import { Injectable, Logger } from "@nestjs/common";
import { OperatorAnalytics } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ShopifyGraphqlAdapter } from "../shopify/shopify-graphql.adapter";
import { RevenueAttributionService } from "../revenue-optimization/revenue-attribution.service";

const BRAND_ID = "luminesce-brand-001";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class OperatorAnalyticsService {
  private readonly logger = new Logger(OperatorAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly shopifyAdapter: ShopifyGraphqlAdapter,
    private readonly attribution: RevenueAttributionService,
  ) {}

  async getAnalytics(): Promise<OperatorAnalytics> {
    const unavailable: string[] = [];

    const [commerce, content, market, revenueOptimization, publishing] =
      await Promise.all([
        this.buildCommerce().catch((e) => {
          this.logger.warn(`Commerce analytics failed: ${e.message}`);
          unavailable.push("commerce");
          return null;
        }),
        this.buildContent(),
        this.buildMarket(),
        this.buildRevenueOptimization(),
        this.buildPublishing(),
      ]);

    return {
      generatedAt: new Date(),
      commerce,
      content,
      market,
      revenueOptimization,
      publishing,
      unavailable,
    };
  }

  private async buildCommerce(): Promise<OperatorAnalytics["commerce"]> {
    if (!this.shopifyAdapter.configured) {
      return {
        status: "NOT_CONFIGURED",
        currencyCode: null,
        periodDays: null,
        revenue: null,
        orderCount: null,
        aov: null,
        repeatRate: null,
        topProducts: [],
      };
    }
    const ctx = await this.shopify.getCommerceContext();
    const m = ctx.metrics;
    return {
      status: ctx.evidenceStatus,
      currencyCode: m?.currencyCode ?? null,
      periodDays:
        m != null
          ? Math.round(
              (m.periodEnd.getTime() - m.periodStart.getTime()) / 86400000,
            )
          : null,
      revenue: m?.revenue ?? null,
      orderCount: m?.orderCount ?? null,
      aov: m?.aov ?? null,
      repeatRate: m?.customerSummary?.repeatRate ?? null,
      topProducts: (m?.revenueByProduct ?? []).slice(0, 5).map((p) => ({
        productTitle: p.productTitle,
        revenue: p.revenue,
        units: p.units,
      })),
    };
  }

  private async buildContent(): Promise<OperatorAnalytics["content"]> {
    const where = { brandId: BRAND_ID };
    const [generated, approved, rejected, awaitingReview, scheduled, failed] =
      await Promise.all([
        this.prisma.contentDraft.count({ where }),
        this.prisma.contentDraft.count({
          where: { ...where, status: "APPROVED" },
        }),
        this.prisma.contentDraft.count({
          where: { ...where, status: "REJECTED" },
        }),
        this.prisma.contentDraft.count({
          where: { ...where, status: "PENDING_REVIEW" },
        }),
        this.prisma.publishRequest.count({
          where: {
            ...where,
            status: { in: ["PENDING", "APPROVED"] },
            scheduledAt: { not: null },
          },
        }),
        this.prisma.publishRequest.count({
          where: { ...where, status: "FAILED" },
        }),
      ]);
    const published = await this.prisma.publication.count({
      where: { publishRequest: { brandId: BRAND_ID }, status: "LIVE" },
    });
    return {
      generated,
      approved,
      rejected,
      awaitingReview,
      scheduled,
      published,
      failed,
    };
  }

  private async buildMarket(): Promise<OperatorAnalytics["market"]> {
    const [opportunitiesDetected, searchOpportunitiesDetected, briefs] =
      await Promise.all([
        this.prisma.marketOpportunity.count({ where: { brandId: BRAND_ID } }),
        this.prisma.searchOpportunity.count({ where: { brandId: BRAND_ID } }),
        this.prisma.contentBrief.count({
          where: {
            brandId: BRAND_ID,
            OR: [
              { opportunityId: { not: null } },
              { searchOpportunityId: { not: null } },
              { marketOpportunityId: { not: null } },
            ],
          },
        }),
      ]);
    return {
      opportunitiesDetected,
      searchOpportunitiesDetected,
      briefsCreatedFromOpportunities: briefs,
    };
  }

  private async buildRevenueOptimization(): Promise<
    OperatorAnalytics["revenueOptimization"]
  > {
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const [openAgg, recoveredAgg, recoveredCount, expiredCount, summary, ck] =
      await Promise.all([
        this.prisma.revenueOpportunity.aggregate({
          where: {
            brandId: BRAND_ID,
            type: { in: ["CART_RECOVERY", "CHECKOUT_RECOVERY"] },
            status: { in: ["NEW", "IN_JOURNEY"] },
          },
          _sum: { cartValue: true },
        }),
        this.prisma.revenueOpportunity.aggregate({
          where: {
            brandId: BRAND_ID,
            status: "RECOVERED",
            recoveredAt: { gte: since },
          },
          _sum: { recoveryValue: true },
        }),
        this.prisma.revenueOpportunity.count({
          where: {
            brandId: BRAND_ID,
            status: "RECOVERED",
            recoveredAt: { gte: since },
          },
        }),
        this.prisma.revenueOpportunity.count({
          where: {
            brandId: BRAND_ID,
            status: "EXPIRED",
            updatedAt: { gte: since },
          },
        }),
        this.attribution.getSummary(30),
        this.prisma.abandonedCheckout.findFirst({
          where: { brandId: BRAND_ID },
          select: { currencyCode: true },
        }),
      ]);

    const resolved = recoveredCount + expiredCount;
    return {
      currencyCode: ck?.currencyCode ?? null,
      abandonedValueOpen: openAgg._sum.cartValue ?? 0,
      recoveredLast30: recoveredAgg._sum.recoveryValue ?? 0,
      attributedRevenueLast30: summary.totalRevenue,
      attributedProfitLast30: summary.totalContributionProfit,
      // Only experiment-backed attributions count as incremental —
      // ATTRIBUTED (last-touch) revenue must never be presented as such.
      incrementalEstimateLast30:
        summary.byAttributionType["INCREMENTAL_ESTIMATE"]?.revenue ?? 0,
      incentiveCostLast30: summary.totalIncentiveCost,
      recoveryRate:
        resolved > 0
          ? Math.round((recoveredCount / resolved) * 1000) / 1000
          : null,
    };
  }

  private async buildPublishing(): Promise<OperatorAnalytics["publishing"]> {
    const [succeeded, unknown, failedPubs, failedRequests] = await Promise.all([
      this.prisma.publication.count({
        where: { publishRequest: { brandId: BRAND_ID }, status: "LIVE" },
      }),
      this.prisma.publication.count({
        where: { publishRequest: { brandId: BRAND_ID }, status: "UNKNOWN" },
      }),
      this.prisma.publication.count({
        where: { publishRequest: { brandId: BRAND_ID }, status: "FAILED" },
      }),
      this.prisma.publishRequest.count({
        where: { brandId: BRAND_ID, status: "FAILED" },
      }),
    ]);
    return {
      succeeded,
      failed: Math.max(failedPubs, failedRequests),
      unknown,
    };
  }
}
