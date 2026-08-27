import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface FunnelIssue {
  productName: string;
  shopifyProductId?: string;
  issue:
    | "HIGH_TRAFFIC_LOW_ATC"
    | "HIGH_ATC_LOW_CHECKOUT"
    | "HIGH_CHECKOUT_ABANDONMENT"
    | "LOW_TRAFFIC_HIGH_CONVERSION";
  description: string;
  views: number;
  atcRate?: number;
  checkoutRate?: number;
  purchaseRate?: number;
  conversionRate?: number;
}

function currentMonthPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

@Injectable()
export class FunnelAnalyticsService {
  private readonly logger = new Logger(FunnelAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Ingest from CommerceContext (what Shopify already provides via existing adapter).
  // Maps available revenue/unit data into ProductFunnelMetric records.
  // Full funnel events (views, ATC, checkout) require Shopify Web Pixel — documented below.
  async ingestFromCommerceContext(commerceContext: {
    metrics?: {
      revenueByProduct?: Array<{
        shopifyProductId?: string;
        title: string;
        revenue: number;
        unitsSold: number;
      }>;
    };
  }): Promise<number> {
    const products = commerceContext?.metrics?.revenueByProduct ?? [];
    const period = currentMonthPeriod();
    let count = 0;

    for (const p of products) {
      if (!p.title) continue;

      // Purchases approximate from unitsSold; revenue known
      // Views/ATC/checkout unavailable from current Shopify data — set to 0 with null rates
      // Full funnel requires Shopify Web Pixel (see setup docs in market-intelligence.module.ts)
      await this.prisma.productFunnelMetric.upsert({
        where: {
          brandId_shopifyProductId_period: {
            brandId: BRAND_ID,
            shopifyProductId: p.shopifyProductId ?? p.title,
            period,
          },
        },
        create: {
          brandId: BRAND_ID,
          shopifyProductId: p.shopifyProductId ?? p.title,
          productName: p.title,
          period,
          purchases: p.unitsSold,
          revenue: p.revenue,
          // views/atc/checkout not available from this source
          views: 0,
          addToCart: 0,
          checkoutStarts: 0,
          atcRate: null,
          checkoutRate: null,
          purchaseRate: null,
          conversionRate: null,
        },
        update: {
          purchases: p.unitsSold,
          revenue: p.revenue,
          productName: p.title,
          fetchedAt: new Date(),
        },
      });
      count++;
    }

    this.logger.log(
      `Ingested ${count} product funnel metrics from commerce context`,
    );
    return count;
  }

  // Update a metric with full funnel data (from Web Pixel or manual import)
  async updateFunnelData(
    shopifyProductId: string,
    period: string,
    data: {
      views?: number;
      addToCart?: number;
      checkoutStarts?: number;
      purchases?: number;
      revenue?: number;
    },
  ): Promise<void> {
    const existing = await this.prisma.productFunnelMetric.findFirst({
      where: { brandId: BRAND_ID, shopifyProductId, period },
    });
    if (!existing) return;

    const views = data.views ?? existing.views;
    const addToCart = data.addToCart ?? existing.addToCart;
    const checkoutStarts = data.checkoutStarts ?? existing.checkoutStarts;
    const purchases = data.purchases ?? existing.purchases;

    await this.prisma.productFunnelMetric.update({
      where: { id: existing.id },
      data: {
        views,
        addToCart,
        checkoutStarts,
        purchases: purchases,
        revenue: data.revenue ?? existing.revenue,
        atcRate: safeRate(addToCart, views),
        checkoutRate: safeRate(checkoutStarts, addToCart),
        purchaseRate: safeRate(purchases, checkoutStarts),
        conversionRate: safeRate(purchases, views),
        fetchedAt: new Date(),
      },
    });
  }

  detectFunnelIssues(
    metrics: {
      productName: string;
      shopifyProductId?: string | null;
      views: number;
      addToCart: number;
      checkoutStarts: number;
      purchases: number;
      atcRate?: number | null;
      checkoutRate?: number | null;
      purchaseRate?: number | null;
      conversionRate?: number | null;
    }[],
  ): FunnelIssue[] {
    const issues: FunnelIssue[] = [];

    for (const m of metrics) {
      const atcRate = m.atcRate ?? safeRate(m.addToCart, m.views);
      const checkoutRate =
        m.checkoutRate ?? safeRate(m.checkoutStarts, m.addToCart);
      const purchaseRate =
        m.purchaseRate ?? safeRate(m.purchases, m.checkoutStarts);
      const conversionRate = m.conversionRate ?? safeRate(m.purchases, m.views);

      if (m.views >= 100 && atcRate !== null && atcRate < 0.05) {
        issues.push({
          productName: m.productName,
          shopifyProductId: m.shopifyProductId ?? undefined,
          issue: "HIGH_TRAFFIC_LOW_ATC",
          description: `${m.views} views but only ${(atcRate * 100).toFixed(1)}% add-to-cart rate — product page or positioning may need improvement`,
          views: m.views,
          atcRate,
          conversionRate: conversionRate ?? undefined,
        });
      }

      if (
        atcRate !== null &&
        atcRate >= 0.1 &&
        checkoutRate !== null &&
        checkoutRate < 0.3
      ) {
        issues.push({
          productName: m.productName,
          shopifyProductId: m.shopifyProductId ?? undefined,
          issue: "HIGH_ATC_LOW_CHECKOUT",
          description: `Strong add-to-cart (${(atcRate * 100).toFixed(1)}%) but checkout start rate is ${(checkoutRate * 100).toFixed(1)}% — cart abandonment or price concern`,
          views: m.views,
          atcRate,
          checkoutRate,
        });
      }

      if (
        checkoutRate !== null &&
        checkoutRate >= 0.3 &&
        purchaseRate !== null &&
        purchaseRate < 0.5
      ) {
        issues.push({
          productName: m.productName,
          shopifyProductId: m.shopifyProductId ?? undefined,
          issue: "HIGH_CHECKOUT_ABANDONMENT",
          description: `${(purchaseRate * 100).toFixed(1)}% checkout completion — checkout friction or shipping costs may be blocking purchase`,
          views: m.views,
          checkoutRate,
          purchaseRate,
        });
      }

      if (m.views < 50 && conversionRate !== null && conversionRate > 0.1) {
        issues.push({
          productName: m.productName,
          shopifyProductId: m.shopifyProductId ?? undefined,
          issue: "LOW_TRAFFIC_HIGH_CONVERSION",
          description: `Excellent ${(conversionRate * 100).toFixed(1)}% conversion but only ${m.views} views — acquisition or content opportunity`,
          views: m.views,
          conversionRate,
        });
      }
    }

    return issues;
  }

  async getProductFunnelSummary() {
    return this.prisma.productFunnelMetric.findMany({
      where: { brandId: BRAND_ID },
      orderBy: [{ period: "desc" }, { revenue: "desc" }],
      take: 30,
    });
  }
}
