import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { BraveSearchAdapter } from "./brave-search.adapter";
import { of, throwError } from "rxjs";

const mockHttp = { get: jest.fn() };
const mockConfig = { get: jest.fn() };

const makeBraveResponse = (results: any[]) => ({
  data: { web: { results } },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

describe("BraveSearchAdapter", () => {
  let adapter: BraveSearchAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BraveSearchAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    adapter = module.get<BraveSearchAdapter>(BraveSearchAdapter);
    jest.clearAllMocks();
  });

  describe("configured", () => {
    it("returns true when API key present", () => {
      mockConfig.get.mockReturnValue("brave-key-abc");
      expect(adapter.configured).toBe(true);
    });

    it("returns false when API key absent", () => {
      mockConfig.get.mockReturnValue(undefined);
      expect(adapter.configured).toBe(false);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === "BRAVE_SEARCH_API_KEY") return "test-key";
        if (key === "RESEARCH_REQUEST_TIMEOUT_MS") return "10000";
        return undefined;
      });
    });

    it("returns empty array when not configured", async () => {
      mockConfig.get.mockReturnValue(undefined);
      const results = await adapter.search("ceramide skincare");
      expect(results).toEqual([]);
      expect(mockHttp.get).not.toHaveBeenCalled();
    });

    it("maps brave results to SearchResult shape", async () => {
      mockHttp.get.mockReturnValue(
        of(
          makeBraveResponse([
            {
              url: "https://reddit.com/r/SkincareAddiction/123",
              title: "Best ceramide serums?",
              description: "Looking for barrier repair help",
              page_age: "2024-06-15",
            },
          ]),
        ),
      );

      const results = await adapter.search("ceramide skincare");

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        url: "https://reddit.com/r/SkincareAddiction/123",
        title: "Best ceramide serums?",
        snippet: "Looking for barrier repair help",
        sourceType: "SUBREDDIT",
      });
      expect(results[0].publishedAt).toBeInstanceOf(Date);
    });

    it("detects SUBREDDIT source type for reddit.com URLs", async () => {
      mockHttp.get.mockReturnValue(
        of(
          makeBraveResponse([
            { url: "https://reddit.com/r/foo", title: "x", description: "" },
          ]),
        ),
      );
      const results = await adapter.search("test");
      expect(results[0].sourceType).toBe("SUBREDDIT");
    });

    it("detects FORUM source type for forum URLs", async () => {
      mockHttp.get.mockReturnValue(
        of(
          makeBraveResponse([
            {
              url: "https://forum.example.com/thread",
              title: "x",
              description: "",
            },
          ]),
        ),
      );
      const results = await adapter.search("test");
      expect(results[0].sourceType).toBe("FORUM");
    });

    it("detects BLOG source type for medium.com URLs", async () => {
      mockHttp.get.mockReturnValue(
        of(
          makeBraveResponse([
            {
              url: "https://medium.com/@author/post",
              title: "x",
              description: "",
            },
          ]),
        ),
      );
      const results = await adapter.search("test");
      expect(results[0].sourceType).toBe("BLOG");
    });

    it("defaults to GENERIC for unknown domains", async () => {
      mockHttp.get.mockReturnValue(
        of(
          makeBraveResponse([
            { url: "https://example.com/article", title: "x", description: "" },
          ]),
        ),
      );
      const results = await adapter.search("test");
      expect(results[0].sourceType).toBe("GENERIC");
    });

    it("returns empty array when response has no web results", async () => {
      mockHttp.get.mockReturnValue(of({ data: {}, status: 200 }));
      const results = await adapter.search("test");
      expect(results).toEqual([]);
    });

    it("caps results at maxResults option", async () => {
      const manyResults = Array.from({ length: 15 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Result ${i}`,
        description: "snippet",
      }));
      mockHttp.get.mockReturnValue(of(makeBraveResponse(manyResults)));

      const results = await adapter.search("test", { maxResults: 5 });

      const callParams = mockHttp.get.mock.calls[0][1].params;
      expect(callParams.count).toBe("5");
    });

    it("passes freshness param when specified", async () => {
      mockHttp.get.mockReturnValue(of(makeBraveResponse([])));

      await adapter.search("trend", { freshness: "week" });

      const callParams = mockHttp.get.mock.calls[0][1].params;
      expect(callParams.freshness).toBe("pw");
    });

    it("propagates HTTP errors", async () => {
      mockHttp.get.mockReturnValue(
        throwError(() => new Error("Network error")),
      );
      await expect(adapter.search("test")).rejects.toThrow("Network error");
    });
  });
});
