import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { SettingsValidationError } from "../settings/runtime-settings.service";
import { WebsiteAnalysisService } from "./website-analysis.service";
import { WebsiteAuditService } from "./website-audit.service";
import { WebsiteContextService } from "./website-context.service";
import { WebsiteFindingService } from "./website-finding.service";
import { WebsiteSettingsService } from "./website-settings.service";
import { LighthouseProvider } from "./lighthouse.provider";

@Controller("website")
export class WebsiteController {
  constructor(
    private readonly settings: WebsiteSettingsService,
    private readonly audits: WebsiteAuditService,
    private readonly findings: WebsiteFindingService,
    private readonly analysis: WebsiteAnalysisService,
    private readonly context: WebsiteContextService,
    private readonly lighthouse: LighthouseProvider,
  ) {}

  /** Everything the Website → Overview tab needs in one call. */
  @Get("overview")
  async overview() {
    const [settings, latest, counts, recommendations] = await Promise.all([
      this.settings.get(),
      this.audits.getLatestAudit(),
      this.findings.counts(),
      this.analysis.list(undefined, "PROPOSED"),
    ]);

    return {
      configured: !!settings.websiteUrl || settings.auditUrls.length > 0,
      lighthouseConfigured: this.lighthouse.configured,
      websiteUrl: settings.websiteUrl,
      lastAudit: latest
        ? {
            id: latest.id,
            status: latest.status,
            startedAt: latest.startedAt,
            completedAt: latest.completedAt,
            pagesAudited: latest.pagesAudited,
            pagesFailed: latest.pagesFailed,
            scores: latest.scores,
            failureReason: latest.failureReason,
          }
        : null,
      counts,
      topRecommendations: recommendations.slice(0, 5),
    };
  }

  @Get("context")
  async websiteContext() {
    return this.context.build();
  }

  @Get("pages")
  async pages() {
    const latest = await this.audits.getLatestAudit();
    return latest?.pageAudits ?? [];
  }

  @Get("audits")
  async listAudits(@Query("take") take?: string) {
    const n = take ? parseInt(take, 10) : 20;
    return this.audits.listAudits(Number.isFinite(n) ? n : 20);
  }

  @Get("history")
  async history(@Query("limit") limit?: string) {
    const n = limit ? parseInt(limit, 10) : 10;
    return this.audits.getHistory(undefined, Number.isFinite(n) ? n : 10);
  }

  @Post("audit")
  async runAudit(@Body() body?: { trigger?: string }) {
    return this.audits.runAudit(body?.trigger ?? "manual");
  }

  @Get("findings")
  async listFindings(
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("category") category?: string,
    @Query("pageUrl") pageUrl?: string,
    @Query("take") take?: string,
  ) {
    const n = take ? parseInt(take, 10) : 200;
    return this.findings.list({
      status: status ?? "OPEN",
      severity,
      category,
      pageUrl,
      take: Number.isFinite(n) ? n : 200,
    });
  }

  @Get("findings/:id")
  async getFinding(@Param("id") id: string) {
    const finding = await this.findings.get(id);
    if (!finding) throw new NotFoundException("Finding not found");
    return finding;
  }

  @Patch("findings/:id")
  async patchFinding(
    @Param("id") id: string,
    @Body() body: { status?: string },
  ) {
    if (body?.status !== "OPEN" && body?.status !== "IGNORED") {
      throw new BadRequestException("status must be OPEN or IGNORED");
    }
    return this.findings.setStatus(id, body.status);
  }

  @Get("recommendations")
  async listRecommendations(@Query("status") status?: string) {
    return this.analysis.list(undefined, status);
  }

  @Post("recommendations/generate")
  async generateRecommendations() {
    return this.analysis.analyseOpenFindings();
  }

  @Patch("recommendations/:id")
  async patchRecommendation(
    @Param("id") id: string,
    @Body() body: { status?: string },
  ) {
    const allowed = ["PROPOSED", "ACCEPTED", "DISMISSED", "DONE"];
    if (!body?.status || !allowed.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${allowed.join(", ")}`);
    }
    return this.analysis.setStatus(id, body.status as any);
  }

  @Get("settings")
  async getSettings() {
    return this.settings.get();
  }

  @Patch("settings")
  async patchSettings(@Body() body: unknown) {
    try {
      return await this.settings.patch(body);
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        throw new BadRequestException({
          message: "Invalid website settings",
          details: err.details,
        });
      }
      throw err;
    }
  }
}
