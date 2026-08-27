import { UnauthorizedException } from "@nestjs/common";
import { ChangedetectionIngestService } from "./changedetection-ingest.service";

describe("ChangedetectionIngestService", () => {
  const mockPrisma = {
    researchRun: { create: jest.fn() },
    researchFinding: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockConfig = {
    get: jest.fn((k: string) =>
      k === "CHANGEDETECTION_WEBHOOK_TOKEN" ? "secret-token" : "",
    ),
  };
  const mockNormalizer = {
    fromSearchResult: jest.fn((r: any) => ({
      url: r.url,
      urlHash: "hash-" + r.url,
      title: r.title,
      excerpt: r.snippet,
      sourceType: "COMPETITOR",
      topic: "competitor change",
      publishedAt: r.publishedAt,
      providerMeta: r.metadata,
    })),
  };

  let svc: ChangedetectionIngestService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.researchRun.create.mockResolvedValue({ id: "run-1" });
    mockPrisma.researchFinding.findUnique.mockResolvedValue(null);
    mockPrisma.researchFinding.create.mockResolvedValue({ id: "f-1" });
    svc = new ChangedetectionIngestService(
      mockPrisma as any,
      mockConfig as any,
      mockNormalizer as any,
    );
  });

  it("rejects missing/invalid token", () => {
    expect(() => svc.assertAuthorized(undefined)).toThrow(
      UnauthorizedException,
    );
    expect(() => svc.assertAuthorized("wrong")).toThrow(UnauthorizedException);
  });

  it("creates research finding with provenance", async () => {
    svc.assertAuthorized("secret-token");
    const result = await svc.ingest({
      watch_url: "https://competitor.example/pricing",
      title: "Pricing page",
      diff_text: "New plan launched",
      uuid: "watch-1",
    });
    expect(result.created).toBe(true);
    expect(result.findingId).toBe("f-1");
    expect(mockPrisma.researchRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: "CHANGEDETECTION",
          providers: ["changedetection"],
        }),
      }),
    );
    expect(mockPrisma.researchFinding.create).toHaveBeenCalled();
  });

  it("ignores non-http urls without fabricating", async () => {
    const result = await svc.ingest({ url: "ftp://x" });
    expect(result.findingId).toBeNull();
    expect(mockPrisma.researchFinding.create).not.toHaveBeenCalled();
  });
});
