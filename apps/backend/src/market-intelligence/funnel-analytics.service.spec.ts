import { Test, TestingModule } from "@nestjs/testing";
import { FunnelAnalyticsService } from "./funnel-analytics.service";
import { PrismaService } from "../prisma.service";

const mockPrisma = {
  productFunnelMetric: {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  },
};

describe("FunnelAnalyticsService", () => {
  let service: FunnelAnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunnelAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(FunnelAnalyticsService);
  });

  // ── ingestFromCommerceContext ──────────────────────────────────────────────
  describe("ingestFromCommerceContext", () => {
    it("upserts one metric per product", async () => {
      await service.ingestFromCommerceContext({
        metrics: {
          revenueByProduct: [
            {
              shopifyProductId: "gid://shopify/Product/1",
              title: "Night Balm",
              revenue: 1200,
              unitsSold: 40,
            },
            {
              shopifyProductId: "gid://shopify/Product/2",
              title: "Lip Balm",
              revenue: 800,
              unitsSold: 80,
            },
          ],
        },
      });
      expect(mockPrisma.productFunnelMetric.upsert).toHaveBeenCalledTimes(2);
    });

    it("stores purchases from unitsSold and revenue", async () => {
      await service.ingestFromCommerceContext({
        metrics: {
          revenueByProduct: [
            {
              shopifyProductId: "p1",
              title: "Night Balm",
              revenue: 500,
              unitsSold: 20,
            },
          ],
        },
      });
      const createArg =
        mockPrisma.productFunnelMetric.upsert.mock.calls[0][0].create;
      expect(createArg.purchases).toBe(20);
      expect(createArg.revenue).toBe(500);
    });

    it("sets views/atcRate/conversionRate to 0/null (not available from commerce context)", async () => {
      await service.ingestFromCommerceContext({
        metrics: {
          revenueByProduct: [
            { title: "Night Balm", revenue: 100, unitsSold: 5 },
          ],
        },
      });
      const createArg =
        mockPrisma.productFunnelMetric.upsert.mock.calls[0][0].create;
      expect(createArg.views).toBe(0);
      expect(createArg.atcRate).toBeNull();
      expect(createArg.conversionRate).toBeNull();
    });

    it("returns 0 when revenueByProduct is empty", async () => {
      const count = await service.ingestFromCommerceContext({
        metrics: { revenueByProduct: [] },
      });
      expect(count).toBe(0);
    });

    it("returns 0 when metrics are absent", async () => {
      const count = await service.ingestFromCommerceContext({});
      expect(count).toBe(0);
    });

    it("skips products with no title", async () => {
      await service.ingestFromCommerceContext({
        metrics: {
          revenueByProduct: [{ title: "", revenue: 100, unitsSold: 5 }],
        },
      });
      expect(mockPrisma.productFunnelMetric.upsert).not.toHaveBeenCalled();
    });
  });

  // ── detectFunnelIssues ────────────────────────────────────────────────────
  describe("detectFunnelIssues", () => {
    const base = {
      productName: "Test",
      shopifyProductId: "p1",
      views: 0,
      addToCart: 0,
      checkoutStarts: 0,
      purchases: 0,
      atcRate: null,
      checkoutRate: null,
      purchaseRate: null,
      conversionRate: null,
    };

    it("detects HIGH_TRAFFIC_LOW_ATC when views ≥ 100 and atcRate < 5%", () => {
      const issues = service.detectFunnelIssues([
        {
          ...base,
          productName: "Night Balm",
          views: 500,
          addToCart: 10,
          atcRate: 0.02,
        },
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0].issue).toBe("HIGH_TRAFFIC_LOW_ATC");
      expect(issues[0].productName).toBe("Night Balm");
    });

    it("does not flag HIGH_TRAFFIC_LOW_ATC when views < 100", () => {
      const issues = service.detectFunnelIssues([
        { ...base, views: 50, addToCart: 1, atcRate: 0.02 },
      ]);
      expect(
        issues.find((i) => i.issue === "HIGH_TRAFFIC_LOW_ATC"),
      ).toBeUndefined();
    });

    it("detects HIGH_ATC_LOW_CHECKOUT when atcRate ≥ 10% and checkoutRate < 30%", () => {
      const issues = service.detectFunnelIssues([
        {
          ...base,
          views: 100,
          addToCart: 20,
          atcRate: 0.2,
          checkoutStarts: 4,
          checkoutRate: 0.2,
        },
      ]);
      expect(
        issues.find((i) => i.issue === "HIGH_ATC_LOW_CHECKOUT"),
      ).toBeDefined();
    });

    it("detects HIGH_CHECKOUT_ABANDONMENT when checkoutRate ≥ 30% and purchaseRate < 50%", () => {
      const issues = service.detectFunnelIssues([
        {
          ...base,
          views: 200,
          addToCart: 60,
          checkoutStarts: 30,
          purchases: 10,
          atcRate: 0.3,
          checkoutRate: 0.5,
          purchaseRate: 0.33,
        },
      ]);
      expect(
        issues.find((i) => i.issue === "HIGH_CHECKOUT_ABANDONMENT"),
      ).toBeDefined();
    });

    it("detects LOW_TRAFFIC_HIGH_CONVERSION when views < 50 and conversionRate > 10%", () => {
      const issues = service.detectFunnelIssues([
        { ...base, views: 30, purchases: 6, conversionRate: 0.2 },
      ]);
      expect(
        issues.find((i) => i.issue === "LOW_TRAFFIC_HIGH_CONVERSION"),
      ).toBeDefined();
    });

    it("returns no issues for a healthy product", () => {
      const issues = service.detectFunnelIssues([
        {
          ...base,
          views: 200,
          addToCart: 30,
          checkoutStarts: 20,
          purchases: 15,
          atcRate: 0.15,
          checkoutRate: 0.67,
          purchaseRate: 0.75,
          conversionRate: 0.075,
        },
      ]);
      expect(issues).toHaveLength(0);
    });

    it("returns empty array for empty input", () => {
      expect(service.detectFunnelIssues([])).toHaveLength(0);
    });

    it("computes atcRate from raw counts when atcRate field is null", () => {
      // views=200, addToCart=5 → atcRate=0.025 < 0.05 → HIGH_TRAFFIC_LOW_ATC
      const issues = service.detectFunnelIssues([
        { ...base, views: 200, addToCart: 5, atcRate: null },
      ]);
      expect(
        issues.find((i) => i.issue === "HIGH_TRAFFIC_LOW_ATC"),
      ).toBeDefined();
    });
  });

  // ── getProductFunnelSummary ───────────────────────────────────────────────
  describe("getProductFunnelSummary", () => {
    it("returns metrics ordered by period desc and revenue desc", async () => {
      const rows = [
        {
          id: "m1",
          productName: "Night Balm",
          period: "2026-08",
          revenue: 1200,
        },
      ];
      mockPrisma.productFunnelMetric.findMany.mockResolvedValue(rows);
      const result = await service.getProductFunnelSummary();
      expect(result).toEqual(rows);
      expect(mockPrisma.productFunnelMetric.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ period: "desc" }, { revenue: "desc" }],
        }),
      );
    });
  });
});
