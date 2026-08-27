import { Test, TestingModule } from "@nestjs/testing";
import { ContentGapService } from "./content-gap.service";
import { KeywordUniverseService } from "./keyword-universe.service";
import { ContentInventoryService } from "./content-inventory.service";
import { PrismaService } from "../prisma.service";

const mockKeywordUniverse = {
  listKeywords: jest.fn(),
};

const mockContentInventory = {
  findMatchingContent: jest.fn(),
};

const mockPrisma = {
  searchOpportunity: {
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: "opp1" }),
    update: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
};

const makeKeyword = (
  overrides: Partial<{
    id: string;
    keyword: string;
    normalizedKeyword: string;
    topic: string | null;
    relevance: number;
    metrics: { impressions: number | null }[];
  }>,
) => ({
  id: "kw1",
  keyword: "tallow moisturizer",
  normalizedKeyword: "tallow moisturizer",
  topic: "skincare",
  relevance: 0.7,
  metrics: [],
  ...overrides,
});

describe("ContentGapService", () => {
  let service: ContentGapService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentGapService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KeywordUniverseService, useValue: mockKeywordUniverse },
        { provide: ContentInventoryService, useValue: mockContentInventory },
      ],
    }).compile();
    service = module.get(ContentGapService);
  });

  describe("analyzeGaps", () => {
    it("creates CONTENT_GAP when keyword has no matching content and high relevance", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([
        makeKeyword({ relevance: 0.7 }),
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([]);
      mockPrisma.searchOpportunity.findFirst.mockResolvedValue(null);

      const result = await service.analyzeGaps();

      expect(result.gapsFound).toBe(1);
      expect(mockPrisma.searchOpportunity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ opportunityType: "CONTENT_GAP" }),
        }),
      );
    });

    it("creates CONTENT_GAP when keyword has SC impressions ≥ 50 but no content", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([
        makeKeyword({ relevance: 0.45, metrics: [{ impressions: 120 }] }),
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([]);
      mockPrisma.searchOpportunity.findFirst.mockResolvedValue(null);

      const result = await service.analyzeGaps();

      expect(result.gapsFound).toBe(1);
    });

    it("does not create CONTENT_GAP when matching content exists", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([
        makeKeyword({ relevance: 0.8 }),
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([
        {
          id: "b1",
          type: "brief",
          title: "Tallow Moisturizer Guide",
          topic: "tallow moisturizer",
          channel: "BLOG",
          keywords: [],
          createdAt: new Date(),
        },
      ]);
      mockPrisma.searchOpportunity.findFirst.mockResolvedValue(null);

      const result = await service.analyzeGaps();

      expect(result.gapsFound).toBe(0);
      expect(mockPrisma.searchOpportunity.create).not.toHaveBeenCalled();
    });

    it("does not create gap for low-relevance keyword with no SC impressions", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([
        makeKeyword({ relevance: 0.45, metrics: [] }),
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([]);
      mockPrisma.searchOpportunity.findFirst.mockResolvedValue(null);

      const result = await service.analyzeGaps();

      expect(result.gapsFound).toBe(0);
    });

    it("creates UPDATE opportunity when content exists but DECAYING_QUERY opp present", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([
        makeKeyword({ relevance: 0.7 }),
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([
        {
          id: "b1",
          type: "brief",
          title: "Old Article",
          topic: "tallow moisturizer",
          channel: "BLOG",
          keywords: [],
          createdAt: new Date(),
        },
      ]);
      // First findFirst: check for DECAYING_QUERY (returns one → update branch)
      // Second findFirst: upsertGap internal check (null → no existing opp)
      mockPrisma.searchOpportunity.findFirst
        .mockResolvedValueOnce({ id: "decay-opp" }) // DECAYING_QUERY exists
        .mockResolvedValueOnce(null); // no existing UPDATE opp → create

      const result = await service.analyzeGaps();

      expect(result.updatesFound).toBe(1);
    });

    it("returns 0,0 when no keywords meet threshold", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([]);

      const result = await service.analyzeGaps();

      expect(result.gapsFound).toBe(0);
      expect(result.updatesFound).toBe(0);
    });

    it("updates existing gap opportunity instead of creating duplicate", async () => {
      mockKeywordUniverse.listKeywords.mockResolvedValue([
        makeKeyword({ relevance: 0.8 }),
      ]);
      mockContentInventory.findMatchingContent.mockResolvedValue([]);
      mockPrisma.searchOpportunity.findFirst.mockResolvedValue({
        id: "existing-gap",
      });

      await service.analyzeGaps();

      expect(mockPrisma.searchOpportunity.update).toHaveBeenCalled();
      expect(mockPrisma.searchOpportunity.create).not.toHaveBeenCalled();
    });
  });

  describe("getGaps", () => {
    it("queries for CONTENT_GAP opportunities ordered by score desc", async () => {
      await service.getGaps(10);
      expect(mockPrisma.searchOpportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            opportunityType: "CONTENT_GAP",
            status: "NEW",
          }),
          orderBy: { score: "desc" },
          take: 10,
        }),
      );
    });
  });
});
