import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RuntimeSettingsService } from "../settings/runtime-settings.service";

const BRAND_ID = "luminesce-brand-001";

interface CustomerSummary {
  contactId?: string;
  shopifyCustomerId?: string;
  totalLtv: number;
  lastOrderAt: Date;
}

@Injectable()
export class WinBackService {
  private readonly logger = new Logger(WinBackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  async scanForWinBack(customers: CustomerSummary[]): Promise<number> {
    let created = 0;
    const policy = this.settings.getRevenueSync();
    const cutoff = new Date(
      Date.now() - policy.winBackDays * 24 * 60 * 60 * 1000,
    );

    for (const c of customers) {
      if (c.lastOrderAt >= cutoff) continue;

      const type = c.totalLtv >= policy.vipLtvThreshold ? "VIP" : "WIN_BACK";

      const existing = await this.prisma.revenueOpportunity.findFirst({
        where: {
          brandId: BRAND_ID,
          type,
          contactId: c.contactId,
          status: { in: ["NEW", "IN_JOURNEY"] },
        },
      });

      if (existing) continue;

      await this.prisma.revenueOpportunity.create({
        data: {
          brandId: BRAND_ID,
          type,
          status: "NEW",
          contactId: c.contactId,
          shopifyCustomerId: c.shopifyCustomerId,
          cartValue: c.totalLtv,
          abandonedAt: c.lastOrderAt,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      created++;
    }

    this.logger.log(`Created ${created} win-back/VIP opportunities`);
    return created;
  }
}
