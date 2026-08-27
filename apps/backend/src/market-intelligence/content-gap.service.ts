import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { KeywordUniverseService } from "./keyword-universe.service";
import { ContentInventoryService } from "./content-inventory.service";

const BRAND_ID = "luminesce-brand-001";
const MIN_RELEVANCE_FOR_GAP = 0.4;
const MIN_IMPRESSIONS_FOR_GAP = 50;

@Injectable()
export class ContentGapService {
  private readonly logger = new Logger(ContentGapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keywordUniverse: KeywordUniverseService,
    private readonly contentInventory: ContentInventoryService,
  ) {}

  async analyzeGaps(): Promise<{ gapsFound: number; updatesFound: number }> {
    const keywords = await this.keywordUniverse.listKeywords({
      minRelevance: MIN_RELEVANCE_FOR_GAP,
      active: true,
    });

    let gapsFound = 0;
    let updatesFound = 0;

    for (const kw of keywords) {
      const matchingContent = await this.contentInventory.findMatchingContent(
        kw.keyword,
      );
      const hasContent = matchingContent.length > 0;

      // Check if any Search Console metric shows impressions
      const latestMetric = kw.metrics?.[0];
      const impressions = latestMetric?.impressions ?? 0;

      // Check for existing DECAYING_QUERY opportunity
      const decayOpp = await this.prisma.searchOpportunity.findFirst({
        where: {
          keywordId: kw.id,
          opportunityType: "DECAYING_QUERY",
          status: "NEW",
        },
      });

      if (
        !hasContent &&
        (impressions >= MIN_IMPRESSIONS_FOR_GAP || kw.relevance >= 0.6)
      ) {
        // Content gap: relevant keyword, no content
        const score = Math.min(
          0.9,
          kw.relevance * 0.6 + (impressions / 2000) * 0.4,
        );
        await this.upsertGap(
          kw,
          "CONTENT_GAP",
          score,
          `No content exists for "${kw.keyword}" — ${impressions > 0 ? `${impressions} Search Console impressions` : `relevance score ${kw.relevance.toFixed(2)}`}`,
        );
        gapsFound++;
      } else if (hasContent && decayOpp) {
        // Existing content + declining signal → UPDATE opportunity
        await this.upsertGap(
          kw,
          "DECAYING_QUERY",
          0.5,
          `Content exists for "${kw.keyword}" but search performance is declining — refresh opportunity`,
        );
        updatesFound++;
      }
    }

    this.logger.log(
      `Content gap analysis: ${gapsFound} gaps, ${updatesFound} updates`,
    );
    return { gapsFound, updatesFound };
  }

  private async upsertGap(
    keyword: { id: string; keyword: string; topic: string | null },
    opportunityType: string,
    score: number,
    reason: string,
  ): Promise<void> {
    const existing = await this.prisma.searchOpportunity.findFirst({
      where: {
        brandId: BRAND_ID,
        keywordId: keyword.id,
        opportunityType,
        status: "NEW",
      },
    });

    if (existing) {
      await this.prisma.searchOpportunity.update({
        where: { id: existing.id },
        data: { score, reason, updatedAt: new Date() },
      });
    } else {
      await this.prisma.searchOpportunity.create({
        data: {
          brandId: BRAND_ID,
          keywordId: keyword.id,
          opportunityType,
          topic: keyword.topic ?? keyword.keyword,
          score,
          reason,
          evidence: { keyword: keyword.keyword },
          relatedProductIds: [],
          relatedContentIds: [],
          status: "NEW",
        },
      });
    }
  }

  async getGaps(limit = 20) {
    return this.prisma.searchOpportunity.findMany({
      where: {
        brandId: BRAND_ID,
        opportunityType: "CONTENT_GAP",
        status: "NEW",
      },
      include: { keyword: true },
      orderBy: { score: "desc" },
      take: limit,
    });
  }
}
