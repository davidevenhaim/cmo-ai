import { Injectable, Logger } from "@nestjs/common";
import type { WhatsAppContext } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { RuntimeSettingsService } from "../settings/runtime-settings.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

const WINDOW_DAYS = 30;

/** Skip reasons recorded on journey steps, grouped into the reporting buckets. */
const SKIP_BUCKETS: Record<string, keyof WhatsAppContext["suppressed"]> = {
  NO_CONSENT: "noConsent",
  UNKNOWN_CONSENT: "noConsent",
  UNSUBSCRIBED: "noConsent",
  FREQUENCY_CAP: "frequencyCap",
  PURCHASED: "purchasedBeforeSend",
  INVALID_PHONE: "invalidPhone",
  INVENTORY_UNAVAILABLE: "inventoryUnavailable",
};

/**
 * Part E — aggregate WhatsApp performance for the CMO.
 *
 * Strictly aggregate: no phone numbers, no names, no message bodies. The CMO
 * can see that the 24h discount step converts poorly; it cannot see who
 * received it.
 */
@Injectable()
export class WhatsAppContextService {
  private readonly logger = new Logger(WhatsAppContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: WhatsAppSessionService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  async build(brandId = DEFAULT_BRAND_ID): Promise<WhatsAppContext> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const connection = await this.session.getConnection(brandId);

    const currencyCode = await this.resolveCurrency(brandId);

    const [steps, opportunities, attributions, automations] = await Promise.all(
      [
        this.prisma.recoveryJourneyStep.findMany({
          where: {
            journey: { brandId },
            scheduledAt: { gte: since },
          },
          select: {
            stepNumber: true,
            delayHours: true,
            status: true,
            skipReason: true,
            offerType: true,
            channel: true,
          },
          take: 5000,
        }),
        this.prisma.revenueOpportunity.findMany({
          where: {
            brandId,
            type: "ABANDONED_CART",
            createdAt: { gte: since },
          },
          select: { id: true, status: true },
          take: 5000,
        }),
        this.prisma.revenueAttribution.findMany({
          where: { brandId, attributedAt: { gte: since } },
          select: {
            revenue: true,
            contributionProfit: true,
            incentiveCost: true,
            attributionType: true,
          },
          take: 5000,
        }),
        this.prisma.whatsAppAutomation.findMany({
          where: { brandId },
          select: {
            type: true,
            mode: true,
            successCount: true,
            failureCount: true,
            lastRunAt: true,
          },
        }),
      ],
    );

    const whatsappSteps = steps.filter((s) => s.channel === "WHATSAPP");

    const suppressed: WhatsAppContext["suppressed"] = {
      noConsent: 0,
      frequencyCap: 0,
      purchasedBeforeSend: 0,
      invalidPhone: 0,
      inventoryUnavailable: 0,
      other: 0,
    };
    for (const step of whatsappSteps) {
      if (step.status !== "SKIPPED") continue;
      const bucket = SKIP_BUCKETS[step.skipReason ?? ""] ?? "other";
      suppressed[bucket]++;
    }

    const messagesSent = whatsappSteps.filter((s) => s.status === "SENT").length;
    const recovered = opportunities.filter(
      (o) => o.status === "RECOVERED",
    ).length;

    const sum = (key: "revenue" | "contributionProfit" | "incentiveCost") =>
      attributions.reduce((acc, a) => acc + (a[key] ?? 0), 0);

    // Group the ladder by step number so the CMO can compare step economics.
    const byStep = new Map<
      number,
      { delayHours: number; sent: number; skipped: number; offerType: string | null }
    >();
    for (const step of whatsappSteps) {
      const entry = byStep.get(step.stepNumber) ?? {
        delayHours: step.delayHours,
        sent: 0,
        skipped: 0,
        offerType: step.offerType,
      };
      if (step.status === "SENT") entry.sent++;
      if (step.status === "SKIPPED") entry.skipped++;
      byStep.set(step.stepNumber, entry);
    }

    return {
      evidenceStatus: !connection.configured
        ? "NOT_CONFIGURED"
        : connection.status === "WORKING"
          ? "AVAILABLE"
          : "UNAVAILABLE",
      connectionStatus: connection.status,
      currencyCode,
      abandonedCart: {
        eligibleCarts: opportunities.length,
        messagesSent,
        recovered,
        // ATTRIBUTED only — the UI and the prompt both label it that way, and
        // nothing here claims incrementality.
        attributedRevenue: sum("revenue"),
        attributedProfit: sum("contributionProfit"),
        incentiveCost: sum("incentiveCost"),
      },
      suppressed,
      ladderSteps: [...byStep.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(0, 12)
        .map(([stepNumber, v]) => ({
          stepNumber,
          delayHours: v.delayHours,
          sent: v.sent,
          skipped: v.skipped,
          offerType: v.offerType,
        })),
      automations: automations.slice(0, 10).map((a) => ({
        type: a.type as any,
        mode: a.mode as any,
        successCount: a.successCount,
        failureCount: a.failureCount,
        lastRunAt: a.lastRunAt,
      })),
      failureReason: connection.lastError,
    };
  }

  /**
   * C3 — everything is expressed in the store's own currency. Prefer the most
   * recent checkout's code over any hardcoded default.
   */
  private async resolveCurrency(brandId: string): Promise<string> {
    const checkout = await this.prisma.abandonedCheckout.findFirst({
      where: { brandId },
      orderBy: { abandonedAt: "desc" },
      select: { currencyCode: true },
    });
    if (checkout?.currencyCode) return checkout.currencyCode;

    const contact = await this.prisma.contact.findFirst({
      where: { brandId },
      orderBy: { updatedAt: "desc" },
      select: { currencyCode: true },
    });
    return contact?.currencyCode ?? "USD";
  }

  /**
   * C6 — the Abandoned Carts view. Kept beside the context builder because it
   * reads the same journey/attribution spine.
   */
  async getAbandonedCartView(brandId = DEFAULT_BRAND_ID) {
    const currencyCode = await this.resolveCurrency(brandId);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const opportunities = await this.prisma.revenueOpportunity.findMany({
      where: { brandId, type: "ABANDONED_CART", createdAt: { gte: since } },
      orderBy: { abandonedAt: "desc" },
      take: 200,
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            smsMarketingStatus: true,
          },
        },
        journey: { include: { steps: { orderBy: { stepNumber: "asc" } } } },
        attributions: true,
      },
    });

    const rows = opportunities.map((o) => {
      const steps = o.journey?.steps ?? [];
      const sent = steps.filter((s) => s.status === "SENT");
      const currentStep = steps.find((s) => s.status === "PENDING");
      const attributedRevenue = o.attributions.reduce(
        (a, x) => a + (x.revenue ?? 0),
        0,
      );
      const attributedProfit = o.attributions.reduce(
        (a, x) => a + (x.contributionProfit ?? 0),
        0,
      );

      return {
        opportunityId: o.id,
        contactId: o.contactId,
        // Given name only — the abandoned-cart table has no reason to render
        // a full identity.
        contactName: o.contact?.firstName ?? null,
        consent: o.contact?.smsMarketingStatus ?? "UNKNOWN",
        products: o.products,
        cartValue: o.cartValue,
        currencyCode,
        abandonedAt: o.abandonedAt,
        journeyStatus: o.journey?.status ?? "NONE",
        currentStep: currentStep?.stepNumber ?? null,
        currentStepScheduledAt: currentStep?.scheduledAt ?? null,
        offer: sent[sent.length - 1]?.offerType ?? null,
        messagesSent: sent.length,
        recovered: o.status === "RECOVERED",
        recoveredValue: o.recoveryValue,
        attributedRevenue,
        attributedProfit,
      };
    });

    const abandonedValue = rows.reduce((a, r) => a + (r.cartValue ?? 0), 0);
    const eligibleValue = rows
      .filter((r) => r.consent === "SUBSCRIBED")
      .reduce((a, r) => a + (r.cartValue ?? 0), 0);
    const contacted = rows.filter((r) => r.messagesSent > 0).length;
    const recoveredCount = rows.filter((r) => r.recovered).length;

    const attributions = await this.prisma.revenueAttribution.findMany({
      where: { brandId, attributedAt: { gte: since } },
      select: { revenue: true, contributionProfit: true, incentiveCost: true },
    });

    return {
      currencyCode,
      windowDays: WINDOW_DAYS,
      kpis: {
        abandonedValue,
        eligibleValue,
        customersContacted: contacted,
        // Recovery rate over contacted customers, not over all carts.
        recoveryRate: contacted > 0 ? recoveredCount / contacted : null,
        recoveredRevenue: attributions.reduce((a, x) => a + (x.revenue ?? 0), 0),
        discountCost: attributions.reduce(
          (a, x) => a + (x.incentiveCost ?? 0),
          0,
        ),
        attributedRecoveredProfit: attributions.reduce(
          (a, x) => a + (x.contributionProfit ?? 0),
          0,
        ),
        // Stated explicitly so the UI never implies causality it cannot prove.
        attributionNote:
          "ATTRIBUTED, not INCREMENTAL — these figures credit recovery journeys that preceded a purchase. Incremental lift requires a holdout experiment.",
      },
      rows,
    };
  }
}
