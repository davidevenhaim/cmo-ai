import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

// Thresholds — conservative defaults.
const VIP_MIN_ORDERS = 5;
const VIP_MIN_LTV = 500;
const LAPSED_DAYS = 180;
const RECENT_DAYS = 30;
const HIGH_VALUE_ABANDONMENT_THRESHOLD = 150;

@Injectable()
export class SegmentService {
  constructor(private readonly prisma: PrismaService) {}

  async refreshAll(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    await Promise.all([
      this.refreshProspects().then((n) => (counts["PROSPECT"] = n)),
      this.refreshFirstTime().then((n) => (counts["FIRST_TIME_CUSTOMER"] = n)),
      this.refreshRepeat().then((n) => (counts["REPEAT_CUSTOMER"] = n)),
      this.refreshVip().then((n) => (counts["VIP"] = n)),
      this.refreshRecent().then((n) => (counts["RECENT_CUSTOMER"] = n)),
      this.refreshLapsed().then((n) => (counts["LAPSED_CUSTOMER"] = n)),
      this.refreshAbandonedCheckout().then(
        (n) => (counts["ABANDONED_CHECKOUT"] = n),
      ),
      this.refreshHighValueAbandonment().then(
        (n) => (counts["HIGH_VALUE_ABANDONMENT"] = n),
      ),
    ]);
    return counts;
  }

  async getMembersForSegment(
    type: string,
    productFilter?: { shopifyProductId?: string; productId?: string },
  ) {
    const cutoff = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    switch (type) {
      case "PROSPECT":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            orderCount: 0,
            emailMarketingStatus: "SUBSCRIBED",
          },
        });

      case "FIRST_TIME_CUSTOMER":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            orderCount: 1,
            emailMarketingStatus: "SUBSCRIBED",
          },
        });

      case "REPEAT_CUSTOMER":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            orderCount: { gte: 2 },
            emailMarketingStatus: "SUBSCRIBED",
          },
        });

      case "VIP":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            orderCount: { gte: VIP_MIN_ORDERS },
            lifetimeRevenue: { gte: VIP_MIN_LTV },
            emailMarketingStatus: "SUBSCRIBED",
          },
        });

      case "RECENT_CUSTOMER":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            lastOrderAt: { gte: cutoff(RECENT_DAYS) },
            emailMarketingStatus: "SUBSCRIBED",
          },
        });

      case "LAPSED_CUSTOMER":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            orderCount: { gte: 1 },
            lastOrderAt: { lt: cutoff(LAPSED_DAYS) },
            emailMarketingStatus: "SUBSCRIBED",
          },
        });

      case "ABANDONED_CHECKOUT":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            emailMarketingStatus: "SUBSCRIBED",
            abandonedCheckouts: { some: { status: "ACTIVE" } },
          },
        });

      case "HIGH_VALUE_ABANDONMENT":
        return this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            emailMarketingStatus: "SUBSCRIBED",
            abandonedCheckouts: {
              some: {
                status: "ACTIVE",
                totalValue: { gte: HIGH_VALUE_ABANDONMENT_THRESHOLD },
              },
            },
          },
        });

      default:
        return [];
    }
  }

  async getSegmentSummary() {
    return this.prisma.segment.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { memberCount: "desc" },
    });
  }

  // --- Private refresh helpers ---

  private async refreshProspects(): Promise<number> {
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        orderCount: 0,
        emailMarketingStatus: "SUBSCRIBED",
      },
    });
    return this.upsertSegment(
      "PROSPECT",
      "Subscribers with no purchases",
      count,
    );
  }

  private async refreshFirstTime(): Promise<number> {
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        orderCount: 1,
        emailMarketingStatus: "SUBSCRIBED",
      },
    });
    return this.upsertSegment(
      "FIRST_TIME_CUSTOMER",
      "One order — conversion focus",
      count,
    );
  }

  private async refreshRepeat(): Promise<number> {
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        orderCount: { gte: 2 },
        emailMarketingStatus: "SUBSCRIBED",
      },
    });
    return this.upsertSegment("REPEAT_CUSTOMER", "Two or more orders", count);
  }

  private async refreshVip(): Promise<number> {
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        orderCount: { gte: VIP_MIN_ORDERS },
        lifetimeRevenue: { gte: VIP_MIN_LTV },
        emailMarketingStatus: "SUBSCRIBED",
      },
    });
    return this.upsertSegment(
      "VIP",
      `${VIP_MIN_ORDERS}+ orders, ${VIP_MIN_LTV}+ LTV`,
      count,
    );
  }

  private async refreshRecent(): Promise<number> {
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        lastOrderAt: { gte: cutoff },
        emailMarketingStatus: "SUBSCRIBED",
      },
    });
    return this.upsertSegment(
      "RECENT_CUSTOMER",
      `Ordered in last ${RECENT_DAYS} days`,
      count,
    );
  }

  private async refreshLapsed(): Promise<number> {
    const cutoff = new Date(Date.now() - LAPSED_DAYS * 24 * 60 * 60 * 1000);
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        orderCount: { gte: 1 },
        lastOrderAt: { lt: cutoff },
        emailMarketingStatus: "SUBSCRIBED",
      },
    });
    return this.upsertSegment(
      "LAPSED_CUSTOMER",
      `No order in ${LAPSED_DAYS} days`,
      count,
    );
  }

  private async refreshAbandonedCheckout(): Promise<number> {
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        emailMarketingStatus: "SUBSCRIBED",
        abandonedCheckouts: { some: { status: "ACTIVE" } },
      },
    });
    return this.upsertSegment(
      "ABANDONED_CHECKOUT",
      "Active abandoned checkout",
      count,
    );
  }

  private async refreshHighValueAbandonment(): Promise<number> {
    const count = await this.prisma.contact.count({
      where: {
        brandId: BRAND_ID,
        emailMarketingStatus: "SUBSCRIBED",
        abandonedCheckouts: {
          some: {
            status: "ACTIVE",
            totalValue: { gte: HIGH_VALUE_ABANDONMENT_THRESHOLD },
          },
        },
      },
    });
    return this.upsertSegment(
      "HIGH_VALUE_ABANDONMENT",
      `Abandoned checkout ≥ ${HIGH_VALUE_ABANDONMENT_THRESHOLD}`,
      count,
    );
  }

  private async upsertSegment(
    type: string,
    description: string,
    count: number,
  ): Promise<number> {
    await this.prisma.segment.upsert({
      where: { brandId_type_name: { brandId: BRAND_ID, type, name: type } },
      create: {
        brandId: BRAND_ID,
        type,
        name: type,
        description,
        memberCount: count,
        lastRefreshedAt: new Date(),
      },
      update: { memberCount: count, lastRefreshedAt: new Date() },
    });
    return count;
  }
}
