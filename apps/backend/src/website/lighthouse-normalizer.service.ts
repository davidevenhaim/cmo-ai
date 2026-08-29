import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import type {
  WebsiteFindingCategory,
  WebsiteMetrics,
  WebsitePageType,
  WebsiteScores,
  WebsiteSeverity,
} from "@ai-cmo/contracts";

/**
 * A normalized, bounded finding produced from a deterministic tool.
 *
 * `evidenceClass: "FACT"` is not decorative — the CMO context builder refuses
 * to emit anything else as a measured finding, which is what keeps A3's
 * fact/interpretation split enforceable rather than aspirational.
 */
export interface NormalizedWebsiteFinding {
  ruleKey: string;
  fingerprint: string;
  pageUrl: string;
  pageType: WebsitePageType;
  category: WebsiteFindingCategory;
  severity: WebsiteSeverity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  metricName: string | null;
  metricValue: number | null;
  metricUnit: string | null;
  source: "LIGHTHOUSE";
  evidenceClass: "FACT";
  suggestedFix: string | null;
  confidence: 1;
}

export interface NormalizedPageAudit {
  url: string;
  pageType: WebsitePageType;
  scores: WebsiteScores;
  metrics: WebsiteMetrics;
  /** Bounded audit references kept as evidence — not the raw report. */
  auditRefs: Array<{
    id: string;
    title: string;
    score: number | null;
    displayValue: string | null;
  }>;
  findings: NormalizedWebsiteFinding[];
}

export class MalformedLighthouseReportError extends Error {
  constructor(detail: string) {
    super(`Malformed Lighthouse report: ${detail}`);
    this.name = "MalformedLighthouseReportError";
  }
}

/** Stable dedup identity for a finding across audits. */
export function findingFingerprint(
  pageUrl: string,
  category: string,
  ruleKey: string,
): string {
  return createHash("sha256")
    .update(`${pageUrl.toLowerCase()}|${category}|${ruleKey}`)
    .digest("hex");
}

/** Core Web Vitals thresholds (Google's published good/needs-improvement cuts). */
const METRIC_RULES: Array<{
  auditId: string;
  metricKey: keyof WebsiteMetrics;
  metricName: string;
  unit: string;
  /** [needsImprovementAbove, poorAbove] in the metric's own unit. */
  thresholds: [number, number];
  category: WebsiteFindingCategory;
  title: string;
  fix: string;
}> = [
  {
    auditId: "largest-contentful-paint",
    metricKey: "lcpMs",
    metricName: "LCP",
    unit: "ms",
    thresholds: [2500, 4000],
    category: "PERFORMANCE",
    title: "Largest Contentful Paint is slow",
    fix: "Identify the LCP element and prioritise it: preload the asset, serve modern image formats (WebP/AVIF), and remove render-blocking resources ahead of it.",
  },
  {
    auditId: "cumulative-layout-shift",
    metricKey: "clsScore",
    metricName: "CLS",
    unit: "score",
    thresholds: [0.1, 0.25],
    category: "PERFORMANCE",
    title: "Cumulative Layout Shift is high",
    fix: "Reserve explicit width/height (or aspect-ratio) for images, embeds and ad slots, and avoid injecting content above existing content after load.",
  },
  {
    auditId: "total-blocking-time",
    metricKey: "tbtMs",
    metricName: "TBT",
    unit: "ms",
    thresholds: [200, 600],
    category: "PERFORMANCE",
    title: "Total Blocking Time is high",
    fix: "Break up long tasks, defer non-critical JavaScript, and move heavy work off the main thread. TBT is the lab proxy for field INP.",
  },
  {
    auditId: "first-contentful-paint",
    metricKey: "fcpMs",
    metricName: "FCP",
    unit: "ms",
    thresholds: [1800, 3000],
    category: "PERFORMANCE",
    title: "First Contentful Paint is slow",
    fix: "Reduce server response time and eliminate render-blocking CSS/JS in the critical path.",
  },
  {
    auditId: "speed-index",
    metricKey: "siMs",
    metricName: "Speed Index",
    unit: "ms",
    thresholds: [3400, 5800],
    category: "PERFORMANCE",
    title: "Speed Index is slow",
    fix: "Prioritise above-the-fold content and reduce the amount of work needed before the page looks complete.",
  },
];

/** Opportunity-style audits that carry a byte or millisecond saving. */
const OPPORTUNITY_RULES: Array<{
  auditId: string;
  metricKey?: keyof WebsiteMetrics;
  category: WebsiteFindingCategory;
  title: string;
  unit: "bytes" | "ms";
  /** Saving above which the finding is worth raising at all. */
  minSaving: number;
  /** Saving above which severity escalates to HIGH. */
  highSaving: number;
  fix: string;
}> = [
  {
    auditId: "uses-optimized-images",
    metricKey: "imageOptimizationBytes",
    category: "PERFORMANCE",
    title: "Images are not efficiently encoded",
    unit: "bytes",
    minSaving: 50_000,
    highSaving: 500_000,
    fix: "Re-encode images and serve WebP/AVIF with correctly sized variants via srcset.",
  },
  {
    auditId: "modern-image-formats",
    metricKey: "imageOptimizationBytes",
    category: "PERFORMANCE",
    title: "Images are not served in modern formats",
    unit: "bytes",
    minSaving: 50_000,
    highSaving: 500_000,
    fix: "Serve WebP or AVIF with a fallback, ideally generated at build/upload time.",
  },
  {
    auditId: "render-blocking-resources",
    metricKey: "renderBlockingMs",
    category: "PERFORMANCE",
    title: "Render-blocking resources delay first paint",
    unit: "ms",
    minSaving: 150,
    highSaving: 800,
    fix: "Inline critical CSS, defer the rest, and add defer/async to non-critical scripts.",
  },
  {
    auditId: "unused-javascript",
    metricKey: "unusedJsBytes",
    category: "PERFORMANCE",
    title: "Unused JavaScript is being shipped",
    unit: "bytes",
    minSaving: 100_000,
    highSaving: 800_000,
    fix: "Code-split by route, tree-shake, and lazy-load third-party scripts that are not needed for first render.",
  },
  {
    auditId: "unused-css-rules",
    metricKey: "unusedCssBytes",
    category: "PERFORMANCE",
    title: "Unused CSS is being shipped",
    unit: "bytes",
    minSaving: 50_000,
    highSaving: 400_000,
    fix: "Purge unused selectors at build time and split stylesheets per template.",
  },
  {
    auditId: "uses-long-cache-ttl",
    category: "BEST_PRACTICE",
    title: "Static assets have an inefficient cache policy",
    unit: "bytes",
    minSaving: 100_000,
    highSaving: 1_000_000,
    fix: "Serve fingerprinted static assets with a long max-age and immutable.",
  },
];

/**
 * Non-scored audits worth surfacing when they fail outright. Category choice
 * routes SEO/accessibility failures to the right operator filter.
 */
const BINARY_RULES: Array<{
  auditId: string;
  category: WebsiteFindingCategory;
  severity: WebsiteSeverity;
  title: string;
  fix: string;
}> = [
  {
    auditId: "meta-description",
    category: "SEO",
    severity: "MEDIUM",
    title: "Page is missing a meta description",
    fix: "Add a unique 120–160 character meta description that reflects the page's intent.",
  },
  {
    auditId: "document-title",
    category: "SEO",
    severity: "HIGH",
    title: "Page is missing a title element",
    fix: "Add a descriptive, unique <title>.",
  },
  {
    auditId: "http-status-code",
    category: "TECHNICAL",
    severity: "CRITICAL",
    title: "Page returns an unsuccessful HTTP status",
    fix: "Fix the failing response before investing in any traffic to this URL.",
  },
  {
    auditId: "is-crawlable",
    category: "SEO",
    severity: "CRITICAL",
    title: "Page is blocked from indexing",
    fix: "Remove the noindex directive or robots.txt block if this page should rank.",
  },
  {
    auditId: "hreflang",
    category: "SEO",
    severity: "LOW",
    title: "hreflang is invalid",
    fix: "Correct the hreflang annotations so they reference valid, reciprocal locales.",
  },
  {
    auditId: "canonical",
    category: "SEO",
    severity: "MEDIUM",
    title: "Canonical link is invalid",
    fix: "Point the canonical at the single preferred URL for this content.",
  },
  {
    auditId: "viewport",
    category: "MOBILE",
    severity: "HIGH",
    title: "Page has no valid viewport meta tag",
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  },
  {
    auditId: "is-on-https",
    category: "TRUST",
    severity: "CRITICAL",
    title: "Page is not served over HTTPS",
    fix: "Serve the whole site over HTTPS and redirect HTTP.",
  },
  {
    auditId: "errors-in-console",
    category: "BEST_PRACTICE",
    severity: "LOW",
    title: "Browser errors were logged to the console",
    fix: "Investigate console errors — they often indicate broken third-party scripts.",
  },
];

const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_STRING = 300;

@Injectable()
export class LighthouseNormalizerService {
  private readonly logger = new Logger(LighthouseNormalizerService.name);

  /**
   * Turns a raw Lighthouse report into bounded scores, metrics and findings.
   *
   * Throws MalformedLighthouseReportError when the report is structurally
   * unusable, so the caller can record a per-page failure instead of
   * persisting silent zeros.
   */
  normalize(
    lhr: unknown,
    pageUrl: string,
    pageType: WebsitePageType,
  ): NormalizedPageAudit {
    if (!lhr || typeof lhr !== "object") {
      throw new MalformedLighthouseReportError("report is not an object");
    }
    const report = lhr as Record<string, any>;
    const categories = report.categories;
    const audits = report.audits;

    if (!audits || typeof audits !== "object") {
      throw new MalformedLighthouseReportError("missing audits section");
    }
    if (!categories || typeof categories !== "object") {
      throw new MalformedLighthouseReportError("missing categories section");
    }

    const scores: WebsiteScores = {
      performance: this.categoryScore(categories.performance),
      accessibility: this.categoryScore(categories.accessibility),
      seo: this.categoryScore(categories.seo),
      bestPractices: this.categoryScore(categories["best-practices"]),
    };

    const metrics = this.extractMetrics(audits);
    const findings: NormalizedWebsiteFinding[] = [
      ...this.metricFindings(audits, metrics, pageUrl, pageType),
      ...this.opportunityFindings(audits, pageUrl, pageType),
      ...this.binaryFindings(audits, pageUrl, pageType),
      ...this.accessibilityFindings(audits, pageUrl, pageType),
    ];

    const auditRefs = Object.values(audits)
      .filter((a: any) => a && typeof a.id === "string" && a.score !== null)
      .slice(0, 120)
      .map((a: any) => ({
        id: String(a.id),
        title: String(a.title ?? a.id).slice(0, 200),
        score: typeof a.score === "number" ? a.score : null,
        displayValue: a.displayValue ? String(a.displayValue).slice(0, 120) : null,
      }));

    return { url: pageUrl, pageType, scores, metrics, auditRefs, findings };
  }

  /** Lighthouse category scores are 0-1; the product speaks in 0-100. */
  private categoryScore(category: any): number | null {
    const raw = category?.score;
    if (typeof raw !== "number" || Number.isNaN(raw)) return null;
    return Math.round(raw * 100);
  }

  private numericValue(audit: any): number | null {
    const v = audit?.numericValue;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  private extractMetrics(audits: Record<string, any>): WebsiteMetrics {
    return {
      lcpMs: this.numericValue(audits["largest-contentful-paint"]),
      fcpMs: this.numericValue(audits["first-contentful-paint"]),
      clsScore: this.numericValue(audits["cumulative-layout-shift"]),
      tbtMs: this.numericValue(audits["total-blocking-time"]),
      siMs: this.numericValue(audits["speed-index"]),
      ttiMs: this.numericValue(audits["interactive"]),
      totalByteWeight: this.numericValue(audits["total-byte-weight"]),
      unusedJsBytes: this.savingsBytes(audits["unused-javascript"]),
      unusedCssBytes: this.savingsBytes(audits["unused-css-rules"]),
      renderBlockingMs: this.numericValue(audits["render-blocking-resources"]),
      imageOptimizationBytes:
        (this.savingsBytes(audits["uses-optimized-images"]) ?? 0) +
          (this.savingsBytes(audits["modern-image-formats"]) ?? 0) || null,
      accessibilityViolations: this.countAccessibilityViolations(audits),
    };
  }

  private savingsBytes(audit: any): number | null {
    const v = audit?.details?.overallSavingsBytes ?? audit?.numericValue;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  private savingsMs(audit: any): number | null {
    const v = audit?.details?.overallSavingsMs ?? audit?.numericValue;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  private countAccessibilityViolations(audits: Record<string, any>): number {
    let count = 0;
    for (const audit of Object.values(audits)) {
      const a = audit as any;
      if (!a || typeof a.id !== "string") continue;
      // Accessibility audits are binary-scored with a details.items list.
      if (a.score === 0 && Array.isArray(a.details?.items) && a.scoreDisplayMode === "binary") {
        if (ACCESSIBILITY_AUDIT_IDS.has(a.id)) count += a.details.items.length;
      }
    }
    return count;
  }

  private severityFromThresholds(
    value: number,
    [needsImprovement, poor]: [number, number],
  ): WebsiteSeverity | null {
    if (value >= poor * 1.5) return "CRITICAL";
    if (value >= poor) return "HIGH";
    if (value >= needsImprovement) return "MEDIUM";
    return null;
  }

  private metricFindings(
    audits: Record<string, any>,
    metrics: WebsiteMetrics,
    pageUrl: string,
    pageType: WebsitePageType,
  ): NormalizedWebsiteFinding[] {
    const out: NormalizedWebsiteFinding[] = [];
    for (const rule of METRIC_RULES) {
      const value = metrics[rule.metricKey];
      if (typeof value !== "number") continue;
      const severity = this.severityFromThresholds(value, rule.thresholds);
      if (!severity) continue;

      const audit = audits[rule.auditId];
      const displayValue = audit?.displayValue
        ? String(audit.displayValue).slice(0, 120)
        : null;

      out.push(
        this.build({
          ruleKey: `lighthouse:${rule.auditId}`,
          pageUrl,
          pageType,
          category: rule.category,
          severity,
          title: rule.title,
          description:
            `${rule.metricName} measured at ${this.formatMetric(value, rule.unit)} ` +
            `(good is under ${this.formatMetric(rule.thresholds[0], rule.unit)}).`,
          evidence: {
            metric: rule.metricName,
            measured: value,
            unit: rule.unit,
            goodThreshold: rule.thresholds[0],
            poorThreshold: rule.thresholds[1],
            displayValue,
          },
          metricName: rule.metricName,
          metricValue: value,
          metricUnit: rule.unit,
          suggestedFix: rule.fix,
        }),
      );
    }
    return out;
  }

  private opportunityFindings(
    audits: Record<string, any>,
    pageUrl: string,
    pageType: WebsitePageType,
  ): NormalizedWebsiteFinding[] {
    const out: NormalizedWebsiteFinding[] = [];
    for (const rule of OPPORTUNITY_RULES) {
      const audit = audits[rule.auditId];
      if (!audit) continue;
      const saving =
        rule.unit === "bytes"
          ? this.savingsBytes(audit)
          : this.savingsMs(audit);
      if (saving == null || saving < rule.minSaving) continue;

      const severity: WebsiteSeverity =
        saving >= rule.highSaving ? "HIGH" : "MEDIUM";

      out.push(
        this.build({
          ruleKey: `lighthouse:${rule.auditId}`,
          pageUrl,
          pageType,
          category: rule.category,
          severity,
          title: rule.title,
          description:
            `Lighthouse estimates a saving of ${this.formatMetric(saving, rule.unit)} ` +
            `on this page.`,
          evidence: {
            estimatedSaving: saving,
            unit: rule.unit,
            items: this.boundedItems(audit),
          },
          metricName: rule.auditId,
          metricValue: saving,
          metricUnit: rule.unit,
          suggestedFix: rule.fix,
        }),
      );
    }
    return out;
  }

  private binaryFindings(
    audits: Record<string, any>,
    pageUrl: string,
    pageType: WebsitePageType,
  ): NormalizedWebsiteFinding[] {
    const out: NormalizedWebsiteFinding[] = [];
    for (const rule of BINARY_RULES) {
      const audit = audits[rule.auditId];
      if (!audit) continue;
      // score === 0 is a real failure; null means "not applicable".
      if (audit.score !== 0) continue;

      out.push(
        this.build({
          ruleKey: `lighthouse:${rule.auditId}`,
          pageUrl,
          pageType,
          category: rule.category,
          severity: rule.severity,
          title: rule.title,
          description: String(
            audit.description ?? audit.title ?? rule.title,
          ).slice(0, 600),
          evidence: {
            auditId: rule.auditId,
            displayValue: audit.displayValue
              ? String(audit.displayValue).slice(0, 120)
              : null,
            items: this.boundedItems(audit),
          },
          metricName: null,
          metricValue: null,
          metricUnit: null,
          suggestedFix: rule.fix,
        }),
      );
    }
    return out;
  }

  private accessibilityFindings(
    audits: Record<string, any>,
    pageUrl: string,
    pageType: WebsitePageType,
  ): NormalizedWebsiteFinding[] {
    const out: NormalizedWebsiteFinding[] = [];
    for (const auditId of ACCESSIBILITY_AUDIT_IDS) {
      const audit = audits[auditId];
      if (!audit || audit.score !== 0) continue;
      const itemCount = Array.isArray(audit.details?.items)
        ? audit.details.items.length
        : 0;

      out.push(
        this.build({
          ruleKey: `lighthouse:${auditId}`,
          pageUrl,
          pageType,
          category: "ACCESSIBILITY",
          // A single violation is worth fixing; many indicate a systemic issue.
          severity: itemCount >= 5 ? "HIGH" : "MEDIUM",
          title: String(audit.title ?? auditId).slice(0, 200),
          description: String(audit.description ?? "").slice(0, 600),
          evidence: {
            auditId,
            violationCount: itemCount,
            items: this.boundedItems(audit),
          },
          metricName: "accessibilityViolations",
          metricValue: itemCount || null,
          metricUnit: "count",
          suggestedFix:
            "Resolve the flagged elements — accessibility failures also degrade SEO and usability for every visitor.",
        }),
      );
    }
    return out;
  }

  /**
   * Evidence must stay small and free of page markup: findings feed the LLM
   * context, and an unbounded details blob would defeat A1's "no gigantic raw
   * JSON into Ollama" rule.
   */
  private boundedItems(audit: any): Array<Record<string, unknown>> {
    const items = audit?.details?.items;
    if (!Array.isArray(items)) return [];
    return items.slice(0, MAX_EVIDENCE_ITEMS).map((item: any) => {
      const out: Record<string, unknown> = {};
      for (const key of ["url", "node", "source", "wastedBytes", "wastedMs", "totalBytes"]) {
        const value = item?.[key];
        if (value == null) continue;
        if (typeof value === "number") {
          out[key] = value;
        } else if (typeof value === "string") {
          out[key] = value.slice(0, MAX_EVIDENCE_STRING);
        } else if (key === "node" && typeof value === "object") {
          // Keep the human-readable selector/snippet only.
          out.node = {
            selector: String(value.selector ?? "").slice(0, 200),
            snippet: String(value.snippet ?? "").slice(0, MAX_EVIDENCE_STRING),
          };
        }
      }
      return out;
    });
  }

  private formatMetric(value: number, unit: string): string {
    if (unit === "ms") {
      return value >= 1000
        ? `${(value / 1000).toFixed(2)}s`
        : `${Math.round(value)}ms`;
    }
    if (unit === "bytes") {
      if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
      return `${Math.round(value / 1024)}KB`;
    }
    if (unit === "score") return value.toFixed(3);
    return `${value}`;
  }

  private build(
    partial: Omit<
      NormalizedWebsiteFinding,
      "fingerprint" | "source" | "evidenceClass" | "confidence"
    >,
  ): NormalizedWebsiteFinding {
    return {
      ...partial,
      fingerprint: findingFingerprint(
        partial.pageUrl,
        partial.category,
        partial.ruleKey,
      ),
      source: "LIGHTHOUSE",
      evidenceClass: "FACT",
      confidence: 1,
    };
  }
}

/** Accessibility audits we raise individually. */
const ACCESSIBILITY_AUDIT_IDS = new Set([
  "color-contrast",
  "image-alt",
  "link-name",
  "button-name",
  "label",
  "html-has-lang",
  "aria-required-attr",
  "aria-valid-attr-value",
  "heading-order",
  "meta-viewport",
  "list",
  // "document-title" is deliberately absent — BINARY_RULES already raises it
  // under SEO, and fingerprints are per-category, so listing it here too
  // would surface the same failure twice.
  "duplicate-id-aria",
  "frame-title",
  "input-image-alt",
  "tabindex",
  "td-headers-attr",
  "valid-lang",
]);
