import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ResearchService } from "./research.service";
import { OpportunityService } from "./opportunity.service";
import type { OpportunityType, OpportunityStatus } from "@ai-cmo/contracts";

@Controller("research")
export class ResearchController {
  constructor(
    private readonly researchService: ResearchService,
    private readonly opportunityService: OpportunityService,
  ) {}

  @Post("run")
  async triggerRun(@Body() body?: { triggeredBy?: string }) {
    return this.researchService.triggerRun(body?.triggeredBy ?? "api");
  }

  @Get("runs")
  async listRuns() {
    return this.researchService.listRuns();
  }

  @Get("runs/:id")
  async getRun(@Param("id") id: string) {
    return this.researchService.getRun(id);
  }

  @Get("findings")
  async listFindings(
    @Query("sourceType") sourceType?: string,
    @Query("minRelevance") minRelevance?: string,
    @Query("since") since?: string,
  ) {
    return this.researchService.listFindings({
      sourceType,
      minRelevance: minRelevance ? parseFloat(minRelevance) : undefined,
      sinceDate: since ? new Date(since) : undefined,
    });
  }

  @Get("findings/:id")
  async getFinding(@Param("id") id: string) {
    return this.researchService.getFinding(id);
  }

  @Get("opportunities")
  async listOpportunities(
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("minRelevance") minRelevance?: string,
  ) {
    return this.opportunityService.list("luminesce-brand-001", {
      type: type as OpportunityType | undefined,
      status: status as OpportunityStatus | undefined,
      minRelevance: minRelevance ? parseFloat(minRelevance) : undefined,
    });
  }

  @Get("opportunities/:id")
  async getOpportunity(@Param("id") id: string) {
    return this.opportunityService.getById(id);
  }

  @Patch("opportunities/:id")
  async updateOpportunity(
    @Param("id") id: string,
    @Body() body: { status: OpportunityStatus },
  ) {
    return this.opportunityService.updateStatus(id, body.status);
  }

  @Get("status")
  async status() {
    const runs = await this.researchService.listRuns();
    const lastRun = runs[0] ?? null;
    const findings = await this.researchService.listFindings();
    const opportunities = await this.opportunityService.list(
      "luminesce-brand-001",
    );
    return {
      lastRunAt: lastRun?.completedAt ?? lastRun?.startedAt ?? null,
      lastRunStatus: lastRun?.status ?? null,
      totalFindings: findings.length,
      newOpportunities: opportunities.filter((o) => o.status === "NEW").length,
    };
  }
}
