import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ContentInventoryService } from "./content-inventory.service";

const BRAND_ID = "luminesce-brand-001";
const MIN_SCORE_FOR_OPPORTUNITY = 40;
// Max denominators for normalization
const MAX_SEARCH_VOLUME = 10_000;
const MAX_ONSITE_COUNT = 50;
const MAX_COMMUNITY_FREQUENCY = 10;

export interface ComponentScores {
  brandRelevance?: number;
  searchDemand?: number;
  trendMomentum?: number;
  commercialIntent?: number;
  searchConsoleOpportunity?: number;
  onsiteDemand?: number;
  communityDiscussion?: number;
  contentGap?: number;
  productRelevance?: number;
}

export interface OpportunityScoreResult {
  total: number; // 0–100
  components: ComponentScores;
  availableSignals: string[];
}

function normalizeToOne(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}

function commercialIntentScore(intent: string | null): number {
  switch (intent) {
    case "TRANSACTIONAL":
      return 1.0;
    case "COMMERCIAL":
      return 0.85;
    case "PRODUCT_AWARE":
      return 0.5;
    case "PROBLEM_AWARE":
      return 0.4;
    default:
      return 0.0;
  }
}

function scOpportunityScore(opportunityType: string): number {
  switch (opportunityType) {
    case "STRIKING_DISTANCE":
      return 0.9;
    case "RISING_QUERY":
      return 0.7;
    case "HIGH_IMPRESSIONS_LOW_CTR":
      return 0.6;
    case "CONTENT_GAP":
      return 0.5;
    case "DECAYING_QUERY":
      return 0.3;
    default:
      return 0.2;
  }
}

@Injectable()
export class OpportunityScoringService {
  private readonly logger = new Logger(OpportunityScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentInventory: ContentInventoryService,
  ) {}

  async scoreKeyword(keywordId: string): Promise<OpportunityScoreResult> {
    const keyword = await this.prisma.keyword.findUniqueOrThrow({
      where: { id: keywordId },
      include: {
        // MOCK metrics carry fixture demand — never score against them
        metrics: {
          where: { evidenceStatus: { not: "MOCK" } },
          orderBy: { fetchedAt: "desc" },
          take: 5,
        },
        searchOpportunities: { where: { status: "NEW" }, take: 1 },
      },
    });

    const components: ComponentScores = {};
    const availableSignals: string[] = [];

    // Brand relevance (always available if keyword exists)
    components.brandRelevance = keyword.relevance;
    availableSignals.push("brandRelevance");

    // Commercial intent (available after classification)
    if (keyword.intent) {
      components.commercialIntent = commercialIntentScore(keyword.intent);
      availableSignals.push("commercialIntent");
    }

    // Search demand from Keyword Planner metrics
    const kpMetric = keyword.metrics.find(
      (m) => m.source === "KEYWORD_PLANNER",
    );
    if (kpMetric?.searchVolume != null) {
      components.searchDemand = normalizeToOne(
        kpMetric.searchVolume,
        MAX_SEARCH_VOLUME,
      );
      availableSignals.push("searchDemand");
    }

    // Trend momentum from Trends metrics
    const trendMetric = keyword.metrics.find((m) => m.source === "TRENDS");
    if (trendMetric?.trendScore != null) {
      let momentum = trendMetric.trendScore / 100;
      if (trendMetric.trendDelta != null && trendMetric.trendDelta > 0)
        momentum += 0.2;
      components.trendMomentum = Math.min(1, momentum);
      availableSignals.push("trendMomentum");
    }

    // Search Console opportunity
    if (keyword.searchOpportunities.length > 0) {
      const bestOpp = keyword.searchOpportunities[0];
      components.searchConsoleOpportunity = scOpportunityScore(
        bestOpp.opportunityType,
      );
      availableSignals.push("searchConsoleOpportunity");
    }

    // Onsite demand
    const onsiteMetrics = await this.prisma.onsiteSearchMetric.aggregate({
      where: {
        brandId: BRAND_ID,
        normalizedQuery: { contains: keyword.normalizedKeyword },
      },
      _sum: { count: true },
    });
    const onsiteCount = onsiteMetrics._sum.count ?? 0;
    if (onsiteCount > 0) {
      components.onsiteDemand = normalizeToOne(onsiteCount, MAX_ONSITE_COUNT);
      availableSignals.push("onsiteDemand");
    }

    // Community discussion
    const langSignal = await this.prisma.audienceLanguageSignal.findFirst({
      where: {
        brandId: BRAND_ID,
        phrase: { contains: keyword.normalizedKeyword },
      },
      orderBy: { frequency: "desc" },
    });
    if (langSignal) {
      components.communityDiscussion = normalizeToOne(
        langSignal.frequency,
        MAX_COMMUNITY_FREQUENCY,
      );
      availableSignals.push("communityDiscussion");
    }

    // Content gap
    const matchingContent = await this.contentInventory.findMatchingContent(
      keyword.keyword,
    );
    components.contentGap = matchingContent.length === 0 ? 1.0 : 0.2;
    availableSignals.push("contentGap");

    // Product relevance — any product tags/category overlaps keyword
    const products = await this.prisma.product.findMany({
      where: { brandId: BRAND_ID, active: true },
      select: { name: true, category: true, tags: true },
    });
    const kwLower = keyword.normalizedKeyword;
    const productMatch = products.some(
      (p) =>
        p.name.toLowerCase().includes(kwLower) ||
        (p.category ?? "").toLowerCase().includes(kwLower) ||
        p.tags.some((t) => t.toLowerCase().includes(kwLower)),
    );
    if (productMatch) {
      components.productRelevance = 1.0;
      availableSignals.push("productRelevance");
    }

    // Weighted average across available signals (equal weight)
    const values = Object.values(components).filter(
      (v): v is number => v !== undefined,
    );
    const avg =
      values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const total = Math.round(avg * 100);

    return { total, components, availableSignals };
  }

  async createMarketOpportunity(
    keywordId: string,
  ): Promise<{ id: string } | null> {
    const result = await this.scoreKeyword(keywordId);
    if (result.total < MIN_SCORE_FOR_OPPORTUNITY) return null;

    const keyword = await this.prisma.keyword.findUniqueOrThrow({
      where: { id: keywordId },
    });

    // Determine recommended action from signals
    let recommendedAction = "RESEARCH_DEEPER";
    if (
      result.components.contentGap === 1.0 &&
      (result.components.searchDemand ?? 0) > 0.3
    ) {
      recommendedAction = "CREATE_BLOG";
    } else if (
      result.components.contentGap !== 1.0 &&
      (result.components.searchConsoleOpportunity ?? 0) >= 0.6
    ) {
      recommendedAction = "UPDATE_BLOG";
    } else if ((result.components.commercialIntent ?? 0) >= 0.85) {
      recommendedAction = "OPTIMIZE_PRODUCT_PAGE";
    } else if ((result.components.trendMomentum ?? 0) >= 0.7) {
      recommendedAction = "CREATE_SOCIAL";
    } else if ((result.components.onsiteDemand ?? 0) > 0) {
      recommendedAction = "CREATE_FAQ";
    }

    // Determine source
    const source =
      result.availableSignals.length >= 4
        ? "MULTI_SIGNAL"
        : result.availableSignals.includes("trendMomentum")
          ? "TREND"
          : result.availableSignals.includes("searchConsoleOpportunity")
            ? "SEARCH"
            : result.availableSignals.includes("communityDiscussion")
              ? "COMMUNITY"
              : "SEARCH";

    const explanation = buildExplanation(keyword.keyword, result);

    const existing = await this.prisma.marketOpportunity.findFirst({
      where: {
        brandId: BRAND_ID,
        topic: keyword.keyword,
        status: { in: ["NEW", "ACTIONED"] },
      },
    });

    if (existing) {
      await this.prisma.marketOpportunity.update({
        where: { id: existing.id },
        data: {
          score: result.total,
          componentScores: result.components as any,
          explanation,
          recommendedAction,
          confidence: result.availableSignals.length / 9,
          updatedAt: new Date(),
        },
      });
      return { id: existing.id };
    }

    const opp = await this.prisma.marketOpportunity.create({
      data: {
        brandId: BRAND_ID,
        topic: keyword.keyword,
        source,
        recommendedAction,
        score: result.total,
        componentScores: result.components as any,
        explanation,
        evidenceRefs: [],
        relatedKeywords: [keyword.keyword],
        relatedProductIds: [],
        relatedContentIds: [],
        confidence: result.availableSignals.length / 9,
        status: "NEW",
      },
    });

    return { id: opp.id };
  }

  async runScoringPass(): Promise<number> {
    const keywords = await this.prisma.keyword.findMany({
      where: { brandId: BRAND_ID, active: true },
      select: { id: true },
    });

    let created = 0;
    for (const kw of keywords) {
      const result = await this.createMarketOpportunity(kw.id);
      if (result) created++;
    }

    this.logger.log(`Scoring pass: ${created} opportunities created/updated`);
    return created;
  }
}

function buildExplanation(
  keyword: string,
  result: OpportunityScoreResult,
): string {
  const parts: string[] = [`Topic: "${keyword}" — score ${result.total}/100.`];
  const c = result.components;

  if (c.brandRelevance != null)
    parts.push(`Brand relevance: ${(c.brandRelevance * 100).toFixed(0)}%`);
  if (c.searchDemand != null)
    parts.push(
      `Search demand: ${(c.searchDemand * 100).toFixed(0)}% of benchmark`,
    );
  if (c.trendMomentum != null)
    parts.push(`Trend momentum: ${(c.trendMomentum * 100).toFixed(0)}%`);
  if (c.searchConsoleOpportunity != null)
    parts.push(`Search Console opportunity detected`);
  if (c.onsiteDemand != null) parts.push(`Onsite search demand present`);
  if (c.communityDiscussion != null)
    parts.push(`Community discussion signal present`);
  if (c.contentGap === 1.0) parts.push(`No existing content covers this topic`);

  return parts.join(". ");
}
