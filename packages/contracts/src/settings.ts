import { z } from "zod";

/** Provider-neutral commerce owner policy (not Shopify-specific). */
export const CommerceSettingsSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(10_000),
  defaultMetricsPeriodDays: z.number().int().min(1).max(365),
});

export const CommerceSettingsPatchSchema = CommerceSettingsSchema.partial();

export type CommerceSettings = z.infer<typeof CommerceSettingsSchema>;

/**
 * Persisted revenue safety policy. LLMs cannot override these values.
 * recoveryLadderHours must be ordered, unique, non-negative.
 */
export const RevenuePolicySchema = z
  .object({
    maxDiscountPct: z.number().min(0).max(50),
    minContributionMarginPct: z.number().min(0).max(100),
    minOrderValue: z.number().min(0).max(1_000_000),
    maxDiscountsPerJourney: z.number().int().min(0).max(20),
    minHoursBeforeDiscount: z.number().min(0).max(720),
    recoveryLadderHours: z.array(z.number().min(0).max(8760)).min(1).max(12),
    winBackDays: z.number().int().min(1).max(1825),
    vipLtvThreshold: z.number().min(0).max(10_000_000),
    freeShippingNearFactor: z.number().min(0.1).max(0.99),
  })
  .superRefine((val, ctx) => {
    const ladder = val.recoveryLadderHours;
    for (let i = 1; i < ladder.length; i++) {
      if (ladder[i]! <= ladder[i - 1]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recoveryLadderHours"],
          message: "recoveryLadderHours must be strictly increasing",
        });
        break;
      }
    }
    const unique = new Set(ladder);
    if (unique.size !== ladder.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recoveryLadderHours"],
        message: "recoveryLadderHours values must be unique",
      });
    }
  });

export const RevenuePolicyPatchSchema = z
  .object({
    maxDiscountPct: z.number().min(0).max(50).optional(),
    minContributionMarginPct: z.number().min(0).max(100).optional(),
    minOrderValue: z.number().min(0).max(1_000_000).optional(),
    maxDiscountsPerJourney: z.number().int().min(0).max(20).optional(),
    minHoursBeforeDiscount: z.number().min(0).max(720).optional(),
    recoveryLadderHours: z
      .array(z.number().min(0).max(8760))
      .min(1)
      .max(12)
      .optional(),
    winBackDays: z.number().int().min(1).max(1825).optional(),
    vipLtvThreshold: z.number().min(0).max(10_000_000).optional(),
    freeShippingNearFactor: z.number().min(0.1).max(0.99).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.recoveryLadderHours === undefined) return;
    const ladder = val.recoveryLadderHours;
    for (let i = 1; i < ladder.length; i++) {
      if (ladder[i]! <= ladder[i - 1]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recoveryLadderHours"],
          message: "recoveryLadderHours must be strictly increasing",
        });
        break;
      }
    }
    if (new Set(ladder).size !== ladder.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recoveryLadderHours"],
        message: "recoveryLadderHours values must be unique",
      });
    }
  });

export type RevenuePolicy = z.infer<typeof RevenuePolicySchema>;

export const RuntimeSettingsSchema = z.object({
  commerce: CommerceSettingsSchema,
  revenue: RevenuePolicySchema,
});

export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;

export const SettingsAuditEntrySchema = z.object({
  id: z.string(),
  scope: z.enum(["COMMERCE", "REVENUE"]),
  field: z.string(),
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  source: z.string(),
  actor: z.string().nullable(),
  changedAt: z.coerce.date(),
});

export type SettingsAuditEntry = z.infer<typeof SettingsAuditEntrySchema>;
