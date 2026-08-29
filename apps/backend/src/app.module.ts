import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { ScheduleModule } from "@nestjs/schedule";
import { BrandModule } from "./brand/brand.module";
import { CmoModule } from "./cmo/cmo.module";
import { HealthModule } from "./health/health.module";
import { BrainModule } from "./brain/brain.module";
import { ApprovalModule } from "./approval/approval.module";
import { TelegramModule } from "./telegram/telegram.module";
import { ShopifyModule } from "./shopify/shopify.module";
import { ResearchModule } from "./research/research.module";
import { ContentModule } from "./content/content.module";
import { GrowthModule } from "./growth/growth.module";
import { PublishingModule } from "./publishing/publishing.module";
import { WordPressModule } from "./wordpress/wordpress.module";
import { SocialModule } from "./social/social.module";
import { MarketIntelligenceModule } from "./market-intelligence/market-intelligence.module";
import { RevenueOptimizationModule } from "./revenue-optimization/revenue-optimization.module";
import { OperatorModule } from "./operator/operator.module";
import { MeasurementModule } from "./measurement/measurement.module";
import { SettingsModule } from "./settings/settings.module";
import { BrowserModule } from "./browser/browser.module";
import { WebsiteModule } from "./website/website.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";
import { PrismaService } from "./prisma.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    HttpModule,
    HealthModule,
    SettingsModule,
    BrandModule,
    BrainModule,
    ApprovalModule,
    ShopifyModule,
    ResearchModule,
    CmoModule,
    ContentModule,
    GrowthModule,
    PublishingModule,
    WordPressModule,
    SocialModule,
    MarketIntelligenceModule,
    RevenueOptimizationModule,
    MeasurementModule,
    OperatorModule,
    TelegramModule,
    BrowserModule,
    WebsiteModule,
    WhatsAppModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
