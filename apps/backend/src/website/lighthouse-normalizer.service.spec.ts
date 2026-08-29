import {
  findingFingerprint,
  LighthouseNormalizerService,
  MalformedLighthouseReportError,
} from "./lighthouse-normalizer.service";

/** Minimal but structurally faithful Lighthouse report. */
function makeReport(overrides: Record<string, any> = {}) {
  return {
    categories: {
      performance: { score: 0.42 },
      accessibility: { score: 0.84 },
      seo: { score: 0.91 },
      "best-practices": { score: 0.75 },
      ...(overrides.categories ?? {}),
    },
    audits: {
      "largest-contentful-paint": {
        id: "largest-contentful-paint",
        title: "Largest Contentful Paint",
        numericValue: 4200,
        displayValue: "4.2 s",
        score: 0.1,
      },
      "first-contentful-paint": {
        id: "first-contentful-paint",
        numericValue: 1200,
        score: 0.9,
      },
      "cumulative-layout-shift": {
        id: "cumulative-layout-shift",
        numericValue: 0.02,
        score: 1,
      },
      "total-blocking-time": {
        id: "total-blocking-time",
        numericValue: 120,
        score: 0.95,
      },
      "speed-index": { id: "speed-index", numericValue: 2000, score: 0.9 },
      "uses-optimized-images": {
        id: "uses-optimized-images",
        title: "Efficiently encode images",
        score: 0.2,
        details: {
          overallSavingsBytes: 3_800_000,
          items: [
            { url: "https://example.com/hero.png", wastedBytes: 3_500_000 },
          ],
        },
      },
      "meta-description": {
        id: "meta-description",
        title: "Document does not have a meta description",
        description: "Meta descriptions may be included in search results.",
        score: 0,
      },
      "image-alt": {
        id: "image-alt",
        title: "Image elements do not have [alt] attributes",
        description: "Informative elements should aim for short alt text.",
        score: 0,
        scoreDisplayMode: "binary",
        details: {
          items: [
            { node: { selector: "img.hero", snippet: "<img src=hero.png>" } },
            { node: { selector: "img.logo", snippet: "<img src=logo.png>" } },
          ],
        },
      },
      ...(overrides.audits ?? {}),
    },
  };
}

describe("LighthouseNormalizerService", () => {
  let normalizer: LighthouseNormalizerService;

  beforeEach(() => {
    normalizer = new LighthouseNormalizerService();
  });

  describe("successful audit", () => {
    it("converts 0-1 category scores to 0-100", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      expect(result.scores).toEqual({
        performance: 42,
        accessibility: 84,
        seo: 91,
        bestPractices: 75,
      });
    });

    it("extracts deterministic metrics from the report", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      expect(result.metrics.lcpMs).toBe(4200);
      expect(result.metrics.clsScore).toBe(0.02);
      expect(result.metrics.tbtMs).toBe(120);
    });

    it("raises an LCP finding carrying the measured value", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      const lcp = result.findings.find(
        (f) => f.ruleKey === "lighthouse:largest-contentful-paint",
      );
      expect(lcp).toBeDefined();
      expect(lcp!.metricValue).toBe(4200);
      expect(lcp!.metricUnit).toBe("ms");
      expect(lcp!.category).toBe("PERFORMANCE");
      expect(lcp!.severity).toBe("HIGH");
    });

    it("marks every Lighthouse finding as a measured FACT", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      expect(result.findings.length).toBeGreaterThan(0);
      for (const f of result.findings) {
        expect(f.evidenceClass).toBe("FACT");
        expect(f.source).toBe("LIGHTHOUSE");
        expect(f.confidence).toBe(1);
      }
    });

    it("does not raise findings for metrics inside the good range", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      // CLS is 0.02 — well under the 0.1 good threshold.
      expect(
        result.findings.find(
          (f) => f.ruleKey === "lighthouse:cumulative-layout-shift",
        ),
      ).toBeUndefined();
    });

    it("escalates severity with the size of the estimated saving", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      const images = result.findings.find(
        (f) => f.ruleKey === "lighthouse:uses-optimized-images",
      );
      expect(images!.severity).toBe("HIGH");
      expect(images!.metricValue).toBe(3_800_000);
    });

    it("routes a failed SEO audit to the SEO category", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      const meta = result.findings.find(
        (f) => f.ruleKey === "lighthouse:meta-description",
      );
      expect(meta!.category).toBe("SEO");
      expect(meta!.severity).toBe("MEDIUM");
    });

    it("counts accessibility violations from the audit details", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      const alt = result.findings.find(
        (f) => f.ruleKey === "lighthouse:image-alt",
      );
      expect(alt!.category).toBe("ACCESSIBILITY");
      expect(alt!.metricValue).toBe(2);
    });
  });

  describe("bounded evidence", () => {
    it("caps evidence items so raw report data cannot reach the LLM", () => {
      const report = makeReport({
        audits: {
          "unused-javascript": {
            id: "unused-javascript",
            score: 0.1,
            details: {
              overallSavingsBytes: 900_000,
              items: Array.from({ length: 50 }, (_, i) => ({
                url: `https://example.com/chunk-${i}.js`,
                wastedBytes: 20_000,
              })),
            },
          },
        },
      });
      const result = normalizer.normalize(
        report,
        "https://example.com",
        "HOMEPAGE",
      );
      const js = result.findings.find(
        (f) => f.ruleKey === "lighthouse:unused-javascript",
      );
      expect((js!.evidence.items as unknown[]).length).toBeLessThanOrEqual(3);
    });

    it("truncates long evidence strings", () => {
      const report = makeReport({
        audits: {
          "render-blocking-resources": {
            id: "render-blocking-resources",
            score: 0,
            details: {
              overallSavingsMs: 900,
              items: [{ url: `https://example.com/${"a".repeat(2000)}.css` }],
            },
          },
        },
      });
      const result = normalizer.normalize(
        report,
        "https://example.com",
        "HOMEPAGE",
      );
      const rb = result.findings.find(
        (f) => f.ruleKey === "lighthouse:render-blocking-resources",
      );
      const item = (rb!.evidence.items as Array<{ url: string }>)[0]!;
      expect(item.url.length).toBeLessThanOrEqual(300);
    });
  });

  describe("malformed reports", () => {
    it("throws when the report is not an object", () => {
      expect(() =>
        normalizer.normalize("not a report", "https://example.com", "HOMEPAGE"),
      ).toThrow(MalformedLighthouseReportError);
    });

    it("throws when the audits section is missing", () => {
      expect(() =>
        normalizer.normalize(
          { categories: { performance: { score: 0.5 } } },
          "https://example.com",
          "HOMEPAGE",
        ),
      ).toThrow(MalformedLighthouseReportError);
    });

    it("throws when the categories section is missing", () => {
      expect(() =>
        normalizer.normalize(
          { audits: {} },
          "https://example.com",
          "HOMEPAGE",
        ),
      ).toThrow(MalformedLighthouseReportError);
    });

    it("returns null scores rather than zeros when a category is unscored", () => {
      const report = makeReport();
      (report.categories as any).performance = { score: null };
      const result = normalizer.normalize(
        report,
        "https://example.com",
        "HOMEPAGE",
      );
      // Null must not be coerced to 0 — that would read as a real measurement.
      expect(result.scores.performance).toBeNull();
    });

    it("tolerates an audit with a missing numericValue", () => {
      const report = makeReport();
      delete (report.audits as any)["largest-contentful-paint"].numericValue;
      const result = normalizer.normalize(
        report,
        "https://example.com",
        "HOMEPAGE",
      );
      expect(result.metrics.lcpMs).toBeNull();
      expect(
        result.findings.find(
          (f) => f.ruleKey === "lighthouse:largest-contentful-paint",
        ),
      ).toBeUndefined();
    });
  });

  describe("multiple page types", () => {
    it("carries the page type onto every finding", () => {
      const result = normalizer.normalize(
        makeReport(),
        "https://example.com/products/serum",
        "PRODUCT",
      );
      for (const f of result.findings) {
        expect(f.pageType).toBe("PRODUCT");
        expect(f.pageUrl).toBe("https://example.com/products/serum");
      }
    });

    it("gives the same rule on different pages distinct fingerprints", () => {
      const home = normalizer.normalize(
        makeReport(),
        "https://example.com",
        "HOMEPAGE",
      );
      const product = normalizer.normalize(
        makeReport(),
        "https://example.com/products/serum",
        "PRODUCT",
      );
      const homeLcp = home.findings.find((f) =>
        f.ruleKey.endsWith("largest-contentful-paint"),
      )!;
      const productLcp = product.findings.find((f) =>
        f.ruleKey.endsWith("largest-contentful-paint"),
      )!;
      expect(homeLcp.fingerprint).not.toBe(productLcp.fingerprint);
    });
  });

  describe("findingFingerprint", () => {
    it("is stable across runs for the same page/category/rule", () => {
      const a = findingFingerprint("https://example.com", "PERFORMANCE", "r");
      const b = findingFingerprint("https://example.com", "PERFORMANCE", "r");
      expect(a).toBe(b);
    });

    it("ignores URL casing so a re-audit does not duplicate the finding", () => {
      const a = findingFingerprint("https://Example.com", "PERFORMANCE", "r");
      const b = findingFingerprint("https://example.com", "PERFORMANCE", "r");
      expect(a).toBe(b);
    });

    it("differs by category", () => {
      const a = findingFingerprint("https://example.com", "PERFORMANCE", "r");
      const b = findingFingerprint("https://example.com", "SEO", "r");
      expect(a).not.toBe(b);
    });
  });
});
