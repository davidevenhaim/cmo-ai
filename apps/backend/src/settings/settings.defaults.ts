/**
 * Code defaults + bootstrap-from-env helpers.
 *
 * Precedence (documented):
 * 1. Persisted Brand configuration — authoritative
 * 2. Bootstrap/default env values — used only when creating initial rows
 * 3. Safe code defaults — final fallback
 *
 * Changing env after initialization must NOT overwrite persisted policy.
 */

import type { CommerceSettings, RevenuePolicy } from "@ai-cmo/contracts";

export const CODE_COMMERCE_DEFAULTS: CommerceSettings = {
  lowStockThreshold: 5,
  defaultMetricsPeriodDays: 30,
};

export const CODE_REVENUE_DEFAULTS: RevenuePolicy = {
  maxDiscountPct: 20,
  minContributionMarginPct: 15,
  minOrderValue: 30,
  maxDiscountsPerJourney: 2,
  minHoursBeforeDiscount: 6,
  recoveryLadderHours: [1, 6, 24, 48],
  winBackDays: 90,
  vipLtvThreshold: 500,
  freeShippingNearFactor: 0.8,
};

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envNumList(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : fallback;
}

/** Bootstrap defaults only — never authoritative after rows exist. */
export function bootstrapCommerceDefaults(): CommerceSettings {
  return {
    lowStockThreshold: Math.max(
      0,
      Math.floor(
        envNum(
          "SHOPIFY_LOW_STOCK_THRESHOLD",
          CODE_COMMERCE_DEFAULTS.lowStockThreshold,
        ),
      ),
    ),
    defaultMetricsPeriodDays: Math.max(
      1,
      Math.floor(
        envNum(
          "SHOPIFY_DEFAULT_PERIOD_DAYS",
          CODE_COMMERCE_DEFAULTS.defaultMetricsPeriodDays,
        ),
      ),
    ),
  };
}

/** Bootstrap defaults only — never authoritative after rows exist. */
export function bootstrapRevenueDefaults(): RevenuePolicy {
  return {
    maxDiscountPct: envNum(
      "REVENUE_MAX_DISCOUNT_PCT",
      CODE_REVENUE_DEFAULTS.maxDiscountPct,
    ),
    minContributionMarginPct: envNum(
      "REVENUE_MIN_MARGIN_PCT",
      CODE_REVENUE_DEFAULTS.minContributionMarginPct,
    ),
    minOrderValue: envNum(
      "REVENUE_MIN_ORDER_VALUE",
      CODE_REVENUE_DEFAULTS.minOrderValue,
    ),
    maxDiscountsPerJourney: Math.floor(
      envNum(
        "REVENUE_MAX_DISCOUNTS_PER_JOURNEY",
        CODE_REVENUE_DEFAULTS.maxDiscountsPerJourney,
      ),
    ),
    minHoursBeforeDiscount: envNum(
      "REVENUE_MIN_HOURS_BEFORE_DISCOUNT",
      CODE_REVENUE_DEFAULTS.minHoursBeforeDiscount,
    ),
    recoveryLadderHours: envNumList(
      "REVENUE_RECOVERY_LADDER_HOURS",
      CODE_REVENUE_DEFAULTS.recoveryLadderHours,
    ),
    winBackDays: Math.floor(
      envNum("REVENUE_WIN_BACK_DAYS", CODE_REVENUE_DEFAULTS.winBackDays),
    ),
    vipLtvThreshold: envNum(
      "REVENUE_VIP_LTV_THRESHOLD",
      CODE_REVENUE_DEFAULTS.vipLtvThreshold,
    ),
    freeShippingNearFactor: envNum(
      "REVENUE_FREE_SHIPPING_NEAR_FACTOR",
      CODE_REVENUE_DEFAULTS.freeShippingNearFactor,
    ),
  };
}

/** @deprecated Prefer RevenuePolicyService.get(). Env is bootstrap-only. */
export function loadRevenuePolicy(): RevenuePolicy {
  return bootstrapRevenueDefaults();
}

/** @deprecated Prefer RevenuePolicyService.get(). */
export const REVENUE_POLICY = CODE_REVENUE_DEFAULTS;
