import { HttpService } from "@nestjs/axios";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type {
  CroObservation,
  WebsiteAuditUrl,
  WebsiteFindingCategory,
  WebsitePageType,
  WebsiteSeverity,
} from "@ai-cmo/contracts";
import { CroReviewResultSchema } from "@ai-cmo/contracts";
import { sanitizeContent } from "../research/research-normalizer.service";
import { CRAWL_PROVIDER } from "../research/providers/provider.factory";
import type { CrawlProvider } from "../research/providers/crawl.provider";
import { findingFingerprint } from "./lighthouse-normalizer.service";
import { WebsiteFindingService } from "./website-finding.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

/** Page text handed to the model. Bounded to keep prompts small and safe. */
const MAX_PAGE_CHARS = 4000;
const MAX_PAGES_REVIEWED = 6;

/**
 * A4 — the bounded visual/content review layer.
 *
 * Everything this service produces is an INTERPRETATION. It reads page content
 * through the existing Crawl4AI/Browserless chain (which sanitises and treats
 * the result as untrusted external input, invariant 4) and asks the brain for
 * qualitative observations Lighthouse cannot make.
 *
 * It deliberately cannot emit a metric: `upsertInterpretationFindings` nulls
 * metricName/metricValue regardless of what the model returns.
 */
@Injectable()
export class WebsiteCroReviewService {
  private readonly logger = new Logger(WebsiteCroReviewService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly findings: WebsiteFindingService,
    @Optional()
    @Inject(CRAWL_PROVIDER)
    private readonly crawl?: CrawlProvider,
  ) {}

  async reviewPages(
    auditId: string,
    targets: WebsiteAuditUrl[],
    pageAuditIdByUrl: Map<string, string>,
    brandId = DEFAULT_BRAND_ID,
  ): Promise<number> {
    if (!this.crawl?.configured) {
      this.logger.log("CRO review skipped — no crawl provider configured");
      return 0;
    }

    const observations: CroObservation[] = [];

    for (const target of targets.slice(0, MAX_PAGES_REVIEWED)) {
      let pageText: string;
      try {
        const extracted = await this.crawl.extract(target.url);
        // Untrusted external content: sanitize before it can reach a prompt.
        pageText = sanitizeContent(extracted.content ?? "").slice(
          0,
          MAX_PAGE_CHARS,
        );
      } catch (err: any) {
        this.logger.warn(`CRO crawl failed for ${target.url}: ${err.message}`);
        continue;
      }
      if (!pageText.trim()) continue;

      const result = await this.askBrain(target, pageText);
      if (result) observations.push(...result);
    }

    if (observations.length === 0) return 0;

    const mapped = observations.map((o) => {
      const ruleKey = `cro:${this.slug(o.title)}`;
      return {
        ruleKey,
        fingerprint: findingFingerprint(o.pageUrl, o.category, ruleKey),
        pageUrl: o.pageUrl,
        pageType: (targets.find((t) => t.url === o.pageUrl)?.pageType ??
          "OTHER") as WebsitePageType,
        category: o.category as WebsiteFindingCategory,
        severity: o.severity as WebsiteSeverity,
        title: o.title,
        description: o.description,
        evidence: {
          // Labelled so the UI can never render this as a measurement.
          kind: "AI_OBSERVATION",
          observedEvidence: o.observedEvidence ?? null,
        } as Record<string, unknown>,
        metricName: null,
        metricValue: null,
        metricUnit: null,
        source: "AI_REVIEW" as const,
        suggestedFix: o.suggestedFix ?? null,
        confidence: o.confidence,
      };
    });

    const res = await this.findings.upsertInterpretationFindings(
      auditId,
      mapped,
      pageAuditIdByUrl,
      brandId,
    );
    return res.created + res.updated;
  }

  private async askBrain(
    target: WebsiteAuditUrl,
    pageText: string,
  ): Promise<CroObservation[] | null> {
    const brainUrl = this.config.get<string>(
      "BRAIN_URL",
      "http://localhost:8000",
    );
    const timeoutMs = parseInt(
      this.config.get<string>("BRAIN_TIMEOUT_MS") ?? "30000",
      10,
    );

    try {
      const response = await firstValueFrom(
        this.http.post(
          `${brainUrl}/brain/website/cro-review`,
          {
            pageUrl: target.url,
            pageType: target.pageType,
            pageText,
          },
          { timeout: timeoutMs },
        ),
      );
      const parsed = CroReviewResultSchema.safeParse(response.data);
      if (!parsed.success) {
        this.logger.warn(
          `CRO review response failed schema validation for ${target.url}`,
        );
        return null;
      }
      // The model is told which page it is reviewing; pin the URL anyway so it
      // cannot attribute an observation to a page it was never given.
      return parsed.data.observations.map((o) => ({
        ...o,
        pageUrl: target.url,
      }));
    } catch (err: any) {
      this.logger.warn(`CRO review call failed for ${target.url}: ${err.message}`);
      return null;
    }
  }

  private slug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }
}
