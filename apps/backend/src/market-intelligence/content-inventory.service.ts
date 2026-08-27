import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface ContentInventoryItem {
  id: string;
  type: "brief" | "draft";
  title: string;
  topic: string;
  channel: string;
  keywords: string[];
  createdAt: Date;
}

@Injectable()
export class ContentInventoryService {
  private readonly logger = new Logger(ContentInventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async buildInventory(): Promise<ContentInventoryItem[]> {
    const [briefs, drafts] = await Promise.all([
      this.prisma.contentBrief.findMany({
        where: { brandId: BRAND_ID, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.contentDraft.findMany({
        where: {
          brandId: BRAND_ID,
          status: { in: ["APPROVED", "GENERATED", "PENDING_REVIEW"] },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    const items: ContentInventoryItem[] = [];

    for (const b of briefs) {
      const keywords: string[] = [];
      if (b.primaryKeyword) keywords.push(b.primaryKeyword);
      keywords.push(...(b.secondaryKeywords as string[]));

      items.push({
        id: b.id,
        type: "brief",
        title: b.topic,
        topic: b.topic,
        channel: b.channel,
        keywords,
        createdAt: b.createdAt,
      });
    }

    for (const d of drafts) {
      items.push({
        id: d.id,
        type: "draft",
        title: d.headline ?? d.caption ?? `${d.channel} ${d.format}`,
        topic: d.headline ?? d.caption ?? "",
        channel: d.channel,
        keywords: [],
        createdAt: d.createdAt,
      });
    }

    return items;
  }

  async findMatchingContent(keyword: string): Promise<ContentInventoryItem[]> {
    const lower = keyword.toLowerCase();
    const all = await this.buildInventory();
    return all.filter(
      (item) =>
        item.topic.toLowerCase().includes(lower) ||
        item.title.toLowerCase().includes(lower) ||
        item.keywords.some((k) => k.toLowerCase().includes(lower)),
    );
  }

  async getInventorySummary(): Promise<{
    totalBriefs: number;
    totalDrafts: number;
    byChannel: Record<string, number>;
    recentTopics: string[];
  }> {
    const inventory = await this.buildInventory();
    const byChannel: Record<string, number> = {};

    for (const item of inventory) {
      byChannel[item.channel] = (byChannel[item.channel] ?? 0) + 1;
    }

    const recentTopics = inventory
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((i) => i.topic)
      .filter(Boolean);

    return {
      totalBriefs: inventory.filter((i) => i.type === "brief").length,
      totalDrafts: inventory.filter((i) => i.type === "draft").length,
      byChannel,
      recentTopics,
    };
  }
}
