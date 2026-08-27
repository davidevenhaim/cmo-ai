import { Injectable } from "@nestjs/common";
import { OfferPolicyEngine } from "./offer-policy-engine.service";
import { ProductAffinityService } from "./product-affinity.service";

export type ActionType =
  | "DO_NOTHING"
  | "START_RECOVERY_JOURNEY"
  | "SEND_CROSS_SELL"
  | "SEND_UPSELL"
  | "SEND_REPLENISHMENT"
  | "SEND_WIN_BACK"
  | "SEND_FREE_SHIPPING_NUDGE"
  | "PROPOSE_BUNDLE";

export interface NextBestAction {
  action: ActionType;
  opportunityId?: string;
  reason: string;
  offerType?: string;
  offerValue?: number;
  productIds?: string[];
  confidence: number;
}

export interface NBAInput {
  opportunityId?: string;
  opportunityType?: string;
  cartValue?: number;
  estimatedMarginPct?: number;
  customerLtv?: number;
  abandonmentAgeHours?: number;
  priorDiscountsThisJourney?: number;
  productInventoryOk?: boolean;
  freeShippingThreshold?: number;
  purchasedProductIds?: string[];
  inventoryProductIds?: string[];
  experimentVariant?: string;
  hasPhone?: boolean;
  messagingConfigured?: boolean;
}

@Injectable()
export class NextBestActionService {
  constructor(
    private readonly offerPolicy: OfferPolicyEngine,
    private readonly affinity: ProductAffinityService,
  ) {}

  async decide(input: NBAInput): Promise<NextBestAction> {
    // No messaging available — can't act
    if (!input.hasPhone || !input.messagingConfigured) {
      return {
        action: "DO_NOTHING",
        reason: "no messaging channel available",
        confidence: 1.0,
      };
    }

    // Cart / checkout recovery
    if (
      (input.opportunityType === "CART_RECOVERY" ||
        input.opportunityType === "CHECKOUT_RECOVERY") &&
      input.cartValue !== undefined &&
      input.abandonmentAgeHours !== undefined
    ) {
      const decision = this.offerPolicy.decide({
        cartValue: input.cartValue,
        estimatedMarginPct: input.estimatedMarginPct,
        abandonmentAgeHours: input.abandonmentAgeHours,
        priorDiscountsThisJourney: input.priorDiscountsThisJourney ?? 0,
        productInventoryOk: input.productInventoryOk ?? true,
        freeShippingThreshold: input.freeShippingThreshold,
        experimentVariant: input.experimentVariant,
      });

      if (decision.type === "NO_OFFER") {
        return {
          action: "DO_NOTHING",
          reason: decision.reason,
          confidence: 0.9,
        };
      }

      return {
        action: "START_RECOVERY_JOURNEY",
        opportunityId: input.opportunityId,
        reason: decision.reason,
        offerType: decision.type,
        offerValue: decision.value,
        confidence: 0.85,
      };
    }

    // Cross-sell from purchase history
    if (
      input.opportunityType === "CROSS_SELL" &&
      input.purchasedProductIds?.length
    ) {
      const recs = await this.affinity.getRankedRecommendations(
        input.purchasedProductIds,
        3,
        input.inventoryProductIds,
      );

      if (recs.length === 0) {
        return {
          action: "DO_NOTHING",
          reason: "no cross-sell recommendations above threshold",
          confidence: 0.8,
        };
      }

      return {
        action: "SEND_CROSS_SELL",
        opportunityId: input.opportunityId,
        reason: recs[0].reason,
        productIds: recs.map((r) => r.productId),
        confidence: Math.min(recs[0].confidence + 0.1, 1.0),
      };
    }

    // Free shipping nudge
    if (
      input.opportunityType === "FREE_SHIPPING" &&
      input.cartValue !== undefined &&
      input.freeShippingThreshold !== undefined
    ) {
      const gap = input.freeShippingThreshold - input.cartValue;
      return {
        action: "SEND_FREE_SHIPPING_NUDGE",
        opportunityId: input.opportunityId,
        reason: `$${gap.toFixed(2)} away from free shipping`,
        offerType: "FREE_SHIPPING",
        confidence: 0.75,
      };
    }

    // Replenishment
    if (input.opportunityType === "REPLENISHMENT") {
      return {
        action: "SEND_REPLENISHMENT",
        opportunityId: input.opportunityId,
        reason: "customer likely due for replenishment",
        confidence: 0.7,
      };
    }

    // Win-back / VIP
    if (
      input.opportunityType === "WIN_BACK" ||
      input.opportunityType === "VIP"
    ) {
      return {
        action: "SEND_WIN_BACK",
        opportunityId: input.opportunityId,
        reason: `${input.opportunityType} customer re-engagement`,
        confidence: 0.6,
      };
    }

    return {
      action: "DO_NOTHING",
      reason: "no applicable action for current context",
      confidence: 1.0,
    };
  }
}
