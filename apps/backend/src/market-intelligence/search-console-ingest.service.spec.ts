import { Test, TestingModule } from "@nestjs/testing";
import { SearchConsoleIngestService } from "./search-console-ingest.service";
import { KeywordUniverseService } from "./keyword-universe.service";
import { PrismaService } from "../prisma.service";

const mockKeywordUniverse = {
  seedFromSearchConsole: jest.fn().mockResolvedValue(1),
  normalizeKeyword: jest.fn((s: string) => s.toLowerCase().trim()),
};

const mockKeyword = {
  id: "kw1",
  keyword: "tallow balm",
  normalizedKeyword: "tallow balm",
  topic: null,
};

const mockPrisma = {
  keyword: {
    findFirst: jest.fn().mockResolvedValue(mockKeyword),
    findMany: jest.fn().mockResolvedValue([]),
  },
  keywordMetric: {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
  searchOpportunity: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: "opp1" }),
    update: jest.fn().mockResolvedValue({}),
  },
  contentBrief: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
};

const mockProvider = {
  providerName: "mock-sc",
  isConfigured: jest.fn().mockReturnValue(false),
  getQueryReport: jest.fn(),
};

const scRows = [
  {
    query: "tallow balm",
    clicks: 80,
    impressions: 1200,
    ctr: 0.067,
    position: 6.1,
  },
  {
    query: "natural moisturizer",
    clicks: 10,
    impressions: 300,
    ctr: 0.033,
    position: 14.5,
  },
  {
    query: "grass fed tallow",
    clicks: 5,
    impressions: 150,
    ctr: 0.033,
    position: 18.2,
  },
];

describe("SearchConsoleIngestService", () => {
  let service: SearchConsoleIngestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockProvider.isConfigured.mockReturnValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchConsoleIngestService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KeywordUniverseService, useValue: mockKeywordUniverse },
        { provide: "SEARCH_CONSOLE_PROVIDER", useValue: mockProvider },
      ],
    }).compile();
    service = module.get(SearchConsoleIngestService);
  });

  // ── ingest ────────────────────────────────────────────────────────────────
  describe("ingest", () => {
    it("upserts a KeywordMetric for each row", async () => {
      mockProvider.getQueryReport.mockResolvedValue({
        rows: scRows,
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "AVAILABLE",
      });

      const count = await service.ingest(mockProvider as any);
      expect(count).toBe(3);
      expect(mockPrisma.keywordMetric.upsert).toHaveBeenCalledTimes(3);
    });

    it("stores clicks, impressions, ctr, position on upsert create", async () => {
      mockProvider.getQueryReport.mockResolvedValue({
        rows: [scRows[0]],
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "AVAILABLE",
      });
      await service.ingest(mockProvider as any);
      const createArg = mockPrisma.keywordMetric.upsert.mock.calls[0][0].create;
      expect(createArg.clicks).toBe(80);
      expect(createArg.impressions).toBe(1200);
      expect(createArg.ctr).toBeCloseTo(0.067);
      expect(createArg.averagePosition).toBeCloseTo(6.1);
    });

    it("returns 0 when provider throws", async () => {
      mockProvider.getQueryReport.mockRejectedValue(new Error("network error"));
      const count = await service.ingest(mockProvider as any);
      expect(count).toBe(0);
    });

    it("skips row when keyword not found in DB", async () => {
      mockProvider.getQueryReport.mockResolvedValue({
        rows: [scRows[0]],
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "AVAILABLE",
      });
      mockPrisma.keyword.findFirst.mockResolvedValue(null);
      const count = await service.ingest(mockProvider as any);
      expect(count).toBe(0);
      expect(mockPrisma.keywordMetric.upsert).not.toHaveBeenCalled();
    });

    it("marks evidenceStatus INCOMPLETE when configured provider returns INCOMPLETE", async () => {
      mockProvider.isConfigured.mockReturnValue(true);
      mockPrisma.keyword.findFirst.mockResolvedValue(mockKeyword);
      mockProvider.getQueryReport.mockResolvedValue({
        rows: [scRows[0]],
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "INCOMPLETE",
      });
      await service.ingest(mockProvider as any);
      const createArg = mockPrisma.keywordMetric.upsert.mock.calls[0][0].create;
      expect(createArg.evidenceStatus).toBe("INCOMPLETE");
    });

    it("marks evidenceStatus AVAILABLE when configured provider returns AVAILABLE", async () => {
      mockProvider.isConfigured.mockReturnValue(true);
      mockPrisma.keyword.findFirst.mockResolvedValue(mockKeyword);
      mockProvider.getQueryReport.mockResolvedValue({
        rows: [scRows[0]],
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "AVAILABLE",
      });
      await service.ingest(mockProvider as any);
      const createArg = mockPrisma.keywordMetric.upsert.mock.calls[0][0].create;
      expect(createArg.evidenceStatus).toBe("AVAILABLE");
    });

    it("persists MOCK when provider is not configured — mock data never looks live", async () => {
      mockProvider.isConfigured.mockReturnValue(false);
      mockPrisma.keyword.findFirst.mockResolvedValue(mockKeyword);
      mockProvider.getQueryReport.mockResolvedValue({
        rows: [scRows[0]],
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "AVAILABLE", // even if report claims AVAILABLE
      });
      await service.ingest(mockProvider as any);
      const upsertArg = mockPrisma.keywordMetric.upsert.mock.calls[0][0];
      expect(upsertArg.create.evidenceStatus).toBe("MOCK");
      expect(upsertArg.update.evidenceStatus).toBe("MOCK");
    });

    it("persists MOCK when report evidenceStatus is MOCK", async () => {
      mockProvider.isConfigured.mockReturnValue(true);
      mockPrisma.keyword.findFirst.mockResolvedValue(mockKeyword);
      mockProvider.getQueryReport.mockResolvedValue({
        rows: [scRows[0]],
        period: "2026-07-28 to 2026-08-24",
        dataDelay: 3,
        evidenceStatus: "MOCK",
      });
      await service.ingest(mockProvider as any);
      const createArg = mockPrisma.keywordMetric.upsert.mock.calls[0][0].create;
      expect(createArg.evidenceStatus).toBe("MOCK");
    });
  });

  // ── detectOpportunities ───────────────────────────────────────────────────
  describe("detectOpportunities", () => {
    const makeMetric = (
      overrides: Partial<{
        id: string;
        keywordId: string;
        source: string;
        period: string;
        clicks: number;
        impressions: number;
        ctr: number;
        averagePosition: number;
        fetchedAt: Date;
        keyword: typeof mockKeyword;
      }>,
    ) => ({
      id: "m1",
      keywordId: "kw1",
      source: "SEARCH_CONSOLE",
      period: "2026-07-28/2026-08-24",
      clicks: 10,
      impressions: 200,
      ctr: 0.05,
      averagePosition: 9.0,
      trendScore: null,
      trendDelta: null,
      searchVolume: null,
      competition: null,
      competitionIndex: null,
      lowTopOfPageBid: null,
      highTopOfPageBid: null,
      evidenceStatus: "AVAILABLE",
      fetchedAt: new Date(),
      keyword: mockKeyword,
      ...overrides,
    });

    it("creates STRIKING_DISTANCE opportunity for pos 8–20 with 100+ impressions", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ averagePosition: 13, impressions: 500 }),
      ]);
      await service.detectOpportunities();
      const createCall = mockPrisma.searchOpportunity.create.mock.calls.find(
        (c) => c[0].data.opportunityType === "STRIKING_DISTANCE",
      );
      expect(createCall).toBeDefined();
    });

    it("does not create STRIKING_DISTANCE for pos < 8", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ averagePosition: 3, impressions: 500 }),
      ]);
      await service.detectOpportunities();
      const createCalls = mockPrisma.searchOpportunity.create.mock.calls;
      const sdCall = createCalls.find(
        (c) => c[0].data.opportunityType === "STRIKING_DISTANCE",
      );
      expect(sdCall).toBeUndefined();
    });

    it("creates HIGH_IMPRESSIONS_LOW_CTR for 200+ impressions and CTR < 2%", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ impressions: 400, ctr: 0.01, averagePosition: 5 }),
      ]);
      await service.detectOpportunities();
      const createCall = mockPrisma.searchOpportunity.create.mock.calls.find(
        (c) => c[0].data.opportunityType === "HIGH_IMPRESSIONS_LOW_CTR",
      );
      expect(createCall).toBeDefined();
    });

    it("does not create HIGH_IMPRESSIONS_LOW_CTR when CTR is acceptable", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ impressions: 400, ctr: 0.05, averagePosition: 5 }),
      ]);
      await service.detectOpportunities();
      const createCalls = mockPrisma.searchOpportunity.create.mock.calls;
      expect(
        createCalls.find(
          (c) => c[0].data.opportunityType === "HIGH_IMPRESSIONS_LOW_CTR",
        ),
      ).toBeUndefined();
    });

    it("creates RISING_QUERY when current clicks > previous * 1.5", async () => {
      const now = new Date();
      // 40 days ago falls in the "previous" window (31–59 days before now)
      const fortyDaysAgo = new Date(now.getTime() - 40 * 86400000);
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ clicks: 150, impressions: 200, fetchedAt: now }),
        makeMetric({
          id: "m2",
          clicks: 50,
          impressions: 200,
          fetchedAt: fortyDaysAgo,
        }),
      ]);
      await service.detectOpportunities();
      const createCall = mockPrisma.searchOpportunity.create.mock.calls.find(
        (c) => c[0].data.opportunityType === "RISING_QUERY",
      );
      expect(createCall).toBeDefined();
    });

    it("creates DECAYING_QUERY when previous clicks > current * 1.5", async () => {
      const now = new Date();
      const sixWeeksAgo = new Date(now.getTime() - 42 * 86400000);
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ clicks: 20, impressions: 200, fetchedAt: now }),
        makeMetric({
          id: "m2",
          clicks: 90,
          impressions: 300,
          fetchedAt: sixWeeksAgo,
        }),
      ]);
      await service.detectOpportunities();
      const createCall = mockPrisma.searchOpportunity.create.mock.calls.find(
        (c) => c[0].data.opportunityType === "DECAYING_QUERY",
      );
      expect(createCall).toBeDefined();
    });

    it("creates CONTENT_GAP when 100+ impressions and no matching brief", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ impressions: 200, averagePosition: 25 }),
      ]);
      mockPrisma.contentBrief.findFirst.mockResolvedValue(null);
      await service.detectOpportunities();
      const createCall = mockPrisma.searchOpportunity.create.mock.calls.find(
        (c) => c[0].data.opportunityType === "CONTENT_GAP",
      );
      expect(createCall).toBeDefined();
    });

    it("does not create CONTENT_GAP when matching brief exists", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ impressions: 200, averagePosition: 25 }),
      ]);
      mockPrisma.contentBrief.findFirst.mockResolvedValue({
        id: "b1",
        topic: "tallow balm guide",
      });
      await service.detectOpportunities();
      expect(
        mockPrisma.searchOpportunity.create.mock.calls.find(
          (c) => c[0].data.opportunityType === "CONTENT_GAP",
        ),
      ).toBeUndefined();
    });

    it("excludes MOCK metrics from opportunity detection", async () => {
      await service.detectOpportunities();
      const where = mockPrisma.keywordMetric.findMany.mock.calls[0][0].where;
      expect(where.evidenceStatus).toEqual({ not: "MOCK" });
    });

    it("updates existing opportunity instead of creating a duplicate", async () => {
      mockPrisma.keywordMetric.findMany.mockResolvedValue([
        makeMetric({ averagePosition: 12, impressions: 300 }),
      ]);
      mockPrisma.searchOpportunity.findFirst.mockResolvedValue({
        id: "opp-existing",
      });
      await service.detectOpportunities();
      expect(mockPrisma.searchOpportunity.update).toHaveBeenCalled();
      expect(mockPrisma.searchOpportunity.create).not.toHaveBeenCalled();
    });
  });

  // ── buildPreviousPeriodRows ───────────────────────────────────────────────
  describe("buildPreviousPeriodRows", () => {
    it("returns rows with decayed clicks and impressions", () => {
      const rows = [
        {
          query: "tallow",
          clicks: 100,
          impressions: 1000,
          ctr: 0.1,
          position: 5,
        },
      ];
      const prev = service.buildPreviousPeriodRows(rows, 0.7);
      expect(prev[0].clicks).toBe(70);
      expect(prev[0].impressions).toBe(700);
    });
  });
});
