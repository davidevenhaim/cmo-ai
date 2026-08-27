import { FreeShippingOptimizerService } from "./free-shipping-optimizer.service";
import { CODE_REVENUE_DEFAULTS } from "../settings/settings.defaults";

const mockPrisma = {
  revenueOpportunity: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "opp-1" }),
  },
};

const mockSettings = {
  getRevenueSync: () => CODE_REVENUE_DEFAULTS,
  getCommerceSync: jest.fn(),
};

describe("FreeShippingOptimizerService", () => {
  let service: FreeShippingOptimizerService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.revenueOpportunity.findFirst.mockResolvedValue(null);
    mockPrisma.revenueOpportunity.create.mockResolvedValue({ id: "opp-1" });
    service = new FreeShippingOptimizerService(
      mockPrisma as any,
      mockSettings as any,
    );
  });

  describe("isNearThreshold", () => {
    it("returns true when cart is 80–99% of threshold", () => {
      expect(service.isNearThreshold(85, 100)).toBe(true);
      expect(service.isNearThreshold(80, 100)).toBe(true);
      expect(service.isNearThreshold(99, 100)).toBe(true);
    });

    it("returns false when cart is below 80% of threshold", () => {
      expect(service.isNearThreshold(79, 100)).toBe(false);
    });

    it("returns false when cart is at or above threshold", () => {
      expect(service.isNearThreshold(100, 100)).toBe(false);
      expect(service.isNearThreshold(110, 100)).toBe(false);
    });
  });

  describe("gapToThreshold", () => {
    it("returns correct gap", () => {
      expect(service.gapToThreshold(85, 100)).toBeCloseTo(15);
    });

    it("returns 0 when already at or above threshold", () => {
      expect(service.gapToThreshold(100, 100)).toBe(0);
      expect(service.gapToThreshold(120, 100)).toBe(0);
    });
  });

  describe("createFreeShippingOpportunity", () => {
    const cart = {
      contactId: "c-1",
      shopifyCheckoutId: "ch-1",
      cartValue: 85,
      products: [],
    };

    it("creates opportunity when near threshold", async () => {
      const id = await service.createFreeShippingOpportunity(cart, 100);
      expect(id).toBe("opp-1");
      expect(mockPrisma.revenueOpportunity.create).toHaveBeenCalled();
    });

    it("returns null when not near threshold", async () => {
      const id = await service.createFreeShippingOpportunity(
        { ...cart, cartValue: 50 },
        100,
      );
      expect(id).toBeNull();
      expect(mockPrisma.revenueOpportunity.create).not.toHaveBeenCalled();
    });

    it("returns existing opportunity id without creating duplicate", async () => {
      mockPrisma.revenueOpportunity.findFirst.mockResolvedValue({
        id: "existing-opp",
      });
      const id = await service.createFreeShippingOpportunity(cart, 100);
      expect(id).toBe("existing-opp");
      expect(mockPrisma.revenueOpportunity.create).not.toHaveBeenCalled();
    });
  });

  describe("suggestUpsellProducts", () => {
    const catalog = [
      { shopifyProductId: "A", title: "Eye Cream", price: 12 },
      { shopifyProductId: "B", title: "Toner", price: 18 },
      { shopifyProductId: "C", title: "Luxury Set", price: 80 },
    ];

    it("returns products within 80–200% of gap price", () => {
      const results = service.suggestUpsellProducts(85, 100, catalog);
      // gap = 15; 80% of 15 = 12, 200% of 15 = 30
      expect(results.map((r) => r.shopifyProductId)).toContain("A");
      expect(results.map((r) => r.shopifyProductId)).toContain("B");
      expect(results.map((r) => r.shopifyProductId)).not.toContain("C");
    });

    it("returns empty array when already at threshold", () => {
      const results = service.suggestUpsellProducts(100, 100, catalog);
      expect(results).toHaveLength(0);
    });

    it("limits results to 3", () => {
      const bigCatalog = Array.from({ length: 10 }, (_, i) => ({
        shopifyProductId: `p${i}`,
        title: `P${i}`,
        price: 15,
      }));
      const results = service.suggestUpsellProducts(85, 100, bigCatalog);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });
});
