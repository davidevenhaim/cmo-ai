import { Test, TestingModule } from "@nestjs/testing";
import { OpportunityScoringService } from "./opportunity-scoring.service";
import { ContentInventoryService } from "./content-inventory.service";
import { PrismaService } from "../prisma.service";

const mockContentInventory = {
  findMatchingContent: jest.fn(),
};

const baseKeyword = {
  id: "kw1",
  keyword: "tallow moisturizer",
  normalizedKeyword: "tallow moisturizer",
  topic: "skincare",
  intent: "COMMERCIAL",
  relevance: 0.8,
  metrics: [],
  searchOpportunities: [],
};

const mockPrisma = {
  keyword: {
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  keywordMetric: { findFirst: jest.fn().mockResolvedValue(null) },
  onsiteSearchMetric: {
    aggregate: jest.fn().mockResolvedValue({ _sum: { count: 0 } }),
  },
  audienceLanguageSignal: { findFirst: jest.fn().mockResolvedValue(null) },
  product: { findMany: jest.fn().mockResolvedValue([]) },
  marketOpportunity: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "opp1" }),
    update: jest.fn().mockResolvedValue({ id: "opp1" }),
  },
};

describe("OpportunityScoringService", () => {
  let service: OpportunityScoringService;

  beforeEach(async () => {
    jest.resetAllMocks();
    // Re-establish defaults after reset
    mockPrisma.keyword.findMany.mockResolvedValue([]);
    mockPrisma.keywordMetric.findFirst.mockResolvedValue(null);
    mockPrisma.onsiteSearchMetric.aggregate.mockResolvedValue({
      _sum: { count: 0 },
    });
    mockPrisma.audienceLanguageSignal.findFirst.mockResolvedValue(null);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.marketOpportunity.findFirst.mockResolvedValue(null);
    mockPrisma.marketOpportunity.create.mockResolvedValue({ id: "opp1" });
    mockPrisma.marketOpportunity.update.mockResolvedValue({ id: "opp1" });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpportunityScoringService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContentInventoryService, useValue: mockContentInventory },
      ],
    }).compile();
    service = module.get(OpportunityScoringService);
  });

  // ── scoreKeyword ──────────────────────────────────────────────────────────
  describe("scoreKeyword", () => {
    it("always includes brandRelevance in available signals", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).toContain("brandRelevance");
      expect(result.components.brandRelevance).toBe(0.8);
    });

    it("queries metrics excluding MOCK — mock demand never scored", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      await service.scoreKeyword("kw1");

      const arg = mockPrisma.keyword.findUniqueOrThrow.mock.calls[0][0];
      expect(arg.include.metrics.where).toEqual({
        evidenceStatus: { not: "MOCK" },
      });
    });

    it("includes commercialIntent when intent is set", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "TRANSACTIONAL",
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).toContain("commercialIntent");
      expect(result.components.commercialIntent).toBe(1.0);
    });

    it("scores COMMERCIAL intent at 0.85", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "COMMERCIAL",
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.components.commercialIntent).toBeCloseTo(0.85);
    });

    it("does not include commercialIntent when intent is null", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: null,
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).not.toContain("commercialIntent");
    });

    it("includes searchDemand from KEYWORD_PLANNER metric", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 5000,
            fetchedAt: new Date(),
          },
        ],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).toContain("searchDemand");
      expect(result.components.searchDemand).toBeCloseTo(0.5); // 5000/10000
    });

    it("caps searchDemand at 1.0 for very high volume", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 50000,
            fetchedAt: new Date(),
          },
        ],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.components.searchDemand).toBe(1.0);
    });

    it("includes trendMomentum from TRENDS metric", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        metrics: [
          {
            source: "TRENDS",
            trendScore: 80,
            trendDelta: 10,
            fetchedAt: new Date(),
          },
        ],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).toContain("trendMomentum");
      expect(result.components.trendMomentum).toBeGreaterThan(0.8);
    });

    it("includes onsiteDemand when onsite searches exist", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockPrisma.onsiteSearchMetric.aggregate.mockResolvedValue({
        _sum: { count: 25 },
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).toContain("onsiteDemand");
      expect(result.components.onsiteDemand).toBeCloseTo(0.5); // 25/50
    });

    it("sets contentGap to 1.0 when no matching content", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.components.contentGap).toBe(1.0);
    });

    it("sets contentGap to 0.2 when matching content exists", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([
        {
          id: "b1",
          type: "brief",
          title: "Tallow Article",
          topic: "tallow moisturizer",
          channel: "BLOG",
          keywords: [],
          createdAt: new Date(),
        },
      ]);

      const result = await service.scoreKeyword("kw1");

      expect(result.components.contentGap).toBe(0.2);
    });

    it("includes productRelevance when a product name matches keyword", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockPrisma.product.findMany.mockResolvedValue([
        { name: "Tallow Moisturizer Cream", category: "face", tags: [] },
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.availableSignals).toContain("productRelevance");
      expect(result.components.productRelevance).toBe(1.0);
    });

    it("returns total as 0–100 integer", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.total)).toBe(true);
    });

    it("multi-signal high opportunity scores higher than single-signal", async () => {
      // Single signal — low relevance + content exists = weak score
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        relevance: 0.2,
        intent: null,
        metrics: [],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([
        {
          id: "b1",
          type: "brief",
          title: "Tallow Article",
          topic: "tallow moisturizer",
          channel: "BLOG",
          keywords: [],
          createdAt: new Date(),
        },
      ]);
      const single = await service.scoreKeyword("kw1");

      jest.clearAllMocks();

      // Multi signal — KP volume + trend + onsite + product match
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "TRANSACTIONAL",
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 8000,
            trendScore: null,
            trendDelta: null,
            fetchedAt: new Date(),
          },
          {
            source: "TRENDS",
            trendScore: 85,
            trendDelta: 20,
            searchVolume: null,
            fetchedAt: new Date(),
          },
        ],
        searchOpportunities: [{ opportunityType: "STRIKING_DISTANCE" }],
      });
      mockPrisma.onsiteSearchMetric.aggregate.mockResolvedValue({
        _sum: { count: 40 },
      });
      mockPrisma.audienceLanguageSignal.findFirst.mockResolvedValue({
        frequency: 8,
      });
      mockPrisma.product.findMany.mockResolvedValue([
        { name: "Tallow Moisturizer", category: "face", tags: [] },
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const multi = await service.scoreKeyword("kw1");

      expect(multi.total).toBeGreaterThan(single.total);
    });

    it("high volume but low brand relevance yields medium score", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        relevance: 0.1,
        intent: "INFORMATIONAL",
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 50000,
            trendScore: null,
            trendDelta: null,
            fetchedAt: new Date(),
          },
        ],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.scoreKeyword("kw1");

      // High volume but low relevance + informational → not top score
      expect(result.total).toBeLessThan(80);
    });
  });

  // ── createMarketOpportunity ───────────────────────────────────────────────
  describe("createMarketOpportunity", () => {
    it("creates a MarketOpportunity when score ≥ 40", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "TRANSACTIONAL",
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 5000,
            trendScore: null,
            trendDelta: null,
            fetchedAt: new Date(),
          },
        ],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      const result = await service.createMarketOpportunity("kw1");

      expect(result).not.toBeNull();
      expect(mockPrisma.marketOpportunity.create).toHaveBeenCalled();
    });

    it("returns null when score < 40", async () => {
      // Very low relevance + no signals → score below threshold
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        relevance: 0.05,
        intent: null,
        metrics: [],
        searchOpportunities: [],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([
        {
          id: "b1",
          type: "brief",
          title: "Existing",
          topic: "tallow moisturizer",
          channel: "BLOG",
          keywords: [],
          createdAt: new Date(),
        },
      ]);

      const result = await service.createMarketOpportunity("kw1");

      expect(result).toBeNull();
      expect(mockPrisma.marketOpportunity.create).not.toHaveBeenCalled();
    });

    it("updates existing opportunity instead of creating a duplicate", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "COMMERCIAL",
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 3000,
            trendScore: null,
            trendDelta: null,
            fetchedAt: new Date(),
          },
        ],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]);
      mockPrisma.marketOpportunity.findFirst.mockResolvedValue({
        id: "existing-opp",
      });

      const result = await service.createMarketOpportunity("kw1");

      expect(result).toEqual({ id: "existing-opp" });
      expect(mockPrisma.marketOpportunity.update).toHaveBeenCalled();
      expect(mockPrisma.marketOpportunity.create).not.toHaveBeenCalled();
    });

    it("recommends CREATE_BLOG for content gap with search demand", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "INFORMATIONAL",
        metrics: [
          {
            source: "KEYWORD_PLANNER",
            searchVolume: 5000,
            trendScore: null,
            trendDelta: null,
            fetchedAt: new Date(),
          },
        ],
        searchOpportunities: [],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([]); // no content → gap = 1.0

      await service.createMarketOpportunity("kw1");

      const createArg =
        mockPrisma.marketOpportunity.create.mock.calls[0]?.[0]?.data;
      expect(createArg?.recommendedAction).toBe("CREATE_BLOG");
    });

    it("recommends OPTIMIZE_PRODUCT_PAGE for TRANSACTIONAL intent", async () => {
      mockPrisma.keyword.findUniqueOrThrow.mockResolvedValue({
        ...baseKeyword,
        intent: "TRANSACTIONAL",
        metrics: [],
        searchOpportunities: [],
      });
      mockContentInventory.findMatchingContent.mockResolvedValue([
        {
          id: "b1",
          type: "brief",
          title: "Existing",
          topic: "tallow moisturizer",
          channel: "BLOG",
          keywords: [],
          createdAt: new Date(),
        },
      ]);

      await service.createMarketOpportunity("kw1");

      const createArg =
        mockPrisma.marketOpportunity.create.mock.calls[0]?.[0]?.data;
      // contentGap is low (content exists), commercialIntent is high → OPTIMIZE_PRODUCT_PAGE
      expect(createArg?.recommendedAction).toBe("OPTIMIZE_PRODUCT_PAGE");
    });
  });

  // ── runScoringPass ────────────────────────────────────────────────────────
  describe("runScoringPass", () => {
    it("calls createMarketOpportunity for each active keyword", async () => {
      mockPrisma.keyword = {
        ...mockPrisma.keyword,
        findMany: jest.fn().mockResolvedValue([{ id: "kw1" }, { id: "kw2" }]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...baseKeyword,
          metrics: [],
          searchOpportunities: [],
        }),
      };
      mockContentInventory.findMatchingContent.mockResolvedValue([]);

      await service.runScoringPass();

      expect(mockPrisma.keyword.findMany).toHaveBeenCalled();
    });
  });
});
