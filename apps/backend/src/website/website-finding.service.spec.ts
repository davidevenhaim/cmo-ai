import { WebsiteFindingService } from "./website-finding.service";
import type { NormalizedWebsiteFinding } from "./lighthouse-normalizer.service";
import { findingFingerprint } from "./lighthouse-normalizer.service";

function makeFinding(
  overrides: Partial<NormalizedWebsiteFinding> = {},
): NormalizedWebsiteFinding {
  const pageUrl = overrides.pageUrl ?? "https://example.com";
  const category = overrides.category ?? "PERFORMANCE";
  const ruleKey = overrides.ruleKey ?? "lighthouse:largest-contentful-paint";
  return {
    ruleKey,
    fingerprint: findingFingerprint(pageUrl, category, ruleKey),
    pageUrl,
    pageType: "HOMEPAGE",
    category,
    severity: "HIGH",
    title: "Largest Contentful Paint is slow",
    description: "LCP measured at 4.20s",
    evidence: { metric: "LCP", measured: 4200 },
    metricName: "LCP",
    metricValue: 4200,
    metricUnit: "ms",
    source: "LIGHTHOUSE",
    evidenceClass: "FACT",
    suggestedFix: "Preload the hero image",
    confidence: 1,
    ...overrides,
  } as NormalizedWebsiteFinding;
}

function makePrisma() {
  return {
    websiteFinding: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "f-1" }),
      update: jest.fn().mockResolvedValue({ id: "f-1" }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

describe("WebsiteFindingService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: WebsiteFindingService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WebsiteFindingService(prisma as any);
  });

  describe("deduplication", () => {
    it("creates a new finding on first sighting", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);

      const result = await service.syncFromAudit(
        "audit-1",
        [makeFinding()],
        ["https://example.com"],
        new Map(),
      );

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(prisma.websiteFinding.create).toHaveBeenCalledTimes(1);
    });

    it("updates rather than duplicating when the same issue reappears", async () => {
      const finding = makeFinding();
      prisma.websiteFinding.findUnique.mockResolvedValue({
        id: "f-1",
        fingerprint: finding.fingerprint,
        status: "OPEN",
        metricValue: 4200,
        metricName: "LCP",
        pageAuditId: null,
        history: [{ auditId: "audit-1", at: "x", value: 4200, severity: "HIGH" }],
      });

      const result = await service.syncFromAudit(
        "audit-2",
        [finding],
        ["https://example.com"],
        new Map(),
      );

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(prisma.websiteFinding.create).not.toHaveBeenCalled();
    });

    it("appends a history entry on each sighting", async () => {
      const finding = makeFinding({ metricValue: 4500 });
      prisma.websiteFinding.findUnique.mockResolvedValue({
        id: "f-1",
        fingerprint: finding.fingerprint,
        status: "OPEN",
        metricValue: 4200,
        metricName: "LCP",
        pageAuditId: null,
        history: [{ auditId: "audit-1", at: "x", value: 4200, severity: "HIGH" }],
      });

      await service.syncFromAudit(
        "audit-2",
        [finding],
        ["https://example.com"],
        new Map(),
      );

      const update = prisma.websiteFinding.update.mock.calls[0]![0];
      expect(update.data.history).toHaveLength(2);
      expect(update.data.history[1].value).toBe(4500);
    });

    it("re-opens a previously resolved finding instead of creating a second row", async () => {
      const finding = makeFinding();
      prisma.websiteFinding.findUnique.mockResolvedValue({
        id: "f-1",
        fingerprint: finding.fingerprint,
        status: "RESOLVED",
        metricValue: 4200,
        metricName: "LCP",
        pageAuditId: null,
        history: [],
      });

      await service.syncFromAudit(
        "audit-3",
        [finding],
        ["https://example.com"],
        new Map(),
      );

      const update = prisma.websiteFinding.update.mock.calls[0]![0];
      expect(update.data.status).toBe("OPEN");
      expect(update.data.resolvedAt).toBeNull();
      expect(prisma.websiteFinding.create).not.toHaveBeenCalled();
    });

    it("leaves an owner-ignored finding ignored when it reappears", async () => {
      const finding = makeFinding();
      prisma.websiteFinding.findUnique.mockResolvedValue({
        id: "f-1",
        fingerprint: finding.fingerprint,
        status: "IGNORED",
        metricValue: 4200,
        metricName: "LCP",
        pageAuditId: null,
        history: [],
      });

      await service.syncFromAudit(
        "audit-3",
        [finding],
        ["https://example.com"],
        new Map(),
      );

      const update = prisma.websiteFinding.update.mock.calls[0]![0];
      expect(update.data.status).toBe("IGNORED");
    });
  });

  describe("resolution", () => {
    it("resolves a finding that a later audit did not reproduce", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);
      prisma.websiteFinding.findMany.mockResolvedValue([{ id: "stale-1" }]);
      prisma.websiteFinding.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.syncFromAudit(
        "audit-2",
        [],
        ["https://example.com"],
        new Map(),
      );

      expect(result.resolved).toBe(1);
      const call = prisma.websiteFinding.updateMany.mock.calls[0]![0];
      expect(call.data.status).toBe("RESOLVED");
      expect(call.data.resolvedAt).toBeInstanceOf(Date);
    });

    it("does not resolve anything when no page audited successfully", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);

      const result = await service.syncFromAudit(
        "audit-2",
        [],
        [], // every page failed
        new Map(),
      );

      expect(result.resolved).toBe(0);
      expect(prisma.websiteFinding.findMany).not.toHaveBeenCalled();
    });

    it("only considers findings on the pages that were actually audited", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);
      prisma.websiteFinding.findMany.mockResolvedValue([]);

      await service.syncFromAudit(
        "audit-2",
        [],
        ["https://example.com/a"],
        new Map(),
      );

      const where = prisma.websiteFinding.findMany.mock.calls[0]![0].where;
      expect(where.pageUrl).toEqual({ in: ["https://example.com/a"] });
    });

    it("never auto-resolves AI interpretations", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);
      prisma.websiteFinding.findMany.mockResolvedValue([]);

      await service.syncFromAudit(
        "audit-2",
        [],
        ["https://example.com"],
        new Map(),
      );

      const where = prisma.websiteFinding.findMany.mock.calls[0]![0].where;
      expect(where.evidenceClass).toBe("FACT");
    });
  });

  describe("metric regression", () => {
    async function syncWith(previous: number, current: number) {
      const finding = makeFinding({ metricValue: current });
      prisma.websiteFinding.findUnique.mockResolvedValue({
        id: "f-1",
        fingerprint: finding.fingerprint,
        status: "OPEN",
        metricValue: previous,
        metricName: "LCP",
        pageAuditId: null,
        history: [],
      });
      return service.syncFromAudit(
        "audit-2",
        [finding],
        ["https://example.com"],
        new Map(),
      );
    }

    it("reports a REGRESSED metric when the value rises", async () => {
      const result = await syncWith(3000, 4500);
      expect(result.regressions).toHaveLength(1);
      expect(result.regressions[0]!.direction).toBe("REGRESSED");
      expect(result.regressions[0]!.previousValue).toBe(3000);
      expect(result.regressions[0]!.currentValue).toBe(4500);
    });

    it("reports an IMPROVED metric when the value falls", async () => {
      const result = await syncWith(4500, 3000);
      expect(result.regressions[0]!.direction).toBe("IMPROVED");
    });

    it("ignores run-to-run noise inside the 5% band", async () => {
      const result = await syncWith(4000, 4100);
      expect(result.regressions).toHaveLength(0);
    });
  });

  describe("interpretation findings", () => {
    it("stores AI review output as INTERPRETATION, never FACT", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);

      await service.upsertInterpretationFindings(
        "audit-1",
        [
          {
            ruleKey: "cro:unclear-cta",
            fingerprint: "fp-cro-1",
            pageUrl: "https://example.com",
            pageType: "HOMEPAGE",
            category: "CONVERSION",
            severity: "MEDIUM",
            title: "Call to action is unclear",
            description: "No obvious primary action above the fold.",
            evidence: { kind: "AI_OBSERVATION" },
            metricName: null,
            metricValue: null,
            metricUnit: null,
            source: "AI_REVIEW",
            suggestedFix: "Add a single primary CTA.",
            confidence: 0.6,
          },
        ],
        new Map(),
      );

      const data = prisma.websiteFinding.create.mock.calls[0]![0].data;
      expect(data.evidenceClass).toBe("INTERPRETATION");
      expect(data.source).toBe("AI_REVIEW");
    });

    it("strips any metric the model tried to attach to an interpretation", async () => {
      prisma.websiteFinding.findUnique.mockResolvedValue(null);

      await service.upsertInterpretationFindings(
        "audit-1",
        [
          {
            ruleKey: "cro:invented-metric",
            fingerprint: "fp-cro-2",
            pageUrl: "https://example.com",
            pageType: "HOMEPAGE",
            category: "CONVERSION",
            severity: "HIGH",
            title: "Page is slow",
            description: "Model claims it measured something.",
            evidence: {},
            // A hostile/confused model supplying a metric must not be able to
            // launder an opinion into a stored measurement.
            metricName: "LCP" as any,
            metricValue: 100 as any,
            metricUnit: "ms" as any,
            source: "AI_REVIEW",
            suggestedFix: null,
            confidence: 0.9,
          } as any,
        ],
        new Map(),
      );

      const data = prisma.websiteFinding.create.mock.calls[0]![0].data;
      expect(data.metricName).toBeNull();
      expect(data.metricValue).toBeNull();
      expect(data.metricUnit).toBeNull();
    });
  });
});
