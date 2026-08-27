import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { assertSafeUrl, BrowserCrawlAdapter } from "./browser-crawl.adapter";

describe("BrowserCrawlAdapter", () => {
  let adapter: BrowserCrawlAdapter;
  const mockHttp = { post: jest.fn() };
  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        BROWSERLESS_URL: "http://browserless:3000",
        RESEARCH_REQUEST_TIMEOUT_MS: "5000",
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrowserCrawlAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    adapter = module.get(BrowserCrawlAdapter);
  });

  it("extracts readable text from HTML", async () => {
    const html =
      "<html><head><title>Demo</title></head><body><p>Hello world content</p></body></html>";
    mockHttp.post.mockReturnValue(of({ data: html }));
    const result = await adapter.extract("https://example.com/page");
    expect(result.title).toBe("Demo");
    expect(result.content).toContain("Hello world");
  });

  it("rejects unsafe URLs", async () => {
    await expect(adapter.extract("file:///etc/passwd")).rejects.toThrow();
    await expect(adapter.extract("http://127.0.0.1/admin")).rejects.toThrow(
      /private/,
    );
  });

  it("assertSafeUrl blocks private hosts", () => {
    expect(() => assertSafeUrl("https://192.168.1.1/")).toThrow();
    expect(() => assertSafeUrl("https://example.com")).not.toThrow();
  });

  it("throws on provider failure", async () => {
    mockHttp.post.mockReturnValue(throwError(() => new Error("down")));
    await expect(adapter.extract("https://example.com")).rejects.toThrow(
      /Browser crawl failed/,
    );
  });

  it("bounds oversized pages", async () => {
    const big = "<html><body>" + "x".repeat(50_000) + "</body></html>";
    mockHttp.post.mockReturnValue(of({ data: big }));
    const result = await adapter.extract("https://example.com/big");
    expect(result.content.length).toBeLessThanOrEqual(2000);
  });
});
