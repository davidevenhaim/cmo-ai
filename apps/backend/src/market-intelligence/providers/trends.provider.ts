// Interface — real impl via pytrends Python library or SerpAPI Google Trends endpoint
// Setup options:
//   A) SerpAPI: Set SERPAPI_KEY — provides structured JSON from Google Trends
//   B) Direct: Google Trends has no official API; pytrends is unofficial and rate-limited
// Recommendation: Use SerpAPI (SERPAPI_KEY) for reliable access.

export interface TrendDataPoint {
  period: string; // YYYY-MM-DD or YYYY-MM
  value: number; // 0–100 relative interest (NOT absolute volume)
}

export interface TrendResult {
  keyword: string;
  timeframe: string;
  data: TrendDataPoint[];
  isRising: boolean;
  isBreakout: boolean; // value reached 100 recently
  averageValue: number;
  peakValue: number;
  recentDelta: number; // recent period vs prior period
  relatedTopics: string[];
  relatedQueries: string[];
  geo: string; // country code or "" for worldwide
  // MOCK = fixture data from a mock provider — must never be treated as live
  evidenceStatus: "AVAILABLE" | "UNAVAILABLE" | "MOCK";
  note: string; // "Values are relative (0–100), not absolute search volume"
}

export interface TrendsProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  getTrend(
    keyword: string,
    geo?: string,
    months?: number,
  ): Promise<TrendResult>;
  getRelatedQueries(keyword: string, geo?: string): Promise<string[]>;
}
