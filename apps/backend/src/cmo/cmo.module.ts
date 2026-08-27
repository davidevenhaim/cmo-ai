import { Module } from "@nestjs/common";
import { CmoController } from "./cmo.controller";
import { CmoService } from "./cmo.service";
import { BrandModule } from "../brand/brand.module";
import { BrainModule } from "../brain/brain.module";
import { ApprovalModule } from "../approval/approval.module";
import { ShopifyModule } from "../shopify/shopify.module";
import { ResearchModule } from "../research/research.module";
import { ContentModule } from "../content/content.module";
import { GrowthModule } from "../growth/growth.module";
import { MarketIntelligenceModule } from "../market-intelligence/market-intelligence.module";
import { RevenueOptimizationModule } from "../revenue-optimization/revenue-optimization.module";
import { PrismaService } from "../prisma.service";

@Module({
  imports: [
    BrandModule,
    BrainModule,
    ApprovalModule,
    ShopifyModule,
    ResearchModule,
    ContentModule,
    GrowthModule,
    MarketIntelligenceModule,
    RevenueOptimizationModule,
  ],
  controllers: [CmoController],
  providers: [CmoService, PrismaService],
  exports: [CmoService],
})
export class CmoModule {}
