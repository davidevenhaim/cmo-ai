/**
 * wordpress.adapter.spec.ts
 * M6.8 WordPress Connector — auth, health, posts, draft CRUD, publish, safety gates.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";

import { WordPressAdapter } from "./wordpress.adapter";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockHttp = {
  get: jest.fn(),
  post: jest.fn(),
};

const mockConfig = {
  get: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAxiosResponse(data: unknown) {
  return of({ data, status: 200, statusText: "OK", headers: {}, config: {} });
}

function configuredEnv() {
  mockConfig.get.mockImplementation((key: string) => {
    const map: Record<string, string> = {
      WORDPRESS_BASE_URL: "https://blog.example.com",
      WORDPRESS_USERNAME: "admin",
      WORDPRESS_APPLICATION_PASSWORD: "secret",
    };
    return map[key];
  });
}

function unconfiguredEnv() {
  mockConfig.get.mockReturnValue(undefined);
}

const stubPost = {
  id: 42,
  date: "2026-08-01T10:00:00",
  title: { rendered: "Hello World" },
  excerpt: { rendered: "An excerpt" },
  link: "https://blog.example.com/hello-world",
  status: "draft",
  categories: [1],
  tags: [],
};

const livePost = { ...stubPost, status: "publish" };

const stubCategory = { id: 1, name: "General", slug: "general" };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
describe("WordPressAdapter", () => {
  let adapter: WordPressAdapter;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordPressAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    adapter = module.get(WordPressAdapter);
  });

  // -------------------------------------------------------------------------
  // health
  // -------------------------------------------------------------------------
  describe("health", () => {
    it("returns healthy when WordPress responds 200", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse({ id: 1, name: "admin" }));

      const result = await adapter.health();

      expect(result.healthy).toBe(true);
      expect(mockHttp.get).toHaveBeenCalledWith(
        expect.stringContaining("/wp-json/wp/v2/users/me"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic "),
          }),
        }),
      );
    });

    it("returns unhealthy when not configured", async () => {
      unconfiguredEnv();
      const result = await adapter.health();
      expect(result.healthy).toBe(false);
      expect(result.message).toContain("not configured");
    });

    it("returns unhealthy on network error", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(throwError(() => new Error("ECONNREFUSED")));

      const result = await adapter.health();
      expect(result.healthy).toBe(false);
      expect(result.message).toContain("ECONNREFUSED");
    });
  });

  // -------------------------------------------------------------------------
  // validateDraft
  // -------------------------------------------------------------------------
  describe("validateDraft", () => {
    it("passes with title and body", async () => {
      const result = await adapter.validateDraft({ title: "T", body: "B" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("passes with headline and content", async () => {
      const result = await adapter.validateDraft({
        headline: "H",
        content: "C",
      });
      expect(result.valid).toBe(true);
    });

    it("fails without title/headline", async () => {
      const result = await adapter.validateDraft({ body: "B" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("title or headline required");
    });

    it("fails without body/content", async () => {
      const result = await adapter.validateDraft({ title: "T" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("body or content required");
    });

    it("fails with both missing", async () => {
      const result = await adapter.validateDraft({});
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // createRemoteDraft
  // -------------------------------------------------------------------------
  describe("createRemoteDraft", () => {
    it("creates WordPress draft and returns DRAFT status", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(stubPost));

      const result = await adapter.createRemoteDraft({
        title: "Hello",
        body: "World",
      });

      expect(result.status).toBe("DRAFT");
      expect(result.remoteId).toBe("42");
      expect(result.remoteUrl).toBe("https://blog.example.com/hello-world");
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/wp-json/wp/v2/posts"),
        expect.objectContaining({ title: "Hello", status: "draft" }),
        expect.anything(),
      );
    });

    it("returns FAILED when not configured", async () => {
      unconfiguredEnv();
      const result = await adapter.createRemoteDraft({ title: "T", body: "B" });
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("not configured");
    });

    it("returns FAILED on API error", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(
        throwError(() => new Error("500 Server Error")),
      );

      const result = await adapter.createRemoteDraft({ title: "T", body: "B" });
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("500 Server Error");
    });

    it("maps headline to WordPress title", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(stubPost));

      await adapter.createRemoteDraft({
        headline: "My Headline",
        content: "Body text",
      });

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: "My Headline", content: "Body text" }),
        expect.anything(),
      );
    });

    it("passes categories and tags from providerMetadata", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(stubPost));

      await adapter.createRemoteDraft(
        { title: "T", body: "B" },
        { categories: [1, 2], tags: [10] },
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ categories: [1, 2], tags: [10] }),
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateRemoteDraft
  // -------------------------------------------------------------------------
  describe("updateRemoteDraft", () => {
    it("updates existing draft by remoteId", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(stubPost));

      const result = await adapter.updateRemoteDraft("42", {
        title: "Updated",
        body: "New body",
      });

      expect(result.status).toBe("DRAFT");
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/wp-json/wp/v2/posts/42"),
        expect.objectContaining({ title: "Updated" }),
        expect.anything(),
      );
    });

    it("returns FAILED when not configured", async () => {
      unconfiguredEnv();
      const result = await adapter.updateRemoteDraft("42", {
        title: "T",
        body: "B",
      });
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED on malformed API response (network error)", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(
        throwError(() => new Error("401 Unauthorized")),
      );

      const result = await adapter.updateRemoteDraft("42", {
        title: "T",
        body: "B",
      });
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("401");
    });
  });

  // -------------------------------------------------------------------------
  // publish
  // -------------------------------------------------------------------------
  describe("publish", () => {
    it("publishes post and returns LIVE status", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(livePost));

      const result = await adapter.publish("42");

      expect(result.status).toBe("LIVE");
      expect(result.remoteId).toBe("42");
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/wp-json/wp/v2/posts/42"),
        expect.objectContaining({ status: "publish" }),
        expect.anything(),
      );
    });

    it("does not duplicate publish — calling twice hits API twice (idempotency is caller responsibility)", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(livePost));

      await adapter.publish("42");
      await adapter.publish("42");

      // Both calls go through — PublishingService guards idempotency at the request level
      expect(mockHttp.post).toHaveBeenCalledTimes(2);
    });

    it("returns FAILED when not configured", async () => {
      unconfiguredEnv();
      const result = await adapter.publish("42");
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED on API failure", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(throwError(() => new Error("Forbidden")));

      const result = await adapter.publish("42");
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED when remote responds with an HTTP error (confirmed failure)", async () => {
      configuredEnv();
      const httpErr = Object.assign(new Error("Request failed with 500"), {
        response: { status: 500, data: {} },
      });
      mockHttp.post.mockReturnValue(throwError(() => httpErr));

      const result = await adapter.publish("42");
      expect(result.status).toBe("FAILED");
    });

    it("returns UNKNOWN when request was sent but response was lost (timeout)", async () => {
      configuredEnv();
      const timeoutErr = Object.assign(
        new Error("timeout of 15000ms exceeded"),
        { code: "ECONNABORTED", request: {} },
      );
      mockHttp.post.mockReturnValue(throwError(() => timeoutErr));

      const result = await adapter.publish("42");
      expect(result.status).toBe("UNKNOWN");
    });

    it("createRemoteDraft returns UNKNOWN on lost response — never fabricates success", async () => {
      configuredEnv();
      const resetErr = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
        request: {},
      });
      mockHttp.post.mockReturnValue(throwError(() => resetErr));

      const result = await adapter.createRemoteDraft(
        { title: "T", body: "B" },
        {},
      );
      expect(result.status).toBe("UNKNOWN");
      expect(result.remoteId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getPublication
  // -------------------------------------------------------------------------
  describe("getPublication", () => {
    it("returns DRAFT status for draft post", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse(stubPost));

      const result = await adapter.getPublication("42");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("DRAFT");
    });

    it("returns LIVE status for published post", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse(livePost));

      const result = await adapter.getPublication("42");
      expect(result!.status).toBe("LIVE");
    });

    it("returns null when not configured", async () => {
      unconfiguredEnv();
      const result = await adapter.getPublication("42");
      expect(result).toBeNull();
    });

    it("returns null on API error", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(throwError(() => new Error("404")));

      const result = await adapter.getPublication("42");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getRecentPosts
  // -------------------------------------------------------------------------
  describe("getRecentPosts", () => {
    it("returns recent posts when configured", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse([stubPost]));

      const posts = await adapter.getRecentPosts(10);
      expect(posts).toHaveLength(1);
      expect(posts[0].id).toBe(42);
    });

    it("returns empty array when not configured", async () => {
      unconfiguredEnv();
      const posts = await adapter.getRecentPosts();
      expect(posts).toHaveLength(0);
    });

    it("returns empty array on API failure", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(
        throwError(() => new Error("Network error")),
      );

      const posts = await adapter.getRecentPosts();
      expect(posts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // buildBlogContext
  // -------------------------------------------------------------------------
  describe("buildBlogContext", () => {
    it("builds BlogContext with posts and categories", async () => {
      configuredEnv();
      mockHttp.get
        .mockReturnValueOnce(makeAxiosResponse([stubPost]))
        .mockReturnValueOnce(makeAxiosResponse([stubCategory]));

      const ctx = await adapter.buildBlogContext();

      expect(ctx.available).toBe(true);
      expect(ctx.recentPosts).toHaveLength(1);
      expect(ctx.recentPosts[0].title).toBe("Hello World");
      expect(ctx.recentPosts[0].url).toBe(
        "https://blog.example.com/hello-world",
      );
      expect(ctx.categories).toHaveLength(1);
      expect(ctx.categories[0].name).toBe("General");
      expect(ctx.fetchedAt).toBeDefined();
    });

    it("returns unavailable context when not configured", async () => {
      unconfiguredEnv();
      const ctx = await adapter.buildBlogContext();
      expect(ctx.available).toBe(false);
      expect(ctx.failureReason).toContain("not configured");
    });

    it("returns available=true with empty arrays when API fails gracefully", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(throwError(() => new Error("503")));

      const ctx = await adapter.buildBlogContext();
      // getRecentPosts and getCategories both return [] on failure
      expect(ctx.available).toBe(true);
      expect(ctx.recentPosts).toHaveLength(0);
    });

    it("does not expose credentials in context", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse([]));

      const ctx = await adapter.buildBlogContext();
      const json = JSON.stringify(ctx);
      expect(json).not.toContain("secret");
      expect(json).not.toContain("admin");
    });
  });

  // -------------------------------------------------------------------------
  // auth header format
  // -------------------------------------------------------------------------
  describe("auth header", () => {
    it("sends Basic auth with base64-encoded credentials", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse({ id: 1 }));

      await adapter.health();

      const expectedBase64 = Buffer.from("admin:secret").toString("base64");
      expect(mockHttp.get).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${expectedBase64}`,
          }),
        }),
      );
    });
  });
});
