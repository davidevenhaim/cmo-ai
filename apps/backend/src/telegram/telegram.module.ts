import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ScheduleModule } from "@nestjs/schedule";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";
import { TelegramCommandService } from "./telegram-command.service";
import { TelegramBriefService } from "./telegram-brief.service";
import { CmoModule } from "../cmo/cmo.module";
import { BrandModule } from "../brand/brand.module";
import { ApprovalModule } from "../approval/approval.module";
import { ShopifyModule } from "../shopify/shopify.module";
import { ResearchModule } from "../research/research.module";
import { ContentModule } from "../content/content.module";
import { GrowthModule } from "../growth/growth.module";
import { WordPressModule } from "../wordpress/wordpress.module";
import { PublishingModule } from "../publishing/publishing.module";
import { MarketIntelligenceModule } from "../market-intelligence/market-intelligence.module";
import { RevenueOptimizationModule } from "../revenue-optimization/revenue-optimization.module";
import { MeasurementModule } from "../measurement/measurement.module";
import { PrismaService } from "../prisma.service";

@Module({
  imports: [
    HttpModule,
    ScheduleModule,
    CmoModule,
    BrandModule,
    ApprovalModule,
    ShopifyModule,
    ResearchModule,
    ContentModule,
    GrowthModule,
    WordPressModule,
    PublishingModule,
    MarketIntelligenceModule,
    RevenueOptimizationModule,
    MeasurementModule,
  ],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    TelegramCommandService,
    TelegramBriefService,
    PrismaService,
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
