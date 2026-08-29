import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { WebsiteAnalysisResultSchema } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

const MAX_FINDINGS_TO_ANALYSE = 12;

/**
 * A3 — turns measured findings into explanation + proposed solution.
 *
 * The contract this service enforces is the important part:
 *
 *   FACT            comes from WebsiteFinding (Lighthouse-measured)
 *   INTERPRETATION  comes from the model, and may only reference findings by
 *                   fingerprint
 *   RECOMMENDATION  is the model's proposed fix, stored separately
 *
 * A model response referencing a fingerprint that was not in the request is
 * dropped — that is what stops the LLM inventing a metric or a page.
 */
@Injectable()
export class WebsiteAnalysisService {
  private readonly logger = new Logger(WebsiteAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async analyseOpenFindings(
    brandId = DEFAULT_BRAND_ID,
  ): Promise<{ created: number; skipped: number; reason?: string }> {
    const findings = await this.prisma.websiteFinding.findMany({
      where: {
        brandId,
        status: "OPEN",
        // Only measured facts are eligible inputs. Feeding the model its own
        // prior interpretations back in would compound speculation.
        evidenceClass: "FACT",
        severity: { in: ["CRITICAL", "HIGH", "MEDIUM"] },
      },
      orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
      take: MAX_FINDINGS_TO_ANALYSE,
    });

    if (findings.length === 0) {
      return { created: 0, skipped: 0, reason: "no open measured findings" };
    }

    const allowed = new Map(findings.map((f) => [f.fingerprint, f]));

    // Bounded payload: title, category, severity and the measured value only.
    // No raw report, no page HTML.
    const payload = findings.map((f) => ({
      fingerprint: f.fingerprint,
      pageUrl: f.pageUrl,
      pageType: f.pageType,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description.slice(0, 500),
      metricName: f.metricName,
      metricValue: f.metricValue,
      metricUnit: f.metricUnit,
    }));

    const brainUrl = this.config.get<string>(
      "BRAIN_URL",
      "http://localhost:8000",
    );
    const timeoutMs = parseInt(
      this.config.get<string>("BRAIN_TIMEOUT_MS") ?? "30000",
      10,
    );

    let parsed;
    try {
      const response = await firstValueFrom(
        this.http.post(
          `${brainUrl}/brain/website/analyze`,
          { findings: payload },
          { timeout: timeoutMs },
        ),
      );
      const result = WebsiteAnalysisResultSchema.safeParse(response.data);
      if (!result.success) {
        this.logger.warn("Website analysis response failed schema validation");
        return { created: 0, skipped: 0, reason: "invalid brain response" };
      }
      parsed = result.data;
    } catch (err: any) {
      this.logger.warn(`Website analysis call failed: ${err.message}`);
      return { created: 0, skipped: 0, reason: err.message };
    }

    let created = 0;
    let skipped = 0;

    for (const item of parsed.recommendations) {
      const referenced = item.findingFingerprints.filter((fp) =>
        allowed.has(fp),
      );
      // Hallucinated references mean we cannot ground the interpretation in a
      // measured fact, so the whole recommendation is discarded.
      if (referenced.length === 0) {
        skipped++;
        continue;
      }

      const findingIds = referenced.map((fp) => allowed.get(fp)!.id);

      await this.prisma.websiteRecommendation.create({
        data: {
          brandId,
          title: item.title,
          interpretation: item.interpretation,
          proposedFix: item.proposedFix,
          category: item.category,
          priority: item.priority,
          confidence: item.confidence,
          status: "PROPOSED",
          modelId: parsed.modelId,
          findings: { connect: findingIds.map((id) => ({ id })) },
        },
      });
      created++;
    }

    return { created, skipped };
  }

  async list(brandId = DEFAULT_BRAND_ID, status?: string) {
    return this.prisma.websiteRecommendation.findMany({
      where: { brandId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        findings: {
          select: {
            id: true,
            title: true,
            pageUrl: true,
            severity: true,
            category: true,
            metricName: true,
            metricValue: true,
            metricUnit: true,
            evidenceClass: true,
          },
        },
      },
    });
  }

  async setStatus(
    id: string,
    status: "PROPOSED" | "ACCEPTED" | "DISMISSED" | "DONE",
  ) {
    return this.prisma.websiteRecommendation.update({
      where: { id },
      data: { status },
    });
  }
}
