import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import type { ScoredFinding } from "./research-scoring.service";
import type { OpportunityType, OpportunityStatus } from "@ai-cmo/contracts";

const MIN_RELEVANCE_FOR_OPPORTUNITY = 0.35;

@Injectable()
export class OpportunityService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromFinding(
    brandId: string,
    findingId: string,
    scored: ScoredFinding,
  ): Promise<string | null> {
    if (scored.relevanceScore < MIN_RELEVANCE_FOR_OPPORTUNITY) return null;

    const type = classifyOpportunity(scored);
    const title = deriveTitle(scored);
    const summary = deriveSummary(scored);
    const reason = deriveReason(scored, type);

    const opportunity = await this.prisma.opportunity.create({
      data: {
        brandId,
        findingId,
        type,
        title,
        summary,
        reason,
        relevanceScore: scored.relevanceScore,
        urgencyScore: scored.urgencyScore,
        confidence: Math.min(
          1,
          (scored.relevanceScore + scored.urgencyScore) / 2,
        ),
        evidenceRefs: [findingId],
      },
    });

    return opportunity.id;
  }

  async list(
    brandId: string,
    filters?: {
      type?: OpportunityType;
      status?: OpportunityStatus;
      minRelevance?: number;
    },
  ) {
    return this.prisma.opportunity.findMany({
      where: {
        brandId,
        ...(filters?.type && { type: filters.type }),
        ...(filters?.status && { status: filters.status }),
        ...(filters?.minRelevance !== undefined && {
          relevanceScore: { gte: filters.minRelevance },
        }),
      },
      orderBy: [{ urgencyScore: "desc" }, { relevanceScore: "desc" }],
      take: 50,
    });
  }

  async getById(id: string) {
    return this.prisma.opportunity.findUniqueOrThrow({ where: { id } });
  }

  async updateStatus(id: string, status: OpportunityStatus) {
    return this.prisma.opportunity.update({
      where: { id },
      data: { status },
    });
  }

  async getTopForContext(brandId: string, limit = 5) {
    return this.prisma.opportunity.findMany({
      where: { brandId, status: "NEW" },
      orderBy: [{ urgencyScore: "desc" }, { relevanceScore: "desc" }],
      take: limit,
    });
  }
}

function classifyOpportunity(scored: ScoredFinding): OpportunityType {
  const text = `${scored.title} ${scored.excerpt}`.toLowerCase();

  if (scored.sourceType === "COMPETITOR") return "COMPETITOR_ACTIVITY";

  if (
    text.includes("question") ||
    text.includes("how to") ||
    text.includes("help") ||
    text.includes("advice") ||
    text.includes("what is") ||
    scored.excerpt.includes("?")
  ) {
    return "CUSTOMER_QUESTION";
  }

  if (
    scored.urgencyScore > 0.7 &&
    (text.includes("trend") ||
      text.includes("viral") ||
      text.includes("popular") ||
      text.includes("everyone"))
  ) {
    return "TREND";
  }

  if (
    text.includes("review") ||
    text.includes("product") ||
    text.includes("ingredient") ||
    text.includes("formula")
  ) {
    return "PRODUCT_INSIGHT";
  }

  if (scored.sourceType === "SUBREDDIT" || scored.sourceType === "FORUM") {
    return "ENGAGEMENT";
  }

  return "CONTENT_IDEA";
}

function deriveTitle(scored: ScoredFinding): string {
  return scored.title.slice(0, 120);
}

function deriveSummary(scored: ScoredFinding): string {
  return scored.excerpt.slice(0, 300);
}

function deriveReason(scored: ScoredFinding, type: OpportunityType): string {
  const source = scored.sourceType.toLowerCase().replace("_", " ");
  const score = Math.round(scored.relevanceScore * 100);

  const typeReasons: Record<OpportunityType, string> = {
    CONTENT_IDEA: `Relevant ${source} content with ${score}% brand alignment — potential content angle.`,
    ENGAGEMENT: `Active ${source} discussion relevant to brand niche — worth monitoring or joining.`,
    TREND: `Fresh ${source} signal with high urgency score — trending topic in niche.`,
    COMPETITOR_ACTIVITY: `Competitor or industry source with ${score}% relevance — track for positioning.`,
    CUSTOMER_QUESTION: `Customer question pattern detected on ${source} — addresses known pain point.`,
    PRODUCT_INSIGHT: `Product or ingredient discussion on ${source} — relevant to portfolio.`,
  };

  return typeReasons[type];
}
