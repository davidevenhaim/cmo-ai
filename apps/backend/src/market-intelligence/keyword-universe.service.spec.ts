import { Test, TestingModule } from "@nestjs/testing";
import { KeywordUniverseService } from "./keyword-universe.service";
import { PrismaService } from "../prisma.service";

const mockUpsert = jest.fn().mockResolvedValue({});
const mockFindMany = jest.fn().mockResolvedValue([]);
const mockFindUnique = jest.fn();

const mockPrisma = {
  keyword: { upsert: mockUpsert, findMany: mockFindMany },
  brand: { findUnique: mockFindUnique },
  product: { findMany: jest.fn().mockResolvedValue([]) },
};

describe("KeywordUniverseService", () => {
  let service: KeywordUniverseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeywordUniverseService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(KeywordUniverseService);
  });

  // ── normalizeKeyword ──────────────────────────────────────────────────────
  describe("normalizeKeyword", () => {
    it("lowercases input", () => {
      expect(service.normalizeKeyword("Tallow Moisturizer")).toBe(
        "tallow moisturizer",
      );
    });

    it("trims leading and trailing whitespace", () => {
      expect(service.normalizeKeyword("  tallow  ")).toBe("tallow");
    });

    it("collapses multiple internal spaces", () => {
      expect(service.normalizeKeyword("tallow  balm   face")).toBe(
        "tallow balm face",
      );
    });

    it("strips non-alphanumeric characters except hyphen and apostrophe", () => {
      expect(service.normalizeKeyword("tallow (balm)!")).toBe("tallow balm");
    });

    it("preserves hyphens", () => {
      expect(service.normalizeKeyword("grass-fed tallow")).toBe(
        "grass-fed tallow",
      );
    });
  });

  // ── addKeyword ────────────────────────────────────────────────────────────
  describe("addKeyword", () => {
    it("calls prisma upsert with normalized keyword", async () => {
      await service.addKeyword("Tallow Moisturizer", "BRAND_SEED", 0.7);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            brandId_normalizedKeyword_language_country: expect.objectContaining(
              {
                normalizedKeyword: "tallow moisturizer",
              },
            ),
          }),
          create: expect.objectContaining({
            source: "BRAND_SEED",
            relevance: 0.7,
          }),
        }),
      );
    });

    it("skips keywords shorter than 2 chars", async () => {
      await service.addKeyword("a", "BRAND_SEED");
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("skips empty string", async () => {
      await service.addKeyword("", "BRAND_SEED");
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("uses default relevance 0.5", async () => {
      await service.addKeyword("tallow", "BRAND_SEED");
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ relevance: 0.5 }),
        }),
      );
    });
  });

  // ── seedFromBrand ─────────────────────────────────────────────────────────
  describe("seedFromBrand", () => {
    it("returns 0 when brand not found", async () => {
      mockFindUnique.mockResolvedValue(null);
      const count = await service.seedFromBrand();
      expect(count).toBe(0);
    });

    it("extracts keywords from brand description and audience", async () => {
      mockFindUnique.mockResolvedValue({
        id: "luminesce-brand-001",
        name: "Luminesce",
        description: "Premium grass-fed tallow skincare balm",
        audience: "Women with sensitive skin",
        facts: [],
        guidelines: [],
      });
      const count = await service.seedFromBrand();
      expect(count).toBeGreaterThan(0);
      expect(mockUpsert).toHaveBeenCalled();
    });

    it("does not seed stop words", async () => {
      mockFindUnique.mockResolvedValue({
        id: "luminesce-brand-001",
        name: "A",
        description: "the and or a",
        audience: "the",
        facts: [],
        guidelines: [],
      });
      await service.seedFromBrand();
      // stop words alone produce no 4+ char single words
      const calls = mockUpsert.mock.calls.map(
        (c) => c[0].create?.normalizedKeyword ?? "",
      );
      const stopWords = ["the", "and", "or", "a"];
      for (const sw of stopWords) {
        expect(calls).not.toContain(sw);
      }
    });
  });

  // ── seedFromProducts ──────────────────────────────────────────────────────
  describe("seedFromProducts", () => {
    it("seeds product name with relevance 0.9", async () => {
      (mockPrisma.product.findMany as jest.Mock).mockResolvedValue([
        {
          id: "p1",
          name: "Night Balm",
          category: "face cream",
          tags: ["tallow", "balm"],
          description: null,
        },
      ]);
      await service.seedFromProducts();
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            keyword: "Night Balm",
            relevance: 0.9,
          }),
        }),
      );
    });

    it("seeds each tag", async () => {
      (mockPrisma.product.findMany as jest.Mock).mockResolvedValue([
        {
          id: "p2",
          name: "Balm",
          category: null,
          tags: ["natural", "vegan"],
          description: null,
        },
      ]);
      await service.seedFromProducts();
      const normalizedKeywords = mockUpsert.mock.calls.map(
        (c) => c[0].create?.normalizedKeyword,
      );
      expect(normalizedKeywords).toContain("natural");
      expect(normalizedKeywords).toContain("vegan");
    });

    it("returns 0 when no products", async () => {
      (mockPrisma.product.findMany as jest.Mock).mockResolvedValue([]);
      const count = await service.seedFromProducts();
      expect(count).toBe(0);
    });
  });

  // ── seedFromSearchConsole ─────────────────────────────────────────────────
  describe("seedFromSearchConsole", () => {
    it("seeds each row as a keyword", async () => {
      const rows = [
        {
          query: "tallow balm",
          clicks: 50,
          impressions: 800,
          ctr: 0.06,
          position: 8,
        },
        {
          query: "natural moisturizer",
          clicks: 20,
          impressions: 400,
          ctr: 0.05,
          position: 12,
        },
      ];
      const count = await service.seedFromSearchConsole(rows);
      expect(count).toBe(2);
      expect(mockUpsert).toHaveBeenCalledTimes(2);
    });

    it("assigns higher relevance for higher impressions", async () => {
      const rows = [
        {
          query: "big query",
          clicks: 100,
          impressions: 10000,
          ctr: 0.01,
          position: 5,
        },
        {
          query: "tiny query",
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          position: 3,
        },
      ];
      await service.seedFromSearchConsole(rows);
      const bigCall = mockUpsert.mock.calls.find(
        (c) => c[0].create?.keyword === "big query",
      );
      const tinyCall = mockUpsert.mock.calls.find(
        (c) => c[0].create?.keyword === "tiny query",
      );
      expect(bigCall![0].create.relevance).toBeGreaterThan(
        tinyCall![0].create.relevance,
      );
    });
  });

  // ── listKeywords ──────────────────────────────────────────────────────────
  describe("listKeywords", () => {
    it("calls findMany with active:true by default", async () => {
      await service.listKeywords();
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it("passes intent filter", async () => {
      await service.listKeywords({ intent: "COMMERCIAL" });
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ intent: "COMMERCIAL" }),
        }),
      );
    });

    it("passes minRelevance as gte", async () => {
      await service.listKeywords({ minRelevance: 0.6 });
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ relevance: { gte: 0.6 } }),
        }),
      );
    });
  });
});
