import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaService } from "../prisma.service";
import { ResearchModule } from "../research/research.module";
import { LighthouseProvider } from "./lighthouse.provider";
import { LighthouseNormalizerService } from "./lighthouse-normalizer.service";
import { WebsiteAnalysisService } from "./website-analysis.service";
import { WebsiteAuditService } from "./website-audit.service";
import { WebsiteContextService } from "./website-context.service";
import { WebsiteCroReviewService } from "./website-cro-review.service";
import { WebsiteFindingService } from "./website-finding.service";
import { WebsiteScheduler } from "./website.scheduler";
import { WebsiteSettingsService } from "./website-settings.service";
import { WebsiteController } from "./website.controller";

@Module({
  // ResearchModule supplies CRAWL_PROVIDER — the website CRO layer reuses the
  // existing Crawl4AI → Browserless chain rather than adding a second crawler.
  imports: [HttpModule, ResearchModule],
  controllers: [WebsiteController],
  providers: [
    PrismaService,
    LighthouseProvider,
    LighthouseNormalizerService,
    WebsiteSettingsService,
    WebsiteFindingService,
    WebsiteCroReviewService,
    WebsiteAuditService,
    WebsiteAnalysisService,
    WebsiteContextService,
    WebsiteScheduler,
  ],
  exports: [WebsiteContextService, WebsiteAuditService, WebsiteSettingsService],
})
export class WebsiteModule {}
