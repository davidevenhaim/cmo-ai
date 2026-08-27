import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";
// Contacts whose last order falls within ±WINDOW_BUFFER_DAYS of the due date
// are considered replenishment candidates.
const WINDOW_BUFFER_DAYS = 7;

@Injectable()
export class ReplenishmentService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns contacts due for replenishment for each configured product.
  // Uses lastOrderAt as a proxy — per-contact product purchase history is not
  // tracked at this milestone. Requires manual ReplenishmentConfig per product.
  async getCandidates(): Promise<
    Array<{
      productId: string;
      productName: string;
      windowDays: number;
      contacts: Array<{
        id: string;
        email: string | null;
        firstName: string | null;
      }>;
    }>
  > {
    const configs = await this.prisma.replenishmentConfig.findMany({
      where: { brandId: BRAND_ID },
      include: { product: true },
    });

    const results = [];

    for (const config of configs) {
      const dueDate = new Date(
        Date.now() - config.windowDays * 24 * 60 * 60 * 1000,
      );
      const earliest = new Date(
        dueDate.getTime() - WINDOW_BUFFER_DAYS * 24 * 60 * 60 * 1000,
      );
      const latest = new Date(
        dueDate.getTime() + WINDOW_BUFFER_DAYS * 24 * 60 * 60 * 1000,
      );

      const contacts = await this.prisma.contact.findMany({
        where: {
          brandId: BRAND_ID,
          emailMarketingStatus: "SUBSCRIBED",
          orderCount: { gte: 1 },
          lastOrderAt: { gte: earliest, lte: latest },
        },
        select: { id: true, email: true, firstName: true },
      });

      results.push({
        productId: config.productId,
        productName: config.product.name,
        windowDays: config.windowDays,
        contacts,
      });
    }

    return results;
  }

  async upsertConfig(dto: {
    productId: string;
    windowDays: number;
    notes?: string;
  }) {
    return this.prisma.replenishmentConfig.upsert({
      where: { productId: dto.productId },
      create: {
        brandId: BRAND_ID,
        productId: dto.productId,
        windowDays: dto.windowDays,
        notes: dto.notes ?? null,
      },
      update: {
        windowDays: dto.windowDays,
        notes: dto.notes ?? undefined,
      },
    });
  }

  async deleteConfig(productId: string) {
    return this.prisma.replenishmentConfig.delete({
      where: { productId },
    });
  }

  async listConfigs() {
    return this.prisma.replenishmentConfig.findMany({
      where: { brandId: BRAND_ID },
      include: { product: { select: { name: true, category: true } } },
      orderBy: { createdAt: "asc" },
    });
  }
}
