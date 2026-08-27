import { ProductAffinityService } from "./product-affinity.service";

const mockPrisma = {
  productAffinity: {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
};

describe("ProductAffinityService", () => {
  let service: ProductAffinityService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.productAffinity.upsert.mockResolvedValue({});
    mockPrisma.productAffinity.findMany.mockResolvedValue([]);
    service = new ProductAffinityService(mockPrisma as any);
  });

  describe("computeFromOrders", () => {
    it("returns 0 for empty orders", async () => {
      const result = await service.computeFromOrders([]);
      expect(result).toBe(0);
    });

    it("skips single-product orders (no pairs)", async () => {
      const orders = [
        { products: [{ shopifyProductId: "A", title: "Serum A" }] },
      ];
      const result = await service.computeFromOrders(orders);
      expect(result).toBe(0);
      expect(mockPrisma.productAffinity.upsert).not.toHaveBeenCalled();
    });

    it("computes one pair from a two-product order", async () => {
      const orders = [
        {
          products: [
            { shopifyProductId: "A", title: "Serum A" },
            { shopifyProductId: "B", title: "Cream B" },
          ],
        },
      ];
      const result = await service.computeFromOrders(orders);
      expect(result).toBe(1);
      expect(mockPrisma.productAffinity.upsert).toHaveBeenCalledTimes(2);
    });

    it("computes lift and confidence correctly", async () => {
      const orders = [
        {
          products: [
            { shopifyProductId: "A", title: "A" },
            { shopifyProductId: "B", title: "B" },
          ],
        },
        {
          products: [
            { shopifyProductId: "A", title: "A" },
            { shopifyProductId: "B", title: "B" },
          ],
        },
        { products: [{ shopifyProductId: "B", title: "B" }] },
      ];

      await service.computeFromOrders(orders);

      const firstCall = mockPrisma.productAffinity.upsert.mock.calls[0][0];
      const { confidence, lift } = firstCall.create;
      // A appears 2/3 orders, B appears 3/3, coOccurrence=2
      // confidence A→B = 2/2 = 1.0
      // pB = 3/3 = 1.0, lift = 1.0/1.0 = 1.0
      expect(confidence).toBeCloseTo(1.0);
      expect(lift).toBeCloseTo(1.0);
    });

    it("upserts both A→B and B→A directions", async () => {
      const orders = [
        {
          products: [
            { shopifyProductId: "A", title: "A" },
            { shopifyProductId: "B", title: "B" },
          ],
        },
      ];
      await service.computeFromOrders(orders);
      const calls = mockPrisma.productAffinity.upsert.mock.calls;
      const directionAB = calls.find(
        (c: any) => c[0].where.brandId_productAId_productBId.productAId === "A",
      );
      const directionBA = calls.find(
        (c: any) => c[0].where.brandId_productAId_productBId.productAId === "B",
      );
      expect(directionAB).toBeDefined();
      expect(directionBA).toBeDefined();
    });
  });

  describe("getTopCrossSells", () => {
    it("queries with MIN_SAMPLE and MIN_LIFT filters", async () => {
      await service.getTopCrossSells("prod-A");
      const call = mockPrisma.productAffinity.findMany.mock.calls[0][0];
      expect(call.where.coOccurrences.gte).toBe(5);
      expect(call.where.lift.gte).toBe(1.2);
      expect(call.where.productAId).toBe("prod-A");
      expect(call.orderBy.lift).toBe("desc");
    });

    it("respects limit param", async () => {
      await service.getTopCrossSells("prod-A", 3);
      const call = mockPrisma.productAffinity.findMany.mock.calls[0][0];
      expect(call.take).toBe(3);
    });
  });

  describe("getRankedRecommendations", () => {
    it("excludes already-purchased products", async () => {
      mockPrisma.productAffinity.findMany.mockResolvedValue([
        {
          productBId: "B",
          productBTitle: "Cream B",
          productATitle: "Serum A",
          confidence: 0.8,
          lift: 2.0,
        },
        {
          productBId: "ALREADY",
          productBTitle: "Already bought",
          productATitle: "Serum A",
          confidence: 0.9,
          lift: 2.5,
        },
      ]);

      const results = await service.getRankedRecommendations(
        ["A", "ALREADY"],
        5,
      );
      expect(results.map((r) => r.productId)).not.toContain("ALREADY");
      expect(results.map((r) => r.productId)).toContain("B");
    });

    it("filters by inventory when provided", async () => {
      mockPrisma.productAffinity.findMany.mockResolvedValue([
        {
          productBId: "B",
          productBTitle: "B",
          productATitle: "A",
          confidence: 0.8,
          lift: 1.5,
        },
        {
          productBId: "C",
          productBTitle: "C",
          productATitle: "A",
          confidence: 0.7,
          lift: 1.4,
        },
      ]);

      const results = await service.getRankedRecommendations(["A"], 5, ["B"]);
      expect(results.map((r) => r.productId)).toContain("B");
      expect(results.map((r) => r.productId)).not.toContain("C");
    });

    it("includes reason string", async () => {
      mockPrisma.productAffinity.findMany.mockResolvedValue([
        {
          productBId: "B",
          productBTitle: "Cream B",
          productATitle: "Serum A",
          confidence: 0.75,
          lift: 1.8,
        },
      ]);

      const results = await service.getRankedRecommendations(["A"], 5);
      expect(results[0].reason).toContain("75%");
      expect(results[0].reason).toContain("Serum A");
    });
  });
});
