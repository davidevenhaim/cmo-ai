import { Controller, Get, Post } from "@nestjs/common";
import { ShopifyService } from "./shopify.service";

@Controller("shopify")
export class ShopifyController {
  constructor(private readonly shopifyService: ShopifyService) {}

  @Get("status")
  async status() {
    const ctx = await this.shopifyService.getLatestSnapshot();
    const evidenceStatus = ctx?.evidenceStatus ?? "UNAVAILABLE";
    return {
      configured: this.shopifyService["adapter"]?.configured ?? false,
      evidenceStatus,
      available: evidenceStatus === "AVAILABLE",
      stale: evidenceStatus === "STALE",
      shopName: ctx?.shopName ?? null,
      lastFetchedAt: ctx?.fetchedAt ?? null,
      revenue: ctx?.metrics?.revenue ?? null,
      orderCount: ctx?.metrics?.orderCount ?? null,
      failureReason: ctx?.failureReason ?? null,
    };
  }

  @Get("snapshot")
  async snapshot() {
    return this.shopifyService.getLatestSnapshot();
  }

  @Post("refresh")
  async refresh() {
    return this.shopifyService.refresh();
  }
}
