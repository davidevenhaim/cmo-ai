export interface ExtractResult {
  url: string;
  title: string;
  content: string; // raw extracted text (sanitized, not full HTML)
  metadata?: {
    publishedAt?: Date;
    author?: string;
    description?: string;
  };
}

export interface CrawlProvider {
  readonly name: string;
  readonly configured: boolean;
  extract(url: string): Promise<ExtractResult>;
}
