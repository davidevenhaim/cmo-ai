import { Injectable, Logger } from "@nestjs/common";
import type { WebsiteContext, WebsiteScores } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { WebsiteSettingsService } from "./website-settings.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

/** Audits older than this are still shown, but flagged STALE. */
const STALE_AFTER_HOURS = 24 * 7;

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

/**
 * A7 — the bounded website slice handed to the CMO.
 *
 * Two rules shape this object:
 *  1. It is small. Counts, four scores, and at most ten findings.
 *  2. Measured facts and AI interpretations are returned in *separate* fields
 *     (`topFindings` vs `croObservations`) so the prompt layer cannot blur
 *     them, and so the model can never present an opinion as a measurement.
 */
@Injectable()
export class WebsiteContextService {
  private readonly logger = new Logger(WebsiteContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WebsiteSettingsService,
  ) {}

  async build(brandId = DEFAULT_BRAND_ID): Promise<WebsiteContext> {
    const settings = await this.settings.get(brandId);

    const empty: WebsiteContext = {
      evidenceStatus: "NOT_CONFIGURED",
      websiteUrl: settings.websiteUrl,
      lastAuditAt: null,
      pagesAudited: 0,
      scores: {
        performance: null,
        accessibility: null,
        seo: null,
        bestPractices: null,
      },
      openCritical: 0,
      openHigh: 0,
      openMedium: 0,
      openTotal: 0,
      topFindings: [],
      croObservations: [],
      regressions: [],
      failureReason: null,
    };

    if (!settings.websiteUrl && settings.auditUrls.length === 0) {
      return {
        ...empty,
        failureReason: "No website URL configured",
      };
    }

    const latest = await this.prisma.websiteAudit.findFirst({
      where: { brandId, status: { in: ["COMPLETED", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
    });

    if (!latest) {
      return {
        ...empty,
        evidenceStatus: "UNAVAILABLE",
        failureReason: "No completed website audit yet",
      };
    }

    const ageHours =
      (Date.now() - (latest.completedAt ?? latest.startedAt).getTime()) /
      3_600_000;

    const [openFindings, croFindings, severityCounts] = await Promise.all([
      this.prisma.websiteFinding.findMany({
        where: {
          brandId,
          status: "OPEN",
          evidenceClass: "FACT",
          severity: { in: ["CRITICAL", "HIGH", "MEDIUM"] },
        },
        orderBy: [{ lastSeenAt: "desc" }],
        take: 40,
      }),
      this.prisma.websiteFinding.findMany({
        where: {
          brandId,
          status: "OPEN",
          evidenceClass: "INTERPRETATION",
        },
        orderBy: [{ lastSeenAt: "desc" }],
        take: 30,
      }),
      this.prisma.websiteFinding.groupBy({
        by: ["severity"],
        where: { brandId, status: "OPEN" },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of severityCounts) counts[row.severity] = row._count._all;

    const bySeverity = (a: { severity: string }, b: { severity: string }) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);

    const topFindings = [...openFindings]
      .sort(bySeverity)
      .slice(0, 10)
      .map((f) => ({
        pageUrl: f.pageUrl,
        pageType: f.pageType as any,
        category: f.category as any,
        severity: f.severity as any,
        title: f.title,
        evidenceSummary: this.evidenceSummary(f),
        metricName: f.metricName,
        metricValue: f.metricValue,
        metricUnit: f.metricUnit,
      }));

    const croObservations = [...croFindings]
      .sort(bySeverity)
      .slice(0, 10)
      .map((f) => ({
        pageUrl: f.pageUrl,
        category: f.category as any,
        severity: f.severity as any,
        title: f.title,
        confidence: f.confidence,
      }));

    return {
      evidenceStatus: ageHours > STALE_AFTER_HOURS ? "STALE" : "AVAILABLE",
      websiteUrl: settings.websiteUrl,
      lastAuditAt: latest.completedAt ?? latest.startedAt,
      pagesAudited: latest.pagesAudited,
      scores: this.parseScores(latest.scores),
      openCritical: counts.CRITICAL ?? 0,
      openHigh: counts.HIGH ?? 0,
      openMedium: counts.MEDIUM ?? 0,
      openTotal: Object.values(counts).reduce((a, b) => a + b, 0),
      topFindings,
      croObservations,
      regressions: await this.recentRegressions(brandId),
      failureReason: latest.failureReason,
    };
  }

  /**
   * A one-line, human-readable statement of the measurement behind a finding.
   * Deliberately built from stored numbers rather than free text so it cannot
   * carry injected instructions from a crawled page.
   */
  private evidenceSummary(f: {
    metricName: string | null;
    metricValue: number | null;
    metricUnit: string | null;
    evidence: unknown;
    description: string;
  }): string {
    if (f.metricName && f.metricValue != null) {
      const unit = f.metricUnit ?? "";
      if (unit === "ms") {
        const v =
          f.metricValue >= 1000
            ? `${(f.metricValue / 1000).toFixed(2)}s`
            : `${Math.round(f.metricValue)}ms`;
        return `${f.metricName} = ${v}`;
      }
      if (unit === "bytes") {
        const mb = f.metricValue / (1024 * 1024);
        const v =
          mb >= 1
            ? `${mb.toFixed(1)}MB`
            : `${Math.round(f.metricValue / 1024)}KB`;
        return `${f.metricName} = ${v}`;
      }
      if (unit === "score") {
        return `${f.metricName} = ${f.metricValue.toFixed(3)}`;
      }
      return `${f.metricName} = ${f.metricValue}${unit ? ` ${unit}` : ""}`;
    }
    return f.description.slice(0, 160);
  }

  /**
   * Metric movement derived from stored finding history — arithmetic only,
   * no model involvement.
   */
  private async recentRegressions(brandId: string) {
    const findings = await this.prisma.websiteFinding.findMany({
      where: {
        brandId,
        status: "OPEN",
        evidenceClass: "FACT",
        metricName: { not: null },
      },
      select: { pageUrl: true, metricName: true, history: true },
      take: 60,
    });

    const out: WebsiteContext["regressions"] = [];
    for (const f of findings) {
      const history = Array.isArray(f.history)
        ? (f.history as Array<{ value: number | null }>)
        : [];
      if (history.length < 2) continue;
      const current = history[history.length - 1]?.value;
      const previous = history[history.length - 2]?.value;
      if (typeof current !== "number" || typeof previous !== "number") continue;
      if (previous === 0) continue;
      if (Math.abs(current - previous) <= Math.abs(previous) * 0.05) continue;

      out.push({
        pageUrl: f.pageUrl,
        metricName: f.metricName!,
        previousValue: previous,
        currentValue: current,
        direction: current > previous ? "REGRESSED" : "IMPROVED",
      });
      if (out.length >= 10) break;
    }
    return out;
  }

  private parseScores(raw: unknown): WebsiteScores {
    const fallback: WebsiteScores = {
      performance: null,
      accessibility: null,
      seo: null,
      bestPractices: null,
    };
    if (!raw || typeof raw !== "object") return fallback;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return {
      performance: num(r.performance),
      accessibility: num(r.accessibility),
      seo: num(r.seo),
      bestPractices: num(r.bestPractices),
    };
  }
}
