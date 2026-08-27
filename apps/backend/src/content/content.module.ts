import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { ContentController } from "./content.controller";
import { ContentService } from "./content.service";
import { ContentGenerationService } from "./content-generation.service";
import { ContentBrainAdapter } from "./content-brain.adapter";
import { BrandModule } from "../brand/brand.module";
import { ShopifyModule } from "../shopify/shopify.module";
import { ResearchModule } from "../research/research.module";
import { ApprovalModule } from "../approval/approval.module";
import { MeasurementModule } from "../measurement/measurement.module";
import { PrismaService } from "../prisma.service";

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    BrandModule,
    ShopifyModule,
    ResearchModule,
    ApprovalModule,
    MeasurementModule,
  ],
  controllers: [ContentController],
  providers: [
    ContentService,
    ContentGenerationService,
    ContentBrainAdapter,
    PrismaService,
  ],
  exports: [ContentService, ContentGenerationService],
})
export class ContentModule {}
