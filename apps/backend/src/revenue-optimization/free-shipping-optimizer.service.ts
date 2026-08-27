import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RuntimeSettingsService } from "../settings/runtime-settings.service";

const BRAND_ID = "luminesce-brand-001";

interface CartSnapshot {
  contactId?: string;
  shopifyCustomerId?: string;
  shopifyCheckoutId?: string;
  cartValue: number;
  products: Array<{ shopifyProductId: string; title: string; price: number }>;
  recoveryUrl?: string;
}

@Injectable()
export class FreeShippingOptimizerService {
  private readonly logger = new Logger(FreeShippingOptimizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  isNearThreshold(cartValue: number, threshold: number): boolean {
    const factor = this.settings.getRevenueSync().freeShippingNearFactor;
    return cartValue >= threshold * factor && cartValue < threshold;
  }

  gapToThreshold(cartValue: number, threshold: number): number {
    return Math.max(0, threshold - cartValue);
  }

  async createFreeShippingOpportunity(
    cart: CartSnapshot,
    threshold: number,
  ): Promise<string | null> {
    if (!this.isNearThreshold(cart.cartValue, threshold)) return null;

    const existing = await this.prisma.revenueOpportunity.findFirst({
      where: {
        brandId: BRAND_ID,
        type: "FREE_SHIPPING",
        contactId: cart.contactId,
        shopifyCheckoutId: cart.shopifyCheckoutId,
        status: { in: ["NEW", "IN_JOURNEY"] },
      },
    });

    if (existing) return existing.id;

    const opp = await this.prisma.revenueOpportunity.create({
      data: {
        brandId: BRAND_ID,
        type: "FREE_SHIPPING",
        status: "NEW",
        contactId: cart.contactId,
        shopifyCustomerId: cart.shopifyCustomerId,
        shopifyCheckoutId: cart.shopifyCheckoutId,
        cartValue: cart.cartValue,
        products: cart.products,
        recoveryUrl: cart.recoveryUrl,
        abandonedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    this.logger.log(
      `Free-shipping opportunity ${opp.id}: cart $${cart.cartValue} / threshold $${threshold}`,
    );
    return opp.id;
  }

  suggestUpsellProducts(
    cartValue: number,
    threshold: number,
    catalog: Array<{ shopifyProductId: string; title: string; price: number }>,
  ): Array<{ shopifyProductId: string; title: string; price: number }> {
    const gap = this.gapToThreshold(cartValue, threshold);
    if (gap <= 0) return [];
    return catalog
      .filter((p) => p.price >= gap * 0.8 && p.price <= gap * 2)
      .sort((a, b) => Math.abs(a.price - gap) - Math.abs(b.price - gap))
      .slice(0, 3);
  }
}
