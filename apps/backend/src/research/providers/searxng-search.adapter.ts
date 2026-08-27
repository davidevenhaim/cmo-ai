import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type {
  SearchProvider,
  SearchResult,
  SearchOptions,
} from "./search.provider";

/**
 * Self-hosted SearXNG search adapter. Nest owns the call — the brain never
 * queries SearXNG directly. Results are normalized into the research domain.
 */
@Injectable()
export class SearxngSearchAdapter implements SearchProvider {
  readonly name = "searxng";
  private readonly logger = new Logger(SearxngSearchAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return !!this.baseUrl;
  }

  private get baseUrl(): string {
    return (this.config.get<string>("SEARXNG_BASE_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (!this.configured) {
      this.logger.warn("SearXNG not configured — skipping");
      return [];
    }

    const count = Math.min(opts?.maxResults ?? 10, 20);
    const params: Record<string, string> = {
      q: query,
      format: "json",
      language: "en",
    };
    if (opts?.freshness === "day") params["time_range"] = "day";
    else if (opts?.freshness === "week") params["time_range"] = "week";
    else if (opts?.freshness === "month") params["time_range"] = "month";

    const timeout = parseInt(
      this.config.get("RESEARCH_REQUEST_TIMEOUT_MS") ?? "10000",
    );

    try {
      const response = await firstValueFrom(
        this.http.get<SearxngResponse>(`${this.baseUrl}/search`, {
          params,
          timeout,
          headers: { Accept: "application/json" },
        }),
      );
      const results = response.data?.results ?? [];
      return results.slice(0, count).map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.content ?? r.description ?? "",
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
        sourceType: detectSourceType(r.url),
        metadata: {
          engine: r.engine,
          engines: r.engines,
          score: r.score,
        },
      }));
    } catch (err: any) {
      this.logger.warn(`SearXNG search failed: ${err.message}`);
      throw new Error(`SearXNG unavailable: ${err.message}`);
    }
  }
}

function detectSourceType(url: string): string {
  const lower = (url ?? "").toLowerCase();
  if (lower.includes("reddit.com")) return "SUBREDDIT";
  if (lower.includes("forum") || lower.includes("discuss")) return "FORUM";
  if (lower.includes("medium.com") || lower.includes("substack.com"))
    return "BLOG";
  return "GENERIC";
}

interface SearxngResult {
  url: string;
  title?: string;
  content?: string;
  description?: string;
  publishedDate?: string;
  engine?: string;
  engines?: string[];
  score?: number;
}

interface SearxngResponse {
  results?: SearxngResult[];
}
