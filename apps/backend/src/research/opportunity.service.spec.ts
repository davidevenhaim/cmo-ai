import { Test, TestingModule } from "@nestjs/testing";
import { OpportunityService } from "./opportunity.service";
import { PrismaService } from "../prisma.service";
import type { ScoredFinding } from "./research-scoring.service";

const makeScored = (overrides: Partial<ScoredFinding> = {}): ScoredFinding => ({
  url: "https://reddit.com/r/SkincareAddiction/abc",
  urlHash: "abc123hash",
  title: "What ceramide serums do you recommend?",
  excerpt: "Looking for barrier repair help. How do I fix my skin barrier?",
  sourceType: "SUBREDDIT",
  topic: "customer question",
  publishedAt: new Date(),
  providerMeta: {},
  relevanceScore: 0.75,
  urgencyScore: 0.8,
  ...overrides,
});

const mockPrisma = {
  opportunity: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
};

describe("OpportunityService", () => {
  let service: OpportunityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpportunityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<OpportunityService>(OpportunityService);
    jest.clearAllMocks();
  });

  describe("createFromFinding", () => {
    it("creates opportunity for high-relevance finding", async () => {
      mockPrisma.opportunity.create.mockResolvedValue({ id: "opp-001" });
      const result = await service.createFromFinding(
        "brand-001",
        "finding-001",
        makeScored({ relevanceScore: 0.75 }),
      );
      expect(result).toBe("opp-001");
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brandId: "brand-001",
            findingId: "finding-001",
            type: "CUSTOMER_QUESTION",
          }),
        }),
      );
    });

    it("returns null for low-relevance finding", async () => {
      const result = await service.createFromFinding(
        "brand-001",
        "finding-001",
        makeScored({ relevanceScore: 0.1 }),
      );
      expect(result).toBeNull();
      expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
    });

    it("classifies competitor source as COMPETITOR_ACTIVITY", async () => {
      mockPrisma.opportunity.create.mockResolvedValue({ id: "opp-002" });
      await service.createFromFinding(
        "brand-001",
        "finding-002",
        makeScored({ sourceType: "COMPETITOR", relevanceScore: 0.6 }),
      );
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "COMPETITOR_ACTIVITY" }),
        }),
      );
    });

    it("classifies high urgency trend as TREND", async () => {
      mockPrisma.opportunity.create.mockResolvedValue({ id: "opp-003" });
      await service.createFromFinding(
        "brand-001",
        "finding-003",
        makeScored({
          title: "Ceramide skincare is trending everywhere",
          excerpt: "Everyone is talking about barrier repair trend this month",
          urgencyScore: 0.9,
          relevanceScore: 0.6,
        }),
      );
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "TREND" }),
        }),
      );
    });
  });

  describe("updateStatus", () => {
    it("updates opportunity status", async () => {
      mockPrisma.opportunity.update.mockResolvedValue({
        id: "opp-001",
        status: "REVIEWED",
      });
      const result = await service.updateStatus("opp-001", "REVIEWED");
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: "opp-001" },
        data: { status: "REVIEWED" },
      });
    });
  });
});
