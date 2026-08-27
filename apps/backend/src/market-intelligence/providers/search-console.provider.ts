// Interface — real impl needs GOOGLE_SEARCH_CONSOLE_SITE_URL + Google service account JSON
// Config: GOOGLE_SEARCH_CONSOLE_SITE_URL, GOOGLE_SERVICE_ACCOUNT_JSON (base64 encoded JSON)
// Setup: Create service account in Google Cloud, add it to Search Console with Read-only access,
//        encode the service account JSON as base64 and set GOOGLE_SERVICE_ACCOUNT_JSON

export interface SearchConsoleRow {
  query: string;
  page?: string;
  country?: string;
  device?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date?: string;
}

export interface SearchConsoleReport {
  rows: SearchConsoleRow[];
  period: string; // YYYY-MM-DD to YYYY-MM-DD
  dataDelay: number; // days — Search Console data is typically 2-4 days delayed
  // MOCK = fixture data from a mock provider — must never be treated as live
  evidenceStatus: "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE" | "MOCK";
}

export interface SearchConsoleProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  getQueryReport(params: {
    siteUrl: string;
    startDate: string; // YYYY-MM-DD
    endDate: string;
    dimensions?: string[];
    rowLimit?: number;
  }): Promise<SearchConsoleReport>;
}
