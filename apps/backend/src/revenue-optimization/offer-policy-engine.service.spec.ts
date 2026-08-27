import { OfferPolicyEngine, HARD_LIMITS } from "./offer-policy-engine.service";

describe("OfferPolicyEngine", () => {
  let engine: OfferPolicyEngine;

  beforeEach(() => {
    engine = new OfferPolicyEngine();
  });

  const base = {
    cartValue: 80,
    abandonmentAgeHours: 24,
    priorDiscountsThisJourney: 0,
    productInventoryOk: true,
    estimatedMarginPct: 0.5,
  };

  describe("hard-limit gates", () => {
    it("returns NO_OFFER when inventory unavailable", () => {
      const result = engine.decide({ ...base, productInventoryOk: false });
      expect(result.type).toBe("NO_OFFER");
      expect(result.marginsSafe).toBe(true);
    });

    it("returns NO_OFFER when cart below minimum", () => {
      const result = engine.decide({ ...base, cartValue: 20 });
      expect(result.type).toBe("NO_OFFER");
      expect(result.reason).toContain("minimum");
    });

    it("returns NO_OFFER when max discounts per journey reached", () => {
      const result = engine.decide({
        ...base,
        priorDiscountsThisJourney: HARD_LIMITS.MAX_DISCOUNTS_PER_JOURNEY,
      });
      expect(result.type).toBe("NO_OFFER");
      expect(result.reason).toContain("maximum discounts");
    });

    it("returns NO_DISCOUNT when abandonment age below threshold", () => {
      const result = engine.decide({ ...base, abandonmentAgeHours: 3 });
      expect(result.type).toBe("NO_DISCOUNT");
      expect(result.reason).toContain("reminder");
    });
  });

  describe("free-shipping near threshold", () => {
    it("returns FREE_SHIPPING when cart is 80–99% of threshold", () => {
      const result = engine.decide({
        ...base,
        cartValue: 85,
        freeShippingThreshold: 100,
        abandonmentAgeHours: 8,
      });
      expect(result.type).toBe("FREE_SHIPPING");
    });

    it("does not return FREE_SHIPPING when cart already at threshold", () => {
      const result = engine.decide({
        ...base,
        cartValue: 100,
        freeShippingThreshold: 100,
        abandonmentAgeHours: 8,
      });
      expect(result.type).not.toBe("FREE_SHIPPING");
    });
  });

  describe("discount ladder", () => {
    it("returns 5% at 12–23h", () => {
      const result = engine.decide({ ...base, abandonmentAgeHours: 12 });
      expect(result.type).toBe("PERCENT_DISCOUNT");
      expect(result.value).toBe(5);
    });

    it("returns 10% at 24h+", () => {
      const result = engine.decide({ ...base, abandonmentAgeHours: 24 });
      expect(result.type).toBe("PERCENT_DISCOUNT");
      expect(result.value).toBe(10);
    });

    it("returns NO_DISCOUNT between 6–11h (no discount zone)", () => {
      const result = engine.decide({ ...base, abandonmentAgeHours: 8 });
      expect(result.type).toBe("NO_DISCOUNT");
    });
  });

  describe("experiment variant override", () => {
    it("applies variant discount pct but still caps at hard limit", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        experimentVariant: "25%",
      });
      expect(result.type).toBe("PERCENT_DISCOUNT");
      expect(result.value).toBe(HARD_LIMITS.MAX_DISCOUNT_PCT);
    });

    it("applies variant discount within hard limit", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        experimentVariant: "15%",
      });
      expect(result.type).toBe("PERCENT_DISCOUNT");
      expect(result.value).toBe(15);
    });
  });

  describe("margin validation", () => {
    it("returns NO_DISCOUNT when margin would breach floor", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        estimatedMarginPct: 0.2,
      });
      expect(result.type).toBe("NO_DISCOUNT");
      expect(result.marginsSafe).toBe(false);
    });

    it("allows discount when margin is safe", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        estimatedMarginPct: 0.4,
      });
      expect(result.type).toBe("PERCENT_DISCOUNT");
      expect(result.marginsSafe).toBe(true);
    });

    it("marks economicsStatus INCOMPLETE when marginPct not provided", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        estimatedMarginPct: undefined,
      });
      expect(result.economicsStatus).toBe("INCOMPLETE");
    });

    it("never authorizes a discount when margin is unknown (ECONOMICS_INCOMPLETE)", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        estimatedMarginPct: undefined,
      });
      expect(result.type).toBe("NO_DISCOUNT");
      expect(result.reason).toContain("ECONOMICS_INCOMPLETE");
      expect(result.marginsSafe).toBe(false);
      expect(result.economicsStatus).toBe("INCOMPLETE");
    });

    it("blocks experiment variant discounts when margin is unknown", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        estimatedMarginPct: undefined,
        experimentVariant: "15%",
      });
      expect(result.type).toBe("NO_DISCOUNT");
      expect(result.reason).toContain("ECONOMICS_INCOMPLETE");
    });

    it("marks economicsStatus COMPLETE when marginPct provided", () => {
      const result = engine.decide({
        ...base,
        abandonmentAgeHours: 24,
        estimatedMarginPct: 0.5,
      });
      expect(result.economicsStatus).toBe("COMPLETE");
    });
  });

  describe("validateOfferSafe", () => {
    it("rejects PERCENT_DISCOUNT exceeding hard cap", () => {
      const { safe, violation } = engine.validateOfferSafe(
        "PERCENT_DISCOUNT",
        25,
        100,
      );
      expect(safe).toBe(false);
      expect(violation).toContain("hard limit");
    });

    it("rejects FIXED_DISCOUNT that exceeds pct cap", () => {
      const { safe, violation } = engine.validateOfferSafe(
        "FIXED_DISCOUNT",
        30,
        100,
      );
      expect(safe).toBe(false);
      expect(violation).toContain("exceeding");
    });

    it("accepts valid FIXED_DISCOUNT", () => {
      const { safe } = engine.validateOfferSafe("FIXED_DISCOUNT", 10, 100);
      expect(safe).toBe(true);
    });
  });
});
