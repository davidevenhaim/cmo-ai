import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { FrequencyCapService } from "../growth/frequency-cap.service";
import type { MessagingProvider } from "./providers/messaging.provider";
import { OfferPolicyEngine } from "./offer-policy-engine.service";
import { RuntimeSettingsService } from "../settings/runtime-settings.service";

const BRAND_ID = "luminesce-brand-001";

interface JourneyStep {
  stepNumber: number;
  delayHours: number;
  channel: string;
}

type CartInventoryStatus =
  "OK" | "PARTIAL_UNAVAILABLE" | "ALL_UNAVAILABLE" | "UNKNOWN";

@Injectable()
export class RecoveryJourneyService {
  private readonly logger = new Logger(RecoveryJourneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject("MESSAGING_PROVIDER")
    private readonly messaging: MessagingProvider,
    private readonly offerPolicy: OfferPolicyEngine,
    private readonly frequencyCaps: FrequencyCapService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private ladder(): JourneyStep[] {
    return this.settings
      .getRevenueSync()
      .recoveryLadderHours.map((delayHours, i) => ({
        stepNumber: i + 1,
        delayHours,
        channel: "WHATSAPP",
      }));
  }

  async startJourney(
    opportunityId: string,
    opts: {
      cartValue: number;
      phone?: string;
      freeShippingThreshold?: number;
      estimatedMarginPct?: number;
      priorDiscountsThisJourney?: number;
      experimentVariant?: string;
    },
  ): Promise<string> {
    const existing = await this.prisma.recoveryJourney.findUnique({
      where: { opportunityId },
    });
    if (existing) return existing.id;

    const opportunity = await this.prisma.revenueOpportunity.findUnique({
      where: { id: opportunityId },
      select: { contactId: true, products: true },
    });

    // One journey per customer at a time — never run simultaneous ladders.
    if (opportunity?.contactId) {
      const activeForContact = await this.prisma.recoveryJourney.findFirst({
        where: {
          status: "ACTIVE",
          opportunity: { contactId: opportunity.contactId },
        },
      });
      if (activeForContact) {
        this.logger.log(
          `Contact ${opportunity.contactId} already has active journey ${activeForContact.id}; not starting another`,
        );
        return activeForContact.id;
      }
    }

    const inventoryStatus = await this._cartInventoryStatus(
      opportunity?.products,
    );
    const productInventoryOk =
      inventoryStatus === "OK" || inventoryStatus === "UNKNOWN";

    const now = new Date();
    const journey = await this.prisma.recoveryJourney.create({
      data: {
        brandId: BRAND_ID,
        opportunityId,
        status: "ACTIVE",
        steps: {
          create: this.ladder().map((s) => {
            const scheduledAt = new Date(
              now.getTime() + s.delayHours * 60 * 60 * 1000,
            );
            const decision = this.offerPolicy.decide({
              cartValue: opts.cartValue,
              estimatedMarginPct: opts.estimatedMarginPct,
              abandonmentAgeHours: s.delayHours,
              priorDiscountsThisJourney: opts.priorDiscountsThisJourney ?? 0,
              productInventoryOk,
              freeShippingThreshold: opts.freeShippingThreshold,
              experimentVariant: opts.experimentVariant,
            });

            return {
              stepNumber: s.stepNumber,
              delayHours: s.delayHours,
              scheduledAt,
              channel: s.channel,
              offerType: decision.type,
              offerValue:
                decision.type === "PERCENT_DISCOUNT" ? decision.value : null,
              status: "PENDING",
            };
          }),
        },
      },
    });

    this.logger.log(
      `Started recovery journey ${journey.id} for opp ${opportunityId}`,
    );
    return journey.id;
  }

  async processAllDueSteps(): Promise<number> {
    const dueSteps = await this.prisma.recoveryJourneyStep.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: new Date() },
        journey: { status: "ACTIVE" },
      },
      include: {
        journey: {
          include: { opportunity: true },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    });

    let executed = 0;
    for (const step of dueSteps) {
      try {
        const handled = await this._executeStep(step);
        if (handled) executed++;
      } catch (err: any) {
        this.logger.warn(`Step ${step.id} failed: ${err.message}`);
      }
    }
    return executed;
  }

  // Returns true when this worker claimed and handled the step (sent, skipped,
  // or failed) — false when another worker won the claim.
  private async _executeStep(step: any): Promise<boolean> {
    // Atomic claim: only one worker may transition PENDING → EXECUTING.
    const claim = await this.prisma.recoveryJourneyStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "EXECUTING" },
    });
    if (claim.count === 0) return false;

    const opp = step.journey.opportunity;

    const skip = async (reason: string) => {
      await this.prisma.recoveryJourneyStep.update({
        where: { id: step.id },
        data: {
          status: "SKIPPED",
          skipReason: reason,
          executedAt: new Date(),
        },
      });
    };

    if (opp.status === "RECOVERED") {
      await skip("PURCHASED");
      return true;
    }
    if (opp.status === "EXPIRED") {
      await skip("JOURNEY_STOPPED");
      return true;
    }

    // Purchase re-check against freshest sync data — the opportunity row may
    // lag behind the checkout record.
    let checkoutCurrency: string | null = null;
    if (opp.abandonedCheckoutId) {
      const checkout = await this.prisma.abandonedCheckout.findUnique({
        where: { id: opp.abandonedCheckoutId },
        select: { status: true, recoveredAt: true, currencyCode: true },
      });
      checkoutCurrency = checkout?.currencyCode ?? null;
      if (checkout?.recoveredAt || checkout?.status === "RECOVERED") {
        await skip("PURCHASED");
        await this.stopJourney(opp.id, "PURCHASED");
        return true;
      }
    }

    if (!opp.contactId) {
      await skip("INVALID_PHONE");
      return true;
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: opp.contactId },
      select: {
        phone: true,
        smsMarketingStatus: true,
        lastOrderAt: true,
        currencyCode: true,
      },
    });

    if (!contact?.phone) {
      await skip("INVALID_PHONE");
      return true;
    }

    // Customer ordered after abandoning — treat as converted.
    if (
      contact.lastOrderAt &&
      opp.abandonedAt &&
      contact.lastOrderAt > opp.abandonedAt
    ) {
      await skip("PURCHASED");
      await this.stopJourney(opp.id, "PURCHASED");
      return true;
    }

    // Consent gate — fail closed. Only explicit SUBSCRIBED may receive
    // WhatsApp marketing; anything else is suppressed.
    const consent = contact.smsMarketingStatus;
    if (consent !== "SUBSCRIBED") {
      const reason =
        consent === "UNSUBSCRIBED" || consent === "REDACTED"
          ? "UNSUBSCRIBED"
          : consent === "NOT_SUBSCRIBED"
            ? "NO_CONSENT"
            : "UNKNOWN_CONSENT";
      await skip(reason);
      return true;
    }

    const suppression = await this.prisma.contactSuppression.findFirst({
      where: {
        contactId: opp.contactId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (suppression) {
      await skip(this._mapSuppressionReason(suppression.reason));
      return true;
    }

    const withinCaps = await this.frequencyCaps.isEligible(
      opp.contactId,
      "CART_RECOVERY",
    );
    if (!withinCaps) {
      await skip("FREQUENCY_CAP");
      return true;
    }

    if (!this.messaging.isConfigured()) {
      await skip("messaging not configured");
      return true;
    }

    // Inventory re-check at send time.
    const inventoryStatus = await this._cartInventoryStatus(opp.products);
    if (inventoryStatus === "ALL_UNAVAILABLE") {
      await skip("INVENTORY_UNAVAILABLE");
      return true;
    }
    const offerSuppressed = inventoryStatus === "PARTIAL_UNAVAILABLE";

    const currencyCode = checkoutCurrency ?? contact.currencyCode ?? "USD";
    const body = this._buildMessage(step, opp, currencyCode, offerSuppressed);
    const result = await this.messaging.send({ to: contact.phone, body });

    const status = result.success
      ? "SENT"
      : result.outcome === "UNKNOWN"
        ? "UNKNOWN"
        : "FAILED";

    await this.prisma.recoveryJourneyStep.update({
      where: { id: step.id },
      data: {
        status,
        executedAt: new Date(),
        messageBody: body,
        providerMessageId: result.providerMessageId,
        skipReason: result.success ? undefined : result.error,
      },
    });

    if (result.success) {
      await this.prisma.customerRevenueAction.create({
        data: {
          brandId: BRAND_ID,
          opportunityId: opp.id,
          type: "MESSAGE_SENT",
          channel: step.channel,
          providerMessageId: result.providerMessageId,
          metadata: { stepNumber: step.stepNumber, offerType: step.offerType },
        },
      });
      // Record touch so frequency caps count WhatsApp sends.
      await this.prisma.campaignTouch.create({
        data: {
          contactId: opp.contactId,
          abandonedCheckoutId: opp.abandonedCheckoutId ?? undefined,
          touchType: "SEND",
          metadata: {
            source: "RECOVERY_JOURNEY",
            journeyId: step.journeyId,
            stepNumber: step.stepNumber,
            channel: step.channel,
          },
        },
      });
    }
    return true;
  }

  async stopJourney(opportunityId: string, reason: string): Promise<void> {
    const journey = await this.prisma.recoveryJourney.findUnique({
      where: { opportunityId },
    });
    if (!journey) return;

    await this.prisma.recoveryJourney.update({
      where: { id: journey.id },
      data: { status: "STOPPED", stopReason: reason },
    });

    await this.prisma.recoveryJourneyStep.updateMany({
      where: { journeyId: journey.id, status: "PENDING" },
      data: { status: "CANCELLED", skipReason: reason },
    });
  }

  private _mapSuppressionReason(reason: string): string {
    switch (reason) {
      case "RECENTLY_CONTACTED":
        return "FREQUENCY_CAP";
      case "PURCHASE_COMPLETED":
        return "PURCHASED";
      case "INVALID_CONTACT":
        return "INVALID_PHONE";
      default:
        return reason;
    }
  }

  // Checks cart line items against the latest commerce snapshot's
  // zero-inventory products. UNKNOWN when no usable snapshot exists —
  // callers must not treat UNKNOWN as confirmation of availability.
  private async _cartInventoryStatus(
    products: unknown,
  ): Promise<CartInventoryStatus> {
    const items = Array.isArray(products) ? products : [];
    if (items.length === 0) return "UNKNOWN";

    const snapshot = await this.prisma.commerceSnapshot.findFirst({
      where: { brandId: BRAND_ID },
      orderBy: { snapshotAt: "desc" },
    });
    const metrics = snapshot?.metricsJson as
      | {
          lowInventoryProducts?: Array<{
            productId: string;
            totalUnits: number;
          }>;
        }
      | null
      | undefined;
    if (!snapshot?.available || !metrics?.lowInventoryProducts) {
      return "UNKNOWN";
    }

    const outOfStock = new Set(
      metrics.lowInventoryProducts
        .filter((p) => (p.totalUnits ?? 0) <= 0)
        .map((p) => String(p.productId)),
    );
    if (outOfStock.size === 0) return "OK";

    const unavailable = items.filter((li: any) =>
      outOfStock.has(String(li?.shopifyProductId ?? li?.productId ?? "")),
    );
    if (unavailable.length === 0) return "OK";
    return unavailable.length === items.length
      ? "ALL_UNAVAILABLE"
      : "PARTIAL_UNAVAILABLE";
  }

  private _formatMoney(value: number, currencyCode: string): string {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
      }).format(value);
    } catch {
      return `${currencyCode} ${value.toFixed(2)}`;
    }
  }

  private _buildMessage(
    step: any,
    opp: any,
    currencyCode: string,
    offerSuppressed: boolean,
  ): string {
    const cartVal =
      opp.cartValue != null
        ? this._formatMoney(opp.cartValue, currencyCode)
        : "your cart";
    const recoveryUrl = opp.recoveryUrl ?? "";

    if (!offerSuppressed) {
      if (step.offerType === "FREE_SHIPPING") {
        return `You left ${cartVal} behind! Complete your order now and get FREE shipping: ${recoveryUrl}`;
      }
      if (step.offerType === "PERCENT_DISCOUNT" && step.offerValue) {
        return `Still thinking? Save ${step.offerValue}% on your ${cartVal} order — limited time: ${recoveryUrl}`;
      }
    }
    return `You have items waiting in your cart (${cartVal}). Complete your purchase: ${recoveryUrl}`;
  }
}
