import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { Crawl4aiAdapter } from "./crawl4ai.adapter";
import { FallbackCrawlProvider } from "./fallback-crawl.provider";

describe("Crawl4aiAdapter", () => {
  let adapter: Crawl4aiAdapter;
  const mockHttp = { post: jest.fn() };
  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        CRAWL4AI_BASE_URL: "http://crawl4ai:11235",
        RESEARCH_REQUEST_TIMEOUT_MS: "5000",
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Crawl4aiAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    adapter = module.get(Crawl4aiAdapter);
  });

  it("extracts markdown content", async () => {
    mockHttp.post.mockReturnValue(
      of({
        data: {
          markdown: "Hello from crawl4ai page content here",
          title: "Demo",
          url: "https://example.com",
        },
      }),
    );
    const result = await adapter.extract("https://example.com");
    expect(result.content).toContain("Hello from crawl4ai");
    expect(result.title).toBe("Demo");
  });

  it("rejects unsafe URLs", async () => {
    await expect(adapter.extract("http://127.0.0.1/x")).rejects.toThrow(
      /private/,
    );
  });

  it("throws on provider failure", async () => {
    mockHttp.post.mockReturnValue(throwError(() => new Error("down")));
    await expect(adapter.extract("https://example.com")).rejects.toThrow(
      /Crawl4AI failed/,
    );
  });
});

describe("FallbackCrawlProvider", () => {
  it("falls back when primary fails", async () => {
    const primary = {
      name: "crawl4ai",
      configured: true,
      extract: jest.fn().mockRejectedValue(new Error("timeout")),
    };
    const secondary = {
      name: "browser",
      configured: true,
      extract: jest.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Ok",
        content: "fallback content",
      }),
    };
    const fallback = new FallbackCrawlProvider([
      primary as any,
      secondary as any,
    ]);
    const result = await fallback.extract("https://example.com");
    expect(result.content).toBe("fallback content");
    expect(primary.extract).toHaveBeenCalled();
    expect(secondary.extract).toHaveBeenCalled();
  });

  it("does not fabricate when all fail", async () => {
    const a = {
      name: "a",
      configured: true,
      extract: jest.fn().mockRejectedValue(new Error("a")),
    };
    const b = {
      name: "b",
      configured: true,
      extract: jest.fn().mockRejectedValue(new Error("b")),
    };
    const fallback = new FallbackCrawlProvider([a as any, b as any]);
    await expect(fallback.extract("https://example.com")).rejects.toThrow(
      /All crawl providers failed/,
    );
  });
});
