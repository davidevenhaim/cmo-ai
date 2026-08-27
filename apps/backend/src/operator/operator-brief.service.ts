import { Injectable, Logger } from "@nestjs/common";
import {
  CmoInterpretation,
  OperatorToday,
  SuggestedAction,
  TodayContent,
  TodayCustomers,
  TodayMarket,
  TodayRecentResults,
  TodayRevenue,
  TodaySales,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ShopifyGraphqlAdapter } from "../shopify/shopify-graphql.adapter";
import { SegmentService } from "../growth/segment.service";
import { AbandonedCheckoutService } from "../growth/abandoned-checkout.service";
import { ReplenishmentService } from "../growth/replenishment.service";
import { RevenueContextService } from "../revenue-optimization/revenue-context.service";
import { MarketIntelligenceContextService } from "../market-intelligence/market-intelligence-context.service";
import { REVENUE_POLICY } from "../revenue-optimization/revenue-policy.config";
import { RevenueAttributionService } from "../revenue-optimization/revenue-attribution.service";
import { RecommendationService } from "../measurement/recommendation.service";
import { ExperimentMeasurementService } from "../measurement/experiment-measurement.service";
import { OperatorBrainClient } from "./operator-brain.client";

const BRAND_ID = "luminesce-brand-001";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

@Injectable()
export class OperatorBriefService {
  private readonly logger = new Logger(OperatorBriefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly shopifyAdapter: ShopifyGraphqlAdapter,
    private readonly segments: SegmentService,
    private readonly abandonedCheckouts: AbandonedCheckoutService,
    private readonly replenishment: ReplenishmentService,
    private readonly revenueContext: RevenueContextService,
    private readonly marketContext: MarketIntelligenceContextService,
    private readonly brain: OperatorBrainClient,
    private readonly attribution: RevenueAttributionService,
    private readonly recommendations: RecommendationService,
    private readonly experimentMeasurement: ExperimentMeasurementService,
  ) {}

  async buildToday(opts?: {
    skipInterpretation?: boolean;
  }): Promise<OperatorToday> {
    const [brand, sales, revenue, market, content, customers, recentResults] =
      await Promise.all([
        settle(
          this.prisma.brand.findFirst({
            where: { id: BRAND_ID },
            select: { name: true },
          }),
        ),
        settle(this.buildSales()),
        settle(this.buildRevenue()),
        settle(this.buildMarket()),
        settle(this.buildContent()),
        settle(this.buildCustomers()),
        settle(this.buildRecentResults()),
      ]);

    const facts = {
      sales: sales.ok ? sales.value : this.unavailableSales(sales.error),
      revenue: revenue.ok
        ? revenue.value
        : this.unavailableRevenue(revenue.error),
      market: market.ok ? market.value : this.unavailableMarket(),
      content: content.ok ? content.value : this.unavailableContent(),
      customers: customers.ok ? customers.value : this.unavailableCustomers(),
    };

    let actions = this.buildCandidateActions(facts);

    // Persist important suggestions as Recommendations for the feedback loop.
    // Idempotent (dedupe key) and failure-safe — Today always renders.
    const persisted = await settle(this.persistRecommendations(actions));
    if (!persisted.ok) {
      this.logger.warn(`Recommendation persistence failed: ${persisted.error}`);
    }

    let interpretation: CmoInterpretation = {
      status: "UNAVAILABLE",
      headline: null,
      narrative: null,
      failureReason: null,
    };

    if (!opts?.skipInterpretation && actions.length > 0) {
      const prioritized = await settle(
        this.brain.prioritize({
          brandName: brand.ok ? (brand.value?.name ?? null) : null,
          facts: this.buildFactLines(facts),
          candidateActions: actions,
        }),
      );
      if (prioritized.ok) {
        actions = this.applyPrioritization(actions, prioritized.value);
        interpretation = {
          status: "AVAILABLE",
          headline: prioritized.value.headline,
          narrative: prioritized.value.narrative,
          failureReason: null,
        };
      } else {
        this.logger.warn(`CMO prioritization failed: ${prioritized.error}`);
        interpretation.failureReason =
          "CMO interpretation unavailable — showing deterministic priorities";
      }
    }

    return {
      generatedAt: new Date(),
      brandName: brand.ok ? (brand.value?.name ?? null) : null,
      facts,
      actions,
      interpretation,
      recentResults: recentResults.ok
        ? recentResults.value
        : this.unavailableRecentResults(),
    };
  }

  // -------------------------------------------------------------------------
  // Section builders — all deterministic
  // -------------------------------------------------------------------------

  private async buildSales(): Promise<TodaySales> {
    if (!this.shopifyAdapter.configured) {
      return {
        ...this.unavailableSales(null),
        status: "NOT_CONFIGURED",
      };
    }
    const ctx = await this.shopify.getCommerceContext();
    const m = ctx.metrics;
    const prevRevenue = m?.previousPeriod?.revenue ?? null;
    const periodDays =
      m != null
        ? Math.round(
            (m.periodEnd.getTime() - m.periodStart.getTime()) / 86400000,
          )
        : null;
    return {
      status: ctx.evidenceStatus,
      currencyCode: m?.currencyCode ?? null,
      periodDays,
      revenue: m?.revenue ?? null,
      orderCount: m?.orderCount ?? null,
      aov: m?.aov ?? null,
      unitsSold: m?.unitsSold ?? null,
      previousRevenue: prevRevenue,
      revenueDeltaPct:
        m != null && prevRevenue != null && prevRevenue > 0
          ? Math.round(((m.revenue - prevRevenue) / prevRevenue) * 1000) / 10
          : null,
      topProducts: (m?.revenueByProduct ?? []).slice(0, 5).map((p) => ({
        productTitle: p.productTitle,
        revenue: p.revenue,
        units: p.units,
      })),
      failureReason: ctx.failureReason,
    };
  }

  private async buildRevenue(): Promise<TodayRevenue> {
    const [ctx, checkoutSummary, eligible, activeJourneys, replenishment] =
      await Promise.all([
        this.revenueContext.build(),
        this.abandonedCheckouts.getSummary(),
        this.countEligibleRecoveries(),
        this.prisma.recoveryJourney.count({
          where: { brandId: BRAND_ID, status: "ACTIVE" },
        }),
        this.replenishment.getCandidates(),
      ]);
    const currencyRow = await this.prisma.abandonedCheckout.findFirst({
      where: { brandId: BRAND_ID },
      select: { currencyCode: true },
    });
    return {
      status: "AVAILABLE",
      currencyCode: currencyRow?.currencyCode ?? null,
      abandonedValue: checkoutSummary.activeTotalValue,
      openOpportunities: ctx.summary.openOpportunities,
      eligibleRecoveries: eligible.count,
      activeJourneys,
      replenishmentOpportunities: replenishment.reduce(
        (sum, r) => sum + r.contacts.length,
        0,
      ),
      recoveredRevenueLast30: ctx.summary.last30Days.totalRevenue,
      contributionProfitLast30: ctx.summary.last30Days.totalContributionProfit,
    };
  }

  // Pre-check only: counts NEW recovery opportunities that pass the cheap
  // deterministic gates (value, phone, SMS consent). The authoritative gates
  // (frequency caps, purchase/inventory recheck, economics) still run at send
  // time inside the recovery journey — this number is "eligible to attempt".
  async countEligibleRecoveries(): Promise<{
    count: number;
    totalValue: number;
  }> {
    const opportunities = await this.prisma.revenueOpportunity.findMany({
      where: {
        brandId: BRAND_ID,
        status: "NEW",
        type: { in: ["CART_RECOVERY", "CHECKOUT_RECOVERY"] },
        cartValue: { gte: REVENUE_POLICY.minOrderValue },
        contact: {
          is: {
            phone: { not: null },
            smsMarketingStatus: "SUBSCRIBED",
          },
        },
      },
      select: { cartValue: true },
    });
    return {
      count: opportunities.length,
      totalValue: opportunities.reduce((s, o) => s + (o.cartValue ?? 0), 0),
    };
  }

  private async buildMarket(): Promise<TodayMarket> {
    const ctx = await this.marketContext.build();
    const [oppCount, searchOppCount, gapCount] = await Promise.all([
      this.prisma.marketOpportunity.count({
        where: { brandId: BRAND_ID, status: "NEW" },
      }),
      this.prisma.searchOpportunity.count({
        where: { brandId: BRAND_ID, status: "NEW" },
      }),
      this.prisma.searchOpportunity.count({
        where: {
          brandId: BRAND_ID,
          status: "NEW",
          opportunityType: "CONTENT_GAP",
        },
      }),
    ]);
    const freshness = ctx.dataFreshness;
    const providerStatuses = [
      freshness.searchConsole,
      freshness.trends,
      freshness.keywordPlanner,
    ];
    const status = providerStatuses.includes("AVAILABLE")
      ? "AVAILABLE"
      : providerStatuses.includes("STALE")
        ? "STALE"
        : providerStatuses.every((s) => s === "MOCK" || s === "NOT_CONFIGURED")
          ? "MOCK"
          : "UNAVAILABLE";
    return {
      status,
      dataFreshness: {
        searchConsole: freshness.searchConsole,
        trends: freshness.trends,
        keywordPlanner: freshness.keywordPlanner,
        funnel: freshness.funnel,
      },
      risingTopics: ctx.topOpportunities
        .slice(0, 3)
        .map((o) => ({ topic: o.topic, score: o.score })),
      opportunityCount: oppCount,
      searchOpportunityCount: searchOppCount,
      contentGapCount: gapCount,
    };
  }

  private async buildContent(): Promise<TodayContent> {
    const [awaitingReview, generated, approvedUnpublished, scheduled, pubs] =
      await Promise.all([
        this.prisma.contentDraft.count({
          where: { status: "PENDING_REVIEW" },
        }),
        this.prisma.contentDraft.count({ where: { status: "GENERATED" } }),
        this.prisma.contentDraft.count({
          where: { status: "APPROVED", publishRequests: { none: {} } },
        }),
        this.prisma.publishRequest.count({
          where: {
            brandId: BRAND_ID,
            status: { in: ["PENDING", "APPROVED"] },
            scheduledAt: { not: null },
          },
        }),
        this.prisma.publication.groupBy({
          by: ["status"],
          where: { status: { in: ["FAILED", "UNKNOWN"] } },
          _count: { id: true },
        }),
      ]);
    const failedRequests = await this.prisma.publishRequest.count({
      where: { brandId: BRAND_ID, status: "FAILED" },
    });
    const pubByStatus: Record<string, number> = {};
    for (const row of pubs) pubByStatus[row.status] = row._count.id;
    return {
      status: "AVAILABLE",
      awaitingReview,
      generated,
      approvedUnpublished,
      scheduled,
      failedPublications: Math.max(failedRequests, pubByStatus["FAILED"] ?? 0),
      unknownPublications: pubByStatus["UNKNOWN"] ?? 0,
    };
  }

  private async buildCustomers(): Promise<TodayCustomers> {
    const [summary, totalContacts] = await Promise.all([
      this.segments.getSegmentSummary(),
      this.prisma.contact.count({ where: { brandId: BRAND_ID } }),
    ]);
    const byType = new Map(summary.map((s) => [s.type, s.memberCount]));
    return {
      status: summary.length > 0 ? "AVAILABLE" : "UNAVAILABLE",
      totalContacts,
      vip: byType.get("VIP") ?? 0,
      winBack: byType.get("LAPSED_CUSTOMER") ?? 0,
      replenishmentDue: byType.get("REPLENISHMENT_DUE") ?? 0,
      abandoned: byType.get("ABANDONED_CHECKOUT") ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Candidate actions — deterministic; the brain may only reorder/explain
  // -------------------------------------------------------------------------

  private buildCandidateActions(
    facts: OperatorToday["facts"],
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];
    const currency = facts.revenue.currencyCode ?? facts.sales.currencyCode;

    if ((facts.revenue.eligibleRecoveries ?? 0) > 0) {
      actions.push({
        id: "recover-abandoned",
        title: `Recover ${facts.revenue.eligibleRecoveries} eligible abandoned checkout${facts.revenue.eligibleRecoveries === 1 ? "" : "s"}`,
        why: `${facts.revenue.eligibleRecoveries} recovery opportunities pass the pre-send eligibility gates (consent, phone, minimum value)`,
        category: "REVENUE",
        evidenceSource: "revenue_opportunities",
        expectedImpact:
          facts.revenue.abandonedValue != null
            ? `up to ${facts.revenue.abandonedValue.toFixed(0)} ${currency ?? ""} abandoned value in play`.trim()
            : null,
        impactValue: facts.revenue.abandonedValue,
        currencyCode: currency,
        confidence: 0.8,
        requiredAction: "EXECUTE",
        requiresApproval: true,
        deepLink: "/revenue?section=abandoned",
        priority: 1,
      });
    }

    // Only non-MOCK market data may drive recommendations (M7.8 guarantee:
    // MOCK metrics are excluded from opportunity detection and scoring).
    if (
      facts.market.risingTopics.length > 0 &&
      (facts.market.status === "AVAILABLE" || facts.market.status === "STALE")
    ) {
      const top = facts.market.risingTopics[0];
      actions.push({
        id: "create-market-content",
        title: `Create content about "${top.topic}"`,
        why: `Top scored market opportunity (score ${top.score.toFixed(0)}/100) from live market intelligence`,
        category: "MARKET",
        evidenceSource: "market_intelligence",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: Math.min(0.9, top.score / 100),
        requiredAction: "PROPOSE",
        requiresApproval: false,
        deepLink: "/market",
        priority: 2,
      });
    }

    if ((facts.content.awaitingReview ?? 0) > 0) {
      actions.push({
        id: "review-drafts",
        title: `Review ${facts.content.awaitingReview} draft${facts.content.awaitingReview === 1 ? "" : "s"} awaiting approval`,
        why: "Drafts in PENDING_REVIEW block the publishing pipeline until approved or rejected",
        category: "CONTENT",
        evidenceSource: "content_drafts",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: 0.9,
        requiredAction: "MUTATE",
        requiresApproval: true,
        deepLink: "/content?view=review",
        priority: 3,
      });
    }

    if ((facts.content.approvedUnpublished ?? 0) > 0) {
      actions.push({
        id: "publish-approved",
        title: `Schedule or publish ${facts.content.approvedUnpublished} approved draft${facts.content.approvedUnpublished === 1 ? "" : "s"}`,
        why: "Approved content with no publish request generates no value while it sits",
        category: "PUBLISHING",
        evidenceSource: "content_drafts",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: 0.85,
        requiredAction: "MUTATE",
        requiresApproval: true,
        deepLink: "/content?view=approved",
        priority: 4,
      });
    }

    if ((facts.content.failedPublications ?? 0) > 0) {
      actions.push({
        id: "investigate-failed-publications",
        title: `Investigate ${facts.content.failedPublications} failed publication${facts.content.failedPublications === 1 ? "" : "s"}`,
        why: "Failed publish requests need a decision: retry, reconcile, or cancel",
        category: "PUBLISHING",
        evidenceSource: "publishing",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: 0.9,
        requiredAction: "READ",
        requiresApproval: false,
        deepLink: "/calendar?status=FAILED",
        priority: 5,
      });
    }

    if ((facts.customers.winBack ?? 0) > 0) {
      actions.push({
        id: "review-winback",
        title: `Review ${facts.customers.winBack} win-back candidate${facts.customers.winBack === 1 ? "" : "s"}`,
        why: "Lapsed customers with purchase history are cheaper to reactivate than new acquisition",
        category: "CUSTOMERS",
        evidenceSource: "customer_segments",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: 0.6,
        requiredAction: "READ",
        requiresApproval: false,
        deepLink: "/customers?segment=LAPSED_CUSTOMER",
        priority: 6,
      });
    }

    if ((facts.revenue.replenishmentOpportunities ?? 0) > 0) {
      actions.push({
        id: "review-replenishment",
        title: `Review ${facts.revenue.replenishmentOpportunities} replenishment opportunit${facts.revenue.replenishmentOpportunities === 1 ? "y" : "ies"}`,
        why: "Customers inside their product replenishment window are the highest-intent audience available",
        category: "CUSTOMERS",
        evidenceSource: "replenishment",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: 0.65,
        requiredAction: "READ",
        requiresApproval: false,
        deepLink: "/customers?segment=REPLENISHMENT_DUE",
        priority: 7,
      });
    }

    if (
      facts.sales.status === "NOT_CONFIGURED" ||
      facts.sales.status === "UNAVAILABLE"
    ) {
      actions.push({
        id: "fix-shopify-connection",
        title: "Fix Shopify connection",
        why:
          facts.sales.status === "NOT_CONFIGURED"
            ? "Shopify credentials are not configured — commerce data is unavailable"
            : `Commerce data unavailable${facts.sales.failureReason ? `: ${facts.sales.failureReason}` : ""}`,
        category: "CONNECTIONS",
        evidenceSource: "connections",
        expectedImpact: null,
        impactValue: null,
        currencyCode: null,
        confidence: 1,
        requiredAction: "MUTATE",
        requiresApproval: false,
        deepLink: "/connections",
        priority: 0,
      });
    }

    return actions.sort((a, b) => a.priority - b.priority).slice(0, 8);
  }

  private buildFactLines(facts: OperatorToday["facts"]): string[] {
    const lines: string[] = [];
    const s = facts.sales;
    if (s.revenue != null) {
      lines.push(
        `Sales last ${s.periodDays ?? "?"} days: ${s.revenue.toFixed(0)} ${s.currencyCode ?? ""}, ${s.orderCount} orders, AOV ${s.aov?.toFixed(0) ?? "?"}${s.revenueDeltaPct != null ? ` (${s.revenueDeltaPct > 0 ? "+" : ""}${s.revenueDeltaPct}% vs previous period)` : ""} [data: ${s.status}]`,
      );
    } else {
      lines.push(`Sales data: ${s.status}`);
    }
    const r = facts.revenue;
    lines.push(
      `Revenue recovery: ${r.abandonedValue?.toFixed(0) ?? 0} ${r.currencyCode ?? ""} abandoned value, ${r.eligibleRecoveries ?? 0} eligible recoveries, ${r.activeJourneys ?? 0} active journeys, ${r.recoveredRevenueLast30?.toFixed(0) ?? 0} recovered last 30 days`,
    );
    const m = facts.market;
    lines.push(
      `Market intelligence [${m.status}]: ${m.opportunityCount ?? 0} open opportunities, ${m.contentGapCount ?? 0} content gaps${m.risingTopics.length ? `, top topic "${m.risingTopics[0].topic}"` : ""}`,
    );
    const c = facts.content;
    lines.push(
      `Content: ${c.awaitingReview ?? 0} awaiting review, ${c.approvedUnpublished ?? 0} approved unpublished, ${c.scheduled ?? 0} scheduled, ${c.failedPublications ?? 0} failed publications`,
    );
    const cu = facts.customers;
    lines.push(
      `Customers: ${cu.totalContacts ?? 0} contacts, ${cu.vip ?? 0} VIP, ${cu.winBack ?? 0} win-back candidates, ${cu.replenishmentDue ?? 0} replenishment due`,
    );
    return lines;
  }

  private applyPrioritization(
    actions: SuggestedAction[],
    prioritization: {
      prioritized: { id: string; why: string; confidence: number }[];
    },
  ): SuggestedAction[] {
    const byId = new Map(actions.map((a) => [a.id, a]));
    const ordered: SuggestedAction[] = [];
    let rank = 1;
    for (const p of prioritization.prioritized) {
      const action = byId.get(p.id);
      if (!action) continue;
      byId.delete(p.id);
      ordered.push({
        ...action,
        why: p.why,
        confidence: p.confidence,
        priority: rank++,
      });
    }
    // Any actions the brain did not mention keep deterministic order at the end
    for (const leftover of byId.values()) {
      ordered.push({ ...leftover, priority: rank++ });
    }
    return ordered;
  }

  // -------------------------------------------------------------------------
  // Recent results — only real measured data, never fabricated examples
  // -------------------------------------------------------------------------

  private async buildRecentResults(): Promise<TodayRecentResults> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [measured, summary, evals, snapshot] = await Promise.all([
      this.prisma.recommendation.findMany({
        where: {
          brandId: BRAND_ID,
          status: "MEASURED",
          measuredAt: { gte: since },
        },
        orderBy: { measuredAt: "desc" },
      }),
      settle(this.attribution.getSummary(7)),
      settle(this.experimentMeasurement.evaluateRecent(5)),
      settle(this.shopify.getLatestSnapshot()),
    ]);

    const attributedProfitLast7 = summary.ok
      ? (summary.value.byAttributionType["ATTRIBUTED"]?.profit ?? 0)
      : null;
    const directionalExperiments = (evals.ok ? evals.value : [])
      .filter((e) => e.state === "DIRECTIONAL" || e.state === "WINNER")
      .map((e) => ({
        experimentId: e.experimentId,
        name: e.name,
        state: e.state,
      }));

    const outcomeCount = (o: string) =>
      measured.filter((r) => r.outcome === o).length;

    const available =
      measured.length > 0 ||
      (attributedProfitLast7 ?? 0) > 0 ||
      directionalExperiments.length > 0;

    return {
      status: available ? "AVAILABLE" : "UNAVAILABLE",
      measuredLast7: measured.length,
      outperformed: outcomeCount("OUTPERFORMED"),
      expected: outcomeCount("EXPECTED"),
      underperformed: outcomeCount("UNDERPERFORMED"),
      inconclusive: outcomeCount("INCONCLUSIVE"),
      currencyCode:
        snapshot.ok && snapshot.value
          ? (snapshot.value.metrics?.currencyCode ?? null)
          : null,
      attributedProfitLast7,
      highlights: measured.slice(0, 3).map((r) => ({
        recommendationId: r.id,
        title: r.title,
        type: r.type,
        outcome: (r.outcome as any) ?? null,
        attributionStrength: (r.attributionStrength as any) ?? null,
        dataQuality: (r.dataQuality as any) ?? null,
        summary: r.outcomeSummary,
      })),
      directionalExperiments,
    };
  }

  // Important suggestions become durable Recommendations so their outcomes can
  // be measured. READ-only pointers are not persisted.
  private async persistRecommendations(
    actions: SuggestedAction[],
  ): Promise<void> {
    const typeByActionId: Record<string, string> = {
      "recover-abandoned": "RECOVER_ABANDONED",
      "create-market-content": "CREATE_CONTENT",
      "review-drafts": "REVIEW_CONTENT",
      "publish-approved": "PUBLISH_CONTENT",
      "fix-shopify-connection": "FIX_CONNECTION",
    };
    for (const action of actions) {
      const type = typeByActionId[action.id];
      if (!type || action.requiredAction === "READ") continue;
      await this.recommendations.propose({
        type,
        title: action.title,
        rationale: action.why,
        evidenceRefs: [
          {
            source: action.evidenceSource,
            refType: "today_action",
            refId: action.id,
            note: null,
          },
        ],
        confidence: action.confidence,
        expectedImpact: action.expectedImpact,
        expectedImpactValue: action.impactValue,
        expectedImpactUnit: action.impactValue != null ? "CURRENCY" : null,
        targetType: "TODAY_ACTION",
        targetId: action.id,
        actionClass: action.requiredAction,
      });
    }
  }

  private unavailableRecentResults(): TodayRecentResults {
    return {
      status: "UNAVAILABLE",
      measuredLast7: 0,
      outperformed: 0,
      expected: 0,
      underperformed: 0,
      inconclusive: 0,
      currencyCode: null,
      attributedProfitLast7: null,
      highlights: [],
      directionalExperiments: [],
    };
  }

  // -------------------------------------------------------------------------
  // Unavailable fallbacks — sections fail independently, Today always renders
  // -------------------------------------------------------------------------

  private unavailableSales(failureReason: string | null): TodaySales {
    return {
      status: "UNAVAILABLE",
      currencyCode: null,
      periodDays: null,
      revenue: null,
      orderCount: null,
      aov: null,
      unitsSold: null,
      previousRevenue: null,
      revenueDeltaPct: null,
      topProducts: [],
      failureReason,
    };
  }

  private unavailableRevenue(_error: string): TodayRevenue {
    return {
      status: "UNAVAILABLE",
      currencyCode: null,
      abandonedValue: null,
      openOpportunities: null,
      eligibleRecoveries: null,
      activeJourneys: null,
      replenishmentOpportunities: null,
      recoveredRevenueLast30: null,
      contributionProfitLast30: null,
    };
  }

  private unavailableMarket(): TodayMarket {
    return {
      status: "UNAVAILABLE",
      dataFreshness: null,
      risingTopics: [],
      opportunityCount: null,
      searchOpportunityCount: null,
      contentGapCount: null,
    };
  }

  private unavailableContent(): TodayContent {
    return {
      status: "UNAVAILABLE",
      awaitingReview: null,
      generated: null,
      approvedUnpublished: null,
      scheduled: null,
      failedPublications: null,
      unknownPublications: null,
    };
  }

  private unavailableCustomers(): TodayCustomers {
    return {
      status: "UNAVAILABLE",
      totalContacts: null,
      vip: null,
      winBack: null,
      replenishmentDue: null,
      abandoned: null,
    };
  }
}
