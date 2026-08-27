import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { SearxngSearchAdapter } from "./searxng-search.adapter";

describe("SearxngSearchAdapter", () => {
  let adapter: SearxngSearchAdapter;
  const mockHttp = { get: jest.fn() };
  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        SEARXNG_BASE_URL: "http://searxng:8080",
        RESEARCH_REQUEST_TIMEOUT_MS: "5000",
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearxngSearchAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    adapter = module.get(SearxngSearchAdapter);
  });

  it("is configured when SEARXNG_BASE_URL is set", () => {
    expect(adapter.configured).toBe(true);
    expect(adapter.name).toBe("searxng");
  });

  it("normalizes search results", async () => {
    mockHttp.get.mockReturnValue(
      of({
        data: {
          results: [
            {
              url: "https://reddit.com/r/SkincareAddiction/1",
              title: "Ceramide help",
              content: "Looking for barrier repair",
              engine: "duckduckgo",
            },
          ],
        },
      }),
    );
    const results = await adapter.search("ceramide", { maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].sourceType).toBe("SUBREDDIT");
    expect(results[0].title).toBe("Ceramide help");
  });

  it("returns empty array for empty results", async () => {
    mockHttp.get.mockReturnValue(of({ data: { results: [] } }));
    expect(await adapter.search("nothing")).toEqual([]);
  });

  it("throws on timeout / provider failure", async () => {
    mockHttp.get.mockReturnValue(throwError(() => new Error("timeout")));
    await expect(adapter.search("x")).rejects.toThrow(/SearXNG unavailable/);
  });

  it("handles malformed response without inventing evidence", async () => {
    mockHttp.get.mockReturnValue(of({ data: {} }));
    expect(await adapter.search("x")).toEqual([]);
  });
});
