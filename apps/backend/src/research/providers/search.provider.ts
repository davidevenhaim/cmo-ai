export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: Date;
  sourceType?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  maxResults?: number;
  freshness?: "day" | "week" | "month";
}

export interface SearchProvider {
  readonly name: string;
  readonly configured: boolean;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
