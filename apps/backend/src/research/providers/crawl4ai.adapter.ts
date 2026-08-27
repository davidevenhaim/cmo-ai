import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type { CrawlProvider, ExtractResult } from "./crawl.provider";
import { assertSafeUrl } from "./browser-crawl.adapter";

const MAX_CONTENT_CHARS = 2000;

/**
 * Crawl4AI self-hosted extraction. Nest owns the call; results still go through
 * normalize → sanitize → persist as UNTRUSTED evidence.
 */
@Injectable()
export class Crawl4aiAdapter implements CrawlProvider {
  readonly name = "crawl4ai";
  private readonly logger = new Logger(Crawl4aiAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return !!this.baseUrl;
  }

  private get baseUrl(): string {
    return (this.config.get<string>("CRAWL4AI_BASE_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  async extract(url: string): Promise<ExtractResult> {
    if (!this.configured) {
      throw new Error("Crawl4AI not configured (CRAWL4AI_BASE_URL)");
    }
    assertSafeUrl(url);

    const timeout = parseInt(
      this.config.get("RESEARCH_REQUEST_TIMEOUT_MS") ?? "30000",
      10,
    );

    try {
      // Prefer /md (markdown) endpoint; fall back to /crawl job shape.
      const md = await this.tryMarkdown(url, timeout);
      if (md) return md;
      return await this.tryCrawl(url, timeout);
    } catch (err: any) {
      this.logger.warn(`Crawl4AI failed for ${url}: ${err.message}`);
      throw new Error(`Crawl4AI failed: ${err.message}`);
    }
  }

  private async tryMarkdown(
    url: string,
    timeout: number,
  ): Promise<ExtractResult | null> {
    try {
      const response = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/md`,
          { url, f: "fit" },
          { timeout, headers: { "Content-Type": "application/json" } },
        ),
      );
      const data = response.data ?? {};
      const content = String(
        data.markdown ?? data.md ?? data.content ?? "",
      ).slice(0, MAX_CONTENT_CHARS);
      if (!content.trim()) return null;
      return {
        url: String(data.url ?? url),
        title: String(data.title ?? url),
        content,
        metadata: {
          description: content.slice(0, 300),
        },
      };
    } catch {
      return null;
    }
  }

  private async tryCrawl(url: string, timeout: number): Promise<ExtractResult> {
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/crawl`,
        {
          urls: [url],
          crawler_config: {
            type: "CrawlerRunConfig",
            params: {
              word_count_threshold: 10,
              excluded_tags: ["script", "style", "nav", "footer"],
            },
          },
        },
        { timeout, headers: { "Content-Type": "application/json" } },
      ),
    );

    const data = response.data ?? {};
    const results = data.results ?? data.result ?? [];
    const first = Array.isArray(results) ? results[0] : results;
    if (!first) {
      throw new Error("Crawl4AI returned no results");
    }

    const content = String(
      first.markdown?.fit_markdown ??
        first.markdown?.raw_markdown ??
        first.markdown ??
        first.cleaned_html ??
        first.content ??
        "",
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTENT_CHARS);

    if (!content) {
      throw new Error(`Crawl4AI returned empty content for ${url}`);
    }

    return {
      url: String(first.url ?? url),
      title: String(first.metadata?.title ?? first.title ?? url),
      content,
      metadata: {
        description: content.slice(0, 300),
        publishedAt: first.metadata?.published_date
          ? new Date(first.metadata.published_date)
          : undefined,
      },
    };
  }
}
