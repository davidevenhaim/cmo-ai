import { Injectable } from "@nestjs/common";

export interface ResearchQuery {
  query: string;
  intent:
    | "TREND"
    | "COMPETITOR_ACTIVITY"
    | "CUSTOMER_QUESTION"
    | "PRODUCT_INSIGHT"
    | "ENGAGEMENT";
  freshness?: "day" | "week" | "month";
}

export interface ResearchPlan {
  queries: ResearchQuery[];
  sourceUrls: string[]; // tracked URLs to crawl directly
}

interface PlanInput {
  brandName: string;
  category: string | null;
  audience: string | null;
  productNames: string[];
  topics: string[]; // from brand facts/guidelines
  competitorUrls: string[]; // from ResearchSource COMPETITOR rows
}

@Injectable()
export class ResearchPlanService {
  buildPlan(input: PlanInput): ResearchPlan {
    const cat = input.category ?? "skincare";
    const audience = input.audience ?? "skincare enthusiasts";
    const brand = input.brandName;
    const queries: ResearchQuery[] = [];

    // Trend queries
    queries.push({
      query: `${cat} trends ${new Date().getFullYear()}`,
      intent: "TREND",
      freshness: "month",
    });
    queries.push({
      query: `${cat} community discussions Reddit`,
      intent: "ENGAGEMENT",
      freshness: "week",
    });

    // Audience pain points and questions
    queries.push({
      query: `${audience} skincare questions forum`,
      intent: "CUSTOMER_QUESTION",
      freshness: "month",
    });
    queries.push({
      query: `${cat} routine advice questions`,
      intent: "CUSTOMER_QUESTION",
      freshness: "month",
    });

    // Product-specific insight
    for (const product of input.productNames.slice(0, 2)) {
      queries.push({
        query: `${product} alternatives review`,
        intent: "PRODUCT_INSIGHT",
        freshness: "month",
      });
    }

    // Competitor activity
    if (brand) {
      queries.push({
        query: `${cat} brand comparison ${new Date().getFullYear()}`,
        intent: "COMPETITOR_ACTIVITY",
        freshness: "month",
      });
    }

    // Topic-specific queries from brand knowledge
    for (const topic of input.topics.slice(0, 2)) {
      queries.push({
        query: `${topic} discussion`,
        intent: "ENGAGEMENT",
        freshness: "month",
      });
    }

    return {
      queries,
      sourceUrls: input.competitorUrls.slice(0, 5),
    };
  }

  buildPlanFromBrandContext(context: {
    brand: {
      name: string;
      description?: string | null;
      audience?: string | null;
    };
    products: Array<{ name: string; category?: string | null }>;
    facts: Array<{ category: string; content: string }>;
    competitorUrls?: string[];
  }): ResearchPlan {
    const categories = context.products
      .map((p) => p.category)
      .filter(Boolean) as string[];
    const primaryCategory = categories[0] ?? null;
    const productNames = context.products.map((p) => p.name);

    // Extract interesting topics from facts
    const topics = context.facts
      .filter(
        (f) =>
          f.category === "differentiator" ||
          f.category === "ingredient-philosophy" ||
          f.category === "mission",
      )
      .map((f) => {
        const words = f.content.split(" ").slice(0, 4).join(" ");
        return words;
      })
      .slice(0, 3);

    return this.buildPlan({
      brandName: context.brand.name,
      category: primaryCategory,
      audience: context.brand.audience ?? null,
      productNames,
      topics,
      competitorUrls: context.competitorUrls ?? [],
    });
  }
}
