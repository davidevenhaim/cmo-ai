import { WeeklyReviewService } from "./weekly-review.service";

function makeDeps() {
  const prisma = {
    brand: {
      findUnique: jest.fn().mockResolvedValue({ id: "b1", name: "Brand A" }),
    },
    publishRequest: { count: jest.fn().mockResolvedValue(2) },
    recommendation: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    marketOpportunity: { count: jest.fn().mockResolvedValue(1) },
    contentBrief: { count: jest.fn().mockResolvedValue(1) },
  };
  const shopify = {
    getCommerceContext: jest.fn().mockResolvedValue({
      evidenceStatus: "AVAILABLE",
      metrics: {
        currencyCode: "USD",
        revenue: 1000,
        orderCount: 10,
        aov: 100,
        previousPeriod: { revenue: 800 },
      },
    }),
    getLatestSnapshot: jest.fn().mockResolvedValue({
      metrics: { currencyCode: "USD" },
    }),
  };
  const attribution = {
    getSummary: jest.fn().mockResolvedValue({
      totalRevenue: 200,
      totalContributionProfit: 80,
      totalIncentiveCost: 20,
      totalAttributions: 3,
      byType: {},
      byAttributionType: {
        ATTRIBUTED: { count: 2, revenue: 150, profit: 60 },
        INCREMENTAL_ESTIMATE: { count: 1, revenue: 50, profit: 20 },
      },
    }),
  };
  const experiments = {
    evaluateRecent: jest.fn().mockResolvedValue([]),
  };
  const brain = {
    interpretWeekly: jest.fn(),
  };
  return { prisma, shopify, attribution, experiments, brain };
}

describe("WeeklyReviewService", () => {
  // H — Claude unavailable
  it("H: deterministic metrics still render when interpretation fails", async () => {
    const { prisma, shopify, attribution, experiments, brain } = makeDeps();
    brain.interpretWeekly.mockRejectedValue(new Error("Brain timeout"));
    const svc = new WeeklyReviewService(
      prisma as any,
      shopify as any,
      attribution as any,
      experiments as any,
      brain as any,
    );

    const review = await svc.generate(new Date("2026-08-27T12:00:00Z"));

    expect(review.business.revenue).toBe(1000);
    expect(review.revenue.attributedRevenue).toBe(150);
    expect(review.revenue.incrementalEstimate).toBe(20);
    expect(review.interpretation.status).toBe("UNAVAILABLE");
    expect(review.interpretation.failureReason).toMatch(/Brain timeout/);
    expect(review.interpretation.headline).toBeNull();
  });

  it("attaches interpretation when the brain succeeds", async () => {
    const { prisma, shopify, attribution, experiments, brain } = makeDeps();
    brain.interpretWeekly.mockResolvedValue({
      headline: "Steady week",
      narrative: "Deterministic numbers look healthy.",
    });
    const svc = new WeeklyReviewService(
      prisma as any,
      shopify as any,
      attribution as any,
      experiments as any,
      brain as any,
    );
    const review = await svc.generate();
    expect(review.interpretation.status).toBe("AVAILABLE");
    expect(review.interpretation.headline).toBe("Steady week");
  });
});
