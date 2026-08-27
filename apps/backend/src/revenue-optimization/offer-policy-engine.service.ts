import { Injectable, Optional } from "@nestjs/common";
import type { RevenuePolicy } from "@ai-cmo/contracts";
import { RuntimeSettingsService } from "../settings/runtime-settings.service";
import { CODE_REVENUE_DEFAULTS } from "../settings/settings.defaults";

export interface OfferInput {
  cartValue: number;
  estimatedMarginPct?: number;
  customerLtv?: number;
  abandonmentAgeHours: number;
  priorDiscountsThisJourney: number;
  productInventoryOk: boolean;
  freeShippingThreshold?: number;
  existingDiscountPct?: number;
  experimentVariant?: string;
}

export type OfferType =
  | "NO_OFFER"
  | "NO_DISCOUNT"
  | "FREE_SHIPPING"
  | "PERCENT_DISCOUNT"
  | "FIXED_DISCOUNT"
  | "FREE_GIFT";

export interface OfferDecision {
  type: OfferType;
  value?: number;
  currency?: string;
  reason: string;
  marginsSafe: boolean;
  economicsStatus: "COMPLETE" | "INCOMPLETE";
}

/** Snapshot of hard limits derived from authoritative RevenuePolicy. */
export function hardLimitsFrom(policy: RevenuePolicy) {
  return {
    MAX_DISCOUNT_PCT: policy.maxDiscountPct,
    MIN_CONTRIBUTION_MARGIN_PCT: policy.minContributionMarginPct,
    MIN_ORDER_VALUE: policy.minOrderValue,
    MAX_DISCOUNTS_PER_JOURNEY: policy.maxDiscountsPerJourney,
    MIN_HOURS_BEFORE_DISCOUNT: policy.minHoursBeforeDiscount,
  } as const;
}

/** @deprecated Prefer hardLimitsFrom(policy). Code defaults only. */
export const HARD_LIMITS = hardLimitsFrom(CODE_REVENUE_DEFAULTS);

@Injectable()
export class OfferPolicyEngine {
  constructor(@Optional() private readonly settings?: RuntimeSettingsService) {}

  private policy(override?: RevenuePolicy): RevenuePolicy {
    return override ?? this.settings?.getRevenueSync() ?? CODE_REVENUE_DEFAULTS;
  }

  decide(input: OfferInput, policyOverride?: RevenuePolicy): OfferDecision {
    const policy = this.policy(policyOverride);
    const limits = hardLimitsFrom(policy);
    const {
      cartValue,
      estimatedMarginPct,
      abandonmentAgeHours,
      priorDiscountsThisJourney,
      productInventoryOk,
      freeShippingThreshold,
      experimentVariant,
    } = input;

    if (!productInventoryOk) {
      return {
        type: "NO_OFFER",
        reason: "inventory unavailable",
        marginsSafe: true,
        economicsStatus: "COMPLETE",
      };
    }

    if (cartValue < limits.MIN_ORDER_VALUE) {
      return {
        type: "NO_OFFER",
        reason: `cart value ${cartValue} below minimum ${limits.MIN_ORDER_VALUE}`,
        marginsSafe: true,
        economicsStatus: "COMPLETE",
      };
    }

    if (priorDiscountsThisJourney >= limits.MAX_DISCOUNTS_PER_JOURNEY) {
      return {
        type: "NO_OFFER",
        reason: "maximum discounts per journey reached",
        marginsSafe: true,
        economicsStatus: "COMPLETE",
      };
    }

    const economicsStatus: "COMPLETE" | "INCOMPLETE" =
      estimatedMarginPct !== undefined ? "COMPLETE" : "INCOMPLETE";

    if (abandonmentAgeHours < limits.MIN_HOURS_BEFORE_DISCOUNT) {
      return {
        type: "NO_DISCOUNT",
        reason: "too early for discount — send reminder only",
        marginsSafe: true,
        economicsStatus,
      };
    }

    const nearThreshold =
      freeShippingThreshold != null &&
      cartValue >= freeShippingThreshold * policy.freeShippingNearFactor &&
      cartValue < freeShippingThreshold;

    if (nearThreshold) {
      return {
        type: "FREE_SHIPPING",
        reason: `cart is within proximity of free-shipping threshold (${freeShippingThreshold})`,
        marginsSafe: true,
        economicsStatus,
      };
    }

    let candidateDiscountPct =
      this._candidateDiscountByAge(abandonmentAgeHours);
    if (experimentVariant) {
      const override = this._variantDiscountPct(experimentVariant);
      if (override !== null) candidateDiscountPct = override;
    }

    if (candidateDiscountPct <= 0) {
      return {
        type: "NO_DISCOUNT",
        reason: "timing policy: no discount at this stage",
        marginsSafe: true,
        economicsStatus,
      };
    }

    if (economicsStatus === "INCOMPLETE") {
      return {
        type: "NO_DISCOUNT",
        reason:
          "ECONOMICS_INCOMPLETE: margin unknown — discount not authorized; send reminder without discount",
        marginsSafe: false,
        economicsStatus,
      };
    }

    const clampedPct = Math.min(candidateDiscountPct, limits.MAX_DISCOUNT_PCT);

    const { safe, violation } = this.validateOfferSafe(
      "PERCENT_DISCOUNT",
      clampedPct,
      cartValue,
      estimatedMarginPct,
      policy,
    );

    if (!safe) {
      return {
        type: "NO_DISCOUNT",
        reason: `margin validation failed: ${violation}`,
        marginsSafe: false,
        economicsStatus,
      };
    }

    return {
      type: "PERCENT_DISCOUNT",
      value: clampedPct,
      reason: `${clampedPct}% discount at ${abandonmentAgeHours}h abandonment`,
      marginsSafe: true,
      economicsStatus,
    };
  }

  validateOfferSafe(
    type: OfferType,
    value: number | undefined,
    cartValue: number,
    estimatedMarginPct?: number,
    policyOverride?: RevenuePolicy,
  ): { safe: boolean; violation?: string } {
    const limits = hardLimitsFrom(this.policy(policyOverride));
    if (type === "PERCENT_DISCOUNT" && value !== undefined) {
      if (value > limits.MAX_DISCOUNT_PCT) {
        return {
          safe: false,
          violation: `discount ${value}% exceeds hard limit of ${limits.MAX_DISCOUNT_PCT}%`,
        };
      }
      if (estimatedMarginPct !== undefined) {
        const marginAfterDiscount = estimatedMarginPct - value / 100;
        if (marginAfterDiscount < limits.MIN_CONTRIBUTION_MARGIN_PCT / 100) {
          return {
            safe: false,
            violation: `post-discount margin ${(marginAfterDiscount * 100).toFixed(1)}% below floor ${limits.MIN_CONTRIBUTION_MARGIN_PCT}%`,
          };
        }
      }
    }
    if (type === "FIXED_DISCOUNT" && value !== undefined) {
      const discountPct = (value / cartValue) * 100;
      if (discountPct > limits.MAX_DISCOUNT_PCT) {
        return {
          safe: false,
          violation: `fixed discount of ${value} is ${discountPct.toFixed(1)}% of cart, exceeding ${limits.MAX_DISCOUNT_PCT}%`,
        };
      }
    }
    return { safe: true };
  }

  private _candidateDiscountByAge(hours: number): number {
    if (hours >= 24) return 10;
    if (hours >= 12) return 5;
    return 0;
  }

  private _variantDiscountPct(variant: string): number | null {
    const match = variant.match(/(\d+)%/);
    if (match) return parseInt(match[1], 10);
    if (variant.toLowerCase().includes("free_shipping")) return 0;
    return null;
  }
}
