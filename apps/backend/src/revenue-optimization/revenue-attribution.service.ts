import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface AttributionInput {
  opportunityId: string;
  shopifyOrderId?: string;
  revenue: number;
  incentiveCost?: number;
  shippingSubsidy?: number;
  estimatedCogs?: number;
  experimentId?: string;
  variantId?: string;
}

@Injectable()
export class RevenueAttributionService {
  private readonly logger = new Logger(RevenueAttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AttributionInput): Promise<string> {
    const incentiveCost = input.incentiveCost ?? 0;
    const shippingSubsidy = input.shippingSubsidy ?? 0;
    const estimatedCogs = input.estimatedCogs ?? 0;

    const grossMargin =
      estimatedCogs > 0
        ? (input.revenue - estimatedCogs) / input.revenue
        : undefined;

    const contributionProfit =
      input.revenue - incentiveCost - shippingSubsidy - estimatedCogs;

    // ATTRIBUTED = last-touch correlation (order followed our touch);
    // INCREMENTAL_ESTIMATE requires an experiment/control comparison. Only
    // the latter supports an incrementality claim.
    const attributionType =
      input.experimentId && input.variantId
        ? "INCREMENTAL_ESTIMATE"
        : "ATTRIBUTED";

    const attribution = await this.prisma.revenueAttribution.create({
      data: {
        brandId: BRAND_ID,
        opportunityId: input.opportunityId,
        shopifyOrderId: input.shopifyOrderId,
        revenue: input.revenue,
        incentiveCost,
        shippingSubsidy,
        estimatedCogs: estimatedCogs || null,
        grossMargin: grossMargin ?? null,
        contributionProfit,
        attributionType,
        experimentId: input.experimentId,
        variantId: input.variantId,
      },
    });

    await this.prisma.revenueOpportunity.update({
      where: { id: input.opportunityId },
      data: {
        status: "RECOVERED",
        recoveredAt: new Date(),
        resultingOrderId: input.shopifyOrderId,
        recoveryValue: input.revenue,
      },
    });

    this.logger.log(
      `Attribution ${attribution.id}: $${input.revenue} revenue, $${contributionProfit.toFixed(2)} contribution profit`,
    );
    return attribution.id;
  }

  async getSummary(days = 30): Promise<{
    totalRevenue: number;
    totalContributionProfit: number;
    totalIncentiveCost: number;
    totalAttributions: number;
    byType: Record<string, { count: number; revenue: number; profit: number }>;
    // Split by attribution honesty: ATTRIBUTED (last-touch, correlational)
    // vs INCREMENTAL_ESTIMATE (experiment-backed). Do not present
    // ATTRIBUTED revenue as incremental.
    byAttributionType: Record<
      string,
      { count: number; revenue: number; profit: number }
    >;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const attributions = await this.prisma.revenueAttribution.findMany({
      where: { brandId: BRAND_ID, attributedAt: { gte: since } },
      include: { opportunity: { select: { type: true } } },
    });

    const byType: Record<
      string,
      { count: number; revenue: number; profit: number }
    > = {};
    const byAttributionType: Record<
      string,
      { count: number; revenue: number; profit: number }
    > = {};

    let totalRevenue = 0;
    let totalProfit = 0;
    let totalIncentiveCost = 0;

    for (const a of attributions) {
      const type = a.opportunity.type;
      if (!byType[type]) byType[type] = { count: 0, revenue: 0, profit: 0 };
      byType[type].count++;
      byType[type].revenue += a.revenue ?? 0;
      byType[type].profit += a.contributionProfit ?? 0;

      const attrType = a.attributionType ?? "ATTRIBUTED";
      if (!byAttributionType[attrType]) {
        byAttributionType[attrType] = { count: 0, revenue: 0, profit: 0 };
      }
      byAttributionType[attrType].count++;
      byAttributionType[attrType].revenue += a.revenue ?? 0;
      byAttributionType[attrType].profit += a.contributionProfit ?? 0;

      totalRevenue += a.revenue ?? 0;
      totalProfit += a.contributionProfit ?? 0;
      totalIncentiveCost += a.incentiveCost ?? 0;
    }

    return {
      totalRevenue,
      totalContributionProfit: totalProfit,
      totalIncentiveCost,
      totalAttributions: attributions.length,
      byType,
      byAttributionType,
    };
  }
}
