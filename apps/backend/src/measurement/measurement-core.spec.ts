import { UtmService } from "./utm.service";
import { ContentOutcomeService } from "./content-outcome.service";
import { BaselineService } from "./baseline.service";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

describe("UtmService", () => {
  const utm = new UtmService();

  it("produces deterministic params from stable ids", () => {
    const a = utm.buildParams({ channel: "BLOG", recommendationId: "rec-123" });
    const b = utm.buildParams({ channel: "BLOG", recommendationId: "rec-123" });
    expect(a).toEqual(b);
    expect(a.utm_campaign).toBe("cmo-rec-123");
    expect(a.utm_source).toBe("blog");
    expect(a.utm_medium).toBe("organic-content");
  });

  it("falls back to briefId then general for the campaign ref", () => {
    expect(
      utm.buildParams({ channel: "EMAIL", briefId: "Brief A" }).utm_campaign,
    ).toBe("cmo-brief-a");
    expect(utm.buildParams({ channel: "EMAIL" }).utm_campaign).toBe(
      "cmo-general",
    );
  });

  it("adds utm_content only when a draft id exists", () => {
    const withDraft = utm.buildParams({
      channel: "INSTAGRAM",
      recommendationId: "r1",
      draftId: "Draft B",
    });
    expect(withDraft.utm_content).toBe("draft-b");
    expect(
      utm.buildParams({ channel: "INSTAGRAM", recommendationId: "r1" })
        .utm_content,
    ).toBeUndefined();
  });

  it("preserves the original URL, query params and fragment", () => {
    const url = "https://example.com/page?ref=abc#section-2";
    const result = utm.applyToUrl(
      url,
      utm.buildParams({ channel: "BLOG", recommendationId: "rec-1" }),
    );
    const parsed = new URL(result);
    expect(parsed.pathname).toBe("/page");
    expect(parsed.searchParams.get("ref")).toBe("abc");
    expect(parsed.hash).toBe("#section-2");
    expect(parsed.searchParams.get("utm_campaign")).toBe("cmo-rec-1");
  });

  it("never overwrites existing utm parameters", () => {
    const url = "https://example.com/?utm_source=newsletter";
    const result = utm.applyToUrl(
      url,
      utm.buildParams({ channel: "BLOG", recommendationId: "rec-1" }),
    );
    expect(new URL(result).searchParams.get("utm_source")).toBe("newsletter");
  });

  it("returns invalid URLs unchanged instead of destroying them", () => {
    expect(
      utm.applyToUrl(
        "not a url",
        utm.buildParams({ channel: "BLOG", recommendationId: "r" }),
      ),
    ).toBe("not a url");
  });

  it("maps channels to media deterministically", () => {
    expect(utm.buildParams({ channel: "WHATSAPP" }).utm_medium).toBe(
      "messaging",
    );
    expect(utm.buildParams({ channel: "INSTAGRAM" }).utm_medium).toBe(
      "organic-social",
    );
    expect(utm.buildParams({ channel: "SOMETHING_ELSE" }).utm_medium).toBe(
      "referral",
    );
  });
});

describe("ContentOutcomeService", () => {
  const svc = new ContentOutcomeService();

  it("classifies OUTPERFORMED at or above +20% vs baseline", () => {
    const r = svc.classify({
      value: 120,
      baseline: 100,
      baselineSamples: 5,
      dataQuality: "COMPLETE",
    });
    expect(r.classification).toBe("OUTPERFORMED");
    expect(r.deltaPct).toBe(20);
  });

  it("classifies UNDERPERFORMED at or below -20% vs baseline", () => {
    const r = svc.classify({
      value: 80,
      baseline: 100,
      baselineSamples: 5,
      dataQuality: "COMPLETE",
    });
    expect(r.classification).toBe("UNDERPERFORMED");
    expect(r.deltaPct).toBe(-20);
  });

  it("classifies EXPECTED inside the threshold band", () => {
    const r = svc.classify({
      value: 110,
      baseline: 100,
      baselineSamples: 5,
      dataQuality: "COMPLETE",
    });
    expect(r.classification).toBe("EXPECTED");
    expect(r.deltaPct).toBe(10);
  });

  it("is INCONCLUSIVE with fewer baseline samples than the minimum", () => {
    const r = svc.classify({
      value: 500,
      baseline: 100,
      baselineSamples: MEASUREMENT_POLICY.minBaselineSamples - 1,
      dataQuality: "COMPLETE",
    });
    expect(r.classification).toBe("INCONCLUSIVE");
    expect(r.reason).toContain("insufficient baseline");
  });

  it("is INCONCLUSIVE without a baseline — never guesses success", () => {
    const r = svc.classify({
      value: 500,
      baseline: null,
      baselineSamples: 0,
      dataQuality: "COMPLETE",
    });
    expect(r.classification).toBe("INCONCLUSIVE");
  });

  it("is INCONCLUSIVE when data quality is poor (INSUFFICIENT/UNAVAILABLE/PARTIAL/STALE)", () => {
    for (const dq of [
      "INSUFFICIENT",
      "UNAVAILABLE",
      "PARTIAL",
      "STALE",
    ] as const) {
      const r = svc.classify({
        value: 1000,
        baseline: 100,
        baselineSamples: 10,
        dataQuality: dq,
      });
      expect(r.classification).toBe("INCONCLUSIVE");
      expect(r.reason).toContain(dq);
    }
  });
});

describe("BaselineService", () => {
  function makePrisma() {
    return {
      publishRequest: { findMany: jest.fn().mockResolvedValue([]) },
      performanceObservation: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  it("compares like-with-like: only prior publications on the same channel", async () => {
    const prisma = makePrisma();
    const svc = new BaselineService(prisma as any);
    await svc.channelContentBaseline({
      channel: "instagram",
      metric: "engagement",
      before: new Date("2026-08-20T00:00:00Z"),
    });
    expect(prisma.publishRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "instagram",
          status: "SUCCEEDED",
        }),
      }),
    );
  });

  it("averages per-publication totals and excludes mock observations", async () => {
    const prisma = makePrisma();
    const before = new Date("2026-08-20T00:00:00Z");
    prisma.publishRequest.findMany.mockResolvedValue([
      pubRequest("pub-1", "2026-08-10"),
      pubRequest("pub-2", "2026-08-12"),
    ]);
    prisma.performanceObservation.findMany.mockResolvedValue([
      { subjectId: "pub-1", value: 100 },
      { subjectId: "pub-1", value: 50 },
      { subjectId: "pub-2", value: 30 },
    ]);
    const svc = new BaselineService(prisma as any);
    const result = await svc.channelContentBaseline({
      channel: "blog",
      metric: "sessions",
      before,
    });
    // pub-1 total 150, pub-2 total 30 → average 90 over 2 samples
    expect(result.baseline).toBe(90);
    expect(result.samples).toBe(2);
    expect(prisma.performanceObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isMock: false }),
      }),
    );
  });

  it("excludes the measured subject itself from its own baseline", async () => {
    const prisma = makePrisma();
    prisma.publishRequest.findMany.mockResolvedValue([
      pubRequest("pub-self", "2026-08-10"),
    ]);
    const svc = new BaselineService(prisma as any);
    const result = await svc.channelContentBaseline({
      channel: "blog",
      metric: "sessions",
      before: new Date("2026-08-20T00:00:00Z"),
      excludeSubjectIds: ["pub-self"],
    });
    expect(result.baseline).toBeNull();
    expect(result.samples).toBe(0);
  });

  it("marks baselines unusable below the minimum sample count", () => {
    const svc = new BaselineService(makePrisma() as any);
    expect(svc.usable({ baseline: 10, samples: 2, windowDays: 30 })).toBe(
      false,
    );
    expect(svc.usable({ baseline: 10, samples: 3, windowDays: 30 })).toBe(true);
    expect(svc.usable({ baseline: null, samples: 5, windowDays: 30 })).toBe(
      false,
    );
  });

  it("brand daily baseline excludes mock data", async () => {
    const prisma = makePrisma();
    prisma.performanceObservation.findMany.mockResolvedValue([
      { value: 10 },
      { value: 20 },
    ]);
    const svc = new BaselineService(prisma as any);
    const result = await svc.brandDailyBaseline({
      provider: "shopify",
      metric: "revenue",
      before: new Date(),
    });
    expect(result.baseline).toBe(15);
    expect(prisma.performanceObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isMock: false }),
      }),
    );
  });
});

function pubRequest(publicationId: string, publishedDay: string) {
  return {
    publication: {
      id: publicationId,
      publishedAt: new Date(`${publishedDay}T12:00:00Z`),
    },
  };
}
