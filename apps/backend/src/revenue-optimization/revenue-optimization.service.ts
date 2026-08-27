import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ShopifyGraphqlAdapter } from "../shopify/shopify-graphql.adapter";
import { normalizeOrder } from "../shopify/shopify-normalizer";
import { ProductAffinityService } from "./product-affinity.service";
import { RecoveryJourneyService } from "./recovery-journey.service";
import { RevenueAttributionService } from "./revenue-attribution.service";

const BRAND_ID = "luminesce-brand-001";

@Injectable()
export class RevenueOptimizationService {
  private readonly logger = new Logger(RevenueOptimizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly affinity: ProductAffinityService,
    private readonly recovery: RecoveryJourneyService,
    private readonly attribution: RevenueAttributionService,
    private readonly shopify: ShopifyGraphqlAdapter,
  ) {}

  async syncOpportunitiesFromCheckouts(): Promise<number> {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const abandonedCheckouts = await this.prisma.abandonedCheckout.findMany({
      where: {
        brandId: BRAND_ID,
        recoveredAt: null,
        abandonedAt: { gte: cutoff },
      },
      include: { contact: true },
    });

    let created = 0;
    for (const checkout of abandonedCheckouts) {
      const existing = await this.prisma.revenueOpportunity.findFirst({
        where: {
          brandId: BRAND_ID,
          shopifyCheckoutId: checkout.shopifyCheckoutId,
        },
      });

      if (existing) continue;

      const cartValue = checkout.totalValue ?? 0;

      await this.prisma.revenueOpportunity.create({
        data: {
          brandId: BRAND_ID,
          type: "CART_RECOVERY",
          status: "NEW",
          contactId: checkout.contactId,
          shopifyCustomerId: checkout.contact?.shopifyCustomerId ?? null,
          shopifyCheckoutId: checkout.shopifyCheckoutId,
          abandonedCheckoutId: checkout.id,
          products: (checkout.lineItems as any) ?? [],
          cartValue,
          recoveryUrl: checkout.recoveryUrl,
          abandonedAt: checkout.abandonedAt,
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        },
      });

      created++;
    }

    this.logger.log(`Synced ${created} new recovery opportunities`);
    return created;
  }

  // Affinity must come from completed orders — abandoned checkouts reflect
  // intent, not purchase behavior, and would bias co-purchase signals.
  async computeAffinityFromOrders(periodDays = 180): Promise<number> {
    if (!this.shopify.configured) {
      this.logger.warn(
        "Shopify not configured — cannot compute product affinity from orders",
      );
      return 0;
    }

    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );
    const ordersResult = await this.shopify.fetchOrders(periodStart, periodEnd);

    const normalized = ordersResult.items
      .map(normalizeOrder)
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .map((o) => ({
        products: o.lineItems
          .filter((li) => li.productId)
          .map((li) => ({
            shopifyProductId: li.productId as string,
            title: li.productTitle,
          })),
      }))
      .filter((o) => o.products.length > 0);

    return this.affinity.computeFromOrders(normalized);
  }

  async processRecoverySteps(): Promise<number> {
    return this.recovery.processAllDueSteps();
  }

  async markOpportunityRecovered(
    opportunityId: string,
    shopifyOrderId: string,
    revenue: number,
    incentiveCost = 0,
    estimatedCogs?: number,
  ): Promise<string> {
    await this.recovery.stopJourney(opportunityId, "RECOVERED");
    return this.attribution.record({
      opportunityId,
      shopifyOrderId,
      revenue,
      incentiveCost,
      estimatedCogs,
    });
  }

  async getAbandonmentDashboard() {
    const [openOpps, recoveredLast30, attributionSummary] = await Promise.all([
      this.prisma.revenueOpportunity.findMany({
        where: {
          brandId: BRAND_ID,
          type: { in: ["CART_RECOVERY", "CHECKOUT_RECOVERY"] },
          status: { in: ["NEW", "IN_JOURNEY"] },
        },
        orderBy: { abandonedAt: "asc" },
        select: {
          id: true,
          type: true,
          stage: true,
          status: true,
          cartValue: true,
          abandonedAt: true,
          recoveryUrl: true,
          contact: { select: { email: true, firstName: true } },
        },
      }),
      this.prisma.revenueOpportunity.count({
        where: {
          brandId: BRAND_ID,
          type: { in: ["CART_RECOVERY", "CHECKOUT_RECOVERY"] },
          status: "RECOVERED",
          recoveredAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.attribution.getSummary(30),
    ]);

    const totalAbandonedValue = openOpps.reduce(
      (s, o) => s + (o.cartValue ?? 0),
      0,
    );

    return {
      openOpportunities: openOpps,
      totalOpen: openOpps.length,
      totalAbandonedValue,
      recoveredLast30Days: recoveredLast30,
      // Attributed (last-touch) figures — not incremental unless backed by
      // an experiment; see byAttributionType for the honest split.
      last30DaysRevenue: attributionSummary.totalRevenue,
      last30DaysContributionProfit: attributionSummary.totalContributionProfit,
      last30DaysByAttributionType: attributionSummary.byAttributionType,
    };
  }

  async getAllOpportunities(type?: string, status?: string, limit = 50) {
    return this.prisma.revenueOpportunity.findMany({
      where: {
        brandId: BRAND_ID,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        journey: {
          select: {
            status: true,
            steps: { take: 1, orderBy: { stepNumber: "desc" } },
          },
        },
        _count: { select: { attributions: true } },
      },
    });
  }
}
