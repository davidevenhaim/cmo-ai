// Interface — real impl via Google Ads API
// Setup: Google Ads developer token + OAuth2 credentials + customer ID
// Config: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//         GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID
// Read-only: keyword ideas only, NO campaign creation

export interface KeywordIdeaResult {
  keyword: string;
  avgMonthlySearches?: number; // null when not enough data
  monthlySearchVolumes?: {
    year: number;
    month: number;
    monthlySearches: number;
  }[];
  competition: "LOW" | "MEDIUM" | "HIGH" | "UNSPECIFIED";
  competitionIndex?: number; // 0–100
  lowTopOfPageBidMicros?: number; // in micros (divide by 1e6 for USD)
  highTopOfPageBidMicros?: number;
}

export interface KeywordPlannerProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  getKeywordIdeas(params: {
    seeds: string[];
    urlSeeds?: string[];
    language?: string;
    geo?: string;
    limit?: number;
  }): Promise<KeywordIdeaResult[]>;
}
