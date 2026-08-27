import { Injectable } from "@nestjs/common";
import { ShopifyService } from "../../shopify/shopify.service";
import {
  ObservationInput,
  PerformanceProvider,
  ProviderCollectResult,
} from "../performance-provider.interface";

const BRAND_ID = "luminesce-brand-001";

// Brand-level commerce observations from the existing Shopify integration.
// Only reports what Shopify genuinely provides: revenue, orders, AOV, units.
@Injectable()
export class ShopifyPerformanceProvider implements PerformanceProvider {
  readonly key = "shopify";

  constructor(private readonly shopify: ShopifyService) {}

  async collect(window: {
    since: Date;
    until: Date;
  }): Promise<ProviderCollectResult> {
    const context = await this.shopify.getCommerceContext();

    if (context.evidenceStatus === "UNAVAILABLE" || !context.metrics) {
      return {
        provider: this.key,
        status: "NOT_CONFIGURED",
        observations: [],
        detail: context.failureReason ?? "Shopify not configured",
      };
    }

    const m = context.metrics;
    const bucketStart = startOfDay(window.until);
    const bucketEnd = window.until;
    const stale = context.evidenceStatus === "STALE";
    const base: Pick<
      ObservationInput,
      "provider" | "subjectType" | "subjectId" | "bucketStart" | "bucketEnd"
    > = {
      provider: this.key,
      subjectType: "BRAND",
      subjectId: BRAND_ID,
      bucketStart,
      bucketEnd,
    };
    const dataQuality = stale ? "STALE" : "COMPLETE";

    const observations: ObservationInput[] = [
      {
        ...base,
        metric: "revenue",
        dimension: "REVENUE",
        value: m.revenue,
        unit: "CURRENCY",
        currencyCode: m.currencyCode,
        dataQuality,
        attributionStrength: "DIRECT",
      },
      {
        ...base,
        metric: "orders",
        dimension: "CONVERSIONS",
        value: m.orderCount,
        unit: "COUNT",
        dataQuality,
        attributionStrength: "DIRECT",
      },
      {
        ...base,
        metric: "aov",
        dimension: "AOV",
        value: m.aov,
        unit: "CURRENCY",
        currencyCode: m.currencyCode,
        dataQuality,
        attributionStrength: "DIRECT",
      },
      {
        ...base,
        metric: "units_sold",
        dimension: "CONVERSIONS",
        value: m.unitsSold,
        unit: "COUNT",
        dataQuality,
        attributionStrength: "DIRECT",
      },
    ];

    return {
      provider: this.key,
      status: stale ? "STALE" : "AVAILABLE",
      observations,
      detail: stale ? (context.failureReason ?? "stale snapshot") : null,
    };
  }
}

function startOfDay(d: Date): Date {
  const day = new Date(d);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}
