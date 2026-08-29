import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import type { NormalizedWebsiteFinding } from "./lighthouse-normalizer.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

const MAX_HISTORY_ENTRIES = 20;

export interface FindingUpsertResult {
  created: number;
  updated: number;
  resolved: number;
  regressions: MetricRegression[];
}

export interface MetricRegression {
  fingerprint: string;
  pageUrl: string;
  metricName: string;
  previousValue: number;
  currentValue: number;
  direction: "IMPROVED" | "REGRESSED";
}

interface HistoryEntry {
  auditId: string;
  at: string;
  value: number | null;
  severity: string;
}

/**
 * Owns the durable lifecycle of website findings.
 *
 * A finding is identified by its fingerprint (page + category + rule), so the
 * same issue seen in ten consecutive audits is one row with ten history
 * entries — not ten rows.
 */
@Injectable()
export class WebsiteFindingService {
  private readonly logger = new Logger(WebsiteFindingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts every finding seen in an audit, then resolves the ones that were
   * previously open on the audited pages but did not reappear.
   *
   * `auditedPageUrls` scopes resolution: a page that failed to audit must not
   * cause its findings to be marked fixed.
   */
  async syncFromAudit(
    auditId: string,
    findings: NormalizedWebsiteFinding[],
    auditedPageUrls: string[],
    pageAuditIdByUrl: Map<string, string>,
    brandId = DEFAULT_BRAND_ID,
  ): Promise<FindingUpsertResult> {
    const now = new Date();
    const regressions: MetricRegression[] = [];
    let created = 0;
    let updated = 0;

    for (const finding of findings) {
      const existing = await this.prisma.websiteFinding.findUnique({
        where: { fingerprint: finding.fingerprint },
      });

      const historyEntry: HistoryEntry = {
        auditId,
        at: now.toISOString(),
        value: finding.metricValue,
        severity: finding.severity,
      };

      if (!existing) {
        await this.prisma.websiteFinding.create({
          data: {
            brandId,
            fingerprint: finding.fingerprint,
            ruleKey: finding.ruleKey,
            pageUrl: finding.pageUrl,
            pageType: finding.pageType,
            category: finding.category,
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            evidence: finding.evidence as any,
            metricName: finding.metricName,
            metricValue: finding.metricValue,
            metricUnit: finding.metricUnit,
            source: finding.source,
            evidenceClass: finding.evidenceClass,
            status: "OPEN",
            detectedAt: now,
            lastSeenAt: now,
            suggestedFix: finding.suggestedFix,
            confidence: finding.confidence,
            firstAuditId: auditId,
            lastAuditId: auditId,
            pageAuditId: pageAuditIdByUrl.get(finding.pageUrl) ?? null,
            history: [historyEntry] as any,
          },
        });
        created++;
        continue;
      }

      // Metric movement between audits is what History renders. Compare before
      // overwriting so the delta is against the previous sighting, not itself.
      if (
        existing.metricValue != null &&
        finding.metricValue != null &&
        existing.metricName
      ) {
        const delta = finding.metricValue - existing.metricValue;
        // 5% band avoids reporting run-to-run Lighthouse noise as a change.
        const threshold = Math.abs(existing.metricValue) * 0.05;
        if (Math.abs(delta) > threshold) {
          regressions.push({
            fingerprint: finding.fingerprint,
            pageUrl: finding.pageUrl,
            metricName: existing.metricName,
            previousValue: existing.metricValue,
            currentValue: finding.metricValue,
            // Every metric we track is "lower is better" (ms, bytes, CLS,
            // violation counts), so a rise is always a regression.
            direction: delta > 0 ? "REGRESSED" : "IMPROVED",
          });
        }
      }

      const history = this.appendHistory(existing.history, historyEntry);

      await this.prisma.websiteFinding.update({
        where: { id: existing.id },
        data: {
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          evidence: finding.evidence as any,
          metricValue: finding.metricValue,
          metricUnit: finding.metricUnit,
          suggestedFix: finding.suggestedFix,
          // A finding that was resolved and came back re-opens rather than
          // creating a duplicate row.
          status: "IGNORED" === existing.status ? "IGNORED" : "OPEN",
          resolvedAt: null,
          lastSeenAt: now,
          lastAuditId: auditId,
          pageAuditId: pageAuditIdByUrl.get(finding.pageUrl) ?? existing.pageAuditId,
          history: history as any,
        },
      });
      updated++;
    }

    const resolved = await this.resolveMissing(
      auditId,
      findings.map((f) => f.fingerprint),
      auditedPageUrls,
      now,
      brandId,
    );

    return { created, updated, resolved, regressions };
  }

  /**
   * Marks OPEN findings on successfully audited pages as RESOLVED when the
   * current audit did not reproduce them.
   */
  private async resolveMissing(
    auditId: string,
    seenFingerprints: string[],
    auditedPageUrls: string[],
    now: Date,
    brandId: string,
  ): Promise<number> {
    if (auditedPageUrls.length === 0) return 0;

    const stale = await this.prisma.websiteFinding.findMany({
      where: {
        brandId,
        status: "OPEN",
        pageUrl: { in: auditedPageUrls },
        fingerprint: { notIn: seenFingerprints.length ? seenFingerprints : ["__none__"] },
        // AI review findings are not deterministic enough to auto-resolve on a
        // single absence; only measured findings self-resolve.
        evidenceClass: "FACT",
      },
      select: { id: true },
    });
    if (stale.length === 0) return 0;

    await this.prisma.websiteFinding.updateMany({
      where: { id: { in: stale.map((f) => f.id) } },
      data: { status: "RESOLVED", resolvedAt: now, lastAuditId: auditId },
    });
    return stale.length;
  }

  /** Persists AI review output. Always INTERPRETATION, never a metric. */
  async upsertInterpretationFindings(
    auditId: string,
    findings: Array<
      Omit<NormalizedWebsiteFinding, "source" | "evidenceClass" | "confidence"> & {
        source: "AI_REVIEW" | "CRAWLER" | "BROWSER";
        confidence: number;
      }
    >,
    pageAuditIdByUrl: Map<string, string>,
    brandId = DEFAULT_BRAND_ID,
  ): Promise<{ created: number; updated: number }> {
    const now = new Date();
    let created = 0;
    let updated = 0;

    for (const finding of findings) {
      const existing = await this.prisma.websiteFinding.findUnique({
        where: { fingerprint: finding.fingerprint },
      });
      const historyEntry: HistoryEntry = {
        auditId,
        at: now.toISOString(),
        value: null,
        severity: finding.severity,
      };

      if (!existing) {
        await this.prisma.websiteFinding.create({
          data: {
            brandId,
            fingerprint: finding.fingerprint,
            ruleKey: finding.ruleKey,
            pageUrl: finding.pageUrl,
            pageType: finding.pageType,
            category: finding.category,
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            evidence: finding.evidence as any,
            // Interpretation findings never carry a metric — enforcing it here
            // means a prompt-injected "LCP = 0.1s" cannot become a stored fact.
            metricName: null,
            metricValue: null,
            metricUnit: null,
            source: finding.source,
            evidenceClass: "INTERPRETATION",
            status: "OPEN",
            detectedAt: now,
            lastSeenAt: now,
            suggestedFix: finding.suggestedFix,
            confidence: finding.confidence,
            firstAuditId: auditId,
            lastAuditId: auditId,
            pageAuditId: pageAuditIdByUrl.get(finding.pageUrl) ?? null,
            history: [historyEntry] as any,
          },
        });
        created++;
      } else {
        await this.prisma.websiteFinding.update({
          where: { id: existing.id },
          data: {
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            evidence: finding.evidence as any,
            suggestedFix: finding.suggestedFix,
            confidence: finding.confidence,
            status: existing.status === "IGNORED" ? "IGNORED" : "OPEN",
            resolvedAt: null,
            lastSeenAt: now,
            lastAuditId: auditId,
            history: this.appendHistory(existing.history, historyEntry) as any,
          },
        });
        updated++;
      }
    }
    return { created, updated };
  }

  async list(
    filters: {
      status?: string;
      severity?: string;
      category?: string;
      pageUrl?: string;
      take?: number;
    } = {},
    brandId = DEFAULT_BRAND_ID,
  ) {
    return this.prisma.websiteFinding.findMany({
      where: {
        brandId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.pageUrl ? { pageUrl: filters.pageUrl } : {}),
      },
      orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
      take: Math.min(filters.take ?? 200, 500),
    });
  }

  async get(id: string) {
    return this.prisma.websiteFinding.findUnique({ where: { id } });
  }

  async setStatus(id: string, status: "OPEN" | "IGNORED") {
    return this.prisma.websiteFinding.update({
      where: { id },
      data: { status, resolvedAt: null },
    });
  }

  async counts(brandId = DEFAULT_BRAND_ID) {
    const rows = await this.prisma.websiteFinding.groupBy({
      by: ["severity"],
      where: { brandId, status: "OPEN" },
      _count: { _all: true },
    });
    const bySeverity: Record<string, number> = {};
    for (const r of rows) bySeverity[r.severity] = r._count._all;
    return {
      critical: bySeverity.CRITICAL ?? 0,
      high: bySeverity.HIGH ?? 0,
      medium: bySeverity.MEDIUM ?? 0,
      low: bySeverity.LOW ?? 0,
      info: bySeverity.INFO ?? 0,
      total: Object.values(bySeverity).reduce((a, b) => a + b, 0),
    };
  }

  private appendHistory(raw: unknown, entry: HistoryEntry): HistoryEntry[] {
    const existing = Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
    return [...existing, entry].slice(-MAX_HISTORY_ENTRIES);
  }
}
