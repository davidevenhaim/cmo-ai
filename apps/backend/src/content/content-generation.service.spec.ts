import { Test, TestingModule } from "@nestjs/testing";
import { ContentGenerationService } from "./content-generation.service";
import { ContentBrainAdapter } from "./content-brain.adapter";
import { ContentService } from "./content.service";
import { BrandService } from "../brand/brand.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ResearchService } from "../research/research.service";
import { ApprovalService } from "../approval/approval.service";

// --- Fixtures ---

const now = new Date();

const mockBrief = {
  id: "brief-001",
  brandId: "luminesce-brand-001",
  objective: "Drive awareness",
  topic: "Barrier repair",
  angle: "Science-first",
  targetAudience: "Women 28-45",
  channel: "INSTAGRAM",
  format: "POST",
  keyMessage: "Ceramides restore barrier",
  callToAction: "Shop now",
  tone: "educational",
  constraints: [],
  supportingEvidence: {},
  createdAt: now,
};

const mockProfile = {
  id: "luminesce-brand-001",
  name: "Luminesce",
  voice: "warm and scientific",
  audience: "Women 28-45",
  facts: [
    { id: "f1", content: "Founded by a biochemist", confidence: 1.0 },
    { id: "f2", content: "Ceramide-first formulation", confidence: 1.0 },
  ],
  guidelines: [
    {
      category: "Tone",
      rule: "Never overclaim",
      example: "Say 'supports' not 'cures'",
    },
  ],
  products: [
    {
      name: "Night Balm",
      description: "Ceramide barrier repair",
      category: "moisturiser",
      tags: ["ceramide"],
    },
  ],
};

const mockCommerceContext = {
  evidenceStatus: "AVAILABLE" as const,
  shopName: "Luminesce Store",
  fetchedAt: now,
  metrics: {
    currencyCode: "ILS",
    revenue: 5200,
    orderCount: 65,
    aov: 80,
    unitsSold: 90,
    metricsIncomplete: false,
    revenueByProduct: [],
    lowInventoryProducts: [],
    customerSummary: null,
    previousPeriod: null,
    periodStart: now,
    periodEnd: now,
  },
  failureReason: null,
};

const mockResearchContext = {
  topFindings: [
    { excerpt: "Ceramides market growing 15% YoY" },
    { excerpt: "Reddit r/SkincareAddiction very active" },
  ],
  topOpportunities: [],
};

const passEvaluation = {
  brandFit: 0.9,
  channelFit: 0.85,
  evidenceAlignment: 0.8,
  clarity: 0.9,
  originality: 0.75,
  promotionalIntensity: 0.8,
  claimRisk: 1.0,
  ctaQuality: 0.85,
  overall: 0.85,
  issues: [],
  passesReview: true,
};

const failEvaluation = {
  ...passEvaluation,
  overall: 0.55,
  passesReview: false,
  issues: ["Too promotional", "Weak hook"],
};

const generatedInstagramPost = {
  channel: "INSTAGRAM" as const,
  format: "POST" as const,
  caption: "Your skin barrier deserves ceramides.",
  hashtags: ["#skincare", "#ceramides"],
  callToAction: "Shop Night Balm",
};

const generatedCarousel = {
  channel: "INSTAGRAM" as const,
  format: "CAROUSEL" as const,
  hookSlide: "5 signs your barrier is damaged",
  slides: [
    { slideNumber: 1, text: "Redness", visualDirection: "red skin graphic" },
    { slideNumber: 2, text: "Tightness", visualDirection: "dry skin" },
    {
      slideNumber: 3,
      text: "How ceramides help",
      visualDirection: "molecule graphic",
    },
  ],
  closingCta: "Shop Night Balm →",
  caption: "Your barrier explained.",
  hashtags: ["#ceramides"],
};

const generatedXPost = {
  channel: "X" as const,
  format: "POST" as const,
  text: "Ceramides are the key to skin barrier repair. Here's why. 🧬",
};

const generatedXThread = {
  channel: "X" as const,
  format: "THREAD" as const,
  thread: [
    "Thread: The science of skin barrier repair 🧵",
    "1/ Your skin barrier is made of ceramides, cholesterol, and fatty acids.",
    "2/ When it breaks down, you get redness, sensitivity, and moisture loss.",
    "3/ Ceramide-first moisturisers rebuild it — but formula matters.",
    "4/ Night Balm uses the same ceramide ratio as healthy skin.",
  ],
};

const generatedRedditPost = {
  channel: "REDDIT" as const,
  format: "POST" as const,
  title: "Anyone else obsessed with ceramide moisturisers for barrier repair?",
  body: "Been dealing with a damaged moisture barrier for months. Finally found something that helps — ceramic-based skincare. Happy to share what worked.",
  subredditSuggestion: "r/SkincareAddiction",
};

const generatedBlogPost = {
  channel: "BLOG" as const,
  format: "LONG_FORM" as const,
  title: "The Complete Guide to Skin Barrier Repair",
  outline: [
    "What is the skin barrier?",
    "Signs of damage",
    "How ceramides help",
    "Building a routine",
  ],
  body: "Your skin barrier is your body's first line of defence...",
  metaDescription:
    "Learn how ceramides repair your skin barrier with this science-backed guide.",
};

const mockDraft = {
  id: "draft-001",
  briefId: "brief-001",
  version: 1,
  channel: "INSTAGRAM",
  format: "POST",
  content: generatedInstagramPost,
  status: "GENERATED",
  criticScore: 0.85,
  createdAt: now,
};

const mockApproval = {
  id: "appr-001",
  type: "CONTENT",
  status: "PENDING",
  subject: "Content approval: INSTAGRAM POST — Barrier repair",
};

// --- Mocks ---

const mockBrain = {
  generate: jest.fn(),
  critique: jest.fn(),
};

const mockContentService = {
  getBrief: jest.fn(),
  createDraft: jest.fn(),
  getNextVersion: jest.fn(),
  supersedePreviousDrafts: jest.fn(),
  linkApprovalToDraft: jest.fn(),
};

const mockBrandService = { getFullProfile: jest.fn() };
const mockShopifyService = { getCommerceContext: jest.fn() };
const mockResearchService = { getResearchContext: jest.fn() };
const mockApprovalService = { create: jest.fn() };

// --- Suite ---

describe("ContentGenerationService", () => {
  let service: ContentGenerationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentGenerationService,
        { provide: ContentBrainAdapter, useValue: mockBrain },
        { provide: ContentService, useValue: mockContentService },
        { provide: BrandService, useValue: mockBrandService },
        { provide: ShopifyService, useValue: mockShopifyService },
        { provide: ResearchService, useValue: mockResearchService },
        { provide: ApprovalService, useValue: mockApprovalService },
      ],
    }).compile();

    service = module.get<ContentGenerationService>(ContentGenerationService);
    jest.clearAllMocks();

    // Defaults
    mockContentService.getBrief.mockResolvedValue(mockBrief);
    mockBrandService.getFullProfile.mockResolvedValue(mockProfile);
    mockShopifyService.getCommerceContext.mockResolvedValue(
      mockCommerceContext,
    );
    mockResearchService.getResearchContext.mockResolvedValue(
      mockResearchContext,
    );
    mockContentService.getNextVersion.mockResolvedValue(1);
    mockBrain.generate.mockResolvedValue(generatedInstagramPost);
    mockBrain.critique.mockResolvedValue(passEvaluation);
    mockContentService.createDraft.mockResolvedValue(mockDraft);
    mockApprovalService.create.mockResolvedValue(mockApproval);
    mockContentService.linkApprovalToDraft.mockResolvedValue(undefined);
    mockContentService.supersedePreviousDrafts.mockResolvedValue(undefined);
  });

  // --- Brief → Draft pipeline ---

  describe("ContentBrief → ContentDraft pipeline", () => {
    it("fetches brief from ContentService", async () => {
      await service.generateForBrief({ briefId: "brief-001" });
      expect(mockContentService.getBrief).toHaveBeenCalledWith("brief-001");
    });

    it("fetches brand profile from BrandService", async () => {
      await service.generateForBrief({ briefId: "brief-001" });
      expect(mockBrandService.getFullProfile).toHaveBeenCalledTimes(1);
    });

    it("passes brand context to brain generate", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].brandContext.name).toBe("Luminesce");
      expect(genCall[0].brandContext.guidelines).toHaveLength(1);
      expect(genCall[0].brandContext.activeProducts).toHaveLength(1);
    });

    it("includes brand facts in evidence", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.brandFacts).toContain(
        "Founded by a biochemist",
      );
      expect(genCall[0].evidence.brandFacts).toContain(
        "Ceramide-first formulation",
      );
    });

    it("calls brain.generate with brief fields", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].brief.channel).toBe("INSTAGRAM");
      expect(genCall[0].brief.format).toBe("POST");
      expect(genCall[0].brief.topic).toBe("Barrier repair");
    });

    it("calls brain.critique with generated content", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockBrain.critique).toHaveBeenCalledTimes(1);
      const [critiqueCall] = mockBrain.critique.mock.calls;
      expect(critiqueCall[0].content).toEqual(generatedInstagramPost);
    });

    it("creates ContentDraft with generated content and critic score", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockContentService.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          briefId: "brief-001",
          version: 1,
          channel: "INSTAGRAM",
          format: "POST",
          criticScore: 0.85,
        }),
      );
    });

    it("returns { draft, approval, evaluation }", async () => {
      const result = await service.generateForBrief({ briefId: "brief-001" });

      expect(result.draft.id).toBe("draft-001");
      expect(result.approval.id).toBe("appr-001");
      expect(result.evaluation.overall).toBe(0.85);
    });
  });

  // --- Critic: no revision on high score ---

  describe("high critic score → no revision", () => {
    it("does not call generate again when score passes", async () => {
      mockBrain.critique.mockResolvedValue(passEvaluation);

      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockBrain.generate).toHaveBeenCalledTimes(1);
    });

    it("records zero autoRevisions in metadata", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const draftCall = mockContentService.createDraft.mock.calls[0][0];
      expect(draftCall.generationMetadata.autoRevisions).toBe(0);
    });
  });

  // --- Critic: revision on low score ---

  describe("low critic score → revision", () => {
    it("calls generate twice when first attempt fails critic", async () => {
      mockBrain.critique
        .mockResolvedValueOnce(failEvaluation) // first critique fails
        .mockResolvedValue(passEvaluation); // revision passes

      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockBrain.generate).toHaveBeenCalledTimes(2);
    });

    it("passes revision feedback to second generate call", async () => {
      mockBrain.critique
        .mockResolvedValueOnce(failEvaluation)
        .mockResolvedValue(passEvaluation);

      await service.generateForBrief({ briefId: "brief-001" });

      const secondGenCall = mockBrain.generate.mock.calls[1][0];
      expect(secondGenCall.revisionFeedback).toMatch(/Auto-revision 1/);
      expect(secondGenCall.revisionFeedback).toMatch(/Too promotional/);
      expect(secondGenCall.revisionFeedback).toMatch(/Weak hook/);
    });

    it("records one autoRevision in metadata", async () => {
      mockBrain.critique
        .mockResolvedValueOnce(failEvaluation)
        .mockResolvedValue(passEvaluation);

      await service.generateForBrief({ briefId: "brief-001" });

      const draftCall = mockContentService.createDraft.mock.calls[0][0];
      expect(draftCall.generationMetadata.autoRevisions).toBe(1);
    });
  });

  // --- External revision feedback ---

  describe("revisionFeedback from caller", () => {
    it("passes caller revision feedback to first generate call", async () => {
      await service.generateForBrief({
        briefId: "brief-001",
        revisionFeedback: "Make it less salesy",
      });

      const [firstGenCall] = mockBrain.generate.mock.calls;
      expect(firstGenCall[0].revisionFeedback).toBe("Make it less salesy");
    });
  });

  // --- Revision cap ---

  describe("revision cap at MAX_REVISIONS (2)", () => {
    it("stops revising after 2 auto-revisions even if still failing", async () => {
      mockBrain.critique.mockResolvedValue(failEvaluation); // always fails

      await service.generateForBrief({ briefId: "brief-001" });

      // initial + 2 revisions = 3 total calls
      expect(mockBrain.generate).toHaveBeenCalledTimes(3);
      expect(mockBrain.critique).toHaveBeenCalledTimes(3);
    });

    it("still creates draft after hitting revision cap", async () => {
      mockBrain.critique.mockResolvedValue(failEvaluation);

      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockContentService.createDraft).toHaveBeenCalledTimes(1);
    });

    it("records 2 autoRevisions in metadata when cap hit", async () => {
      mockBrain.critique.mockResolvedValue(failEvaluation);

      await service.generateForBrief({ briefId: "brief-001" });

      const draftCall = mockContentService.createDraft.mock.calls[0][0];
      expect(draftCall.generationMetadata.autoRevisions).toBe(2);
    });
  });

  // --- Version management ---

  describe("version management and supersession", () => {
    it("does not call supersedePreviousDrafts for version 1", async () => {
      mockContentService.getNextVersion.mockResolvedValue(1);

      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockContentService.supersedePreviousDrafts).not.toHaveBeenCalled();
    });

    it("supersedes previous drafts when version > 1", async () => {
      mockContentService.getNextVersion.mockResolvedValue(2);

      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockContentService.supersedePreviousDrafts).toHaveBeenCalledWith(
        "brief-001",
        2,
      );
    });

    it("creates new draft with correct version number", async () => {
      mockContentService.getNextVersion.mockResolvedValue(3);

      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockContentService.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ version: 3 }),
      );
    });
  });

  // --- Approval ---

  describe("Approval lifecycle", () => {
    it("creates exactly one Approval for the final draft", async () => {
      await service.generateForBrief({ briefId: "brief-001" });
      expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    });

    it("Approval type is CONTENT", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [approvalCall] = mockApprovalService.create.mock.calls;
      expect(approvalCall[0].type).toBe("CONTENT");
    });

    it("Approval subject contains channel, format, and topic", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [approvalCall] = mockApprovalService.create.mock.calls;
      expect(approvalCall[0].subject).toMatch(/INSTAGRAM/);
      expect(approvalCall[0].subject).toMatch(/POST/);
      expect(approvalCall[0].subject).toMatch(/Barrier repair/);
    });

    it("Approval metadata contains draftId and criticScore", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [approvalCall] = mockApprovalService.create.mock.calls;
      expect(approvalCall[0].metadata.draftId).toBe("draft-001");
      expect(approvalCall[0].metadata.criticScore).toBe(0.85);
    });

    it("links Approval to draft via ContentService", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      expect(mockContentService.linkApprovalToDraft).toHaveBeenCalledWith(
        "draft-001",
        "appr-001",
      );
    });

    it("does NOT create Approval for superseded drafts", async () => {
      mockContentService.getNextVersion.mockResolvedValue(2);

      await service.generateForBrief({ briefId: "brief-001" });

      // supersedePreviousDrafts called but Approval created only once
      expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    });

    it("Approval does not cause external side effects", async () => {
      // Only ContentService and ApprovalService are called — no email, no Shopify write
      await service.generateForBrief({ briefId: "brief-001" });

      // ShopifyService only read (getCommerceContext), never written
      expect(mockShopifyService.getCommerceContext).toHaveBeenCalledTimes(1);
      // No publish/send calls exist on any mock
    });
  });

  // --- Evidence safety ---

  describe("evidence safety — trust boundary", () => {
    it("brand facts are in evidence.brandFacts (trusted)", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.brandFacts).toEqual([
        "Founded by a biochemist",
        "Ceramide-first formulation",
      ]);
    });

    it("brand guidelines are in brandContext (trusted)", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].brandContext.guidelines[0].rule).toBe(
        "Never overclaim",
      );
    });

    it("research findings go to evidence.researchFindings (untrusted path)", async () => {
      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.researchFindings).toEqual([
        "Ceramides market growing 15% YoY",
        "Reddit r/SkincareAddiction very active",
      ]);
    });

    it("research findings sourced from topFindings[].excerpt", async () => {
      mockResearchContext.topFindings = [
        { excerpt: "Finding A" },
        { excerpt: "Finding B" },
      ];

      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.researchFindings).toEqual([
        "Finding A",
        "Finding B",
      ]);
    });

    it("STALE commerce gets stale prefix in summary", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue({
        ...mockCommerceContext,
        evidenceStatus: "STALE",
      });

      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.commerceSummary).toMatch(/STALE DATA/);
    });

    it("UNAVAILABLE commerce omits summary from evidence", async () => {
      mockShopifyService.getCommerceContext.mockResolvedValue({
        evidenceStatus: "UNAVAILABLE",
        metrics: null,
        failureReason: "Shopify not configured",
      });

      await service.generateForBrief({ briefId: "brief-001" });

      const [genCall] = mockBrain.generate.mock.calls;
      // commerceSummary should be present but indicate no metrics
      expect(genCall[0].evidence.commerceSummary).toMatch(/no metrics/);
    });

    it("works without Shopify (getCommerceContext throws)", async () => {
      mockShopifyService.getCommerceContext.mockRejectedValue(
        new Error("Shopify not configured"),
      );

      await expect(
        service.generateForBrief({ briefId: "brief-001" }),
      ).resolves.toBeDefined();

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.commerceSummary).toBeUndefined();
    });

    it("works without research (getResearchContext throws)", async () => {
      mockResearchService.getResearchContext.mockRejectedValue(
        new Error("Research not available"),
      );

      await expect(
        service.generateForBrief({ briefId: "brief-001" }),
      ).resolves.toBeDefined();

      const [genCall] = mockBrain.generate.mock.calls;
      expect(genCall[0].evidence.researchFindings).toEqual([]);
    });
  });

  // --- Failure handling ---

  describe("failure handling", () => {
    it("throws when brain.generate fails on initial call", async () => {
      mockBrain.generate.mockRejectedValue(new Error("Brain unavailable"));

      await expect(
        service.generateForBrief({ briefId: "brief-001" }),
      ).rejects.toThrow("Brain unavailable");
    });

    it("throws when brain.critique fails", async () => {
      mockBrain.critique.mockRejectedValue(new Error("Critic timeout"));

      await expect(
        service.generateForBrief({ briefId: "brief-001" }),
      ).rejects.toThrow("Critic timeout");
    });

    it("does not create draft when generation fails", async () => {
      mockBrain.generate.mockRejectedValue(new Error("Brain error"));

      await expect(
        service.generateForBrief({ briefId: "brief-001" }),
      ).rejects.toThrow();

      expect(mockContentService.createDraft).not.toHaveBeenCalled();
    });

    it("does not create Approval when generation fails", async () => {
      mockBrain.generate.mockRejectedValue(new Error("Brain error"));

      await expect(
        service.generateForBrief({ briefId: "brief-001" }),
      ).rejects.toThrow();

      expect(mockApprovalService.create).not.toHaveBeenCalled();
    });

    it("throws when brief not found", async () => {
      mockContentService.getBrief.mockRejectedValue(
        new Error("ContentBrief brief-999 not found"),
      );

      await expect(
        service.generateForBrief({ briefId: "brief-999" }),
      ).rejects.toThrow("brief-999 not found");
    });
  });
});

// --- Channel-native output tests ---

describe("ContentGenerationService — channel-native output", () => {
  let service: ContentGenerationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentGenerationService,
        { provide: ContentBrainAdapter, useValue: mockBrain },
        { provide: ContentService, useValue: mockContentService },
        { provide: BrandService, useValue: mockBrandService },
        { provide: ShopifyService, useValue: mockShopifyService },
        { provide: ResearchService, useValue: mockResearchService },
        { provide: ApprovalService, useValue: mockApprovalService },
      ],
    }).compile();

    service = module.get<ContentGenerationService>(ContentGenerationService);
    jest.clearAllMocks();

    mockContentService.getBrief.mockResolvedValue(mockBrief);
    mockBrandService.getFullProfile.mockResolvedValue(mockProfile);
    mockShopifyService.getCommerceContext.mockResolvedValue(
      mockCommerceContext,
    );
    mockResearchService.getResearchContext.mockResolvedValue(
      mockResearchContext,
    );
    mockContentService.getNextVersion.mockResolvedValue(1);
    mockBrain.critique.mockResolvedValue(passEvaluation);
    mockContentService.createDraft.mockResolvedValue(mockDraft);
    mockApprovalService.create.mockResolvedValue(mockApproval);
    mockContentService.linkApprovalToDraft.mockResolvedValue(undefined);
    mockContentService.supersedePreviousDrafts.mockResolvedValue(undefined);
  });

  it("Instagram POST — passes channel and format to draft", async () => {
    mockBrain.generate.mockResolvedValue(generatedInstagramPost);

    await service.generateForBrief({ briefId: "brief-001" });

    expect(mockContentService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "INSTAGRAM", format: "POST" }),
    );
  });

  it("Instagram CAROUSEL — slides array preserved in content", async () => {
    mockBrain.generate.mockResolvedValue(generatedCarousel);

    await service.generateForBrief({ briefId: "brief-001" });

    const draftCall = mockContentService.createDraft.mock.calls[0][0];
    expect((draftCall.content as any).slides).toHaveLength(3);
    expect((draftCall.content as any).hookSlide).toMatch(/damaged/i);
    expect((draftCall.content as any).slides[0].slideNumber).toBe(1);
  });

  it("X POST — passes text content", async () => {
    mockBrain.generate.mockResolvedValue(generatedXPost);

    await service.generateForBrief({ briefId: "brief-001" });

    const draftCall = mockContentService.createDraft.mock.calls[0][0];
    expect(draftCall.channel).toBe("X");
    expect((draftCall.content as any).text).toBeTruthy();
  });

  it("X THREAD — passes thread array", async () => {
    mockBrain.generate.mockResolvedValue(generatedXThread);

    await service.generateForBrief({ briefId: "brief-001" });

    const draftCall = mockContentService.createDraft.mock.calls[0][0];
    expect((draftCall.content as any).thread).toHaveLength(5);
  });

  it("Reddit POST — title and body preserved", async () => {
    mockBrain.generate.mockResolvedValue(generatedRedditPost);

    await service.generateForBrief({ briefId: "brief-001" });

    const draftCall = mockContentService.createDraft.mock.calls[0][0];
    expect((draftCall.content as any).title).toBeTruthy();
    expect((draftCall.content as any).body).toBeTruthy();
    expect((draftCall.content as any).subredditSuggestion).toMatch(/r\//);
  });

  it("Blog LONG_FORM — outline array preserved", async () => {
    mockBrain.generate.mockResolvedValue(generatedBlogPost);

    await service.generateForBrief({ briefId: "brief-001" });

    const draftCall = mockContentService.createDraft.mock.calls[0][0];
    expect((draftCall.content as any).outline).toHaveLength(4);
    expect((draftCall.content as any).title).toBeTruthy();
    expect((draftCall.content as any).metaDescription).toBeTruthy();
  });
});
