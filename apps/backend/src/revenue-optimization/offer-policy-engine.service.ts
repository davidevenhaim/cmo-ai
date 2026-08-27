import { Injectable } from "@nestjs/common";
import { REVENUE_POLICY } from "./revenue-policy.config";

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

// Hard limits — cannot be overridden by Claude or experiment variants.
// Values come from RevenuePolicy (env-configurable, sensible defaults).
export const HARD_LIMITS = {
  MAX_DISCOUNT_PCT: REVENUE_POLICY.maxDiscountPct,
  MIN_CONTRIBUTION_MARGIN_PCT: REVENUE_POLICY.minContributionMarginPct,
  MIN_ORDER_VALUE: REVENUE_POLICY.minOrderValue,
  MAX_DISCOUNTS_PER_JOURNEY: REVENUE_POLICY.maxDiscountsPerJourney,
  MIN_HOURS_BEFORE_DISCOUNT: REVENUE_POLICY.minHoursBeforeDiscount,
} as const;

@Injectable()
export class OfferPolicyEngine {
  decide(input: OfferInput): OfferDecision {
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

    if (cartValue < HARD_LIMITS.MIN_ORDER_VALUE) {
      return {
        type: "NO_OFFER",
        reason: `cart value ${cartValue} below minimum ${HARD_LIMITS.MIN_ORDER_VALUE}`,
        marginsSafe: true,
        economicsStatus: "COMPLETE",
      };
    }

    if (priorDiscountsThisJourney >= HARD_LIMITS.MAX_DISCOUNTS_PER_JOURNEY) {
      return {
        type: "NO_OFFER",
        reason: "maximum discounts per journey reached",
        marginsSafe: true,
        economicsStatus: "COMPLETE",
      };
    }

    const economicsStatus: "COMPLETE" | "INCOMPLETE" =
      estimatedMarginPct !== undefined ? "COMPLETE" : "INCOMPLETE";

    // Step 0–6h: reminder only, no incentive
    if (abandonmentAgeHours < HARD_LIMITS.MIN_HOURS_BEFORE_DISCOUNT) {
      return {
        type: "NO_DISCOUNT",
        reason: "too early for discount — send reminder only",
        marginsSafe: true,
        economicsStatus,
      };
    }

    // Near free-shipping threshold?
    const nearThreshold =
      freeShippingThreshold != null &&
      cartValue >=
        freeShippingThreshold *
          REVENUE_POLICY.freeShippingNearThresholdFactor &&
      cartValue < freeShippingThreshold;

    if (nearThreshold) {
      return {
        type: "FREE_SHIPPING",
        reason: `cart is within 20% of free-shipping threshold (${freeShippingThreshold})`,
        marginsSafe: true,
        economicsStatus,
      };
    }

    // Experiment variant override — still subject to hard limits
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

    // Unknown margin must never authorize a discount — fall back to a
    // reminder without incentive until economics are complete.
    if (economicsStatus === "INCOMPLETE") {
      return {
        type: "NO_DISCOUNT",
        reason:
          "ECONOMICS_INCOMPLETE: margin unknown — discount not authorized; send reminder without discount",
        marginsSafe: false,
        economicsStatus,
      };
    }

    // Enforce hard cap
    const clampedPct = Math.min(
      candidateDiscountPct,
      HARD_LIMITS.MAX_DISCOUNT_PCT,
    );

    // Validate margin
    const { safe, violation } = this.validateOfferSafe(
      "PERCENT_DISCOUNT",
      clampedPct,
      cartValue,
      estimatedMarginPct,
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
  ): { safe: boolean; violation?: string } {
    if (type === "PERCENT_DISCOUNT" && value !== undefined) {
      if (value > HARD_LIMITS.MAX_DISCOUNT_PCT) {
        return {
          safe: false,
          violation: `discount ${value}% exceeds hard limit of ${HARD_LIMITS.MAX_DISCOUNT_PCT}%`,
        };
      }
      if (estimatedMarginPct !== undefined) {
        const marginAfterDiscount = estimatedMarginPct - value / 100;
        if (
          marginAfterDiscount <
          HARD_LIMITS.MIN_CONTRIBUTION_MARGIN_PCT / 100
        ) {
          return {
            safe: false,
            violation: `post-discount margin ${(marginAfterDiscount * 100).toFixed(1)}% below floor ${HARD_LIMITS.MIN_CONTRIBUTION_MARGIN_PCT}%`,
          };
        }
      }
    }
    if (type === "FIXED_DISCOUNT" && value !== undefined) {
      const discountPct = (value / cartValue) * 100;
      if (discountPct > HARD_LIMITS.MAX_DISCOUNT_PCT) {
        return {
          safe: false,
          violation: `fixed discount of ${value} is ${discountPct.toFixed(1)}% of cart, exceeding ${HARD_LIMITS.MAX_DISCOUNT_PCT}%`,
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
    if (variant.toLowerCase().includes("free_shipping")) return 0; // handled separately
    return null;
  }
}
