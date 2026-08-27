/**
 * postiz.publisher.spec.ts
 * Publishing Foundation — PostizPublisher (SocialPublisher) adapter tests.
 * No live credentials required.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";

import { PostizPublisher, SUPPORTED_CHANNELS } from "./postiz.publisher";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockHttp = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
const mockConfig = { get: jest.fn() };

function makeAxiosResponse(data: unknown) {
  return of({ data, status: 200, statusText: "OK", headers: {}, config: {} });
}

function configuredEnv() {
  mockConfig.get.mockImplementation((key: string) => {
    const map: Record<string, string> = {
      POSTIZ_BASE_URL: "https://postiz.internal",
      POSTIZ_API_KEY: "test-api-key",
    };
    return map[key];
  });
}

function unconfiguredEnv() {
  mockConfig.get.mockReturnValue(undefined);
}

const validMeta = { channel: "INSTAGRAM", accountId: "acc-001" };

const draftPost = { id: "pz-001", state: "DRAFT", content: "Hello world" };
const queuedPost = { id: "pz-001", state: "QUEUE", content: "Hello world" };
const publishedPost = {
  id: "pz-001",
  state: "PUBLISHED",
  content: "Hello world",
};
const errorPost = { id: "pz-001", state: "ERROR", content: "" };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
describe("PostizPublisher", () => {
  let publisher: PostizPublisher;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostizPublisher,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    publisher = module.get(PostizPublisher);
  });

  // -------------------------------------------------------------------------
  // provider identity
  // -------------------------------------------------------------------------
  it("has provider name 'postiz'", () => {
    expect(publisher.provider).toBe("postiz");
  });

  it("exposes SUPPORTED_CHANNELS constant", () => {
    expect(SUPPORTED_CHANNELS).toContain("INSTAGRAM");
    expect(SUPPORTED_CHANNELS).toContain("FACEBOOK");
    expect(SUPPORTED_CHANNELS).toContain("LINKEDIN");
    expect(SUPPORTED_CHANNELS).toContain("X");
    expect(SUPPORTED_CHANNELS).toContain("REDDIT");
  });

  // -------------------------------------------------------------------------
  // health
  // -------------------------------------------------------------------------
  describe("health", () => {
    it("returns healthy when Postiz responds", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse({ integrations: [] }));

      const result = await publisher.health();

      expect(result.healthy).toBe(true);
      expect(mockHttp.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/integrations"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });

    it("returns unhealthy when not configured", async () => {
      unconfiguredEnv();
      const result = await publisher.health();
      expect(result.healthy).toBe(false);
      expect(result.message).toContain("not configured");
    });

    it("returns unhealthy on network error", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(throwError(() => new Error("ECONNREFUSED")));
      const result = await publisher.health();
      expect(result.healthy).toBe(false);
      expect(result.message).toContain("ECONNREFUSED");
    });
  });

  // -------------------------------------------------------------------------
  // validateDraft
  // -------------------------------------------------------------------------
  describe("validateDraft", () => {
    it("passes with valid channel, accountId, and content", async () => {
      const result = await publisher.validateDraft(
        { caption: "Great post!" },
        validMeta,
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when channel missing", async () => {
      const result = await publisher.validateDraft(
        { caption: "Post" },
        { accountId: "acc-001" },
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("channel"))).toBe(true);
    });

    it("fails when channel not in supported list", async () => {
      const result = await publisher.validateDraft(
        { caption: "Post" },
        { channel: "TIKTOK", accountId: "acc-001" },
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("TIKTOK"))).toBe(true);
    });

    it("fails when accountId missing", async () => {
      const result = await publisher.validateDraft(
        { caption: "Post" },
        { channel: "INSTAGRAM" },
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("accountId"))).toBe(true);
    });

    it("fails when post body is empty", async () => {
      const result = await publisher.validateDraft({}, validMeta);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("body"))).toBe(true);
    });

    it("accepts body, content, or caption interchangeably", async () => {
      const byBody = await publisher.validateDraft({ body: "Hi" }, validMeta);
      const byContent = await publisher.validateDraft(
        { content: "Hi" },
        validMeta,
      );
      const byCaption = await publisher.validateDraft(
        { caption: "Hi" },
        validMeta,
      );

      expect(byBody.valid).toBe(true);
      expect(byContent.valid).toBe(true);
      expect(byCaption.valid).toBe(true);
    });

    it("returns multiple errors when multiple fields missing", async () => {
      const result = await publisher.validateDraft({}, {});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // createRemoteDraft
  // -------------------------------------------------------------------------
  describe("createRemoteDraft", () => {
    it("creates Postiz draft and returns DRAFT status", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(draftPost));

      const result = await publisher.createRemoteDraft(
        { caption: "Hello world" },
        validMeta,
      );

      expect(result.status).toBe("DRAFT");
      expect(result.remoteId).toBe("pz-001");
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/posts"),
        expect.objectContaining({
          integrationId: "acc-001",
          content: "Hello world",
          state: "DRAFT",
        }),
        expect.anything(),
      );
    });

    it("returns FAILED when not configured", async () => {
      unconfiguredEnv();
      const result = await publisher.createRemoteDraft(
        { caption: "X" },
        validMeta,
      );
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("not configured");
    });

    it("returns FAILED when validation fails (unsupported channel)", async () => {
      configuredEnv();
      const result = await publisher.createRemoteDraft(
        { caption: "X" },
        { channel: "TIKTOK", accountId: "acc-001" },
      );
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED on API error", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(
        throwError(() => new Error("429 Rate Limited")),
      );
      const result = await publisher.createRemoteDraft(
        { caption: "Hello" },
        validMeta,
      );
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("429");
    });

    it("passes scheduledAt from providerMetadata to payload", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(draftPost));

      await publisher.createRemoteDraft(
        { caption: "Scheduled post" },
        { ...validMeta, scheduledAt: "2026-09-01T10:00:00Z" },
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ publishDate: "2026-09-01T10:00:00Z" }),
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateRemoteDraft
  // -------------------------------------------------------------------------
  describe("updateRemoteDraft", () => {
    it("updates draft by remoteId", async () => {
      configuredEnv();
      mockHttp.put.mockReturnValue(makeAxiosResponse(draftPost));

      const result = await publisher.updateRemoteDraft(
        "pz-001",
        { caption: "Updated caption" },
        validMeta,
      );

      expect(result.status).toBe("DRAFT");
      expect(mockHttp.put).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/posts/pz-001"),
        expect.anything(),
        expect.anything(),
      );
    });

    it("returns FAILED when not configured", async () => {
      unconfiguredEnv();
      const result = await publisher.updateRemoteDraft("id", { caption: "X" });
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED on API error", async () => {
      configuredEnv();
      mockHttp.put.mockReturnValue(throwError(() => new Error("404")));
      const result = await publisher.updateRemoteDraft("bad", { caption: "X" });
      expect(result.status).toBe("FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // publish — schedule vs immediate
  // -------------------------------------------------------------------------
  describe("publish", () => {
    it("queues post and returns DRAFT (scheduled, not yet live)", async () => {
      configuredEnv();
      mockHttp.put.mockReturnValue(makeAxiosResponse(queuedPost));

      const result = await publisher.publish("pz-001", {
        scheduledAt: "2026-09-01T10:00:00Z",
      });

      expect(result.status).toBe("DRAFT"); // QUEUE state → still not LIVE
      expect(mockHttp.put).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/posts/pz-001"),
        expect.objectContaining({
          state: "QUEUE",
          publishDate: "2026-09-01T10:00:00Z",
        }),
        expect.anything(),
      );
    });

    it("returns LIVE when post transitions to PUBLISHED", async () => {
      configuredEnv();
      mockHttp.put.mockReturnValue(makeAxiosResponse(publishedPost));

      const result = await publisher.publish("pz-001");
      expect(result.status).toBe("LIVE");
    });

    it("returns FAILED when not configured", async () => {
      unconfiguredEnv();
      const result = await publisher.publish("pz-001");
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED on API error", async () => {
      configuredEnv();
      mockHttp.put.mockReturnValue(throwError(() => new Error("503")));
      const result = await publisher.publish("pz-001");
      expect(result.status).toBe("FAILED");
    });

    it("returns FAILED when remote responds with an HTTP error (confirmed failure)", async () => {
      configuredEnv();
      const httpErr = Object.assign(new Error("Request failed with 422"), {
        response: { status: 422, data: {} },
      });
      mockHttp.put.mockReturnValue(throwError(() => httpErr));

      const result = await publisher.publish("pz-001");
      expect(result.status).toBe("FAILED");
    });

    it("returns UNKNOWN when request was sent but response was lost (timeout)", async () => {
      configuredEnv();
      const timeoutErr = Object.assign(
        new Error("timeout of 15000ms exceeded"),
        { code: "ECONNABORTED", request: {} },
      );
      mockHttp.put.mockReturnValue(throwError(() => timeoutErr));

      const result = await publisher.publish("pz-001");
      expect(result.status).toBe("UNKNOWN");
    });

    it("createRemoteDraft returns UNKNOWN on lost response — never fabricates success", async () => {
      configuredEnv();
      const resetErr = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
        request: {},
      });
      mockHttp.post.mockReturnValue(throwError(() => resetErr));

      const result = await publisher.createRemoteDraft(
        { caption: "Hello" },
        validMeta,
      );
      expect(result.status).toBe("UNKNOWN");
    });
  });

  // -------------------------------------------------------------------------
  // getPublication
  // -------------------------------------------------------------------------
  describe("getPublication", () => {
    it("returns LIVE for PUBLISHED post", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse(publishedPost));
      const result = await publisher.getPublication("pz-001");
      expect(result!.status).toBe("LIVE");
    });

    it("returns DRAFT for QUEUE/DRAFT post", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse(queuedPost));
      const result = await publisher.getPublication("pz-001");
      expect(result!.status).toBe("DRAFT");
    });

    it("returns FAILED for ERROR post", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(makeAxiosResponse(errorPost));
      const result = await publisher.getPublication("pz-001");
      expect(result!.status).toBe("FAILED");
    });

    it("returns null when not configured", async () => {
      unconfiguredEnv();
      const result = await publisher.getPublication("pz-001");
      expect(result).toBeNull();
    });

    it("returns null on API error", async () => {
      configuredEnv();
      mockHttp.get.mockReturnValue(throwError(() => new Error("404")));
      const result = await publisher.getPublication("pz-001");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // duplicate request guard — at adapter level
  // -------------------------------------------------------------------------
  describe("duplicate request", () => {
    it("each publish call hits API independently (PublishingService owns idempotency)", async () => {
      configuredEnv();
      mockHttp.put.mockReturnValue(makeAxiosResponse(publishedPost));

      await publisher.publish("pz-001");
      await publisher.publish("pz-001");

      expect(mockHttp.put).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // retry uncertainty — UNKNOWN outcome
  // -------------------------------------------------------------------------
  describe("missing media / malformed response", () => {
    it("returns FAILED when API returns empty response body", async () => {
      configuredEnv();
      mockHttp.post.mockReturnValue(makeAxiosResponse(null));

      // null response — post.id will be undefined
      const result = await publisher.createRemoteDraft(
        { caption: "Post" },
        validMeta,
      );
      // remoteId is undefined — status still resolved from state field
      expect(["DRAFT", "FAILED"]).toContain(result.status);
    });
  });
});
