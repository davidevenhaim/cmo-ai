import { WebsiteAuditService } from "./website-audit.service";
import { LighthouseNormalizerService } from "./lighthouse-normalizer.service";
import { WebsiteFindingService } from "./website-finding.service";

function makeReport(perf = 0.5) {
  return {
    categories: {
      performance: { score: perf },
      accessibility: { score: 0.9 },
      seo: { score: 0.8 },
      "best-practices": { score: 0.7 },
    },
    audits: {
      "largest-contentful-paint": {
        id: "largest-contentful-paint",
        numericValue: 4200,
        score: 0.1,
      },
    },
  };
}

function makePrisma() {
  let auditSeq = 0;
  let pageSeq = 0;
  return {
    websiteAudit: {
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `audit-${++auditSeq}`, ...data }),
      ),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    websitePageAudit: {
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `page-${++pageSeq}`, ...data }),
      ),
    },
  };
}

describe("WebsiteAuditService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let lighthouse: { configured: boolean; run: jest.Mock };
  let findings: { syncFromAudit: jest.Mock };
  let settings: {
    get: jest.Mock;
    resolveAuditTargets: jest.Mock;
    isCategoryEnabled: jest.Mock;
  };
  let croReview: { reviewPages: jest.Mock };
  let service: WebsiteAuditService;

  const defaultSettings = {
    websiteUrl: "https://example.com",
    auditUrls: [],
    enabledCategories: [
      "PERFORMANCE",
      "SEO",
      "ACCESSIBILITY",
      "BEST_PRACTICE",
    ],
    cadence: "MANUAL",
    maxPages: 10,
    formFactor: "MOBILE",
    croReviewEnabled: false,
    auditTimeoutMs: 120_000,
  };

  beforeEach(() => {
    prisma = makePrisma();
    lighthouse = {
      configured: true,
      run: jest.fn().mockResolvedValue({
        status: "OK",
        lhr: makeReport(),
        durationMs: 1200,
      }),
    };
    findings = {
      syncFromAudit: jest.fn().mockResolvedValue({
        created: 1,
        updated: 0,
        resolved: 0,
        regressions: [],
      }),
    };
    settings = {
      get: jest.fn().mockResolvedValue(defaultSettings),
      resolveAuditTargets: jest.fn().mockResolvedValue([
        { url: "https://example.com", pageType: "HOMEPAGE" },
      ]),
      isCategoryEnabled: jest.fn().mockReturnValue(true),
    };
    croReview = { reviewPages: jest.fn().mockResolvedValue(0) };

    service = new WebsiteAuditService(
      prisma as any,
      lighthouse as any,
      new LighthouseNormalizerService(),
      findings as unknown as WebsiteFindingService,
      settings as any,
      croReview as any,
    );
  });

  describe("successful audit", () => {
    it("stores page scores and completes", async () => {
      const result = await service.runAudit();
      expect(result.status).toBe("COMPLETED");
      expect(result.pagesAudited).toBe(1);
      expect(result.pagesFailed).toBe(0);

      const page = prisma.websitePageAudit.create.mock.calls[0]![0].data;
      expect(page.performance).toBe(50);
      expect(page.seo).toBe(80);
      expect(page.status).toBe("OK");
    });

    it("rolls site scores up as the median of page scores", async () => {
      settings.resolveAuditTargets.mockResolvedValue([
        { url: "https://example.com/a", pageType: "HOMEPAGE" },
        { url: "https://example.com/b", pageType: "PRODUCT" },
        { url: "https://example.com/c", pageType: "PRODUCT" },
      ]);
      lighthouse.run
        .mockResolvedValueOnce({ status: "OK", lhr: makeReport(0.2) })
        .mockResolvedValueOnce({ status: "OK", lhr: makeReport(0.6) })
        .mockResolvedValueOnce({ status: "OK", lhr: makeReport(0.9) });

      await service.runAudit();

      const update = prisma.websiteAudit.update.mock.calls[0]![0];
      expect(update.data.scores.performance).toBe(60);
    });

    it("filters out findings in categories the owner disabled", async () => {
      settings.isCategoryEnabled.mockImplementation(
        (_s: unknown, category: string) => category !== "PERFORMANCE",
      );
      await service.runAudit();
      const passed = findings.syncFromAudit.mock.calls[0]![1];
      expect(
        passed.find((f: any) => f.category === "PERFORMANCE"),
      ).toBeUndefined();
    });
  });

  describe("lighthouse unavailable", () => {
    it("fails the audit without creating page rows when not configured", async () => {
      lighthouse.configured = false;
      const result = await service.runAudit();
      expect(result.status).toBe("FAILED");
      expect(result.failureReason).toContain("LIGHTHOUSE_BASE_URL");
      expect(prisma.websitePageAudit.create).not.toHaveBeenCalled();
    });

    it("stops after the first page when the runner is unreachable", async () => {
      settings.resolveAuditTargets.mockResolvedValue([
        { url: "https://example.com/a", pageType: "HOMEPAGE" },
        { url: "https://example.com/b", pageType: "PRODUCT" },
        { url: "https://example.com/c", pageType: "PRODUCT" },
      ]);
      lighthouse.run.mockResolvedValue({
        status: "UNAVAILABLE",
        failureReason: "connect ECONNREFUSED",
      });

      const result = await service.runAudit();

      // One attempt, not three — a dead runner fails identically every time.
      expect(lighthouse.run).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("FAILED");
      expect(result.failureReason).toBe("Lighthouse runner unreachable");
    });

    it("does not resolve existing findings when every page failed", async () => {
      lighthouse.run.mockResolvedValue({
        status: "UNAVAILABLE",
        failureReason: "down",
      });
      await service.runAudit();
      // Empty audited-URL list is what stops syncFromAudit resolving anything.
      expect(findings.syncFromAudit.mock.calls[0]![2]).toEqual([]);
    });
  });

  describe("per-page failures", () => {
    it("records a timeout as a page failure and keeps going", async () => {
      settings.resolveAuditTargets.mockResolvedValue([
        { url: "https://example.com/a", pageType: "HOMEPAGE" },
        { url: "https://example.com/b", pageType: "PRODUCT" },
      ]);
      lighthouse.run
        .mockResolvedValueOnce({
          status: "TIMEOUT",
          failureReason: "audit exceeded 120000ms",
        })
        .mockResolvedValueOnce({ status: "OK", lhr: makeReport() });

      const result = await service.runAudit();

      expect(result.status).toBe("PARTIAL");
      expect(result.pagesFailed).toBe(1);
      expect(result.pagesAudited).toBe(1);

      const failedPage = prisma.websitePageAudit.create.mock.calls[0]![0].data;
      expect(failedPage.status).toBe("TIMEOUT");
      expect(failedPage.failureReason).toContain("120000ms");
    });

    it("treats a malformed report as a single page failure", async () => {
      settings.resolveAuditTargets.mockResolvedValue([
        { url: "https://example.com/a", pageType: "HOMEPAGE" },
        { url: "https://example.com/b", pageType: "PRODUCT" },
      ]);
      lighthouse.run
        .mockResolvedValueOnce({ status: "OK", lhr: { nonsense: true } })
        .mockResolvedValueOnce({ status: "OK", lhr: makeReport() });

      const result = await service.runAudit();

      expect(result.status).toBe("PARTIAL");
      expect(result.pagesAudited).toBe(1);
      const failed = prisma.websitePageAudit.create.mock.calls[0]![0].data;
      expect(failed.status).toBe("FAILED");
      expect(failed.failureReason).toContain("Malformed Lighthouse report");
    });

    it("excludes a failed page from the resolution scope", async () => {
      settings.resolveAuditTargets.mockResolvedValue([
        { url: "https://example.com/a", pageType: "HOMEPAGE" },
        { url: "https://example.com/b", pageType: "PRODUCT" },
      ]);
      lighthouse.run
        .mockResolvedValueOnce({ status: "FAILED", failureReason: "boom" })
        .mockResolvedValueOnce({ status: "OK", lhr: makeReport() });

      await service.runAudit();

      // Only the page that succeeded may have its findings resolved.
      expect(findings.syncFromAudit.mock.calls[0]![2]).toEqual([
        "https://example.com/b",
      ]);
    });
  });

  describe("configuration", () => {
    it("fails cleanly when no URLs are configured", async () => {
      settings.resolveAuditTargets.mockResolvedValue([]);
      const result = await service.runAudit();
      expect(result.status).toBe("FAILED");
      expect(result.failureReason).toContain("No website URL");
      expect(lighthouse.run).not.toHaveBeenCalled();
    });

    it("passes the configured form factor and timeout to the runner", async () => {
      settings.get.mockResolvedValue({
        ...defaultSettings,
        formFactor: "DESKTOP",
        auditTimeoutMs: 45_000,
      });
      await service.runAudit();
      expect(lighthouse.run).toHaveBeenCalledWith("https://example.com", {
        formFactor: "DESKTOP",
        timeoutMs: 45_000,
      });
    });
  });

  describe("CRO review", () => {
    it("runs only when enabled", async () => {
      await service.runAudit();
      expect(croReview.reviewPages).not.toHaveBeenCalled();

      settings.get.mockResolvedValue({
        ...defaultSettings,
        croReviewEnabled: true,
      });
      await service.runAudit();
      expect(croReview.reviewPages).toHaveBeenCalled();
    });

    it("does not fail the technical audit when the review throws", async () => {
      settings.get.mockResolvedValue({
        ...defaultSettings,
        croReviewEnabled: true,
      });
      croReview.reviewPages.mockRejectedValue(new Error("brain down"));

      const result = await service.runAudit();
      expect(result.status).toBe("COMPLETED");
      expect(result.croObservations).toBe(0);
    });
  });
});
