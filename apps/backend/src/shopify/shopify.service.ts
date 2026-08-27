import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { ShopifyGraphqlAdapter } from "./shopify-graphql.adapter";
import {
  normalizeProduct,
  normalizeOrder,
  computeMetrics,
} from "./shopify-normalizer";
import { CommerceContextSchema } from "@ai-cmo/contracts";
import type { CommerceContext } from "@ai-cmo/contracts";

const BRAND_ID = "luminesce-brand-001";

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    private readonly adapter: ShopifyGraphqlAdapter,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCommerceContext(): Promise<CommerceContext> {
    if (!this.adapter.configured) {
      return this.unavailableContext("Shopify not configured");
    }

    try {
      return await this.fetchAndPersist();
    } catch (err: any) {
      this.logger.warn(`Shopify fetch failed: ${err.message}`);
      const stale = await this.loadLatestSnapshot();
      if (stale) {
        return {
          ...stale,
          evidenceStatus: "STALE",
          failureReason: err.message,
        };
      }
      return this.unavailableContext(err.message);
    }
  }

  async getLatestSnapshot(): Promise<CommerceContext | null> {
    return this.loadLatestSnapshot();
  }

  async refresh(): Promise<CommerceContext> {
    if (!this.adapter.configured) {
      throw new Error("Shopify not configured");
    }
    return this.fetchAndPersist();
  }

  private async fetchAndPersist(): Promise<CommerceContext> {
    const periodDays = parseInt(
      this.config.get<string>("SHOPIFY_DEFAULT_PERIOD_DAYS") ?? "30",
    );
    const lowStockThreshold = parseInt(
      this.config.get<string>("SHOPIFY_LOW_STOCK_THRESHOLD") ?? "5",
    );

    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );
    const previousStart = new Date(
      periodStart.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );

    const [
      productsResult,
      ordersResult,
      previousOrdersResult,
      shopName,
      currencyCode,
    ] = await Promise.all([
      this.adapter.fetchProducts(),
      this.adapter.fetchOrders(periodStart, periodEnd),
      this.adapter.fetchOrders(previousStart, periodStart),
      this.adapter.fetchShopName(),
      this.adapter.fetchCurrencyCode(),
    ]);

    const products = productsResult.items.map(normalizeProduct);
    const orders = ordersResult.items
      .map(normalizeOrder)
      .filter((o): o is NonNullable<typeof o> => o !== null);
    const previousOrders = previousOrdersResult.items
      .map(normalizeOrder)
      .filter((o): o is NonNullable<typeof o> => o !== null);

    const metricsIncomplete =
      ordersResult.truncated ||
      productsResult.truncated ||
      previousOrdersResult.truncated;

    const metrics = computeMetrics(
      orders,
      products,
      periodStart,
      periodEnd,
      lowStockThreshold,
      previousOrders,
      currencyCode,
      metricsIncomplete,
    );

    const topProducts = products
      .filter((p) => p.status === "ACTIVE")
      .sort((a, b) => b.totalInventory - a.totalInventory)
      .slice(0, 10);

    const snapshot = await this.prisma.commerceSnapshot.create({
      data: {
        brandId: BRAND_ID,
        available: true,
        shopName,
        metricsJson: metrics as any,
        topProductsJson: topProducts as any,
      },
    });

    const ctx: CommerceContext = {
      fetchedAt: snapshot.snapshotAt,
      shopName,
      evidenceStatus: "AVAILABLE",
      metrics,
      topProducts,
      failureReason: null,
      snapshotId: snapshot.id,
    };

    return CommerceContextSchema.parse(ctx);
  }

  private async loadLatestSnapshot(): Promise<CommerceContext | null> {
    const snapshot = await this.prisma.commerceSnapshot.findFirst({
      where: { brandId: BRAND_ID },
      orderBy: { snapshotAt: "desc" },
    });

    if (!snapshot) return null;

    return CommerceContextSchema.parse({
      fetchedAt: snapshot.snapshotAt,
      shopName: snapshot.shopName ?? null,
      evidenceStatus: snapshot.available ? "STALE" : "UNAVAILABLE",
      metrics: snapshot.metricsJson ?? null,
      topProducts: (snapshot.topProductsJson as any[]) ?? [],
      failureReason: snapshot.failureReason ?? null,
      snapshotId: snapshot.id,
    });
  }

  private unavailableContext(reason: string): CommerceContext {
    return {
      fetchedAt: new Date(),
      shopName: null,
      evidenceStatus: "UNAVAILABLE",
      metrics: null,
      topProducts: [],
      failureReason: reason,
    };
  }
}
