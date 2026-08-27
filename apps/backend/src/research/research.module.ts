import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ResearchService } from "./research.service";
import { ResearchController } from "./research.controller";
import { ResearchPlanService } from "./research-plan.service";
import { ResearchNormalizerService } from "./research-normalizer.service";
import { ResearchScoringService } from "./research-scoring.service";
import { OpportunityService } from "./opportunity.service";
import { BraveSearchAdapter } from "./providers/brave-search.adapter";
import { SearxngSearchAdapter } from "./providers/searxng-search.adapter";
import { FirecrawlAdapter } from "./providers/firecrawl.adapter";
import { BrowserCrawlAdapter } from "./providers/browser-crawl.adapter";
import { Crawl4aiAdapter } from "./providers/crawl4ai.adapter";
import {
  crawlProviderFactory,
  searchProviderFactory,
} from "./providers/provider.factory";
import { ChangedetectionController } from "./changedetection.controller";
import { ChangedetectionIngestService } from "./changedetection-ingest.service";
import { BrandModule } from "../brand/brand.module";
import { PrismaService } from "../prisma.service";

@Module({
  imports: [HttpModule, BrandModule],
  controllers: [ResearchController, ChangedetectionController],
  providers: [
    ResearchService,
    ResearchPlanService,
    ResearchNormalizerService,
    ResearchScoringService,
    OpportunityService,
    BraveSearchAdapter,
    SearxngSearchAdapter,
    FirecrawlAdapter,
    BrowserCrawlAdapter,
    Crawl4aiAdapter,
    searchProviderFactory,
    crawlProviderFactory,
    ChangedetectionIngestService,
    PrismaService,
  ],
  exports: [ResearchService, OpportunityService],
})
export class ResearchModule {}
