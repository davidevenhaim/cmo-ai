import { Test, TestingModule } from "@nestjs/testing";
import { CmoService } from "./cmo.service";
import { PrismaService } from "../prisma.service";
import { BrandService } from "../brand/brand.service";
import { BrainAdapter } from "../brain/brain.adapter";
import { ApprovalService } from "../approval/approval.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ResearchService } from "../research/research.service";
import { ContentService } from "../content/content.service";
import { ContentGenerationService } from "../content/content-generation.service";
import { GrowthContextService } from "../growth/growth-context.service";
import { MarketIntelligenceContextService } from "../market-intelligence/market-intelligence-context.service";
import { RevenueContextService } from "../revenue-optimization/revenue-context.service";
import { WebsiteContextService } from "../website/website-context.service";
import { WhatsAppContextService } from "../whatsapp/whatsapp-context.service";

const mockBrand = {
  id: "luminesce-brand-001",
  name: "Luminesce",
  description: "Test brand",
  voice: null,
  audience: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  facts: [
    {
      id: "fact-001",
      brandId: "luminesce-brand-001",
      category: "origin",
      content: "Founded 2019",
      confidence: 1.0,
      sourceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  guidelines: [],
  sources: [],
  products: [],
};

const validBrainResult = {
  decisionType: "CREATE_CONTENT",
  decisionPayload: {
    type: "CREATE_CONTENT",
    contentType: "blog_post",
    topic: "Barrier repair",
    keyMessages: ["Ceramides help"],
    targetAudience: "Women 28-45",
    suggestedChannels: ["instagram"],
  },
  rationale: "Test rationale",
  evidenceRefs: ["fact-001"],
  confidence: 0.9,
  modelId: "claude-sonnet-4-6",
  durationMs: 800,
};

const approvalBrainResult = {
  decisionType: "REQUEST_APPROVAL",
  decisionPayload: {
    type: "REQUEST_APPROVAL",
    subject: "Approve Q3 campaign",
    description: "Campaign targets summer skin concerns",
    urgency: "medium",
  },
  rationale: "Campaign needs stakeholder sign-off",
  evidenceRefs: ["fact-001"],
  confidence: 0.75,
  modelId: "claude-sonnet-4-6",
  durationMs: 900,
};

const mockCommerceContext = {
  fetchedAt: new Date(),
  shopName: "Luminesce Store",
  available: true,
  stale: false,
  metrics: null,
  topProducts: [],
  failureReason: null,
};

const mockResearchContext = {
  runAt: new Date(),
  available: true,
  stale: false,
  topFindings: [],
  topOpportunities: [],
  failureReason: null,
};

const mockPrisma = {
  cmoRun: { create: jest.fn() },
};

const mockBrandService = { getFullProfile: jest.fn() };
const mockBrainAdapter = { callBrain: jest.fn() };
const mockApprovalService = { create: jest.fn() };
const mockShopifyService = { getCommerceContext: jest.fn() };
const mockResearchService = { getResearchContext: jest.fn() };
const mockContentService = { createBrief: jest.fn() };
const mockContentGenerationService = { generateForBrief: jest.fn() };
const mockGrowthContextService = { build: jest.fn() };
const mockMarketContextService = { build: jest.fn().mockResolvedValue({}) };
const mockRevenueContextService = { build: jest.fn().mockResolvedValue({}) };
const mockWebsiteContextService = { build: jest.fn().mockResolvedValue({}) };
const mockWhatsAppContextService = { build: jest.fn().mockResolvedValue({}) };

describe("CmoService", () => {
  let service: CmoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BrandService, useValue: mockBrandService },
        { provide: BrainAdapter, useValue: mockBrainAdapter },
        { provide: ApprovalService, useValue: mockApprovalService },
        { provide: ShopifyService, useValue: mockShopifyService },
        { provide: ResearchService, useValue: mockResearchService },
        { provide: ContentService, useValue: mockContentService },
        {
          provide: ContentGenerationService,
          useValue: mockContentGenerationService,
        },
        {
          provide: GrowthContextService,
          useValue: mockGrowthContextService,
        },
        {
          provide: WebsiteContextService,
          useValue: mockWebsiteContextService,
        },
        {
          provide: WhatsAppContextService,
          useValue: mockWhatsAppContextService,
        },
        {
          provide: MarketIntelligenceContextService,
          useValue: mockMarketContextService,
        },
        {
          provide: RevenueContextService,
          useValue: mockRevenueContextService,
        },
      ],
    }).compile();
    service = module.get<CmoService>(CmoService);
    jest.clearAllMocks();
    mockShopifyService.getCommerceContext.mockResolvedValue(
      mockCommerceContext,
    );
    mockResearchService.getResearchContext.mockResolvedValue(
      mockResearchContext,
    );
    mockGrowthContextService.build.mockResolvedValue(undefined);
    mockContentService.createBrief.mockResolvedValue({ id: "brief-001" });
    mockContentGenerationService.generateForBrief.mockResolvedValue({
      draft: { id: "draft-001" },
      approval: { id: "appr-001" },
      evaluation: { overall: 0.85, passesReview: true, issues: [] },
    });
  });

  it("triggerRun validates brain output before persisting", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({
      id: "run-001",
      ...validBrainResult,
    });

    const { run } = await service.triggerRun("dev");

    expect(mockBrainAdapter.callBrain).toHaveBeenCalledTimes(1);
    expect(mockPrisma.cmoRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionType: "CREATE_CONTENT",
          failed: false,
          triggeredBy: "dev",
        }),
      }),
    );
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("triggerRun passes hint and commerceContext to brain", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-001" });

    await service.triggerRun("telegram", "What should we do this week?");

    const callArg = mockBrainAdapter.callBrain.mock.calls[0][0];
    expect(callArg.hint).toBe("What should we do this week?");
    expect(callArg.commerceContext).toEqual(mockCommerceContext);
  });

  it("triggerRun creates Approval when decision is REQUEST_APPROVAL", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockBrainAdapter.callBrain.mockResolvedValue(approvalBrainResult);
    const fakeRun = { id: "run-002" };
    mockPrisma.cmoRun.create.mockResolvedValue(fakeRun);
    mockApprovalService.create.mockResolvedValue({ id: "approval-001" });

    const { run, approval } = await service.triggerRun("telegram");

    expect(mockApprovalService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cmoRunId: "run-002",
        type: "GENERAL",
        subject: "Approve Q3 campaign",
      }),
    );
    expect(approval).toBeDefined();
    expect(approval!.id).toBe("approval-001");
  });

  it("triggerDevRun is backward-compat alias for triggerRun('dev')", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-003" });

    await service.triggerDevRun();

    expect(mockPrisma.cmoRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triggeredBy: "dev" }),
      }),
    );
  });

  it("triggerRun persists failed run when brain throws", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockBrainAdapter.callBrain.mockRejectedValue(new Error("Brain timeout"));
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-004", failed: true });

    const { run } = await service.triggerRun("dev");

    expect(mockPrisma.cmoRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failed: true }),
      }),
    );
  });

  it("triggerRun continues when shopify context fetch fails", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockShopifyService.getCommerceContext.mockRejectedValue(
      new Error("Shopify down"),
    );
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-005" });

    const { run } = await service.triggerRun("dev");

    expect(mockBrainAdapter.callBrain).toHaveBeenCalledTimes(1);
    const callArg = mockBrainAdapter.callBrain.mock.calls[0][0];
    expect(callArg.commerceContext).toBeUndefined();
  });

  it("triggerRun attaches researchContext to brain call", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-006" });

    await service.triggerRun("dev");

    const callArg = mockBrainAdapter.callBrain.mock.calls[0][0];
    expect(callArg.researchContext).toEqual(mockResearchContext);
  });

  it("triggerRun continues when research context fetch fails", async () => {
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockResearchService.getResearchContext.mockRejectedValue(
      new Error("Research DB error"),
    );
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-007" });

    const { run } = await service.triggerRun("dev");

    expect(mockBrainAdapter.callBrain).toHaveBeenCalledTimes(1);
    const callArg = mockBrainAdapter.callBrain.mock.calls[0][0];
    expect(callArg.researchContext).toBeUndefined();
  });

  it("triggerRun fetches shopify and research contexts in parallel", async () => {
    const callOrder: string[] = [];
    mockBrandService.getFullProfile.mockResolvedValue(mockBrand);
    mockShopifyService.getCommerceContext.mockImplementation(async () => {
      callOrder.push("shopify-start");
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push("shopify-end");
      return mockCommerceContext;
    });
    mockResearchService.getResearchContext.mockImplementation(async () => {
      callOrder.push("research-start");
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push("research-end");
      return mockResearchContext;
    });
    mockBrainAdapter.callBrain.mockResolvedValue(validBrainResult);
    mockPrisma.cmoRun.create.mockResolvedValue({ id: "run-008" });

    await service.triggerRun("dev");

    // Both start before either ends — confirms Promise.all parallelism
    expect(callOrder[0]).toBe("shopify-start");
    expect(callOrder[1]).toBe("research-start");
  });
});
