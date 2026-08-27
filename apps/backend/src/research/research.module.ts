import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ResearchService } from "./research.service";
import { ResearchController } from "./research.controller";
import { ResearchPlanService } from "./research-plan.service";
import { ResearchNormalizerService } from "./research-normalizer.service";
import { ResearchScoringService } from "./research-scoring.service";
import { OpportunityService } from "./opportunity.service";
import { BraveSearchAdapter } from "./providers/brave-search.adapter";
import { FirecrawlAdapter } from "./providers/firecrawl.adapter";
import { BrandModule } from "../brand/brand.module";
import { PrismaService } from "../prisma.service";

@Module({
  imports: [HttpModule, BrandModule],
  controllers: [ResearchController],
  providers: [
    ResearchService,
    ResearchPlanService,
    ResearchNormalizerService,
    ResearchScoringService,
    OpportunityService,
    BraveSearchAdapter,
    FirecrawlAdapter,
    PrismaService,
  ],
  exports: [ResearchService, OpportunityService],
})
export class ResearchModule {}
