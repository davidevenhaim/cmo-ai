import { Test, TestingModule } from "@nestjs/testing";
import { KeywordIntentService } from "./keyword-intent.service";
import { PrismaService } from "../prisma.service";

const mockPrisma = {
  brand: { findUnique: jest.fn() },
  keyword: { findMany: jest.fn(), update: jest.fn() },
};

describe("KeywordIntentService", () => {
  let service: KeywordIntentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeywordIntentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(KeywordIntentService);
  });

  describe("classifyKeyword", () => {
    it("classifies buy-intent keywords as TRANSACTIONAL", () => {
      expect(service.classifyKeyword("buy tallow balm")).toBe("TRANSACTIONAL");
      expect(service.classifyKeyword("tallow cream price")).toBe(
        "TRANSACTIONAL",
      );
      expect(service.classifyKeyword("tallow balm discount")).toBe(
        "TRANSACTIONAL",
      );
    });

    it("classifies comparison keywords as COMMERCIAL", () => {
      expect(service.classifyKeyword("best tallow moisturizer")).toBe(
        "COMMERCIAL",
      );
      expect(service.classifyKeyword("tallow vs shea butter")).toBe(
        "COMMERCIAL",
      );
      expect(service.classifyKeyword("tallow cream review")).toBe("COMMERCIAL");
    });

    it("classifies question starters as INFORMATIONAL", () => {
      expect(service.classifyKeyword("what is tallow")).toBe("INFORMATIONAL");
      expect(service.classifyKeyword("how to use tallow on face")).toBe(
        "INFORMATIONAL",
      );
      expect(service.classifyKeyword("why use tallow skincare")).toBe(
        "INFORMATIONAL",
      );
      expect(service.classifyKeyword("is tallow good for skin")).toBe(
        "INFORMATIONAL",
      );
    });

    it("classifies problem-aware keywords correctly", () => {
      expect(service.classifyKeyword("how to fix dry skin")).toBe(
        "PROBLEM_AWARE",
      );
      expect(service.classifyKeyword("remedy for dry skin problem")).toBe(
        "PROBLEM_AWARE",
      );
    });

    it("classifies product-containing keywords as PRODUCT_AWARE", () => {
      expect(service.classifyKeyword("tallow moisturizer")).toBe(
        "PRODUCT_AWARE",
      );
      expect(service.classifyKeyword("face cream natural")).toBe(
        "PRODUCT_AWARE",
      );
    });

    it("classifies brand name as BRAND", () => {
      expect(service.classifyKeyword("luminesce balm", "Luminesce")).toBe(
        "BRAND",
      );
    });

    it("defaults to INFORMATIONAL for unclassified keywords", () => {
      expect(service.classifyKeyword("interesting morning walk")).toBe(
        "INFORMATIONAL",
      );
    });

    it("TRANSACTIONAL takes priority over COMMERCIAL", () => {
      expect(service.classifyKeyword("best tallow buy")).toBe("TRANSACTIONAL");
    });
  });

  describe("classifyAll", () => {
    it("updates each unclassified keyword with intent and intentClassifiedAt", async () => {
      mockPrisma.brand.findUnique.mockResolvedValue({ name: "Luminesce" });
      mockPrisma.keyword.findMany.mockResolvedValue([
        {
          id: "kw1",
          keyword: "buy tallow cream",
          intentClassifiedAt: null,
          active: true,
        },
        {
          id: "kw2",
          keyword: "what is tallow",
          intentClassifiedAt: null,
          active: true,
        },
      ]);
      mockPrisma.keyword.update.mockResolvedValue({});

      const count = await service.classifyAll();
      expect(count).toBe(2);
      expect(mockPrisma.keyword.update).toHaveBeenCalledTimes(2);

      const calls = mockPrisma.keyword.update.mock.calls;
      const kw1Call = calls.find((c) => c[0].where.id === "kw1");
      const kw2Call = calls.find((c) => c[0].where.id === "kw2");
      expect(kw1Call![0].data.intent).toBe("TRANSACTIONAL");
      expect(kw2Call![0].data.intent).toBe("INFORMATIONAL");
      expect(kw1Call![0].data.intentClassifiedAt).toBeInstanceOf(Date);
    });

    it("returns 0 when no unclassified keywords", async () => {
      mockPrisma.brand.findUnique.mockResolvedValue({ name: "Luminesce" });
      mockPrisma.keyword.findMany.mockResolvedValue([]);
      const count = await service.classifyAll();
      expect(count).toBe(0);
      expect(mockPrisma.keyword.update).not.toHaveBeenCalled();
    });

    it("handles missing brand gracefully", async () => {
      mockPrisma.brand.findUnique.mockResolvedValue(null);
      mockPrisma.keyword.findMany.mockResolvedValue([
        {
          id: "kw1",
          keyword: "tallow balm",
          intentClassifiedAt: null,
          active: true,
        },
      ]);
      mockPrisma.keyword.update.mockResolvedValue({});
      const count = await service.classifyAll();
      expect(count).toBe(1);
    });
  });
});
