import { Test, TestingModule } from "@nestjs/testing";
import { TelegramCommandService } from "./telegram-command.service";
import { CmoService } from "../cmo/cmo.service";
import { BrandService } from "../brand/brand.service";
import { ApprovalService } from "../approval/approval.service";
import { TelegramService } from "./telegram.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ResearchService } from "../research/research.service";
import { OpportunityService } from "../research/opportunity.service";
import { ContentService } from "../content/content.service";
import { ContentGenerationService } from "../content/content-generation.service";
import { GrowthContextService } from "../growth/growth-context.service";
import { AbandonedCheckoutService } from "../growth/abandoned-checkout.service";
import { SegmentService } from "../growth/segment.service";
import { CampaignService } from "../growth/campaign.service";
import { WordPressAdapter } from "../wordpress/wordpress.adapter";
import { PublishingService } from "../publishing/publishing.service";
import { MarketIntelligenceSyncService } from "../market-intelligence/market-intelligence-sync.service";
import { MarketIntelligenceContextService } from "../market-intelligence/market-intelligence-context.service";
import { RevenueContextService } from "../revenue-optimization/revenue-context.service";
import { WeeklyReviewService } from "../measurement/weekly-review.service";

const now = new Date();

const mockRun = {
  id: "run-001",
  decisionType: "CREATE_CONTENT",
  decisionPayload: {
    type: "CREATE_CONTENT",
    contentType: "blog_post",
    topic: "Barrier repair science",
    keyMessages: ["Ceramides restore barrier"],
    targetAudience: "Women 28-45",
    suggestedChannels: ["instagram", "email"],
  },
  rationale: "Strong product fit for barrier repair content.",
  evidenceRefs: ["fact-001"],
  confidence: 0.88,
  modelId: "claude-sonnet-4-6",
  durationMs: 900,
  failed: false,
  failureReason: null,
  createdAt: now,
};

const mockBrand = {
  id: "luminesce-brand-001",
  name: "Luminesce",
  description: "Clean skincare",
  facts: [{}],
  guidelines: [{}],
  products: [{}],
};

const makeCommerceContext = (
  evidenceStatus: "AVAILABLE" | "STALE" | "UNAVAILABLE",
  overrides: Record<string, unknown> = {},
) => ({
  fetchedAt: now,
  shopName: "Luminesce Store",
  evidenceStatus,
  metrics:
    evidenceStatus !== "UNAVAILABLE"
      ? {
          periodStart: new Date("2024-06-01"),
          periodEnd: new Date("2024-06-30"),
          revenue: 1200,
          orderCount: 15,
          aov: 80,
          unitsSold: 20,
          currencyCode: "USD",
          metricsIncomplete: false,
          revenueByProduct: [
            {
              productId: "p1",
              productTitle: "Barrier Repair Serum",
              revenue: 800,
              units: 12,
            },
          ],
          lowInventoryProducts: [
            {
              productId: "p2",
              productTitle: "Gentle Exfoliant",
              totalUnits: 3,
              lowStock: true,
              variants: [],
            },
          ],
          customerSummary: {
            totalCustomers: 12,
            repeatCustomers: 4,
            repeatRate: 0.33,
            newThisPeriod: 8,
          },
          previousPeriod: { revenue: 1000, orderCount: 12, aov: 83 },
        }
      : null,
  topProducts: [],
  failureReason: null,
  ...overrides,
});

const mockCmoService = {
  triggerRun: jest.fn(),
  listRuns: jest.fn(),
};
const mockBrandService = { getFullProfile: jest.fn() };
const mockApprovalService = { listPending: jest.fn(), resolve: jest.fn() };
const mockTelegramService = {
  sendMessage: jest.fn(),
  answerCallbackQuery: jest.fn(),
};
const mockShopifyService = { getCommerceContext: jest.fn() };
const mockResearchService = { triggerRun: jest.fn() };
const mockOpportunityService = { list: jest.fn() };
const mockContentService = {
  listPendingDrafts: jest.fn(),
  getDraft: jest.fn(),
};
const mockContentGenerationService = { generateForBrief: jest.fn() };
const mockGrowthContextService = { build: jest.fn() };
const mockAbandonedCheckoutService = { getActive: jest.fn() };
const mockSegmentService = { getSegmentSummary: jest.fn() };
const mockCampaignService = { list: jest.fn() };
const mockWordPressAdapter = { buildBlogContext: jest.fn() };
const mockPublishingService = { listRequests: jest.fn() };
const mockMarketSyncService = { runSync: jest.fn(), getStatus: jest.fn() };
const mockMarketContextService = { build: jest.fn() };
const mockRevenueContextService = { build: jest.fn() };
const mockWeeklyReviewService = { generate: jest.fn() };

describe("TelegramCommandService", () => {
  let service: TelegramCommandService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramCommandService,
        { provide: CmoService, useValue: mockCmoService },
        { provide: BrandService, useValue: mockBrandService },
        { provide: ApprovalService, useValue: mockApprovalService },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: ShopifyService, useValue: mockShopifyService },
        { provide: ResearchService, useValue: mockResearchService },
        { provide: OpportunityService, useValue: mockOpportunityService },
        { provide: ContentService, useValue: mockContentService },
        {
          provide: ContentGenerationService,
          useValue: mockContentGenerationService,
        },
        { provide: GrowthContextService, useValue: mockGrowthContextService },
        {
          provide: AbandonedCheckoutService,
          useValue: mockAbandonedCheckoutService,
        },
        { provide: SegmentService, useValue: mockSegmentService },
        { provide: CampaignService, useValue: mockCampaignService },
        { provide: WordPressAdapter, useValue: mockWordPressAdapter },
        { provide: PublishingService, useValue: mockPublishingService },
        {
          provide: MarketIntelligenceSyncService,
          useValue: mockMarketSyncService,
        },
        {
          provide: MarketIntelligenceContextService,
          useValue: mockMarketContextService,
        },
        {
          provide: RevenueContextService,
          useValue: mockRevenueContextService,
        },
        { provide: WeeklyReviewService, useValue: mockWeeklyReviewService },
      ],
    }).compile();
    service = module.get<TelegramCommandService>(TelegramCommandService);
    jest.clearAllMocks();
  });

  describe("handleToday", () => {
    it("sends thinking message then decision when no approval", async () => {
      mockCmoService.triggerRun.mockResolvedValue({ run: mockRun });

      await service.handleToday("111");

      expect(mockTelegramService.sendMessage).toHaveBeenNthCalledWith(
        1,
        "111",
        expect.stringContaining("Running CMO"),
      );
      expect(mockTelegramService.sendMessage).toHaveBeenNthCalledWith(
        2,
        "111",
        expect.stringContaining("Create Content"),
      );
      expect(mockCmoService.triggerRun).toHaveBeenCalledWith("telegram");
    });

    it("sends failure message when run.failed is true — NOT NO_ACTION", async () => {
      const failedRun = {
        ...mockRun,
        failed: true,
        failureReason: "Brain timeout",
        decisionType: "NO_ACTION",
      };
      mockCmoService.triggerRun.mockResolvedValue({ run: failedRun });

      await service.handleToday("111");

      const messages = mockTelegramService.sendMessage.mock.calls.map(
        (c: any[]) => c[1] as string,
      );
      const failMsg = messages.find((m) => m.includes("CMO run failed"));
      expect(failMsg).toBeDefined();
      expect(failMsg).toContain("Brain timeout");
      // Must not render as NO_ACTION
      const noActionMsg = messages.find((m) => m.includes("No Action"));
      expect(noActionMsg).toBeUndefined();
    });

    it("sends approval request when decision is REQUEST_APPROVAL", async () => {
      const approval = {
        id: "appr-001",
        subject: "Approve Q3 campaign",
        description: "Targets summer skin concerns",
        metadata: { urgency: "medium" },
      };
      const approvalRun = {
        ...mockRun,
        decisionType: "REQUEST_APPROVAL",
        decisionPayload: {
          type: "REQUEST_APPROVAL",
          subject: "Approve Q3 campaign",
          description: "Targets summer skin concerns",
          urgency: "medium",
        },
      };
      mockCmoService.triggerRun.mockResolvedValue({
        run: approvalRun,
        approval,
      });

      await service.handleToday("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("Approval Required"),
        expect.objectContaining({
          replyMarkup: expect.objectContaining({
            inline_keyboard: expect.any(Array),
          }),
          approvalId: "appr-001",
        }),
      );
    });
  });

  describe("handleStatus", () => {
    it("returns brand summary and last run info", async () => {
      mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
      mockCmoService.listRuns.mockResolvedValue([mockRun]);
      mockApprovalService.listPending.mockResolvedValue([]);

      await service.handleStatus("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("Luminesce"),
      );
      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("CREATE_CONTENT");
      expect(msg).toContain("No pending approvals");
    });

    it("reports pending approvals count", async () => {
      mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
      mockCmoService.listRuns.mockResolvedValue([]);
      mockApprovalService.listPending.mockResolvedValue([
        { id: "a1" },
        { id: "a2" },
      ]);

      await service.handleStatus("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("2 pending approval");
    });
  });

  describe("handleRuns", () => {
    it("lists recent runs", async () => {
      mockCmoService.listRuns.mockResolvedValue([mockRun, mockRun]);

      await service.handleRuns("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("Recent CMO Runs");
      expect(msg).toContain("CREATE_CONTENT");
    });

    it("handles empty runs list", async () => {
      mockCmoService.listRuns.mockResolvedValue([]);
      await service.handleRuns("111");
      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("No CMO runs yet"),
      );
    });
  });

  describe("handleNaturalLanguage", () => {
    it("passes user text as hint to cmo run", async () => {
      mockCmoService.triggerRun.mockResolvedValue({ run: mockRun });

      await service.handleNaturalLanguage("111", "What should we focus on?");

      expect(mockCmoService.triggerRun).toHaveBeenCalledWith(
        "telegram",
        "What should we focus on?",
      );
    });

    it("sends failure message when run.failed is true", async () => {
      const failedRun = {
        ...mockRun,
        failed: true,
        failureReason: "Claude API error",
      };
      mockCmoService.triggerRun.mockResolvedValue({ run: failedRun });

      await service.handleNaturalLanguage("111", "help");

      const messages = mockTelegramService.sendMessage.mock.calls.map(
        (c: any[]) => c[1] as string,
      );
      expect(messages.some((m) => m.includes("CMO run failed"))).toBe(true);
    });
  });

  describe("handleCallbackQuery", () => {
    it("resolves approval and confirms via answerCallbackQuery", async () => {
      mockApprovalService.resolve.mockResolvedValue({
        id: "appr-001",
        status: "APPROVED",
      });

      await service.handleCallbackQuery(
        "cq-001",
        "111",
        "approval:appr-001:APPROVED",
      );

      expect(mockApprovalService.resolve).toHaveBeenCalledWith(
        "appr-001",
        "APPROVED",
        "telegram",
      );
      expect(mockTelegramService.answerCallbackQuery).toHaveBeenCalledWith(
        "cq-001",
        expect.stringContaining("APPROVED"),
      );
    });

    it("handles unknown callback data gracefully", async () => {
      await service.handleCallbackQuery("cq-002", "111", "garbage");
      expect(mockTelegramService.answerCallbackQuery).toHaveBeenCalledWith(
        "cq-002",
        "Unknown action",
      );
      expect(mockApprovalService.resolve).not.toHaveBeenCalled();
    });
  });

  describe("handleShopify", () => {
    it("reports shop status and low stock when AVAILABLE", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("AVAILABLE"),
      );

      await service.handleShopify("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("Luminesce Store");
      expect(msg).toContain("1200.00");
      expect(msg).toContain("Gentle Exfoliant");
    });

    it("reports unavailable when evidenceStatus is UNAVAILABLE", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("UNAVAILABLE", {
          failureReason: "Shopify not configured",
        }),
      );

      await service.handleShopify("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("unavailable"),
      );
    });

    it("shows stale label when evidenceStatus is STALE", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("STALE"),
      );

      await service.handleShopify("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg.toLowerCase()).toContain("cached");
    });
  });

  describe("handleSales", () => {
    it("reports sales metrics with top products", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("AVAILABLE"),
      );

      await service.handleSales("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("Sales");
      expect(msg).toContain("1200.00");
      expect(msg).toContain("Barrier Repair Serum");
    });

    it("reports unavailable when evidenceStatus is UNAVAILABLE", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("UNAVAILABLE", { failureReason: "not configured" }),
      );

      await service.handleSales("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("unavailable"),
      );
    });

    it("shows stale warning when evidenceStatus is STALE", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("STALE"),
      );

      await service.handleSales("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("cached");
    });

    it("shows incomplete warning when metricsIncomplete is true", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue(
        makeCommerceContext("AVAILABLE", {
          metrics: {
            ...makeCommerceContext("AVAILABLE").metrics,
            metricsIncomplete: true,
          },
        }),
      );

      await service.handleSales("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("incomplete");
    });
  });

  describe("handleResearch", () => {
    it("sends immediate acknowledgement message", async () => {
      mockResearchService.triggerRun.mockResolvedValue({
        findingsCreated: 3,
        findingsUpdated: 1,
        opportunitiesCreated: 2,
        status: "COMPLETED",
      });

      await service.handleResearch("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("Starting research run"),
      );
    });

    it("sends completion message after background run succeeds", async () => {
      mockResearchService.triggerRun.mockResolvedValue({
        findingsCreated: 3,
        findingsUpdated: 1,
        opportunitiesCreated: 2,
        status: "COMPLETED",
      });

      await service.handleResearch("111");
      await new Promise((r) => setImmediate(r));

      const messages = mockTelegramService.sendMessage.mock.calls.map(
        (c: any[]) => c[1] as string,
      );
      const completionMsg = messages.find((m) =>
        m.includes("Research complete"),
      );
      expect(completionMsg).toBeDefined();
      expect(completionMsg).toContain("3 new");
      expect(completionMsg).toContain("2 created");
    });

    it("sends error message when background run fails", async () => {
      mockResearchService.triggerRun.mockRejectedValue(
        new Error("Provider timeout"),
      );

      await service.handleResearch("111");
      await new Promise((r) => setImmediate(r));

      const messages = mockTelegramService.sendMessage.mock.calls.map(
        (c: any[]) => c[1] as string,
      );
      const errorMsg = messages.find((m) => m.includes("failed"));
      expect(errorMsg).toBeDefined();
      expect(errorMsg).toContain("Provider timeout");
    });
  });

  describe("handleOpportunities", () => {
    it("lists new opportunities with type, score and reason", async () => {
      mockOpportunityService.list.mockResolvedValue([
        {
          id: "opp-001",
          type: "TREND",
          title: "Ceramide trending everywhere",
          relevanceScore: 0.8,
          urgencyScore: 0.9,
          reason: "Fresh signal with high urgency score",
        },
      ]);

      await service.handleOpportunities("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("TREND");
      expect(msg).toContain("80%");
      expect(msg).toContain("Ceramide trending everywhere");
    });

    it("prompts /research when no opportunities exist", async () => {
      mockOpportunityService.list.mockResolvedValue([]);

      await service.handleOpportunities("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("/research"),
      );
    });

    it("calls list with NEW status and minRelevance filter", async () => {
      mockOpportunityService.list.mockResolvedValue([]);

      await service.handleOpportunities("111");

      expect(mockOpportunityService.list).toHaveBeenCalledWith(
        "luminesce-brand-001",
        expect.objectContaining({
          status: "NEW",
          minRelevance: expect.any(Number),
        }),
      );
    });
  });

  // ── M6.6 Growth Telegram commands ─────────────────────────────────────────

  describe("handleGrowth", () => {
    const baseCtx = {
      evidenceStatus: "AVAILABLE",
      lastSyncAt: new Date(),
      abandonedCheckouts: {
        activeCount: 7,
        activeTotalValue: 1050.0,
        currencyCode: "USD",
        recoveryRate: 0.4,
      },
      replenishmentCandidates: [
        { productName: "Night Balm", windowDays: 30, candidateCount: 12 },
      ],
      lapsedCustomerCount: 88,
      segments: [],
      crossSellOpportunities: [],
      campaigns: { APPROVED: 2, SENT: 5 },
    };

    it("sends growth overview with abandonment stats", async () => {
      mockGrowthContextService.build.mockResolvedValue(baseCtx);

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("7");
      expect(msg).toContain("1050");
      expect(msg).toContain("40%");
    });

    it("shows recovery rate as n/a when null", async () => {
      mockGrowthContextService.build.mockResolvedValue({
        ...baseCtx,
        abandonedCheckouts: {
          ...baseCtx.abandonedCheckouts,
          recoveryRate: null,
        },
      });

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("n/a");
    });

    it("shows lapsed customer count", async () => {
      mockGrowthContextService.build.mockResolvedValue(baseCtx);

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("88");
    });

    it("shows replenishment candidate info", async () => {
      mockGrowthContextService.build.mockResolvedValue(baseCtx);

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("Night Balm");
      expect(msg).toContain("12");
    });

    it("mentions /abandoned /segments /campaigns links", async () => {
      mockGrowthContextService.build.mockResolvedValue(baseCtx);

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("/abandoned");
      expect(msg).toContain("/segments");
      expect(msg).toContain("/campaigns");
    });

    it("does not include raw email, phone, or name in message", async () => {
      mockGrowthContextService.build.mockResolvedValue(baseCtx);

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).not.toMatch(/[a-z]+@[a-z]+\.[a-z]+/); // no email addresses
      expect(msg).not.toMatch(/\+?1?\d{10,}/); // no phone numbers
    });

    it("shows stale warning when evidenceStatus is STALE", async () => {
      mockGrowthContextService.build.mockResolvedValue({
        ...baseCtx,
        evidenceStatus: "STALE",
      });

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg.toLowerCase()).toContain("stale");
    });

    it("sends unavailable message when evidenceStatus is UNAVAILABLE — no overview rendered", async () => {
      mockGrowthContextService.build.mockResolvedValue({
        ...baseCtx,
        evidenceStatus: "UNAVAILABLE",
      });

      await service.handleGrowth("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg.toLowerCase()).toMatch(/unavailable|no sync/);
      // Should not render checkout stats in the unavailable message
      expect(msg).not.toContain("Abandoned Checkouts");
    });
  });

  describe("handleAbandoned", () => {
    it("shows active checkout list with value and age", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
      mockAbandonedCheckoutService.getActive.mockResolvedValue([
        {
          id: "co-1",
          totalValue: 200.0,
          currencyCode: "USD",
          abandonedAt: twoHoursAgo,
          status: "ACTIVE",
          email: "hidden@test.com",
        },
      ]);

      await service.handleAbandoned("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("200");
      expect(msg).toContain("ACTIVE");
    });

    it("sends no-checkouts message when list is empty", async () => {
      mockAbandonedCheckoutService.getActive.mockResolvedValue([]);

      await service.handleAbandoned("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("No active"),
      );
    });

    it("does not surface raw email addresses in message", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
      mockAbandonedCheckoutService.getActive.mockResolvedValue([
        {
          id: "co-1",
          totalValue: 99.0,
          currencyCode: "USD",
          abandonedAt: twoHoursAgo,
          status: "ACTIVE",
          email: "customer@secret.com",
        },
      ]);

      await service.handleAbandoned("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      // Email field exists in data but must not appear verbatim in the Telegram message
      expect(msg).not.toContain("customer@secret.com");
    });

    it("caps list at 10 items and mentions overflow", async () => {
      const twoHoursAgo = new Date(Date.now() - 3600000).toISOString();
      const checkouts = Array.from({ length: 15 }, (_, i) => ({
        id: `co-${i}`,
        totalValue: 100,
        currencyCode: "USD",
        abandonedAt: twoHoursAgo,
        status: "ACTIVE",
        email: null,
      }));
      mockAbandonedCheckoutService.getActive.mockResolvedValue(checkouts);

      await service.handleAbandoned("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("5 more");
    });
  });

  describe("handleSegments", () => {
    it("lists segment types and member counts", async () => {
      mockSegmentService.getSegmentSummary.mockResolvedValue([
        {
          id: "s-1",
          type: "PROSPECT",
          name: "PROSPECT",
          memberCount: 250,
          description: "Subs",
        },
        {
          id: "s-2",
          type: "VIP",
          name: "VIP",
          memberCount: 18,
          description: "VIPs",
        },
      ]);

      await service.handleSegments("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("PROSPECT");
      expect(msg).toContain("250");
      expect(msg).toContain("VIP");
      expect(msg).toContain("18");
    });

    it("sends no-segments message when list is empty", async () => {
      mockSegmentService.getSegmentSummary.mockResolvedValue([]);

      await service.handleSegments("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("No segments"),
      );
    });

    it("does not show individual contact details", async () => {
      mockSegmentService.getSegmentSummary.mockResolvedValue([
        {
          id: "s-1",
          type: "VIP",
          name: "VIP",
          memberCount: 5,
          description: null,
        },
      ]);

      await service.handleSegments("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      // Aggregate only — no names or emails
      expect(msg).not.toMatch(/[a-z]+@[a-z]+/);
    });
  });

  describe("handleCampaigns", () => {
    it("lists campaign names and statuses", async () => {
      mockCampaignService.list.mockResolvedValue([
        {
          id: "c-1",
          name: "Win-Back Nov",
          type: "WIN_BACK",
          status: "APPROVED",
        },
        { id: "c-2", name: "Lapsed Q4", type: "NEWSLETTER", status: "DRAFT" },
      ]);

      await service.handleCampaigns("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("Win-Back Nov");
      expect(msg).toContain("APPROVED");
      expect(msg).toContain("Lapsed Q4");
      expect(msg).toContain("DRAFT");
    });

    it("sends no-campaigns message when list is empty", async () => {
      mockCampaignService.list.mockResolvedValue([]);

      await service.handleCampaigns("111");

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        "111",
        expect.stringContaining("No campaigns"),
      );
    });

    it("caps list at 10 campaigns and notes overflow", async () => {
      const campaigns = Array.from({ length: 13 }, (_, i) => ({
        id: `c-${i}`,
        name: `Campaign ${i}`,
        type: "NEWSLETTER",
        status: "DRAFT",
      }));
      mockCampaignService.list.mockResolvedValue(campaigns);

      await service.handleCampaigns("111");

      const msg = mockTelegramService.sendMessage.mock.calls[0][1] as string;
      expect(msg).toContain("3 more");
    });

    it("uses service data — no duplicate business logic in handler", async () => {
      mockCampaignService.list.mockResolvedValue([]);

      await service.handleCampaigns("111");

      // Handler delegates entirely to campaignService.list — called exactly once
      expect(mockCampaignService.list).toHaveBeenCalledTimes(1);
    });
  });
});
