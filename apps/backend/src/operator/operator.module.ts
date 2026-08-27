import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaService } from "../prisma.service";
import { ShopifyModule } from "../shopify/shopify.module";
import { ContentModule } from "../content/content.module";
import { GrowthModule } from "../growth/growth.module";
import { MarketIntelligenceModule } from "../market-intelligence/market-intelligence.module";
import { RevenueOptimizationModule } from "../revenue-optimization/revenue-optimization.module";
import { MeasurementModule } from "../measurement/measurement.module";
import { SettingsModule } from "../settings/settings.module";
import { OperatorBrainClient } from "./operator-brain.client";
import { OperatorBriefService } from "./operator-brief.service";
import { OperatorStatusService } from "./operator-status.service";
import { OperatorAnalyticsService } from "./operator-analytics.service";
import { OperatorCommandService } from "./operator-command.service";
import { OperatorController } from "./operator.controller";

@Module({
  imports: [
    HttpModule,
    ShopifyModule,
    ContentModule,
    GrowthModule,
    MarketIntelligenceModule,
    RevenueOptimizationModule,
    MeasurementModule,
    SettingsModule,
  ],
  controllers: [OperatorController],
  providers: [
    PrismaService,
    OperatorBrainClient,
    OperatorBriefService,
    OperatorStatusService,
    OperatorAnalyticsService,
    OperatorCommandService,
  ],
  exports: [OperatorBriefService, OperatorCommandService],
})
export class OperatorModule {}
