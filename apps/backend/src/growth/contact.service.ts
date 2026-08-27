import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface UpsertContactDto {
  shopifyCustomerId: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailMarketingStatus?: string;
  smsMarketingStatus?: string;
  firstOrderAt?: Date | null;
  lastOrderAt?: Date | null;
  orderCount?: number;
  lifetimeRevenue?: number;
  currencyCode?: string;
}

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(dto: UpsertContactDto) {
    return this.prisma.contact.upsert({
      where: { shopifyCustomerId: dto.shopifyCustomerId },
      create: {
        brandId: BRAND_ID,
        shopifyCustomerId: dto.shopifyCustomerId,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        emailMarketingStatus: dto.emailMarketingStatus ?? "NOT_SUBSCRIBED",
        smsMarketingStatus: dto.smsMarketingStatus ?? "NOT_SUBSCRIBED",
        firstOrderAt: dto.firstOrderAt ?? null,
        lastOrderAt: dto.lastOrderAt ?? null,
        orderCount: dto.orderCount ?? 0,
        lifetimeRevenue: dto.lifetimeRevenue ?? 0,
        currencyCode: dto.currencyCode ?? "USD",
      },
      update: {
        email: dto.email ?? undefined,
        phone: dto.phone ?? undefined,
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        emailMarketingStatus: dto.emailMarketingStatus ?? undefined,
        smsMarketingStatus: dto.smsMarketingStatus ?? undefined,
        firstOrderAt: dto.firstOrderAt ?? undefined,
        lastOrderAt: dto.lastOrderAt ?? undefined,
        orderCount: dto.orderCount ?? undefined,
        lifetimeRevenue: dto.lifetimeRevenue ?? undefined,
        currencyCode: dto.currencyCode ?? undefined,
      },
    });
  }

  async findByShopifyId(shopifyCustomerId: string) {
    return this.prisma.contact.findUnique({ where: { shopifyCustomerId } });
  }

  async findByEmail(email: string) {
    return this.prisma.contact.findFirst({
      where: { brandId: BRAND_ID, email },
    });
  }

  async list(opts?: { emailSubscribed?: boolean; minOrderCount?: number }) {
    return this.prisma.contact.findMany({
      where: {
        brandId: BRAND_ID,
        ...(opts?.emailSubscribed
          ? { emailMarketingStatus: "SUBSCRIBED" }
          : {}),
        ...(opts?.minOrderCount != null
          ? { orderCount: { gte: opts.minOrderCount } }
          : {}),
      },
      orderBy: { lifetimeRevenue: "desc" },
    });
  }

  async count() {
    return this.prisma.contact.count({ where: { brandId: BRAND_ID } });
  }

  async addSuppression(
    contactId: string,
    reason: string,
    detail?: string,
    expiresAt?: Date,
  ) {
    return this.prisma.contactSuppression.create({
      data: {
        contactId,
        reason,
        detail: detail ?? null,
        expiresAt: expiresAt ?? null,
      },
    });
  }

  async getActiveSuppressions(contactId: string) {
    const now = new Date();
    return this.prisma.contactSuppression.findMany({
      where: {
        contactId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  async isMarketingEligible(contactId: string): Promise<boolean> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) return false;
    if (contact.emailMarketingStatus !== "SUBSCRIBED") return false;
    const suppressions = await this.getActiveSuppressions(contactId);
    return suppressions.length === 0;
  }
}
