import { Injectable } from "@nestjs/common";
import type { NormalizedFinding } from "./research-normalizer.service";

export interface ScoredFinding extends NormalizedFinding {
  relevanceScore: number;
  urgencyScore: number;
}

interface BrandSignals {
  brandName: string;
  productNames: string[];
  categoryKeywords: string[];
  audienceKeywords: string[];
}

const SOURCE_WEIGHT: Record<string, number> = {
  COMPETITOR: 0.25,
  PUBLICATION: 0.2,
  BLOG: 0.15,
  SUBREDDIT: 0.15,
  FORUM: 0.15,
  WEBSITE: 0.1,
  GENERIC: 0.05,
};

const MS_PER_DAY = 86_400_000;

@Injectable()
export class ResearchScoringService {
  score(finding: NormalizedFinding, signals: BrandSignals): ScoredFinding {
    const text = `${finding.title} ${finding.excerpt}`.toLowerCase();

    // Keyword relevance (0–0.6)
    let relevance = 0;
    if (signals.brandName && text.includes(signals.brandName.toLowerCase()))
      relevance += 0.15;
    for (const name of signals.productNames) {
      if (text.includes(name.toLowerCase())) {
        relevance += 0.15;
        break;
      }
    }
    for (const kw of signals.categoryKeywords) {
      if (text.includes(kw.toLowerCase())) {
        relevance += 0.1;
        break;
      }
    }
    for (const kw of signals.audienceKeywords) {
      if (text.includes(kw.toLowerCase())) {
        relevance += 0.1;
        break;
      }
    }

    // Source weight bonus (0–0.25)
    relevance += SOURCE_WEIGHT[finding.sourceType] ?? 0.05;

    // Excerpt quality bonus (0–0.15)
    if (finding.excerpt.length > 100) relevance += 0.05;
    if (finding.title.length > 20) relevance += 0.05;
    if (finding.excerpt.includes("?")) relevance += 0.05; // likely a question

    const relevanceScore = Math.min(1, relevance);

    // Urgency: freshness-based (0–1)
    const urgencyScore = computeUrgency(finding.publishedAt);

    return { ...finding, relevanceScore, urgencyScore };
  }

  buildSignals(context: {
    brand: { name: string; audience?: string | null };
    products: Array<{ name: string; category?: string | null }>;
    facts: Array<{ category: string; content: string }>;
  }): BrandSignals {
    const categoryKeywords = [
      ...new Set(
        context.products.map((p) => p.category).filter(Boolean) as string[],
      ),
      "skincare",
      "beauty",
    ];
    const audienceKeywords = context.brand.audience
      ? context.brand.audience
          .toLowerCase()
          .split(/[\s,]+/)
          .filter((w) => w.length > 3)
      : ["skin", "skincare", "routine"];

    return {
      brandName: context.brand.name,
      productNames: context.products.map((p) => p.name),
      categoryKeywords,
      audienceKeywords,
    };
  }
}

function computeUrgency(publishedAt: Date | null): number {
  if (!publishedAt) return 0.3; // unknown age → medium urgency
  const ageDays = (Date.now() - publishedAt.getTime()) / MS_PER_DAY;
  if (ageDays < 1) return 1.0;
  if (ageDays < 3) return 0.85;
  if (ageDays < 7) return 0.7;
  if (ageDays < 14) return 0.5;
  if (ageDays < 30) return 0.3;
  return 0.1;
}
