import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaService } from "../prisma.service";
import { ShopifyModule } from "../shopify/shopify.module";
import { RevenueOptimizationModule } from "../revenue-optimization/revenue-optimization.module";
import { MeasurementController } from "./measurement.controller";
import { RecommendationService } from "./recommendation.service";
import { RecommendationMeasurementService } from "./recommendation-measurement.service";
import { PerformanceIngestionService } from "./performance-ingestion.service";
import { PERFORMANCE_PROVIDERS } from "./performance-provider.interface";
import { ShopifyPerformanceProvider } from "./providers/shopify-performance.provider";
import { Ga4PerformanceProvider } from "./providers/ga4-performance.provider";
import { UmamiPerformanceProvider } from "./providers/umami-performance.provider";
import { BaselineService } from "./baseline.service";
import { ContentOutcomeService } from "./content-outcome.service";
import { ExperimentMeasurementService } from "./experiment-measurement.service";
import { UtmService } from "./utm.service";
import { WeeklyReviewService } from "./weekly-review.service";
import { CmoScorecardService } from "./cmo-scorecard.service";
import { MeasurementBrainClient } from "./measurement-brain.client";
import { MeasurementSchedulerService } from "./measurement-scheduler.service";

@Module({
  imports: [HttpModule, ShopifyModule, RevenueOptimizationModule],
  controllers: [MeasurementController],
  providers: [
    PrismaService,
    RecommendationService,
    RecommendationMeasurementService,
    PerformanceIngestionService,
    BaselineService,
    ContentOutcomeService,
    ExperimentMeasurementService,
    UtmService,
    WeeklyReviewService,
    CmoScorecardService,
    MeasurementBrainClient,
    MeasurementSchedulerService,
    ShopifyPerformanceProvider,
    Ga4PerformanceProvider,
    UmamiPerformanceProvider,
    {
      provide: PERFORMANCE_PROVIDERS,
      useFactory: (
        shopify: ShopifyPerformanceProvider,
        ga4: Ga4PerformanceProvider,
        umami: UmamiPerformanceProvider,
      ) => [shopify, ga4, umami],
      inject: [
        ShopifyPerformanceProvider,
        Ga4PerformanceProvider,
        UmamiPerformanceProvider,
      ],
    },
  ],
  exports: [
    RecommendationService,
    RecommendationMeasurementService,
    PerformanceIngestionService,
    ExperimentMeasurementService,
    WeeklyReviewService,
    CmoScorecardService,
    UtmService,
    MeasurementSchedulerService,
  ],
})
export class MeasurementModule {}
