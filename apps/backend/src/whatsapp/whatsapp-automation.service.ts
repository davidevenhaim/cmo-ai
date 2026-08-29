import { Injectable, Logger } from "@nestjs/common";
import type { AutomationType } from "@ai-cmo/contracts";
import { AutomationPatchSchema } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "AutomationError";
  }
}

const AUTOMATION_DEFAULTS: Array<{
  type: AutomationType;
  templateKey: string;
  timing: Record<string, unknown>;
  audience: Record<string, unknown>;
}> = [
  {
    type: "ABANDONED_CART",
    templateKey: "abandoned-cart-reminder",
    // Empty: the ladder is owned by RevenuePolicy.recoveryLadderHours (C4),
    // and duplicating it here would create two sources of truth.
    timing: {},
    audience: { segmentType: "ABANDONED_CHECKOUT" },
  },
  {
    type: "REPLENISHMENT",
    templateKey: "replenishment",
    timing: { delayDays: 30 },
    audience: { segmentType: "REPLENISHMENT_DUE" },
  },
  {
    type: "WIN_BACK",
    templateKey: "win-back",
    timing: {},
    audience: { segmentType: "LAPSED_CUSTOMER" },
  },
  {
    type: "VIP",
    templateKey: "vip",
    timing: {},
    audience: { segmentType: "VIP" },
  },
  {
    type: "BACK_IN_STOCK",
    templateKey: "back-in-stock",
    timing: {},
    audience: {},
  },
  {
    type: "POST_PURCHASE",
    templateKey: "review-request",
    timing: { delayDays: 7 },
    audience: { segmentType: "RECENT_CUSTOMER" },
  },
  {
    type: "REVIEW_REQUEST",
    templateKey: "review-request",
    timing: { delayDays: 14 },
    audience: { segmentType: "RECENT_CUSTOMER" },
  },
];

/**
 * Part D — exposes existing revenue flows as owner-configurable WhatsApp
 * automations.
 *
 * This is a configuration surface, not a second execution engine: the actual
 * sends stay in RecoveryJourneyService and friends. Enabling an automation
 * grants permission; it never bypasses OfferPolicyEngine or the pre-send gates.
 */
@Injectable()
export class WhatsAppAutomationService {
  private readonly logger = new Logger(WhatsAppAutomationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Seeds one row per flow. New automations are always DISABLED (Part D). */
  async ensureDefaults(brandId = DEFAULT_BRAND_ID): Promise<void> {
    for (const def of AUTOMATION_DEFAULTS) {
      const existing = await this.prisma.whatsAppAutomation.findUnique({
        where: { brandId_type: { brandId, type: def.type } },
      });
      if (existing) continue;

      const template = await this.prisma.whatsAppTemplate.findUnique({
        where: { brandId_key: { brandId, key: def.templateKey } },
      });

      await this.prisma.whatsAppAutomation.create({
        data: {
          brandId,
          type: def.type,
          mode: "DISABLED",
          channel: "WHATSAPP",
          templateId: template?.id ?? null,
          timing: def.timing as any,
          audience: def.audience as any,
          offerPolicy: {},
        },
      });
    }
  }

  async list(brandId = DEFAULT_BRAND_ID) {
    await this.ensureDefaults(brandId);
    return this.prisma.whatsAppAutomation.findMany({
      where: { brandId },
      orderBy: { type: "asc" },
      include: { template: { select: { id: true, name: true, key: true } } },
    });
  }

  async get(type: AutomationType, brandId = DEFAULT_BRAND_ID) {
    return this.prisma.whatsAppAutomation.findUnique({
      where: { brandId_type: { brandId, type } },
    });
  }

  async patch(
    type: AutomationType,
    patch: unknown,
    brandId = DEFAULT_BRAND_ID,
  ) {
    const parsed = AutomationPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new AutomationError("Invalid automation patch", parsed.error.flatten());
    }
    await this.ensureDefaults(brandId);

    // Going LIVE without a template would mean sending an empty body.
    if (parsed.data.mode === "LIVE") {
      const current = await this.get(type, brandId);
      const templateId =
        parsed.data.templateId !== undefined
          ? parsed.data.templateId
          : current?.templateId;
      if (!templateId) {
        throw new AutomationError(
          "An automation cannot be set LIVE without a template",
        );
      }
    }

    return this.prisma.whatsAppAutomation.update({
      where: { brandId_type: { brandId, type } },
      data: {
        ...(parsed.data.mode !== undefined ? { mode: parsed.data.mode } : {}),
        ...(parsed.data.templateId !== undefined
          ? { templateId: parsed.data.templateId }
          : {}),
        ...(parsed.data.timing !== undefined
          ? { timing: parsed.data.timing as any }
          : {}),
        ...(parsed.data.audience !== undefined
          ? { audience: parsed.data.audience as any }
          : {}),
        ...(parsed.data.offerPolicy !== undefined
          ? { offerPolicy: parsed.data.offerPolicy as any }
          : {}),
        ...(parsed.data.frequencyCapRuleId !== undefined
          ? { frequencyCapRuleId: parsed.data.frequencyCapRuleId }
          : {}),
      },
    });
  }

  /**
   * The single gate the execution path consults.
   *
   * DISABLED and DRY_RUN both return false for "may actually send" — DRY_RUN
   * exercises every eligibility check and records the decision without
   * dispatching a message.
   */
  async resolveMode(
    type: AutomationType,
    brandId = DEFAULT_BRAND_ID,
  ): Promise<{ mode: "DISABLED" | "DRY_RUN" | "LIVE"; maySend: boolean }> {
    const row = await this.prisma.whatsAppAutomation.findUnique({
      where: { brandId_type: { brandId, type } },
    });
    // Absent configuration fails closed.
    const mode = (row?.mode ?? "DISABLED") as "DISABLED" | "DRY_RUN" | "LIVE";
    return { mode, maySend: mode === "LIVE" };
  }

  async recordRun(
    type: AutomationType,
    outcome: { success: number; failure: number },
    brandId = DEFAULT_BRAND_ID,
  ) {
    await this.prisma.whatsAppAutomation.updateMany({
      where: { brandId, type },
      data: {
        lastRunAt: new Date(),
        successCount: { increment: outcome.success },
        failureCount: { increment: outcome.failure },
      },
    });
  }
}
