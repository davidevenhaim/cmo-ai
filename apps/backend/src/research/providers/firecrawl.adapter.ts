import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type { CrawlProvider, ExtractResult } from "./crawl.provider";

@Injectable()
export class FirecrawlAdapter implements CrawlProvider {
  readonly name = "firecrawl";
  private readonly logger = new Logger(FirecrawlAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return !!this.config.get<string>("FIRECRAWL_API_KEY");
  }

  async extract(url: string): Promise<ExtractResult> {
    const apiKey = this.config.get<string>("FIRECRAWL_API_KEY");
    if (!apiKey) {
      throw new Error("Firecrawl not configured");
    }

    const timeout = parseInt(
      this.config.get("RESEARCH_REQUEST_TIMEOUT_MS") ?? "15000",
    );

    const response = await firstValueFrom(
      this.http.post<FirecrawlScrapeResponse>(
        "https://api.firecrawl.dev/v1/scrape",
        {
          url,
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: Math.floor(timeout / 1000),
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout,
        },
      ),
    );

    if (!response.data.success) {
      throw new Error(`Firecrawl extraction failed for ${url}`);
    }

    const { data } = response.data;
    const rawContent = data?.markdown ?? data?.content ?? "";
    // Truncate to avoid storing/sending full pages — keep first 2000 chars
    const content = rawContent.slice(0, 2000);

    return {
      url,
      title: data?.metadata?.title ?? extractTitleFromContent(content) ?? url,
      content,
      metadata: {
        publishedAt: data?.metadata?.publishedTime
          ? new Date(data.metadata.publishedTime)
          : undefined,
        author: data?.metadata?.author,
        description: data?.metadata?.description?.slice(0, 300),
      },
    };
  }
}

function extractTitleFromContent(content: string): string | null {
  const match = content.match(/^#\s+(.+)/m);
  return match?.[1] ?? null;
}

interface FirecrawlScrapeData {
  markdown?: string;
  content?: string;
  metadata?: {
    title?: string;
    description?: string;
    publishedTime?: string;
    author?: string;
  };
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: FirecrawlScrapeData;
}
