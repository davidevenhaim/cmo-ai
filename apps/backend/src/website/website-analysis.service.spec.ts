import { of, throwError } from "rxjs";
import { WebsiteAnalysisService } from "./website-analysis.service";

const CONFIG = {
  get: jest.fn((key: string, fallback?: string) =>
    key === "BRAIN_URL" ? "http://brain:8000" : (fallback ?? "30000"),
  ),
};

const STORED_FINDING = {
  id: "finding-1",
  fingerprint: "fp-real-1",
  pageUrl: "https://example.com",
  pageType: "HOMEPAGE",
  category: "PERFORMANCE",
  severity: "HIGH",
  title: "Largest Contentful Paint is slow",
  description: "LCP measured at 4.20s",
  metricName: "LCP",
  metricValue: 4200,
  metricUnit: "ms",
};

function makePrisma(findings = [STORED_FINDING]) {
  return {
    websiteFinding: { findMany: jest.fn().mockResolvedValue(findings) },
    websiteRecommendation: {
      create: jest.fn().mockResolvedValue({ id: "rec-1" }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
}

function makeService(response: unknown, findings = [STORED_FINDING]) {
  const prisma = makePrisma(findings);
  const http = { post: jest.fn().mockReturnValue(of({ data: response })) };
  const service = new WebsiteAnalysisService(
    prisma as any,
    http as any,
    CONFIG as any,
  );
  return { service, prisma, http };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    findingFingerprints: ["fp-real-1"],
    title: "Fix the homepage hero image",
    interpretation: "The oversized hero is likely driving the slow LCP.",
    proposedFix: "Convert the hero to WebP and preload it.",
    category: "PERFORMANCE",
    priority: "HIGH",
    confidence: 0.8,
    ...overrides,
  };
}

describe("WebsiteAnalysisService", () => {
  it("persists a recommendation grounded in a supplied finding", async () => {
    const { service, prisma } = makeService({
      modelId: "test-model",
      recommendations: [recommendation()],
    });

    const result = await service.analyseOpenFindings();

    expect(result.created).toBe(1);
    const data = prisma.websiteRecommendation.create.mock.calls[0]![0].data;
    expect(data.status).toBe("PROPOSED");
    expect(data.findings.connect).toEqual([{ id: "finding-1" }]);
  });

  describe("the model cannot replace a measured fact", () => {
    it("only sends bounded finding fields to the brain", async () => {
      const { service, http } = makeService({
        modelId: "m",
        recommendations: [],
      });
      await service.analyseOpenFindings();

      const payload = http.post.mock.calls[0]![1].findings[0];
      // No raw report, no page HTML, no evidence blob.
      expect(Object.keys(payload).sort()).toEqual(
        [
          "category",
          "description",
          "fingerprint",
          "metricName",
          "metricUnit",
          "metricValue",
          "pageType",
          "pageUrl",
          "severity",
          "title",
        ].sort(),
      );
    });

    it("only feeds measured facts into the analysis", async () => {
      const { service, prisma } = makeService({
        modelId: "m",
        recommendations: [],
      });
      await service.analyseOpenFindings();
      const where = prisma.websiteFinding.findMany.mock.calls[0]![0].where;
      expect(where.evidenceClass).toBe("FACT");
    });

    it("discards a recommendation citing a fingerprint it was never given", async () => {
      const { service, prisma } = makeService({
        modelId: "m",
        recommendations: [
          recommendation({ findingFingerprints: ["fp-hallucinated"] }),
        ],
      });

      const result = await service.analyseOpenFindings();

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(prisma.websiteRecommendation.create).not.toHaveBeenCalled();
    });

    it("keeps only the grounded fingerprints when the model mixes real and invented", async () => {
      const { service, prisma } = makeService({
        modelId: "m",
        recommendations: [
          recommendation({
            findingFingerprints: ["fp-real-1", "fp-hallucinated"],
          }),
        ],
      });

      await service.analyseOpenFindings();

      const data = prisma.websiteRecommendation.create.mock.calls[0]![0].data;
      expect(data.findings.connect).toEqual([{ id: "finding-1" }]);
    });

    it("stores interpretation and proposed fix in separate fields", async () => {
      const { service, prisma } = makeService({
        modelId: "m",
        recommendations: [recommendation()],
      });
      await service.analyseOpenFindings();

      const data = prisma.websiteRecommendation.create.mock.calls[0]![0].data;
      expect(data.interpretation).toBe(
        "The oversized hero is likely driving the slow LCP.",
      );
      expect(data.proposedFix).toBe(
        "Convert the hero to WebP and preload it.",
      );
      // A recommendation has no metric field at all — it cannot restate one.
      expect(data).not.toHaveProperty("metricValue");
    });
  });

  describe("degradation", () => {
    it("returns early when there is nothing measured to analyse", async () => {
      const { service, http } = makeService(
        { modelId: "m", recommendations: [] },
        [],
      );
      const result = await service.analyseOpenFindings();
      expect(result.reason).toBe("no open measured findings");
      expect(http.post).not.toHaveBeenCalled();
    });

    it("reports the failure rather than throwing when the brain is down", async () => {
      const prisma = makePrisma();
      const http = {
        post: jest.fn().mockReturnValue(throwError(() => new Error("ECONNREFUSED"))),
      };
      const service = new WebsiteAnalysisService(
        prisma as any,
        http as any,
        CONFIG as any,
      );

      const result = await service.analyseOpenFindings();
      expect(result.created).toBe(0);
      expect(result.reason).toContain("ECONNREFUSED");
    });

    it("rejects a response that fails schema validation", async () => {
      const { service } = makeService({ garbage: true });
      const result = await service.analyseOpenFindings();
      expect(result.created).toBe(0);
      expect(result.reason).toBe("invalid brain response");
    });
  });
});
