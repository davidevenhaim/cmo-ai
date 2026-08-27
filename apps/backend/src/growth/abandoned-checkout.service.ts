import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  RawShopifyAbandonedCheckout,
  RawShopifyOrder,
  ShopifyGraphqlAdapter,
} from "../shopify/shopify-graphql.adapter";
import { ContactService } from "./contact.service";

const BRAND_ID = "luminesce-brand-001";
const DEFAULT_EXPIRY_DAYS = 30;

@Injectable()
export class AbandonedCheckoutService {
  private readonly logger = new Logger(AbandonedCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyGraphqlAdapter,
    private readonly contacts: ContactService,
  ) {}

  async ingestFromShopify(): Promise<{ upserted: number; linked: number }> {
    const { items } = await this.shopify.fetchAbandonedCheckouts();
    let upserted = 0;
    let linked = 0;

    for (const raw of items) {
      const email = raw.customer?.email ?? null;

      let contactId: string | null = null;
      if (email) {
        const contact = await this.contacts.findByEmail(email);
        if (contact) {
          contactId = contact.id;
          linked++;
        }
      }

      const lineItems = raw.lineItems.edges.map(({ node }) => ({
        title: node.title,
        quantity: node.quantity,
        shopifyProductId: node.variant?.product?.id ?? null,
        variantId: node.variant?.id ?? null,
        sku: node.variant?.sku ?? null,
        price: parseFloat(node.originalTotalSet.shopMoney.amount),
        currency: node.originalTotalSet.shopMoney.currencyCode,
      }));

      const totalValue = parseFloat(raw.totalPriceSet.shopMoney.amount);
      const currencyCode = raw.totalPriceSet.shopMoney.currencyCode;

      await this.prisma.abandonedCheckout.upsert({
        where: { shopifyCheckoutId: raw.id },
        create: {
          brandId: BRAND_ID,
          shopifyCheckoutId: raw.id,
          contactId,
          email,
          lineItems,
          totalValue,
          currencyCode,
          abandonedAt: new Date(raw.createdAt),
          recoveryUrl: raw.abandonedCheckoutUrl,
          checkoutToken: raw.token,
          status: "ACTIVE",
        },
        update: {
          contactId: contactId ?? undefined,
          email: email ?? undefined,
          lineItems,
          totalValue,
          currencyCode,
          recoveryUrl: raw.abandonedCheckoutUrl,
          checkoutToken: raw.token,
        },
      });

      upserted++;
    }

    this.logger.log(
      `Abandoned checkout ingest: ${upserted} upserted, ${linked} linked to contacts`,
    );
    return { upserted, linked };
  }

  // Called after fetching recent orders. Marks RECOVERED any checkout whose
  // checkoutToken matches an order, creates a LAST_TOUCH attribution record.
  async reconcileWithOrders(orders: RawShopifyOrder[]): Promise<number> {
    const tokenToOrderId = new Map<string, string>();
    for (const order of orders) {
      if (order.checkoutToken) {
        tokenToOrderId.set(order.checkoutToken, order.id);
      }
    }

    if (tokenToOrderId.size === 0) return 0;

    const openCheckouts = await this.prisma.abandonedCheckout.findMany({
      where: {
        brandId: BRAND_ID,
        status: { in: ["ACTIVE", "RECOVERY_STARTED"] },
        checkoutToken: { not: null },
      },
    });

    let recovered = 0;
    for (const checkout of openCheckouts) {
      if (!checkout.checkoutToken) continue;
      const shopifyOrderId = tokenToOrderId.get(checkout.checkoutToken);
      if (!shopifyOrderId) continue;

      await this.prisma.$transaction([
        this.prisma.abandonedCheckout.update({
          where: { id: checkout.id },
          data: {
            status: "RECOVERED",
            recoveredAt: new Date(),
            recoveryOrderId: shopifyOrderId,
          },
        }),
        this.prisma.conversionAttribution.create({
          data: {
            brandId: BRAND_ID,
            contactId: checkout.contactId ?? null,
            abandonedCheckoutId: checkout.id,
            shopifyOrderId,
            attributedRevenue: checkout.totalValue,
            currencyCode: checkout.currencyCode,
            attributionMethod: "LAST_TOUCH",
          },
        }),
      ]);

      recovered++;
      this.logger.log(
        `Checkout ${checkout.shopifyCheckoutId} recovered via order ${shopifyOrderId}`,
      );
    }

    return recovered;
  }

  async markRecoveryStarted(shopifyCheckoutId: string): Promise<void> {
    await this.prisma.abandonedCheckout.updateMany({
      where: { shopifyCheckoutId, status: "ACTIVE" },
      data: { status: "RECOVERY_STARTED" },
    });
  }

  async expireOld(olderThanDays = DEFAULT_EXPIRY_DAYS): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.abandonedCheckout.updateMany({
      where: {
        brandId: BRAND_ID,
        status: { in: ["ACTIVE", "RECOVERY_STARTED"] },
        abandonedAt: { lt: cutoff },
      },
      data: { status: "EXPIRED" },
    });
    if (count > 0) {
      this.logger.log(
        `Expired ${count} abandoned checkouts older than ${olderThanDays} days`,
      );
    }
    return count;
  }

  async getActive() {
    return this.prisma.abandonedCheckout.findMany({
      where: { brandId: BRAND_ID, status: "ACTIVE" },
      orderBy: { totalValue: "desc" },
    });
  }

  async getHighValue(threshold = 150) {
    return this.prisma.abandonedCheckout.findMany({
      where: {
        brandId: BRAND_ID,
        status: "ACTIVE",
        totalValue: { gte: threshold },
      },
      orderBy: { totalValue: "desc" },
    });
  }

  async getSummary() {
    const [statusCounts, activeAgg] = await Promise.all([
      this.prisma.abandonedCheckout.groupBy({
        by: ["status"],
        where: { brandId: BRAND_ID },
        _count: { id: true },
      }),
      this.prisma.abandonedCheckout.aggregate({
        where: { brandId: BRAND_ID, status: "ACTIVE" },
        _sum: { totalValue: true },
        _count: { id: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row._count.id;
    }

    return {
      byStatus,
      activeCount: activeAgg._count.id,
      activeTotalValue: activeAgg._sum.totalValue ?? 0,
    };
  }
}
