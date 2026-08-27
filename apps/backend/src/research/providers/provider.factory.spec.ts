import { ConfigService } from "@nestjs/config";
import type { FactoryProvider } from "@nestjs/common";
import {
  crawlProviderFactory,
  searchProviderFactory,
} from "./provider.factory";

describe("research provider factories", () => {
  const searchFactory = (searchProviderFactory as FactoryProvider)
    .useFactory as Function;
  const crawlFactory = (crawlProviderFactory as FactoryProvider)
    .useFactory as Function;

  it("defaults search to searxng", () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    expect(
      searchFactory(config, { name: "searxng" }, { name: "brave" }).name,
    ).toBe("searxng");
  });

  it("defaults crawl to crawl4ai fallback chain", () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const result = crawlFactory(
      config,
      { name: "crawl4ai", configured: true },
      { name: "browser", configured: true },
      { name: "firecrawl", configured: false },
    );
    expect(result.name).toBe("fallback");
  });

  it("selects browser only when CRAWL_PROVIDER=browser", () => {
    const config = {
      get: (k: string) => (k === "CRAWL_PROVIDER" ? "browser" : undefined),
    } as unknown as ConfigService;
    const result = crawlFactory(
      config,
      { name: "crawl4ai" },
      { name: "browser" },
      { name: "firecrawl" },
    );
    expect(result.name).toBe("browser");
  });
});
