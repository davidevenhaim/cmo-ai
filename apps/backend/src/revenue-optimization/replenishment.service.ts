import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

interface ReplenishmentCandidate {
  contactId: string;
  shopifyCustomerId?: string;
  productId: string;
  productTitle: string;
  lastPurchasedAt: Date;
  cycledays: number;
}

@Injectable()
export class ReplenishmentService {
  private readonly logger = new Logger(ReplenishmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scanForReplenishment(
    candidates: ReplenishmentCandidate[],
  ): Promise<number> {
    let created = 0;

    for (const c of candidates) {
      const daysSincePurchase = Math.floor(
        (Date.now() - c.lastPurchasedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysSincePurchase < c.cycledays) continue;

      const existing = await this.prisma.revenueOpportunity.findFirst({
        where: {
          brandId: BRAND_ID,
          type: "REPLENISHMENT",
          contactId: c.contactId,
          status: { in: ["NEW", "IN_JOURNEY"] },
          products: { path: ["$[0].shopifyProductId"], equals: c.productId },
        },
      });

      if (existing) continue;

      await this.prisma.revenueOpportunity.create({
        data: {
          brandId: BRAND_ID,
          type: "REPLENISHMENT",
          status: "NEW",
          contactId: c.contactId,
          shopifyCustomerId: c.shopifyCustomerId,
          products: [{ shopifyProductId: c.productId, title: c.productTitle }],
          abandonedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      created++;
    }

    this.logger.log(`Created ${created} replenishment opportunities`);
    return created;
  }

  async computeCandidatesFromOrders(
    orders: Array<{
      contactId?: string;
      shopifyCustomerId?: string;
      products: Array<{ shopifyProductId: string; title: string }>;
      createdAt: Date;
    }>,
    productCycleDays: Record<string, number>,
    defaultCycleDays = 60,
  ): Promise<ReplenishmentCandidate[]> {
    const lastPurchaseMap = new Map<
      string,
      {
        contactId?: string;
        shopifyCustomerId?: string;
        lastPurchasedAt: Date;
        productTitle: string;
      }
    >();

    for (const order of orders) {
      for (const p of order.products) {
        const key = `${order.contactId ?? order.shopifyCustomerId}__${p.shopifyProductId}`;
        const existing = lastPurchaseMap.get(key);
        if (!existing || order.createdAt > existing.lastPurchasedAt) {
          lastPurchaseMap.set(key, {
            contactId: order.contactId,
            shopifyCustomerId: order.shopifyCustomerId,
            lastPurchasedAt: order.createdAt,
            productTitle: p.title,
          });
        }
      }
    }

    const results: ReplenishmentCandidate[] = [];
    for (const [key, val] of lastPurchaseMap.entries()) {
      const [, productId] = key.split("__");
      results.push({
        contactId: val.contactId ?? val.shopifyCustomerId ?? key,
        shopifyCustomerId: val.shopifyCustomerId,
        productId,
        productTitle: val.productTitle,
        lastPurchasedAt: val.lastPurchasedAt,
        cycledays: productCycleDays[productId] ?? defaultCycleDays,
      });
    }

    return results;
  }
}
