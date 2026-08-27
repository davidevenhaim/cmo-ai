import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

@Injectable()
export class FrequencyCapService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns true when the contact is within all applicable frequency caps.
  // Checks global rules first, then flowType-specific rules if provided.
  async isEligible(contactId: string, flowType?: string): Promise<boolean> {
    const rules = await this.prisma.frequencyCapRule.findMany({
      where: {
        brandId: BRAND_ID,
        OR: [{ flowType: null }, ...(flowType ? [{ flowType }] : [])],
      },
    });

    for (const rule of rules) {
      const windowStart = new Date(
        Date.now() - rule.windowDays * 24 * 60 * 60 * 1000,
      );
      const count = await this.prisma.campaignTouch.count({
        where: {
          contactId,
          touchType: "SEND",
          timestamp: { gte: windowStart },
        },
      });
      if (count >= rule.maxMessages) return false;
    }

    return true;
  }

  async getRules() {
    return this.prisma.frequencyCapRule.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { createdAt: "asc" },
    });
  }

  async createRule(dto: {
    name: string;
    maxMessages: number;
    windowDays: number;
    flowType?: string;
  }) {
    return this.prisma.frequencyCapRule.create({
      data: {
        brandId: BRAND_ID,
        name: dto.name,
        maxMessages: dto.maxMessages,
        windowDays: dto.windowDays,
        flowType: dto.flowType ?? null,
      },
    });
  }

  async deleteRule(id: string) {
    return this.prisma.frequencyCapRule.delete({ where: { id } });
  }
}
