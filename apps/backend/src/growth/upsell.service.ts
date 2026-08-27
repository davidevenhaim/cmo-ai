import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RawShopifyOrder } from "../shopify/shopify-graphql.adapter";

const BRAND_ID = "luminesce-brand-001";
// Minimum number of co-purchasing orders required to create a commerce-derived
// recommendation. Guards against noise from small sample sizes.
const MIN_SAMPLE_SIZE = 10;

@Injectable()
export class UpsellService {
  constructor(private readonly prisma: PrismaService) {}

  async getRecommendations(sourceProductId: string) {
    return this.prisma.productRecommendation.findMany({
      where: { brandId: BRAND_ID, sourceProductId },
      include: {
        targetProduct: {
          select: { id: true, name: true, category: true, active: true },
        },
      },
      orderBy: [{ source: "asc" }, { strength: "desc" }],
    });
  }

  async addManualRecommendation(dto: {
    sourceProductId: string;
    targetProductId: string;
    type: "CROSS_SELL" | "UPSELL";
    notes?: string;
  }) {
    return this.prisma.productRecommendation.upsert({
      where: {
        brandId_sourceProductId_targetProductId_type: {
          brandId: BRAND_ID,
          sourceProductId: dto.sourceProductId,
          targetProductId: dto.targetProductId,
          type: dto.type,
        },
      },
      create: {
        brandId: BRAND_ID,
        sourceProductId: dto.sourceProductId,
        targetProductId: dto.targetProductId,
        type: dto.type,
        source: "MANUAL",
        notes: dto.notes ?? null,
      },
      update: {
        notes: dto.notes ?? undefined,
      },
    });
  }

  // Analyzes raw Shopify orders to find co-purchased product pairs, then
  // upserts COMMERCE-sourced recommendations for pairs with enough support.
  // Products with fewer than MIN_SAMPLE_SIZE co-purchases are skipped.
  async syncCommerceRecommendations(
    orders: RawShopifyOrder[],
    minSampleSize = MIN_SAMPLE_SIZE,
  ): Promise<{ upserted: number; skipped: number }> {
    // Count co-occurrences: source → target → count
    const coOccurrence = new Map<string, Map<string, number>>();

    for (const order of orders) {
      const productIds = order.lineItems.edges
        .map(({ node }) => node.product?.id)
        .filter((id): id is string => Boolean(id));

      const unique = [...new Set(productIds)];
      if (unique.length < 2) continue;

      for (let i = 0; i < unique.length; i++) {
        for (let j = 0; j < unique.length; j++) {
          if (i === j) continue;
          const src = unique[i];
          const tgt = unique[j];
          if (!coOccurrence.has(src)) coOccurrence.set(src, new Map());
          const inner = coOccurrence.get(src)!;
          inner.set(tgt, (inner.get(tgt) ?? 0) + 1);
        }
      }
    }

    // Resolve shopify product GIDs to internal product IDs
    const allShopifyIds = [
      ...new Set([
        ...coOccurrence.keys(),
        ...[...coOccurrence.values()].flatMap((m) => [...m.keys()]),
      ]),
    ];
    const products = await this.prisma.product.findMany({
      where: {
        brandId: BRAND_ID,
        shopifyProductId: { in: allShopifyIds },
        active: true,
      },
      select: { id: true, shopifyProductId: true },
    });
    const shopifyToInternal = new Map(
      products.map((p) => [p.shopifyProductId!, p.id]),
    );

    let upserted = 0;
    let skipped = 0;

    for (const [srcShopify, targets] of coOccurrence) {
      const srcId = shopifyToInternal.get(srcShopify);
      if (!srcId) continue;

      for (const [tgtShopify, count] of targets) {
        const tgtId = shopifyToInternal.get(tgtShopify);
        if (!tgtId || srcId === tgtId) continue;

        if (count < minSampleSize) {
          skipped++;
          continue;
        }

        const strength = Math.min(count / orders.length, 1.0);

        await this.prisma.productRecommendation.upsert({
          where: {
            brandId_sourceProductId_targetProductId_type: {
              brandId: BRAND_ID,
              sourceProductId: srcId,
              targetProductId: tgtId,
              type: "CROSS_SELL",
            },
          },
          create: {
            brandId: BRAND_ID,
            sourceProductId: srcId,
            targetProductId: tgtId,
            type: "CROSS_SELL",
            source: "COMMERCE",
            strength,
            sampleSize: count,
          },
          update: { strength, sampleSize: count },
        });

        upserted++;
      }
    }

    return { upserted, skipped };
  }

  async listAll() {
    return this.prisma.productRecommendation.findMany({
      where: { brandId: BRAND_ID },
      include: {
        sourceProduct: { select: { name: true } },
        targetProduct: { select: { name: true, active: true } },
      },
      orderBy: [{ type: "asc" }, { strength: "desc" }],
    });
  }
}
