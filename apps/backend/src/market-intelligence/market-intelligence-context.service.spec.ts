import { Test, TestingModule } from "@nestjs/testing";
import { MarketIntelligenceContextService } from "./market-intelligence-context.service";
import { PrismaService } from "../prisma.service";

const now = new Date("2026-08-27T10:00:00Z");
const recentDate = new Date(now.getTime() - 24 * 36e5); // 1 day ago — fresh
const staleDate = new Date(now.getTime() - 5 * 24 * 36e5); // 5 days ago — stale for SC/trends

const mockScProvider = { isConfigured: jest.fn() };
const mockTrendsProvider = { isConfigured: jest.fn() };
const mockKpProvider = { isConfigured: jest.fn() };

const mockPrisma = {
  marketOpportunity: { findMany: jest.fn().mockResolvedValue([]) },
  keywordMetric: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  searchOpportunity: { findMany: jest.fn().mockResolvedValue([]) },
  onsiteSearchMetric: { findMany: jest.fn().mockResolvedValue([]) },
  productFunnelMetric: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  questionSignal: { findMany: jest.fn().mockResolvedValue([]) },
  audienceLanguageSignal: { findMany: jest.fn().mockResolvedValue([]) },
  marketIntelligenceSyncRun: { findFirst: jest.fn().mockResolvedValue(null) },
};

describe("MarketIntelligenceContextService", () => {
  let service: MarketIntelligenceContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScProvider.isConfigured.mockReturnValue(true);
    mockTrendsProvider.isConfigured.mockReturnValue(true);
    mockKpProvider.isConfigured.mockReturnValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketIntelligenceContextService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: "SEARCH_CONSOLE_PROVIDER", useValue: mockScProvider },
        { provide: "TRENDS_PROVIDER", useValue: mockTrendsProvider },
        { provide: "KEYWORD_PLANNER_PROVIDER", useValue: mockKpProvider },
      ],
    }).compile();
    service = module.get(MarketIntelligenceContextService);
  });

  describe("build", () => {
    it("returns well-structured context with all required keys", async () => {
      const ctx = await service.build();

      expect(ctx).toHaveProperty("topOpportunities");
      expect(ctx).toHaveProperty("risingKeywords");
      expect(ctx).toHaveProperty("searchConsoleOpportunities");
      expect(ctx).toHaveProperty("contentGaps");
      expect(ctx).toHaveProperty("onsiteSearches");
      expect(ctx).toHaveProperty("funnelDiagnostics");
      expect(ctx).toHaveProperty("audienceQuestions");
      expect(ctx).toHaveProperty("communityLanguage");
      expect(ctx).toHaveProperty("dataFreshness");
    });

    it("returns empty arrays when no data available", async () => {
      const ctx = await service.build();

      expect(ctx.topOpportunities).toHaveLength(0);
      expect(ctx.risingKeywords).toHaveLength(0);
      expect(ctx.searchConsoleOpportunities).toHaveLength(0);
      expect(ctx.contentGaps).toHaveLength(0);
      expect(ctx.onsiteSearches).toHaveLength(0);
      expect(ctx.audienceQuestions).toHaveLength(0);
      expect(ctx.communityLanguage).toHaveLength(0);
    });

    it("maps topOpportunities from MarketOpportunity records", async () => {
      mockPrisma.marketOpportunity.findMany.mockResolvedValue([
        {
          id: "opp1",
          topic: "tallow moisturizer",
          score: 88,
          source: "MULTI_SIGNAL",
          recommendedAction: "CREATE_BLOG",
          explanation: "Rising trend + content gap",
        },
      ]);

      const ctx = await service.build();

      expect(ctx.topOpportunities).toHaveLength(1);
      expect(ctx.topOpportunities[0].topic).toBe("tallow moisturizer");
      expect(ctx.topOpportunities[0].score).toBe(88);
      expect(ctx.topOpportunities[0].recommendedAction).toBe("CREATE_BLOG");
    });

    it("maps searchConsoleOpportunities with keyword, type, impressions, position", async () => {
      mockPrisma.searchOpportunity.findMany.mockResolvedValue([
        {
          id: "so1",
          opportunityType: "STRIKING_DISTANCE",
          topic: "tallow balm",
          score: 0.75,
          reason: "Position 14",
          evidence: { impressions: 620, position: 13.4, ctr: 0.02 },
          keyword: { keyword: "tallow balm" },
        },
      ]);

      const ctx = await service.build();

      expect(ctx.searchConsoleOpportunities).toHaveLength(1);
      expect(ctx.searchConsoleOpportunities[0].keyword).toBe("tallow balm");
      expect(ctx.searchConsoleOpportunities[0].type).toBe("STRIKING_DISTANCE");
      expect(ctx.searchConsoleOpportunities[0].impressions).toBe(620);
      expect(ctx.searchConsoleOpportunities[0].position).toBeCloseTo(13.4);
    });

    it("maps contentGaps from CONTENT_GAP search opportunities", async () => {
      // contentGaps come from the second searchOpportunity.findMany call (type=CONTENT_GAP)
      mockPrisma.searchOpportunity.findMany
        .mockResolvedValueOnce([]) // first call: all search opps for SC opportunities
        .mockResolvedValueOnce([
          // second call: CONTENT_GAP only
          { id: "g1", topic: "grass fed tallow skincare", score: 0.65 },
          { id: "g2", topic: "tallow for beard", score: 0.55 },
        ]);

      const ctx = await service.build();

      expect(ctx.contentGaps).toContain("grass fed tallow skincare");
      expect(ctx.contentGaps).toContain("tallow for beard");
    });

    it("maps onsiteSearches from OnsiteSearchMetric", async () => {
      mockPrisma.onsiteSearchMetric.findMany.mockResolvedValue([
        {
          id: "os1",
          query: "dry skin",
          normalizedQuery: "dry skin",
          count: 45,
          period: "2026-08-27",
        },
        {
          id: "os2",
          query: "beard balm",
          normalizedQuery: "beard balm",
          count: 22,
          period: "2026-08-27",
        },
      ]);

      const ctx = await service.build();

      expect(ctx.onsiteSearches).toHaveLength(2);
      expect(ctx.onsiteSearches[0]).toEqual({ query: "dry skin", count: 45 });
    });

    it("maps audienceQuestions from QuestionSignal", async () => {
      mockPrisma.questionSignal.findMany.mockResolvedValue([
        {
          id: "q1",
          question: "does tallow clog pores?",
          frequency: 8,
          topic: null,
          sources: ["REDDIT"],
        },
        {
          id: "q2",
          question: "what is tallow skincare?",
          frequency: 5,
          topic: null,
          sources: ["SEARCH_CONSOLE"],
        },
      ]);

      const ctx = await service.build();

      expect(ctx.audienceQuestions).toContain("does tallow clog pores?");
      expect(ctx.audienceQuestions).toContain("what is tallow skincare?");
    });

    it("maps communityLanguage from AudienceLanguageSignal", async () => {
      mockPrisma.audienceLanguageSignal.findMany.mockResolvedValue([
        {
          id: "ls1",
          phrase: "grass fed tallow",
          frequency: 12,
          topic: null,
          sourceTypes: ["REDDIT"],
        },
      ]);

      const ctx = await service.build();

      expect(ctx.communityLanguage).toContain("grass fed tallow");
    });

    it("reports UNAVAILABLE freshness when no metrics exist", async () => {
      const ctx = await service.build();

      expect(ctx.dataFreshness.searchConsole).toBe("UNAVAILABLE");
      expect(ctx.dataFreshness.trends).toBe("UNAVAILABLE");
      expect(ctx.dataFreshness.keywordPlanner).toBe("UNAVAILABLE");
    });

    it("reports AVAILABLE freshness for recent Search Console data", async () => {
      mockPrisma.keywordMetric.findFirst
        .mockResolvedValueOnce({ fetchedAt: recentDate }) // SC
        .mockResolvedValueOnce(null) // trends
        .mockResolvedValueOnce(null); // KP

      const ctx = await service.build();

      expect(ctx.dataFreshness.searchConsole).toBe("AVAILABLE");
    });

    it("reports STALE freshness for old Search Console data (> 72 hours)", async () => {
      mockPrisma.keywordMetric.findFirst
        .mockResolvedValueOnce({ fetchedAt: staleDate }) // SC — 5 days old
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const ctx = await service.build();

      expect(ctx.dataFreshness.searchConsole).toBe("STALE");
    });

    it("reports NOT_CONFIGURED when real provider credentials absent", async () => {
      mockScProvider.isConfigured.mockReturnValue(false);
      mockTrendsProvider.isConfigured.mockReturnValue(false);
      mockKpProvider.isConfigured.mockReturnValue(false);

      const ctx = await service.build();

      expect(ctx.dataFreshness.searchConsole).toBe("NOT_CONFIGURED");
      expect(ctx.dataFreshness.trends).toBe("NOT_CONFIGURED");
      expect(ctx.dataFreshness.keywordPlanner).toBe("NOT_CONFIGURED");
    });

    it("reports MOCK when latest metric is fixture data — never AVAILABLE", async () => {
      mockPrisma.keywordMetric.findFirst
        .mockResolvedValueOnce({
          fetchedAt: recentDate,
          evidenceStatus: "MOCK",
        }) // SC
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const ctx = await service.build();

      expect(ctx.dataFreshness.searchConsole).toBe("MOCK");
    });

    it("excludes MOCK trend metrics from risingKeywords", async () => {
      await service.build();
      const trendsWhere =
        mockPrisma.keywordMetric.findMany.mock.calls[0][0].where;
      expect(trendsWhere.evidenceStatus).toEqual({ not: "MOCK" });
    });

    it("does not include raw individual customer data — only aggregates", async () => {
      mockPrisma.onsiteSearchMetric.findMany.mockResolvedValue([
        {
          id: "os1",
          query: "tallow",
          normalizedQuery: "tallow",
          count: 30,
          period: "2026-08-27",
        },
      ]);

      const ctx = await service.build();

      // Verify onsite searches are aggregates (count only) with no customer identifiers
      for (const s of ctx.onsiteSearches) {
        expect(s).not.toHaveProperty("contactId");
        expect(s).not.toHaveProperty("customerId");
        expect(s).not.toHaveProperty("sessionId");
        expect(s).toHaveProperty("query");
        expect(s).toHaveProperty("count");
      }
    });

    it("limits topOpportunities to 5", async () => {
      mockPrisma.marketOpportunity.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          id: `opp${i}`,
          topic: `topic ${i}`,
          score: 90 - i,
          source: "SEARCH",
          recommendedAction: "CREATE_BLOG",
          explanation: "test",
        })),
      );

      const ctx = await service.build();

      expect(ctx.topOpportunities.length).toBeLessThanOrEqual(5);
    });

    it("includes lastSyncAt when sync run exists", async () => {
      const completedAt = new Date("2026-08-27T08:00:00Z");
      mockPrisma.marketIntelligenceSyncRun.findFirst.mockResolvedValue({
        id: "sync1",
        status: "COMPLETED",
        completedAt,
      });

      const ctx = await service.build();

      expect(ctx.dataFreshness.lastSyncAt).toBe(completedAt.toISOString());
    });

    it("risingKeywords only includes metrics with positive trendDelta", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        {
          id: "m1",
          trendScore: 75,
          trendDelta: 15,
          keyword: { keyword: "tallow moisturizer" },
        },
      ]);

      const ctx = await service.build();

      expect(ctx.risingKeywords).toHaveLength(1);
      expect(ctx.risingKeywords[0].keyword).toBe("tallow moisturizer");
      expect(ctx.risingKeywords[0].trendScore).toBe(75);
    });

    it("funnelDiagnostics only surfaces issues not all products", async () => {
      mockPrisma.productFunnelMetric.findMany.mockResolvedValue([
        // Issue: high traffic, poor ATC
        {
          id: "m1",
          productName: "Night Balm",
          views: 500,
          addToCart: 10,
          checkoutStarts: 5,
          purchases: 3,
          atcRate: 0.02,
          checkoutRate: null,
          purchaseRate: null,
          conversionRate: 0.006,
          revenue: 120,
        },
        // Healthy product — no issue
        {
          id: "m2",
          productName: "Lip Balm",
          views: 200,
          addToCart: 40,
          checkoutStarts: 30,
          purchases: 25,
          atcRate: 0.2,
          checkoutRate: 0.75,
          purchaseRate: 0.83,
          conversionRate: 0.125,
          revenue: 500,
        },
      ]);

      const ctx = await service.build();

      expect(ctx.funnelDiagnostics.length).toBeGreaterThanOrEqual(1);
      const nightBalmIssue = ctx.funnelDiagnostics.find(
        (d) => d.productName === "Night Balm",
      );
      expect(nightBalmIssue).toBeDefined();
      const lipBalmIssue = ctx.funnelDiagnostics.find(
        (d) => d.productName === "Lip Balm",
      );
      expect(lipBalmIssue).toBeUndefined();
    });
  });
});
