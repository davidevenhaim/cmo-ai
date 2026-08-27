import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BraveSearchAdapter } from "./brave-search.adapter";
import { SearxngSearchAdapter } from "./searxng-search.adapter";
import { FirecrawlAdapter } from "./firecrawl.adapter";
import { BrowserCrawlAdapter } from "./browser-crawl.adapter";
import { Crawl4aiAdapter } from "./crawl4ai.adapter";
import { FallbackCrawlProvider } from "./fallback-crawl.provider";
import type { SearchProvider } from "./search.provider";
import type { CrawlProvider } from "./crawl.provider";

export const SEARCH_PROVIDER = "SEARCH_PROVIDER";
export const CRAWL_PROVIDER = "CRAWL_PROVIDER";

export const searchProviderFactory: Provider = {
  provide: SEARCH_PROVIDER,
  inject: [ConfigService, SearxngSearchAdapter, BraveSearchAdapter],
  useFactory: (
    config: ConfigService,
    searxng: SearxngSearchAdapter,
    brave: BraveSearchAdapter,
  ): SearchProvider => {
    const choice = (config.get<string>("SEARCH_PROVIDER") ?? "searxng")
      .trim()
      .toLowerCase();
    if (choice === "brave") return brave;
    return searxng;
  },
};

/**
 * CRAWL_PROVIDER:
 * - crawl4ai (default) → Crawl4AI then Browserless fallback
 * - browser → Browserless only
 * - firecrawl → Firecrawl only (optional cloud)
 * - chain → explicit Crawl4AI → browser → firecrawl (whichever configured)
 */
export const crawlProviderFactory: Provider = {
  provide: CRAWL_PROVIDER,
  inject: [
    ConfigService,
    Crawl4aiAdapter,
    BrowserCrawlAdapter,
    FirecrawlAdapter,
  ],
  useFactory: (
    config: ConfigService,
    crawl4ai: Crawl4aiAdapter,
    browser: BrowserCrawlAdapter,
    firecrawl: FirecrawlAdapter,
  ): CrawlProvider => {
    const choice = (config.get<string>("CRAWL_PROVIDER") ?? "crawl4ai")
      .trim()
      .toLowerCase();

    if (choice === "browser") return browser;
    if (choice === "firecrawl") return firecrawl;
    if (choice === "crawl4ai-only") return crawl4ai;

    // Default crawl4ai + browser fallback; "chain" includes firecrawl if configured.
    const chain: CrawlProvider[] =
      choice === "chain" ? [crawl4ai, browser, firecrawl] : [crawl4ai, browser];

    return new FallbackCrawlProvider(chain);
  },
};
