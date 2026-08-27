import { Injectable, Logger } from "@nestjs/common";
import {
  ExperimentEvaluation,
  OutcomeClassification,
  WeeklyRecommendationHighlight,
  WeeklyReview,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { ShopifyService } from "../shopify/shopify.service";
import { RevenueAttributionService } from "../revenue-optimization/revenue-attribution.service";
import { ExperimentMeasurementService } from "./experiment-measurement.service";
import { MeasurementBrainClient } from "./measurement-brain.client";

const BRAND_ID = "luminesce-brand-001";
const PERIOD_DAYS = 7;

// Deterministic aggregation first, interpretation after. Every number in the
// review is computed here; Claude only writes the narrative and can never
// change a figure. Interpretation failure never blocks the review.
@Injectable()
export class WeeklyReviewService {
  private readonly logger = new Logger(WeeklyReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly attribution: RevenueAttributionService,
    private readonly experiments: ExperimentMeasurementService,
    private readonly brain: MeasurementBrainClient,
  ) {}

  async generate(now = new Date()): Promise<WeeklyReview> {
    const periodStart = new Date(
      now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );

    const brand = await this.prisma.brand.findUnique({
      where: { id: BRAND_ID },
    });

    const [business, content, market, revenue, experiments, recommendations] =
      await Promise.all([
        this.businessSection(),
        this.contentSection(periodStart),
        this.marketSection(periodStart),
        this.revenueSection(),
        this.experiments.evaluateRecent(5),
        this.recommendationSection(periodStart, now),
      ]);

    const review: WeeklyReview = {
      generatedAt: now,
      brandName: brand?.name ?? null,
      periodStart,
      periodEnd: now,
      business,
      content,
      market,
      revenue,
      experiments,
      recommendations,
      interpretation: {
        status: "UNAVAILABLE",
        headline: null,
        narrative: null,
        failureReason: null,
      },
    };

    try {
      const interpretation = await this.brain.interpretWeekly({
        brandName: review.brandName,
        facts: this.facts(review),
      });
      review.interpretation = {
        status: "AVAILABLE",
        headline: interpretation.headline,
        narrative: interpretation.narrative,
        failureReason: null,
      };
    } catch (err: any) {
      this.logger.warn(`Weekly interpretation unavailable: ${err.message}`);
      review.interpretation.failureReason = err.message;
    }

    return review;
  }

  private async businessSection(): Promise<WeeklyReview["business"]> {
    const ctx = await this.shopify.getCommerceContext();
    const metrics = ctx.metrics;
    const status =
      ctx.evidenceStatus === "UNAVAILABLE" &&
      (ctx.failureReason ?? "").toLowerCase().includes("not configured")
        ? "NOT_CONFIGURED"
        : ctx.evidenceStatus;
    const prevRevenue = metrics?.previousPeriod?.revenue ?? null;
    const revenueDeltaPct =
      metrics && prevRevenue !== null && prevRevenue > 0
        ? Math.round(((metrics.revenue - prevRevenue) / prevRevenue) * 1000) /
          10
        : null;
    return {
      status,
      currencyCode: metrics?.currencyCode ?? null,
      revenue: metrics?.revenue ?? null,
      orderCount: metrics?.orderCount ?? null,
      aov: metrics?.aov ?? null,
      previousRevenue: prevRevenue,
      revenueDeltaPct,
    };
  }

  private async contentSection(
    periodStart: Date,
  ): Promise<WeeklyReview["content"]> {
    const [published, failedPublications, measuredContent] = await Promise.all([
      this.prisma.publishRequest.count({
        where: {
          brandId: BRAND_ID,
          status: "SUCCEEDED",
          executedAt: { gte: periodStart },
        },
      }),
      this.prisma.publishRequest.count({
        where: {
          brandId: BRAND_ID,
          status: "FAILED",
          executedAt: { gte: periodStart },
        },
      }),
      this.prisma.recommendation.findMany({
        where: {
          brandId: BRAND_ID,
          status: "MEASURED",
          measuredAt: { gte: periodStart },
          contentBriefs: { some: {} },
        },
        select: { outcome: true },
      }),
    ]);
    const byOutcome = countOutcomes(measuredContent.map((r) => r.outcome));
    return {
      published,
      failedPublications,
      measured: measuredContent.length,
      ...byOutcome,
    };
  }

  private async marketSection(
    periodStart: Date,
  ): Promise<WeeklyReview["market"]> {
    const [newOpportunities, briefsCreated] = await Promise.all([
      this.prisma.marketOpportunity.count({
        where: { brandId: BRAND_ID, createdAt: { gte: periodStart } },
      }),
      this.prisma.contentBrief.count({
        where: { brandId: BRAND_ID, createdAt: { gte: periodStart } },
      }),
    ]);
    return { newOpportunities, briefsCreated };
  }

  private async revenueSection(): Promise<WeeklyReview["revenue"]> {
    const summary = await this.attribution.getSummary(PERIOD_DAYS);
    const snapshot = await this.shopify.getLatestSnapshot();
    return {
      currencyCode: snapshot?.metrics?.currencyCode ?? null,
      attributedRevenue: summary.byAttributionType["ATTRIBUTED"]?.revenue ?? 0,
      attributedProfit: summary.byAttributionType["ATTRIBUTED"]?.profit ?? 0,
      incentiveCost: summary.totalIncentiveCost,
      incrementalEstimate:
        summary.byAttributionType["INCREMENTAL_ESTIMATE"]?.profit ?? 0,
      recoveredOrders: summary.byType["ABANDONED_CHECKOUT"]?.count ?? 0,
    };
  }

  private async recommendationSection(
    periodStart: Date,
    now: Date,
  ): Promise<WeeklyReview["recommendations"]> {
    const [proposed, decided, executed, measuredRecs, unmeasured, failed] =
      await Promise.all([
        this.prisma.recommendation.count({
          where: { brandId: BRAND_ID, createdAt: { gte: periodStart } },
        }),
        this.prisma.recommendation.findMany({
          where: { brandId: BRAND_ID, decidedAt: { gte: periodStart } },
          select: { status: true },
        }),
        this.prisma.recommendation.count({
          where: { brandId: BRAND_ID, executedAt: { gte: periodStart } },
        }),
        this.prisma.recommendation.findMany({
          where: {
            brandId: BRAND_ID,
            status: "MEASURED",
            measuredAt: { gte: periodStart },
          },
          orderBy: { measuredAt: "desc" },
        }),
        // Past the measurement window but not yet finalized — honest gap.
        this.prisma.recommendation.count({
          where: {
            brandId: BRAND_ID,
            status: { in: ["EXECUTED", "MEASURING"] },
            measurementWindowEndsAt: { lt: now },
          },
        }),
        this.prisma.recommendation.count({
          where: {
            brandId: BRAND_ID,
            status: "FAILED",
            updatedAt: { gte: periodStart },
          },
        }),
      ]);

    const approved = decided.filter((r) => r.status !== "REJECTED").length;
    const rejected = decided.filter((r) => r.status === "REJECTED").length;

    const highlight = (r: (typeof measuredRecs)[number]) =>
      ({
        recommendationId: r.id,
        title: r.title,
        type: r.type,
        outcome: (r.outcome as OutcomeClassification | null) ?? null,
        attributionStrength: (r.attributionStrength as any) ?? null,
        dataQuality: (r.dataQuality as any) ?? null,
        summary: r.outcomeSummary,
      }) satisfies WeeklyRecommendationHighlight;

    return {
      proposed,
      approved,
      rejected,
      executed,
      measured: measuredRecs.length,
      unmeasured,
      failedExecutions: failed,
      wins: measuredRecs
        .filter((r) => r.outcome === "OUTPERFORMED")
        .slice(0, 3)
        .map(highlight),
      losses: measuredRecs
        .filter((r) => r.outcome === "UNDERPERFORMED")
        .slice(0, 3)
        .map(highlight),
      inconclusive: measuredRecs
        .filter((r) => r.outcome === "INCONCLUSIVE")
        .slice(0, 3)
        .map(highlight),
    };
  }

  // Deterministic facts handed to Claude for narrative only.
  private facts(review: WeeklyReview): string[] {
    const facts: string[] = [];
    const b = review.business;
    if (b.status === "AVAILABLE" || b.status === "STALE") {
      facts.push(
        `Business (${b.status.toLowerCase()} data): revenue ${b.revenue} ${b.currencyCode ?? ""}, ${b.orderCount} orders, AOV ${b.aov}` +
          (b.revenueDeltaPct !== null
            ? `, revenue ${b.revenueDeltaPct >= 0 ? "+" : ""}${b.revenueDeltaPct}% vs previous period`
            : ""),
      );
    } else {
      facts.push(`Business data ${b.status} — no commerce numbers this week.`);
    }
    const c = review.content;
    facts.push(
      `Content: ${c.published} published, ${c.failedPublications} failed publications, ${c.measured} measured (${c.outperformed} outperformed, ${c.expected} expected, ${c.underperformed} underperformed, ${c.inconclusive} inconclusive).`,
    );
    facts.push(
      `Market: ${review.market.newOpportunities} new opportunities, ${review.market.briefsCreated} briefs created.`,
    );
    const rev = review.revenue;
    facts.push(
      `Revenue attribution (last-touch, not incremental): ${rev.attributedRevenue} attributed revenue, ${rev.attributedProfit} contribution profit, ${rev.incentiveCost} incentive cost. Experiment-backed incremental estimate: ${rev.incrementalEstimate}. ${rev.recoveredOrders} recovered abandoned checkouts.`,
    );
    for (const e of review.experiments) {
      facts.push(`Experiment "${e.name}": ${e.state}. ${e.note}`);
    }
    const r = review.recommendations;
    facts.push(
      `Recommendations: ${r.proposed} proposed, ${r.approved} approved, ${r.rejected} rejected, ${r.executed} executed, ${r.measured} measured, ${r.unmeasured} past window unmeasured, ${r.failedExecutions} failed executions.`,
    );
    for (const w of r.wins) {
      facts.push(`Win: "${w.title}" — ${w.summary ?? "outperformed"}`);
    }
    for (const l of r.losses) {
      facts.push(`Loss: "${l.title}" — ${l.summary ?? "underperformed"}`);
    }
    return facts;
  }
}

function countOutcomes(outcomes: (string | null)[]): {
  outperformed: number;
  expected: number;
  underperformed: number;
  inconclusive: number;
} {
  return {
    outperformed: outcomes.filter((o) => o === "OUTPERFORMED").length,
    expected: outcomes.filter((o) => o === "EXPECTED").length,
    underperformed: outcomes.filter((o) => o === "UNDERPERFORMED").length,
    inconclusive: outcomes.filter((o) => o === "INCONCLUSIVE").length,
  };
}
