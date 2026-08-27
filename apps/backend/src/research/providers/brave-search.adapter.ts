import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type {
  SearchProvider,
  SearchResult,
  SearchOptions,
} from "./search.provider";

@Injectable()
export class BraveSearchAdapter implements SearchProvider {
  readonly name = "brave";
  private readonly logger = new Logger(BraveSearchAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return !!this.config.get<string>("BRAVE_SEARCH_API_KEY");
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = this.config.get<string>("BRAVE_SEARCH_API_KEY");
    if (!apiKey) {
      this.logger.warn("Brave Search not configured — skipping");
      return [];
    }

    const count = Math.min(opts?.maxResults ?? 10, 20);
    const params: Record<string, string> = {
      q: query,
      count: String(count),
      text_decorations: "0",
      search_lang: "en",
    };
    if (opts?.freshness) {
      params["freshness"] =
        opts.freshness === "day"
          ? "pd"
          : opts.freshness === "week"
            ? "pw"
            : "pm";
    }

    const response = await firstValueFrom(
      this.http.get<BraveSearchResponse>(
        "https://api.search.brave.com/res/v1/web/search",
        {
          params,
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
          },
          timeout: parseInt(
            this.config.get("RESEARCH_REQUEST_TIMEOUT_MS") ?? "10000",
          ),
        },
      ),
    );

    const results = response.data?.web?.results ?? [];
    return results.map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.description ?? "",
      publishedAt: r.page_age ? new Date(r.page_age) : undefined,
      sourceType: detectSourceType(r.url),
      metadata: { age: r.page_age, extra_snippets: r.extra_snippets },
    }));
  }
}

function detectSourceType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("reddit.com")) return "SUBREDDIT";
  if (lower.includes("forum") || lower.includes("discuss")) return "FORUM";
  if (lower.includes("medium.com") || lower.includes("substack.com"))
    return "BLOG";
  return "GENERIC";
}

interface BraveWebResult {
  url: string;
  title: string;
  description?: string;
  page_age?: string;
  extra_snippets?: string[];
}

interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
}
