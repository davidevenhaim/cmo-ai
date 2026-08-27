import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { FirecrawlAdapter } from "./firecrawl.adapter";
import { of, throwError } from "rxjs";

const mockHttp = { post: jest.fn() };
const mockConfig = { get: jest.fn() };

const makeFirecrawlResponse = (overrides: any = {}) => ({
  data: {
    success: true,
    data: {
      markdown: "# Top Skincare Ingredients\nCeramides are trending.",
      metadata: {
        title: "Top Skincare Ingredients",
        description: "A guide to ceramides.",
        publishedTime: "2024-05-01T00:00:00Z",
        author: "Jane Doe",
      },
    },
    ...overrides,
  },
  status: 200,
});

describe("FirecrawlAdapter", () => {
  let adapter: FirecrawlAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirecrawlAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    adapter = module.get<FirecrawlAdapter>(FirecrawlAdapter);
    jest.clearAllMocks();
  });

  describe("configured", () => {
    it("returns true when API key present", () => {
      mockConfig.get.mockReturnValue("fc-key-abc");
      expect(adapter.configured).toBe(true);
    });

    it("returns false when API key absent", () => {
      mockConfig.get.mockReturnValue(undefined);
      expect(adapter.configured).toBe(false);
    });
  });

  describe("extract", () => {
    beforeEach(() => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === "FIRECRAWL_API_KEY") return "test-fc-key";
        if (key === "RESEARCH_REQUEST_TIMEOUT_MS") return "10000";
        return undefined;
      });
    });

    it("throws when not configured", async () => {
      mockConfig.get.mockReturnValue(undefined);
      await expect(adapter.extract("https://example.com")).rejects.toThrow(
        "Firecrawl not configured",
      );
    });

    it("returns ExtractResult with title, content, metadata", async () => {
      mockHttp.post.mockReturnValue(of(makeFirecrawlResponse()));

      const result = await adapter.extract("https://competitor.com/blog");

      expect(result.url).toBe("https://competitor.com/blog");
      expect(result.title).toBe("Top Skincare Ingredients");
      expect(result.content).toContain("Ceramides are trending");
      expect(result.metadata?.publishedAt).toEqual(
        new Date("2024-05-01T00:00:00Z"),
      );
      expect(result.metadata?.author).toBe("Jane Doe");
    });

    it("truncates content to 2000 chars", async () => {
      const longMarkdown = "x".repeat(5000);
      mockHttp.post.mockReturnValue(
        of(
          makeFirecrawlResponse({
            data: { markdown: longMarkdown, metadata: {} },
          }),
        ),
      );

      const result = await adapter.extract("https://example.com/long");
      expect(result.content.length).toBeLessThanOrEqual(2000);
    });

    it("extracts title from markdown heading when metadata title absent", async () => {
      mockHttp.post.mockReturnValue(
        of(
          makeFirecrawlResponse({
            data: {
              markdown: "# My Article Title\nContent here.",
              metadata: {},
            },
          }),
        ),
      );

      const result = await adapter.extract("https://example.com/article");
      expect(result.title).toBe("My Article Title");
    });

    it("falls back to URL as title when no title found", async () => {
      mockHttp.post.mockReturnValue(
        of(
          makeFirecrawlResponse({
            data: { markdown: "No heading here.", metadata: {} },
          }),
        ),
      );

      const result = await adapter.extract("https://example.com/no-title");
      expect(result.title).toBe("https://example.com/no-title");
    });

    it("throws when firecrawl returns success: false", async () => {
      mockHttp.post.mockReturnValue(
        of({ data: { success: false }, status: 200 }),
      );

      await expect(adapter.extract("https://example.com/fail")).rejects.toThrow(
        "Firecrawl extraction failed",
      );
    });

    it("propagates HTTP errors", async () => {
      mockHttp.post.mockReturnValue(throwError(() => new Error("Timeout")));
      await expect(adapter.extract("https://example.com")).rejects.toThrow(
        "Timeout",
      );
    });

    it("truncates description to 300 chars", async () => {
      mockHttp.post.mockReturnValue(
        of(
          makeFirecrawlResponse({
            data: {
              markdown: "Content",
              metadata: { description: "d".repeat(500) },
            },
          }),
        ),
      );

      const result = await adapter.extract("https://example.com");
      expect((result.metadata?.description ?? "").length).toBeLessThanOrEqual(
        300,
      );
    });
  });
});
