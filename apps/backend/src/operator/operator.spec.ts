import { BadRequestException } from "@nestjs/common";
import { OperatorBriefService } from "./operator-brief.service";
import { OperatorCommandService } from "./operator-command.service";
import { OperatorStatusService } from "./operator-status.service";
import { OperatorController } from "./operator.controller";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function mockPrisma() {
  return {
    brand: { findFirst: jest.fn().mockResolvedValue({ name: "Luminesce" }) },
    revenueOpportunity: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    recoveryJourney: { count: jest.fn().mockResolvedValue(0) },
    abandonedCheckout: {
      findFirst: jest.fn().mockResolvedValue({ currencyCode: "EUR" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    marketOpportunity: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    searchOpportunity: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    contentDraft: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    publishRequest: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    publication: { groupBy: jest.fn().mockResolvedValue([]) },
    contact: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    commerceSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
    marketIntelligenceSyncRun: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

function mockShopify(configured = true) {
  return {
    adapter: { configured },
    service: {
      getCommerceContext: jest.fn().mockResolvedValue({
        evidenceStatus: "AVAILABLE",
        failureReason: null,
        metrics: {
          currencyCode: "EUR",
          revenue: 5000,
          orderCount: 50,
          aov: 100,
          unitsSold: 80,
          periodStart: new Date("2026-08-01"),
          periodEnd: new Date("2026-08-31"),
          previousPeriod: { revenue: 4000 },
          revenueByProduct: [
            {
              productId: "p1",
              productTitle: "Night Balm",
              revenue: 3000,
              units: 30,
            },
          ],
          customerSummary: { repeatRate: 0.4 },
        },
      }),
    },
  };
}

function mockBriefDeps(overrides?: {
  prisma?: any;
  shopifyConfigured?: boolean;
  marketFreshness?: Record<string, string>;
  brainPrioritize?: jest.Mock;
}) {
  const prisma = overrides?.prisma ?? mockPrisma();
  const shopify = mockShopify(overrides?.shopifyConfigured ?? true);
  const segments = {
    getSegmentSummary: jest.fn().mockResolvedValue([
      { type: "VIP", name: "VIP", memberCount: 5 },
      { type: "LAPSED_CUSTOMER", name: "Lapsed", memberCount: 12 },
      { type: "REPLENISHMENT_DUE", name: "Replen", memberCount: 3 },
      { type: "ABANDONED_CHECKOUT", name: "Abandoned", memberCount: 2 },
    ]),
  };
  const abandonedCheckouts = {
    getSummary: jest.fn().mockResolvedValue({ activeTotalValue: 900 }),
  };
  const replenishment = {
    getCandidates: jest.fn().mockResolvedValue([
      {
        productId: "p1",
        productName: "Night Balm",
        windowDays: 45,
        contacts: [{ id: "c1" }],
      },
    ]),
  };
  const revenueContext = {
    build: jest.fn().mockResolvedValue({
      summary: {
        openOpportunities: 4,
        last30Days: { totalRevenue: 300, totalContributionProfit: 120 },
      },
    }),
  };
  const marketContext = {
    build: jest.fn().mockResolvedValue({
      dataFreshness: {
        searchConsole: "MOCK",
        trends: "MOCK",
        keywordPlanner: "MOCK",
        funnel: "NOT_CONFIGURED",
        ...(overrides?.marketFreshness ?? {}),
      },
      topOpportunities: [{ topic: "vitamin c serum", score: 82 }],
    }),
  };
  const brain = {
    prioritize:
      overrides?.brainPrioritize ??
      jest.fn().mockRejectedValue(new Error("brain down")),
  };
  const attribution = {
    getSummary: jest.fn().mockResolvedValue({
      totalRevenue: 0,
      totalContributionProfit: 0,
      totalIncentiveCost: 0,
      totalAttributions: 0,
      byType: {},
      byAttributionType: {},
    }),
  };
  const recommendations = {
    propose: jest.fn().mockResolvedValue({ id: "rec-1" }),
  };
  const experimentMeasurement = {
    evaluateRecent: jest.fn().mockResolvedValue([]),
  };
  const settings = {
    getRevenueSync: () => ({
      maxDiscountPct: 20,
      minContributionMarginPct: 15,
      minOrderValue: 30,
      maxDiscountsPerJourney: 2,
      minHoursBeforeDiscount: 6,
      recoveryLadderHours: [1, 6, 24, 48],
      winBackDays: 90,
      vipLtvThreshold: 500,
      freeShippingNearFactor: 0.8,
    }),
    getCommerceSync: () => ({
      lowStockThreshold: 5,
      defaultMetricsPeriodDays: 30,
    }),
  };
  const service = new OperatorBriefService(
    prisma as any,
    shopify.service as any,
    shopify.adapter as any,
    segments as any,
    abandonedCheckouts as any,
    replenishment as any,
    revenueContext as any,
    marketContext as any,
    brain as any,
    attribution as any,
    recommendations as any,
    experimentMeasurement as any,
    settings as any,
  );
  return { service, prisma, shopify, brain, recommendations };
}

// ---------------------------------------------------------------------------
// OperatorBriefService — /today aggregation
// ---------------------------------------------------------------------------

describe("OperatorBriefService", () => {
  it("aggregates deterministic facts from all sections", async () => {
    const { service } = mockBriefDeps();
    const today = await service.buildToday({ skipInterpretation: true });

    expect(today.brandName).toBe("Luminesce");
    expect(today.facts.sales.status).toBe("AVAILABLE");
    expect(today.facts.sales.revenue).toBe(5000);
    expect(today.facts.sales.revenueDeltaPct).toBe(25);
    expect(today.facts.revenue.abandonedValue).toBe(900);
    expect(today.facts.customers.vip).toBe(5);
    expect(today.facts.customers.winBack).toBe(12);
    expect(today.generatedAt).toBeInstanceOf(Date);
  });

  it("Today renders with interpretation UNAVAILABLE when the brain fails", async () => {
    const { service } = mockBriefDeps(); // brain rejects by default
    const today = await service.buildToday();

    expect(today.interpretation.status).toBe("UNAVAILABLE");
    expect(today.interpretation.failureReason).toContain(
      "CMO interpretation unavailable",
    );
    // Deterministic metrics unaffected
    expect(today.facts.sales.revenue).toBe(5000);
    expect(today.actions.length).toBeGreaterThan(0);
  });

  it("brain reordering is applied but invented action ids are dropped", async () => {
    const prioritize = jest.fn().mockResolvedValue({
      headline: "Focus on recovery",
      narrative: "Recover carts first.",
      prioritized: [
        { id: "review-winback", why: "cheapest revenue", confidence: 0.7 },
        { id: "invented-action", why: "should be dropped", confidence: 0.9 },
      ],
    });
    const { service } = mockBriefDeps({ brainPrioritize: prioritize });
    const today = await service.buildToday();

    expect(today.interpretation.status).toBe("AVAILABLE");
    expect(today.actions[0].id).toBe("review-winback");
    expect(today.actions.map((a) => a.id)).not.toContain("invented-action");
    // Actions not mentioned by the brain keep deterministic order at the end
    expect(today.actions.length).toBeGreaterThan(1);
  });

  it("sales NOT_CONFIGURED produces fix-shopify-connection action with top priority", async () => {
    const { service } = mockBriefDeps({ shopifyConfigured: false });
    const today = await service.buildToday({ skipInterpretation: true });

    expect(today.facts.sales.status).toBe("NOT_CONFIGURED");
    const fix = today.actions.find((a) => a.id === "fix-shopify-connection");
    expect(fix).toBeDefined();
    expect(today.actions[0].id).toBe("fix-shopify-connection");
    expect(fix!.deepLink).toBe("/connections");
  });

  it("a failing section degrades to UNAVAILABLE without breaking Today", async () => {
    const prisma = mockPrisma();
    prisma.contentDraft.count.mockRejectedValue(new Error("db timeout"));
    const { service } = mockBriefDeps({ prisma });
    const today = await service.buildToday({ skipInterpretation: true });

    expect(today.facts.content.status).toBe("UNAVAILABLE");
    expect(today.facts.content.awaitingReview).toBeNull();
    expect(today.facts.sales.status).toBe("AVAILABLE");
  });

  it("MOCK market data never drives content recommendations", async () => {
    const prisma = mockPrisma();
    const { service } = mockBriefDeps({ prisma });
    const today = await service.buildToday({ skipInterpretation: true });

    expect(today.facts.market.status).toBe("MOCK");
    expect(
      today.actions.find((a) => a.id === "create-market-content"),
    ).toBeUndefined();
  });

  it("AVAILABLE market data does drive content recommendations", async () => {
    const { service } = mockBriefDeps({
      marketFreshness: { searchConsole: "AVAILABLE" },
    });
    const today = await service.buildToday({ skipInterpretation: true });

    expect(today.facts.market.status).toBe("AVAILABLE");
    const action = today.actions.find((a) => a.id === "create-market-content");
    expect(action).toBeDefined();
    expect(action!.deepLink).toBe("/market");
  });

  it("failed publications produce an investigate action deep-linking to the calendar", async () => {
    const prisma = mockPrisma();
    prisma.publishRequest.count.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.status === "FAILED" ? 2 : 0),
    );
    const { service } = mockBriefDeps({ prisma });
    const today = await service.buildToday({ skipInterpretation: true });

    expect(today.facts.content.failedPublications).toBe(2);
    const action = today.actions.find(
      (a) => a.id === "investigate-failed-publications",
    );
    expect(action).toBeDefined();
    expect(action!.deepLink).toBe("/calendar?status=FAILED");
    expect(action!.requiredAction).toBe("READ");
  });

  it("action deep links point at operator pages", async () => {
    const prisma = mockPrisma();
    prisma.contentDraft.count.mockImplementation((args: any) => {
      if (args?.where?.status === "PENDING_REVIEW") return Promise.resolve(3);
      if (args?.where?.status === "APPROVED") return Promise.resolve(1);
      return Promise.resolve(0);
    });
    const { service } = mockBriefDeps({ prisma });
    const today = await service.buildToday({ skipInterpretation: true });

    const links = Object.fromEntries(
      today.actions.map((a) => [a.id, a.deepLink]),
    );
    expect(links["review-drafts"]).toBe("/content?view=review");
    expect(links["publish-approved"]).toBe("/content?view=approved");
    expect(links["review-winback"]).toBe("/customers?segment=LAPSED_CUSTOMER");
  });

  it("eligible recoveries create an EXECUTE action that requires approval", async () => {
    const prisma = mockPrisma();
    prisma.revenueOpportunity.findMany.mockResolvedValue([
      { cartValue: 120 },
      { cartValue: 80 },
    ]);
    const { service } = mockBriefDeps({ prisma });
    const today = await service.buildToday({ skipInterpretation: true });

    const action = today.actions.find((a) => a.id === "recover-abandoned");
    expect(action).toBeDefined();
    expect(action!.requiredAction).toBe("EXECUTE");
    expect(action!.requiresApproval).toBe(true);
    expect(action!.deepLink).toBe("/revenue?section=abandoned");
  });
});

// ---------------------------------------------------------------------------
// OperatorCommandService — classification, routing, confirmation gating
// ---------------------------------------------------------------------------

function mockCommandDeps(overrides?: {
  prisma?: any;
  shopifyConfigured?: boolean;
  brain?: Partial<{
    classifyIntent: jest.Mock;
    toValidatedProposal: jest.Mock;
  }>;
}) {
  const prisma = overrides?.prisma ?? mockPrisma();
  const shopify = mockShopify(overrides?.shopifyConfigured ?? true);
  const content = {
    createBrief: jest.fn().mockResolvedValue({ id: "brief-1" }),
  };
  const contentGeneration = {
    generateForBrief: jest.fn().mockResolvedValue({}),
  };
  const segments = {
    getSegmentSummary: jest
      .fn()
      .mockResolvedValue([
        { type: "VIP", name: "VIP", memberCount: 5, id: "s1" },
      ]),
  };
  const bundles = {
    suggestBundlesFromAffinity: jest.fn().mockResolvedValue(1),
  };
  const replenishment = { getCandidates: jest.fn().mockResolvedValue([]) };
  const brief = {
    buildToday: jest.fn().mockResolvedValue({ facts: {}, actions: [] }),
  };
  const analytics = { getAnalytics: jest.fn().mockResolvedValue({ ok: 1 }) };
  const brain = {
    classifyIntent: jest.fn().mockRejectedValue(new Error("no brain")),
    toValidatedProposal: jest.fn().mockReturnValue(null),
    ...(overrides?.brain ?? {}),
  };
  const recommendations = {
    propose: jest.fn().mockResolvedValue({ id: "rec-1" }),
  };
  const service = new OperatorCommandService(
    prisma as any,
    shopify.service as any,
    shopify.adapter as any,
    content as any,
    contentGeneration as any,
    segments as any,
    bundles as any,
    replenishment as any,
    brief as any,
    analytics as any,
    brain as any,
    recommendations as any,
  );
  return {
    service,
    prisma,
    content,
    contentGeneration,
    bundles,
    brief,
    brain,
  };
}

describe("OperatorCommandService", () => {
  it("classifies READ intents and routes without side effects", async () => {
    const { service, brief } = mockCommandDeps();
    const result = await service.execute({
      intent: "GET_DAILY_BRIEF",
      confirm: false,
    });

    expect(result.status).toBe("OK");
    expect(result.classification).toBe("READ");
    expect(result.deepLink).toBe("/today");
    expect(brief.buildToday).toHaveBeenCalledWith({ skipInterpretation: true });
  });

  it("LIST_CUSTOMERS returns aggregated counts only", async () => {
    const { service } = mockCommandDeps();
    const result = await service.execute({
      intent: "LIST_CUSTOMERS",
      confirm: false,
    });

    expect(result.status).toBe("OK");
    expect(result.classification).toBe("READ");
    expect(result.data).toEqual([{ type: "VIP", name: "VIP", memberCount: 5 }]);
  });

  it("LIST_ABANDONED strips PII from results", async () => {
    const prisma = mockPrisma();
    prisma.abandonedCheckout.findMany.mockResolvedValue([
      {
        id: "ac1",
        email: "secret@example.com",
        totalValue: 120,
        currencyCode: "EUR",
        abandonedAt: new Date(),
        status: "ACTIVE",
        lineItems: [{}, {}],
      },
    ]);
    const { service } = mockCommandDeps({ prisma });
    const result = await service.execute({
      intent: "LIST_ABANDONED",
      confirm: false,
    });

    expect(result.status).toBe("OK");
    const item = (result.data as any[])[0];
    expect(item.email).toBeUndefined();
    expect(item.totalValue).toBe(120);
    expect(item.itemCount).toBe(2);
    expect(result.deepLink).toBe("/revenue?section=abandoned");
  });

  it("CREATE_CONTENT_BRIEF is PROPOSE: creates brief and starts generation", async () => {
    const { service, content, contentGeneration } = mockCommandDeps();
    const result = await service.execute({
      intent: "CREATE_CONTENT_BRIEF",
      params: { topic: "retinol myths" },
      confirm: false,
    });

    expect(result.status).toBe("OK");
    expect(result.classification).toBe("PROPOSE");
    expect(content.createBrief).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "retinol myths", channel: "BLOG" }),
    );
    expect(contentGeneration.generateForBrief).toHaveBeenCalledWith({
      briefId: "brief-1",
    });
    expect(result.deepLink).toBe("/content");
  });

  it("CREATE_CONTENT_BRIEF without topic asks for clarification", async () => {
    const { service, content } = mockCommandDeps();
    const result = await service.execute({
      intent: "CREATE_CONTENT_BRIEF",
      params: {},
      confirm: false,
    });

    expect(result.status).toBe("CLARIFICATION_NEEDED");
    expect(content.createBrief).not.toHaveBeenCalled();
  });

  it("SCHEDULE_CONTENT is MUTATE and requires explicit confirmation", async () => {
    const prisma = mockPrisma();
    prisma.publishRequest.findUnique.mockResolvedValue({
      id: "pr1",
      brandId: "luminesce-brand-001",
      status: "PENDING",
    });
    const { service } = mockCommandDeps({ prisma });

    const result = await service.execute({
      intent: "SCHEDULE_CONTENT",
      params: { publishRequestId: "pr1", scheduledAt: "2026-09-01T10:00:00Z" },
      confirm: false,
    });

    expect(result.status).toBe("CONFIRMATION_REQUIRED");
    expect(result.classification).toBe("MUTATE");
    expect(prisma.publishRequest.update).not.toHaveBeenCalled();
  });

  it("SCHEDULE_CONTENT with confirm updates scheduledAt only (no execution)", async () => {
    const prisma = mockPrisma();
    prisma.publishRequest.findUnique.mockResolvedValue({
      id: "pr1",
      brandId: "luminesce-brand-001",
      status: "APPROVED",
    });
    prisma.publishRequest.update.mockResolvedValue({
      id: "pr1",
      scheduledAt: new Date("2026-09-01T10:00:00Z"),
    });
    const { service } = mockCommandDeps({ prisma });

    const result = await service.execute({
      intent: "SCHEDULE_CONTENT",
      params: { publishRequestId: "pr1", scheduledAt: "2026-09-01T10:00:00Z" },
      confirm: true,
    });

    expect(result.status).toBe("OK");
    expect(prisma.publishRequest.update).toHaveBeenCalledWith({
      where: { id: "pr1" },
      data: { scheduledAt: new Date("2026-09-01T10:00:00Z") },
    });
    expect(result.summary).toContain("approval flow");
  });

  it("SCHEDULE_CONTENT refuses requests outside PENDING/APPROVED", async () => {
    const prisma = mockPrisma();
    prisma.publishRequest.findUnique.mockResolvedValue({
      id: "pr1",
      brandId: "luminesce-brand-001",
      status: "SUCCEEDED",
    });
    const { service } = mockCommandDeps({ prisma });

    const result = await service.execute({
      intent: "SCHEDULE_CONTENT",
      params: { publishRequestId: "pr1", scheduledAt: "2026-09-01T10:00:00Z" },
      confirm: true,
    });

    expect(result.status).toBe("ERROR");
    expect(prisma.publishRequest.update).not.toHaveBeenCalled();
  });

  it("PROPOSE_BUNDLE creates proposals only and never mutates Shopify", async () => {
    const { service, bundles } = mockCommandDeps();
    const result = await service.execute({
      intent: "PROPOSE_BUNDLE",
      confirm: false,
    });

    expect(result.status).toBe("OK");
    expect(result.classification).toBe("PROPOSE");
    expect(bundles.suggestBundlesFromAffinity).toHaveBeenCalledWith([
      { shopifyProductId: "p1", title: "Night Balm", price: 100 },
    ]);
    expect(result.deepLink).toBe("/revenue?section=bundles");
  });

  it("no intent and no text → UNSUPPORTED", async () => {
    const { service } = mockCommandDeps();
    const result = await service.execute({ confirm: false } as any);
    expect(result.status).toBe("UNSUPPORTED");
  });

  it("NL text with unclassifiable intent → CLARIFICATION_NEEDED", async () => {
    const { service } = mockCommandDeps({
      brain: {
        classifyIntent: jest
          .fn()
          .mockResolvedValue({ intent: null, params: {}, confidence: 0 }),
        toValidatedProposal: jest.fn().mockReturnValue(null),
      },
    });
    const result = await service.execute({
      text: "make me a coffee",
      confirm: false,
    });

    expect(result.status).toBe("CLARIFICATION_NEEDED");
    expect(result.intent).toBeNull();
  });

  it("low-confidence proposals never route", async () => {
    const { service, brief } = mockCommandDeps({
      brain: {
        classifyIntent: jest.fn().mockResolvedValue({
          intent: "GET_DAILY_BRIEF",
          params: {},
          confidence: 0.3,
        }),
        toValidatedProposal: jest.fn().mockReturnValue({
          intent: "GET_DAILY_BRIEF",
          params: {},
          confidence: 0.3,
        }),
      },
    });
    const result = await service.execute({ text: "brief?", confirm: false });

    expect(result.status).toBe("CLARIFICATION_NEEDED");
    expect(brief.buildToday).not.toHaveBeenCalled();
  });

  it("brain unavailable during NL classification → ERROR with fallback hint", async () => {
    const { service } = mockCommandDeps(); // classifyIntent rejects by default
    const result = await service.execute({
      text: "show my daily brief",
      confirm: false,
    });

    expect(result.status).toBe("ERROR");
    expect(result.summary).toContain("explicit intents");
  });

  it("routing errors surface as ERROR results, not exceptions", async () => {
    const prisma = mockPrisma();
    prisma.contentDraft.findMany.mockRejectedValue(new Error("db down"));
    const { service } = mockCommandDeps({ prisma });
    const result = await service.execute({
      intent: "LIST_DRAFTS",
      confirm: false,
    });

    expect(result.status).toBe("ERROR");
    expect(result.summary).toContain("db down");
  });
});

// ---------------------------------------------------------------------------
// OperatorController — malformed commands rejected by Zod before routing
// ---------------------------------------------------------------------------

describe("OperatorController command validation", () => {
  function makeController() {
    const command = { execute: jest.fn().mockResolvedValue({ status: "OK" }) };
    const controller = new OperatorController(
      {} as any,
      {} as any,
      {} as any,
      command as any,
    );
    return { controller, command };
  }

  it("rejects an invented intent", async () => {
    const { controller, command } = makeController();
    expect(() =>
      controller.executeCommand({ intent: "DELETE_EVERYTHING" }),
    ).toThrow(BadRequestException);
    expect(command.execute).not.toHaveBeenCalled();
  });

  it("rejects a command with neither text nor intent", () => {
    const { controller, command } = makeController();
    expect(() => controller.executeCommand({ params: {} })).toThrow(
      BadRequestException,
    );
    expect(command.execute).not.toHaveBeenCalled();
  });

  it("accepts a valid explicit intent and applies confirm default", async () => {
    const { controller, command } = makeController();
    await controller.executeCommand({ intent: "GET_ANALYTICS" });
    expect(command.execute).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "GET_ANALYTICS", confirm: false }),
    );
  });
});

// ---------------------------------------------------------------------------
// OperatorStatusService — provider truth
// ---------------------------------------------------------------------------

describe("OperatorStatusService", () => {
  function makeStatus(opts?: {
    env?: Record<string, string>;
    shopifyConfigured?: boolean;
    snapshot?: any;
  }) {
    const prisma = mockPrisma();
    if (opts?.snapshot !== undefined) {
      prisma.commerceSnapshot.findFirst.mockResolvedValue(opts.snapshot);
    }
    const config = {
      get: jest.fn((key: string, def = "") => (opts?.env ?? {})[key] ?? def),
    };
    const adapter = { configured: opts?.shopifyConfigured ?? false };
    const { of } = require("rxjs");
    const http = {
      get: jest.fn().mockReturnValue(
        of({
          data: {
            status: "ok",
            llm: {
              provider: "ollama",
              model: "test",
              configured: true,
              reachable: true,
              lastError: null,
            },
          },
        }),
      ),
    };
    return {
      service: new OperatorStatusService(
        prisma as any,
        config as any,
        adapter as any,
        http as any,
      ),
      prisma,
      http,
    };
  }

  it("Shopify without credentials is NOT_CONFIGURED", async () => {
    const { service } = makeStatus({ shopifyConfigured: false });
    const status = await service.getStatus();
    const shopify = status.connections.find((c) => c.key === "shopify")!;
    expect(shopify.health).toBe("NOT_CONFIGURED");
  });

  it("Shopify with fresh snapshot is CONNECTED; stale snapshot is STALE", async () => {
    const fresh = makeStatus({
      shopifyConfigured: true,
      snapshot: {
        available: true,
        snapshotAt: new Date(),
        shopName: "Luminesce Store",
      },
    });
    const freshStatus = await fresh.service.getStatus();
    expect(
      freshStatus.connections.find((c) => c.key === "shopify")!.health,
    ).toBe("CONNECTED");

    const stale = makeStatus({
      shopifyConfigured: true,
      snapshot: {
        available: true,
        snapshotAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        shopName: "Luminesce Store",
      },
    });
    const staleStatus = await stale.service.getStatus();
    expect(
      staleStatus.connections.find((c) => c.key === "shopify")!.health,
    ).toBe("STALE");
  });

  it("Shopify failed snapshot is ERROR with the failure reason", async () => {
    const { service } = makeStatus({
      shopifyConfigured: true,
      snapshot: {
        available: false,
        snapshotAt: new Date(),
        failureReason: "401 unauthorized",
      },
    });
    const status = await service.getStatus();
    const shopify = status.connections.find((c) => c.key === "shopify")!;
    expect(shopify.health).toBe("ERROR");
    expect(shopify.detail).toContain("401 unauthorized");
  });

  it("market intelligence providers are always MOCK, even with env vars set", async () => {
    const { service } = makeStatus({
      env: {
        GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
        SERPAPI_KEY: "x",
        GOOGLE_ADS_DEVELOPER_TOKEN: "y",
      },
    });
    const status = await service.getStatus();
    for (const key of ["search-console", "trends", "keyword-planner"]) {
      const c = status.connections.find((x) => x.key === key)!;
      expect(c.health).toBe("MOCK");
      expect(c.detail).toContain("Mock");
    }
  });

  it("env-based providers show NOT_CONFIGURED with missing var names, never secret values", async () => {
    const { service } = makeStatus({
      env: { WORDPRESS_BASE_URL: "https://blog.example.com" },
    });
    const status = await service.getStatus();
    const wp = status.connections.find((c) => c.key === "wordpress")!;
    expect(wp.health).toBe("NOT_CONFIGURED");
    expect(wp.detail).toContain("WORDPRESS_USERNAME");
    expect(wp.detail).not.toContain("blog.example.com");
  });

  it("configured env-based providers are CONNECTED", async () => {
    const { service } = makeStatus({
      env: { TELEGRAM_BOT_TOKEN: "123:abc" },
    });
    const status = await service.getStatus();
    const tg = status.connections.find((c) => c.key === "telegram")!;
    expect(tg.health).toBe("CONNECTED");
    expect(tg.detail).not.toContain("123:abc");
  });

  it("email is MOCK and creative is NOT_CONFIGURED — no fake availability", async () => {
    const { service } = makeStatus();
    const status = await service.getStatus();
    expect(status.connections.find((c) => c.key === "email")!.health).toBe(
      "MOCK",
    );
    expect(status.connections.find((c) => c.key === "creative")!.health).toBe(
      "NOT_CONFIGURED",
    );
  });
});
