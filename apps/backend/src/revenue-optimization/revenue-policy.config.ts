// Single-brand business policy. Values are configurable via environment
// variables; defaults preserve prior hardcoded behavior. Deliberately not a
// multi-tenant configuration framework.

export interface RevenuePolicy {
  maxDiscountPct: number;
  minContributionMarginPct: number;
  minOrderValue: number;
  maxDiscountsPerJourney: number;
  minHoursBeforeDiscount: number;
  recoveryLadderHours: number[];
  winBackDays: number;
  vipLtvThreshold: number;
  // Cart is "near" the free-shipping threshold when
  // cartValue >= threshold * factor.
  freeShippingNearThresholdFactor: number;
}

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
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

export function loadRevenuePolicy(): RevenuePolicy {
  return {
    maxDiscountPct: envNum("REVENUE_MAX_DISCOUNT_PCT", 20),
    minContributionMarginPct: envNum("REVENUE_MIN_MARGIN_PCT", 15),
    minOrderValue: envNum("REVENUE_MIN_ORDER_VALUE", 30),
    maxDiscountsPerJourney: envNum("REVENUE_MAX_DISCOUNTS_PER_JOURNEY", 2),
    minHoursBeforeDiscount: envNum("REVENUE_MIN_HOURS_BEFORE_DISCOUNT", 6),
    recoveryLadderHours: envNumList(
      "REVENUE_RECOVERY_LADDER_HOURS",
      [1, 6, 24, 48],
    ),
    winBackDays: envNum("REVENUE_WIN_BACK_DAYS", 90),
    vipLtvThreshold: envNum("REVENUE_VIP_LTV_THRESHOLD", 500),
    freeShippingNearThresholdFactor: envNum(
      "REVENUE_FREE_SHIPPING_NEAR_FACTOR",
      0.8,
    ),
  };
}

export const REVENUE_POLICY = loadRevenuePolicy();
