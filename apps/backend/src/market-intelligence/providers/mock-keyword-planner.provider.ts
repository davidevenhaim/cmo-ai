import { Injectable } from "@nestjs/common";
import type {
  KeywordPlannerProvider,
  KeywordIdeaResult,
} from "./keyword-planner.provider";

const FIXTURE_KEYWORDS: KeywordIdeaResult[] = [
  {
    keyword: "tallow moisturizer",
    avgMonthlySearches: 8100,
    competition: "LOW",
    competitionIndex: 12,
    lowTopOfPageBidMicros: 450000,
    highTopOfPageBidMicros: 1200000,
  },
  {
    keyword: "tallow balm",
    avgMonthlySearches: 6600,
    competition: "LOW",
    competitionIndex: 18,
    lowTopOfPageBidMicros: 380000,
    highTopOfPageBidMicros: 980000,
  },
  {
    keyword: "beef tallow skincare",
    avgMonthlySearches: 4400,
    competition: "LOW",
    competitionIndex: 9,
    lowTopOfPageBidMicros: 320000,
    highTopOfPageBidMicros: 870000,
  },
  {
    keyword: "grass fed tallow cream",
    avgMonthlySearches: 2900,
    competition: "LOW",
    competitionIndex: 14,
    lowTopOfPageBidMicros: 410000,
    highTopOfPageBidMicros: 1100000,
  },
  {
    keyword: "whipped tallow balm",
    avgMonthlySearches: 2400,
    competition: "LOW",
    competitionIndex: 11,
    lowTopOfPageBidMicros: 290000,
    highTopOfPageBidMicros: 760000,
  },
  {
    keyword: "natural face moisturizer",
    avgMonthlySearches: 22200,
    competition: "HIGH",
    competitionIndex: 78,
    lowTopOfPageBidMicros: 1200000,
    highTopOfPageBidMicros: 4500000,
  },
  {
    keyword: "clean beauty moisturizer",
    avgMonthlySearches: 12100,
    competition: "HIGH",
    competitionIndex: 82,
    lowTopOfPageBidMicros: 1400000,
    highTopOfPageBidMicros: 5200000,
  },
  {
    keyword: "ancestral skincare",
    avgMonthlySearches: 1600,
    competition: "LOW",
    competitionIndex: 6,
    lowTopOfPageBidMicros: 180000,
    highTopOfPageBidMicros: 520000,
  },
  {
    keyword: "tallow vs shea butter",
    avgMonthlySearches: 1300,
    competition: "LOW",
    competitionIndex: 8,
    lowTopOfPageBidMicros: 150000,
    highTopOfPageBidMicros: 440000,
  },
  {
    keyword: "non toxic face cream",
    avgMonthlySearches: 9900,
    competition: "MEDIUM",
    competitionIndex: 54,
    lowTopOfPageBidMicros: 880000,
    highTopOfPageBidMicros: 2800000,
  },
  {
    keyword: "best tallow skincare brand",
    avgMonthlySearches: 880,
    competition: "LOW",
    competitionIndex: 5,
    lowTopOfPageBidMicros: 200000,
    highTopOfPageBidMicros: 580000,
  },
  {
    keyword: "tallow skin benefits",
    avgMonthlySearches: 2100,
    competition: "LOW",
    competitionIndex: 10,
    lowTopOfPageBidMicros: 120000,
    highTopOfPageBidMicros: 390000,
  },
  {
    keyword: "is beef tallow good for skin",
    avgMonthlySearches: 1900,
    competition: "LOW",
    competitionIndex: 7,
    lowTopOfPageBidMicros: 100000,
    highTopOfPageBidMicros: 310000,
  },
  {
    keyword: "tallow body butter",
    avgMonthlySearches: 3600,
    competition: "LOW",
    competitionIndex: 16,
    lowTopOfPageBidMicros: 340000,
    highTopOfPageBidMicros: 920000,
  },
  {
    keyword: "natural body butter no chemicals",
    avgMonthlySearches: 1400,
    competition: "MEDIUM",
    competitionIndex: 42,
    lowTopOfPageBidMicros: 620000,
    highTopOfPageBidMicros: 1800000,
  },
];

@Injectable()
export class MockKeywordPlannerProvider implements KeywordPlannerProvider {
  readonly providerName = "mock-keyword-planner";

  isConfigured(): boolean {
    return false;
  }

  async getKeywordIdeas(params: {
    seeds: string[];
    urlSeeds?: string[];
    language?: string;
    geo?: string;
    limit?: number;
  }): Promise<KeywordIdeaResult[]> {
    const limit = params.limit ?? 50;
    return FIXTURE_KEYWORDS.slice(0, limit);
  }
}
