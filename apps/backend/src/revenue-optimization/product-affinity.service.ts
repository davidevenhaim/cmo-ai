import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";
const MIN_SAMPLE = 5;
const MIN_LIFT = 1.2;

interface OrderProduct {
  shopifyProductId: string;
  title: string;
}

@Injectable()
export class ProductAffinityService {
  private readonly logger = new Logger(ProductAffinityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeFromOrders(
    orders: Array<{ products: OrderProduct[] }>,
  ): Promise<number> {
    const totalOrders = orders.length;
    if (totalOrders === 0) return 0;

    const supportMap = new Map<string, { title: string; count: number }>();
    const coMap = new Map<string, number>();

    for (const order of orders) {
      const seen = new Map<string, string>();
      for (const p of order.products) {
        seen.set(p.shopifyProductId, p.title);
      }
      for (const [idA, titleA] of seen.entries()) {
        const entry = supportMap.get(idA) ?? { title: titleA, count: 0 };
        supportMap.set(idA, { title: titleA, count: entry.count + 1 });
        for (const [idB, titleB] of seen.entries()) {
          if (idA >= idB) continue;
          const key = `${idA}__${idB}`;
          coMap.set(key, (coMap.get(key) ?? 0) + 1);
        }
      }
    }

    let upserted = 0;
    for (const [key, coCount] of coMap.entries()) {
      const [idA, idB] = key.split("__");
      const sA = supportMap.get(idA);
      const sB = supportMap.get(idB);
      if (!sA || !sB) continue;

      const pB = sB.count / totalOrders;
      const confidence = sA.count > 0 ? coCount / sA.count : 0;
      const lift = pB > 0 ? confidence / pB : 0;

      await this.prisma.productAffinity.upsert({
        where: {
          brandId_productAId_productBId: {
            brandId: BRAND_ID,
            productAId: idA,
            productBId: idB,
          },
        },
        create: {
          brandId: BRAND_ID,
          productAId: idA,
          productBId: idB,
          productATitle: sA.title,
          productBTitle: sB.title,
          coOccurrences: coCount,
          supportA: sA.count,
          supportB: sB.count,
          totalOrders,
          confidence,
          lift,
        },
        update: {
          coOccurrences: coCount,
          supportA: sA.count,
          supportB: sB.count,
          totalOrders,
          confidence,
          lift,
          computedAt: new Date(),
        },
      });

      // also store reverse direction
      const confidenceBA = sB.count > 0 ? coCount / sB.count : 0;
      const pA = sA.count / totalOrders;
      const liftBA = pA > 0 ? confidenceBA / pA : 0;

      await this.prisma.productAffinity.upsert({
        where: {
          brandId_productAId_productBId: {
            brandId: BRAND_ID,
            productAId: idB,
            productBId: idA,
          },
        },
        create: {
          brandId: BRAND_ID,
          productAId: idB,
          productBId: idA,
          productATitle: sB.title,
          productBTitle: sA.title,
          coOccurrences: coCount,
          supportA: sB.count,
          supportB: sA.count,
          totalOrders,
          confidence: confidenceBA,
          lift: liftBA,
        },
        update: {
          coOccurrences: coCount,
          supportA: sB.count,
          supportB: sA.count,
          totalOrders,
          confidence: confidenceBA,
          lift: liftBA,
          computedAt: new Date(),
        },
      });

      upserted++;
    }

    this.logger.log(
      `Computed ${upserted} affinity pairs from ${totalOrders} orders`,
    );
    return upserted;
  }

  async listTopAffinities(limit = 20) {
    return this.prisma.productAffinity.findMany({
      where: {
        brandId: BRAND_ID,
        coOccurrences: { gte: MIN_SAMPLE },
        lift: { gte: MIN_LIFT },
      },
      orderBy: { lift: "desc" },
      take: limit,
    });
  }

  async getTopCrossSells(shopifyProductId: string, limit = 5) {
    return this.prisma.productAffinity.findMany({
      where: {
        brandId: BRAND_ID,
        productAId: shopifyProductId,
        coOccurrences: { gte: MIN_SAMPLE },
        lift: { gte: MIN_LIFT },
      },
      orderBy: { lift: "desc" },
      take: limit,
    });
  }

  async getRankedRecommendations(
    purchasedProductIds: string[],
    limit = 5,
    inventoryProductIds?: string[],
  ): Promise<
    Array<{
      productId: string;
      title: string;
      confidence: number;
      lift: number;
      reason: string;
    }>
  > {
    const affinities = await this.prisma.productAffinity.findMany({
      where: {
        brandId: BRAND_ID,
        productAId: { in: purchasedProductIds },
        productBId: { notIn: purchasedProductIds },
        coOccurrences: { gte: MIN_SAMPLE },
        lift: { gte: MIN_LIFT },
      },
      orderBy: { lift: "desc" },
    });

    const seen = new Set<string>();
    const results: Array<{
      productId: string;
      title: string;
      confidence: number;
      lift: number;
      reason: string;
    }> = [];

    const purchasedSet = new Set(purchasedProductIds);
    for (const a of affinities) {
      if (seen.has(a.productBId)) continue;
      if (purchasedSet.has(a.productBId)) continue;
      if (inventoryProductIds && !inventoryProductIds.includes(a.productBId))
        continue;
      seen.add(a.productBId);
      results.push({
        productId: a.productBId,
        title: a.productBTitle,
        confidence: a.confidence,
        lift: a.lift,
        reason: `${Math.round(a.confidence * 100)}% of "${a.productATitle}" buyers also bought this (lift ${a.lift.toFixed(2)}×)`,
      });
      if (results.length >= limit) break;
    }

    return results;
  }
}
