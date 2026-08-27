import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ProductAffinityService } from "./product-affinity.service";

const BRAND_ID = "luminesce-brand-001";
const MAX_BUNDLE_DISCOUNT_PCT = 15;

interface ProductInfo {
  shopifyProductId: string;
  title: string;
  price: number;
  cogs?: number;
}

@Injectable()
export class BundleService {
  private readonly logger = new Logger(BundleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly affinity: ProductAffinityService,
  ) {}

  async suggestBundlesFromAffinity(
    catalog: ProductInfo[],
    discountPct = 10,
  ): Promise<number> {
    const clampedDiscount = Math.min(discountPct, MAX_BUNDLE_DISCOUNT_PCT);
    const catalogMap = new Map(catalog.map((p) => [p.shopifyProductId, p]));
    let created = 0;

    for (const product of catalog) {
      const crossSells = await this.affinity.getTopCrossSells(
        product.shopifyProductId,
        3,
      );

      for (const cs of crossSells) {
        const partner = catalogMap.get(cs.productBId);
        if (!partner) continue;

        const normalPrice = product.price + partner.price;
        const bundlePrice = normalPrice * (1 - clampedDiscount / 100);

        const estimatedCogs =
          product.cogs !== undefined && partner.cogs !== undefined
            ? product.cogs + partner.cogs
            : undefined;

        const estimatedMargin =
          estimatedCogs !== undefined
            ? (bundlePrice - estimatedCogs) / bundlePrice
            : undefined;

        const bundleName = `${product.title} + ${cs.productBTitle}`;
        const existing = await this.prisma.bundle.findFirst({
          where: { brandId: BRAND_ID, active: true, name: bundleName },
        });

        if (existing) continue;

        await this.prisma.bundle.create({
          data: {
            brandId: BRAND_ID,
            name: bundleName,
            products: [
              {
                shopifyProductId: product.shopifyProductId,
                title: product.title,
                price: product.price,
              },
              {
                shopifyProductId: cs.productBId,
                title: cs.productBTitle,
                price: partner.price,
              },
            ],
            normalPrice,
            bundlePrice,
            discountPct: clampedDiscount,
            estimatedCogs: estimatedCogs ?? null,
            estimatedMargin: estimatedMargin ?? null,
            source: "AFFINITY",
            active: true,
            approved: false,
          },
        });

        created++;
      }
    }

    this.logger.log(`Suggested ${created} bundles from affinity`);
    return created;
  }

  async getActiveBundles(approvedOnly = false) {
    return this.prisma.bundle.findMany({
      where: {
        brandId: BRAND_ID,
        active: true,
        ...(approvedOnly ? { approved: true } : {}),
      },
      orderBy: { discountPct: "desc" },
    });
  }
}
