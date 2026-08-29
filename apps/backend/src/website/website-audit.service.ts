import { Injectable, Logger } from "@nestjs/common";
import type { WebsiteScores } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { LighthouseProvider } from "./lighthouse.provider";
import {
  LighthouseNormalizerService,
  MalformedLighthouseReportError,
  type NormalizedWebsiteFinding,
} from "./lighthouse-normalizer.service";
import { WebsiteFindingService } from "./website-finding.service";
import { WebsiteSettingsService } from "./website-settings.service";
import { WebsiteCroReviewService } from "./website-cro-review.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

/** Raw reports are big; keep them only when they fit comfortably. */
const MAX_RAW_REPORT_BYTES = 2_000_000;

export interface RunAuditResult {
  auditId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  pagesPlanned: number;
  pagesAudited: number;
  pagesFailed: number;
  findingsCreated: number;
  findingsUpdated: number;
  findingsResolved: number;
  regressions: number;
  croObservations: number;
  failureReason?: string;
}

@Injectable()
export class WebsiteAuditService {
  private readonly logger = new Logger(WebsiteAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lighthouse: LighthouseProvider,
    private readonly normalizer: LighthouseNormalizerService,
    private readonly findings: WebsiteFindingService,
    private readonly settings: WebsiteSettingsService,
    private readonly croReview: WebsiteCroReviewService,
  ) {}

  async runAudit(
    trigger = "manual",
    brandId = DEFAULT_BRAND_ID,
  ): Promise<RunAuditResult> {
    const settings = await this.settings.get(brandId);
    const targets = await this.settings.resolveAuditTargets(brandId);

    if (targets.length === 0) {
      const audit = await this.prisma.websiteAudit.create({
        data: {
          brandId,
          status: "FAILED",
          trigger,
          completedAt: new Date(),
          failureReason:
            "No website URL or audit URLs configured. Set them in Website → Settings.",
        },
      });
      return {
        auditId: audit.id,
        status: "FAILED",
        pagesPlanned: 0,
        pagesAudited: 0,
        pagesFailed: 0,
        findingsCreated: 0,
        findingsUpdated: 0,
        findingsResolved: 0,
        regressions: 0,
        croObservations: 0,
        failureReason: audit.failureReason ?? undefined,
      };
    }

    if (!this.lighthouse.configured) {
      const audit = await this.prisma.websiteAudit.create({
        data: {
          brandId,
          status: "FAILED",
          trigger,
          pagesPlanned: targets.length,
          completedAt: new Date(),
          failureReason:
            "Lighthouse runner not configured (LIGHTHOUSE_BASE_URL).",
        },
      });
      return {
        auditId: audit.id,
        status: "FAILED",
        pagesPlanned: targets.length,
        pagesAudited: 0,
        pagesFailed: 0,
        findingsCreated: 0,
        findingsUpdated: 0,
        findingsResolved: 0,
        regressions: 0,
        croObservations: 0,
        failureReason: audit.failureReason ?? undefined,
      };
    }

    const audit = await this.prisma.websiteAudit.create({
      data: {
        brandId,
        status: "RUNNING",
        trigger,
        pagesPlanned: targets.length,
      },
    });

    const allFindings: NormalizedWebsiteFinding[] = [];
    const succeededUrls: string[] = [];
    const pageAuditIdByUrl = new Map<string, string>();
    const pageScores: WebsiteScores[] = [];
    let pagesAudited = 0;
    let pagesFailed = 0;
    let providerDown = false;

    for (const target of targets) {
      const run = await this.lighthouse.run(target.url, {
        formFactor: settings.formFactor,
        timeoutMs: settings.auditTimeoutMs,
      });

      // A dead runner will fail identically for every remaining page — stop
      // rather than burning the full timeout budget on each one.
      if (run.status === "UNAVAILABLE" || run.status === "NOT_CONFIGURED") {
        providerDown = true;
        await this.recordFailedPage(audit.id, target, run.status, run.failureReason);
        pagesFailed++;
        break;
      }

      if (run.status !== "OK" || !run.lhr) {
        await this.recordFailedPage(
          audit.id,
          target,
          run.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
          run.failureReason,
          run.durationMs,
        );
        pagesFailed++;
        continue;
      }

      try {
        const normalized = this.normalizer.normalize(
          run.lhr,
          target.url,
          target.pageType,
        );

        const enabled = normalized.findings.filter((f) =>
          this.settings.isCategoryEnabled(settings, f.category),
        );

        const raw = this.boundedRawReport(run.lhr);
        const pageAudit = await this.prisma.websitePageAudit.create({
          data: {
            auditId: audit.id,
            url: target.url,
            pageType: target.pageType,
            performance: normalized.scores.performance,
            accessibility: normalized.scores.accessibility,
            seo: normalized.scores.seo,
            bestPractices: normalized.scores.bestPractices,
            metrics: normalized.metrics as any,
            auditRefs: normalized.auditRefs as any,
            rawReport: raw.report as any,
            rawBytes: raw.bytes,
            status: "OK",
            durationMs: run.durationMs,
          },
        });

        pageAuditIdByUrl.set(target.url, pageAudit.id);
        succeededUrls.push(target.url);
        allFindings.push(...enabled);
        pageScores.push(normalized.scores);
        pagesAudited++;
      } catch (err: any) {
        // A malformed report is a per-page failure: the rest of the audit and
        // every previously stored finding stay valid.
        const reason =
          err instanceof MalformedLighthouseReportError
            ? err.message
            : `normalization failed: ${err.message}`;
        this.logger.warn(`${target.url}: ${reason}`);
        await this.recordFailedPage(audit.id, target, "FAILED", reason, run.durationMs);
        pagesFailed++;
      }
    }

    const sync = await this.findings.syncFromAudit(
      audit.id,
      allFindings,
      succeededUrls,
      pageAuditIdByUrl,
      brandId,
    );

    // The bounded AI CRO layer runs only over pages that actually audited, and
    // only when the owner has enabled it.
    let croObservations = 0;
    if (settings.croReviewEnabled && succeededUrls.length > 0) {
      try {
        croObservations = await this.croReview.reviewPages(
          audit.id,
          targets.filter((t) => succeededUrls.includes(t.url)),
          pageAuditIdByUrl,
          brandId,
        );
      } catch (err: any) {
        // CRO review is advisory; its failure must not fail a technical audit.
        this.logger.warn(`CRO review failed: ${err.message}`);
      }
    }

    const status: RunAuditResult["status"] =
      pagesAudited === 0 ? "FAILED" : pagesFailed > 0 ? "PARTIAL" : "COMPLETED";

    const failureReason = providerDown
      ? "Lighthouse runner unreachable"
      : pagesAudited === 0
        ? "All pages failed to audit"
        : undefined;

    await this.prisma.websiteAudit.update({
      where: { id: audit.id },
      data: {
        status,
        completedAt: new Date(),
        pagesAudited,
        pagesFailed,
        scores: this.rollUpScores(pageScores) as any,
        failureReason: failureReason ?? null,
      },
    });

    return {
      auditId: audit.id,
      status,
      pagesPlanned: targets.length,
      pagesAudited,
      pagesFailed,
      findingsCreated: sync.created,
      findingsUpdated: sync.updated,
      findingsResolved: sync.resolved,
      regressions: sync.regressions.length,
      croObservations,
      failureReason,
    };
  }

  /**
   * Site-level scores are the median of per-page scores — a deterministic
   * roll-up of measured facts, explicitly not an invented composite "website
   * score" (A5).
   */
  private rollUpScores(pages: WebsiteScores[]): WebsiteScores {
    const median = (key: keyof WebsiteScores): number | null => {
      const values = pages
        .map((p) => p[key])
        .filter((v): v is number => typeof v === "number")
        .sort((a, b) => a - b);
      if (values.length === 0) return null;
      const mid = Math.floor(values.length / 2);
      return values.length % 2
        ? values[mid]!
        : Math.round((values[mid - 1]! + values[mid]!) / 2);
    };
    return {
      performance: median("performance"),
      accessibility: median("accessibility"),
      seo: median("seo"),
      bestPractices: median("bestPractices"),
    };
  }

  private async recordFailedPage(
    auditId: string,
    target: { url: string; pageType: string },
    status: string,
    failureReason?: string,
    durationMs?: number,
  ) {
    await this.prisma.websitePageAudit.create({
      data: {
        auditId,
        url: target.url,
        pageType: target.pageType,
        status,
        failureReason: failureReason?.slice(0, 500) ?? null,
        durationMs: durationMs ?? null,
      },
    });
  }

  private boundedRawReport(lhr: unknown): {
    report: unknown | null;
    bytes: number;
  } {
    try {
      const serialized = JSON.stringify(lhr);
      const bytes = Buffer.byteLength(serialized);
      return bytes > MAX_RAW_REPORT_BYTES
        ? { report: null, bytes }
        : { report: lhr, bytes };
    } catch {
      return { report: null, bytes: 0 };
    }
  }

  // --- Reads for the UI ----------------------------------------------------

  async listAudits(take = 20, brandId = DEFAULT_BRAND_ID) {
    return this.prisma.websiteAudit.findMany({
      where: { brandId },
      orderBy: { startedAt: "desc" },
      take: Math.min(take, 100),
      select: {
        id: true,
        status: true,
        trigger: true,
        startedAt: true,
        completedAt: true,
        pagesPlanned: true,
        pagesAudited: true,
        pagesFailed: true,
        scores: true,
        failureReason: true,
      },
    });
  }

  async getLatestAudit(brandId = DEFAULT_BRAND_ID) {
    return this.prisma.websiteAudit.findFirst({
      where: { brandId, status: { in: ["COMPLETED", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
      include: {
        pageAudits: {
          select: {
            id: true,
            url: true,
            pageType: true,
            performance: true,
            accessibility: true,
            seo: true,
            bestPractices: true,
            metrics: true,
            status: true,
            failureReason: true,
            fetchedAt: true,
          },
        },
      },
    });
  }

  /**
   * Per-metric movement between the two most recent audits of each page.
   * Purely arithmetic over stored measurements — no model involvement.
   */
  async getHistory(brandId = DEFAULT_BRAND_ID, limit = 10) {
    const audits = await this.prisma.websiteAudit.findMany({
      where: { brandId, status: { in: ["COMPLETED", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
      take: Math.min(limit, 30),
      include: {
        pageAudits: {
          where: { status: "OK" },
          select: {
            url: true,
            pageType: true,
            performance: true,
            accessibility: true,
            seo: true,
            bestPractices: true,
            metrics: true,
          },
        },
      },
    });

    return audits.map((a) => ({
      auditId: a.id,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      status: a.status,
      scores: a.scores,
      pages: a.pageAudits,
    }));
  }
}
