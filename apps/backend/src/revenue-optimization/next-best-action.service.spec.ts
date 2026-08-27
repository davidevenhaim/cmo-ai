import { NextBestActionService } from "./next-best-action.service";
import { OfferPolicyEngine } from "./offer-policy-engine.service";
import { ProductAffinityService } from "./product-affinity.service";

const mockOfferPolicy = {
  decide: jest.fn(),
};

const mockAffinity = {
  getRankedRecommendations: jest.fn(),
};

describe("NextBestActionService", () => {
  let service: NextBestActionService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new NextBestActionService(
      mockOfferPolicy as unknown as OfferPolicyEngine,
      mockAffinity as unknown as ProductAffinityService,
    );
  });

  describe("DO_NOTHING — first-class output", () => {
    it("returns DO_NOTHING when no phone", async () => {
      const result = await service.decide({
        opportunityType: "CART_RECOVERY",
        hasPhone: false,
        messagingConfigured: true,
        cartValue: 100,
        abandonmentAgeHours: 24,
        priorDiscountsThisJourney: 0,
        productInventoryOk: true,
      });
      expect(result.action).toBe("DO_NOTHING");
    });

    it("returns DO_NOTHING when messaging not configured", async () => {
      const result = await service.decide({
        opportunityType: "CART_RECOVERY",
        hasPhone: true,
        messagingConfigured: false,
        cartValue: 100,
        abandonmentAgeHours: 24,
        priorDiscountsThisJourney: 0,
        productInventoryOk: true,
      });
      expect(result.action).toBe("DO_NOTHING");
    });

    it("returns DO_NOTHING when offer policy says NO_OFFER", async () => {
      mockOfferPolicy.decide.mockReturnValue({
        type: "NO_OFFER",
        reason: "inventory unavailable",
        marginsSafe: true,
        economicsStatus: "COMPLETE",
      });
      const result = await service.decide({
        opportunityType: "CART_RECOVERY",
        hasPhone: true,
        messagingConfigured: true,
        cartValue: 100,
        abandonmentAgeHours: 24,
        priorDiscountsThisJourney: 0,
        productInventoryOk: false,
      });
      expect(result.action).toBe("DO_NOTHING");
    });
  });

  describe("cart/checkout recovery", () => {
    it("returns START_RECOVERY_JOURNEY for valid cart recovery", async () => {
      mockOfferPolicy.decide.mockReturnValue({
        type: "PERCENT_DISCOUNT",
        value: 10,
        reason: "10% at 24h",
        marginsSafe: true,
        economicsStatus: "INCOMPLETE",
      });
      const result = await service.decide({
        opportunityType: "CART_RECOVERY",
        hasPhone: true,
        messagingConfigured: true,
        cartValue: 100,
        abandonmentAgeHours: 24,
        priorDiscountsThisJourney: 0,
        productInventoryOk: true,
      });
      expect(result.action).toBe("START_RECOVERY_JOURNEY");
      expect(result.offerType).toBe("PERCENT_DISCOUNT");
      expect(result.offerValue).toBe(10);
    });
  });

  describe("cross-sell", () => {
    it("returns SEND_CROSS_SELL when affinity recs available", async () => {
      mockAffinity.getRankedRecommendations.mockResolvedValue([
        {
          productId: "B",
          title: "Cream B",
          confidence: 0.8,
          lift: 2.0,
          reason: "80% of buyers also bought this",
        },
      ]);
      const result = await service.decide({
        opportunityType: "CROSS_SELL",
        hasPhone: true,
        messagingConfigured: true,
        purchasedProductIds: ["A"],
      });
      expect(result.action).toBe("SEND_CROSS_SELL");
      expect(result.productIds).toContain("B");
    });

    it("returns DO_NOTHING when no recs above threshold", async () => {
      mockAffinity.getRankedRecommendations.mockResolvedValue([]);
      const result = await service.decide({
        opportunityType: "CROSS_SELL",
        hasPhone: true,
        messagingConfigured: true,
        purchasedProductIds: ["A"],
      });
      expect(result.action).toBe("DO_NOTHING");
    });
  });

  describe("other opportunity types", () => {
    it("returns SEND_FREE_SHIPPING_NUDGE for FREE_SHIPPING type", async () => {
      const result = await service.decide({
        opportunityType: "FREE_SHIPPING",
        hasPhone: true,
        messagingConfigured: true,
        cartValue: 85,
        freeShippingThreshold: 100,
      });
      expect(result.action).toBe("SEND_FREE_SHIPPING_NUDGE");
    });

    it("returns SEND_REPLENISHMENT for REPLENISHMENT type", async () => {
      const result = await service.decide({
        opportunityType: "REPLENISHMENT",
        hasPhone: true,
        messagingConfigured: true,
      });
      expect(result.action).toBe("SEND_REPLENISHMENT");
    });

    it("returns SEND_WIN_BACK for WIN_BACK type", async () => {
      const result = await service.decide({
        opportunityType: "WIN_BACK",
        hasPhone: true,
        messagingConfigured: true,
      });
      expect(result.action).toBe("SEND_WIN_BACK");
    });

    it("returns DO_NOTHING for unknown opportunity type", async () => {
      const result = await service.decide({
        opportunityType: "UNKNOWN",
        hasPhone: true,
        messagingConfigured: true,
      });
      expect(result.action).toBe("DO_NOTHING");
    });
  });
});
