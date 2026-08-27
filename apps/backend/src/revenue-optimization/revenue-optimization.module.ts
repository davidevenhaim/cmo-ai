import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { GrowthModule } from "../growth/growth.module";
import { PrismaService } from "../prisma.service";
import { ShopifyModule } from "../shopify/shopify.module";
import { SettingsModule } from "../settings/settings.module";
import { BundleService } from "./bundle.service";
import { FreeShippingOptimizerService } from "./free-shipping-optimizer.service";
import { NextBestActionService } from "./next-best-action.service";
import { OfferPolicyEngine } from "./offer-policy-engine.service";
import { ProductAffinityService } from "./product-affinity.service";
import { MockMessagingProvider } from "./providers/mock-messaging.provider";
import { WahaMessagingProvider } from "./providers/waha-messaging.provider";
import { RecoveryJourneyService } from "./recovery-journey.service";
import { ReplenishmentService } from "./replenishment.service";
import { RevenueAttributionService } from "./revenue-attribution.service";
import { RevenueContextService } from "./revenue-context.service";
import { RevenueExperimentService } from "./revenue-experiment.service";
import { RevenueOptimizationController } from "./revenue-optimization.controller";
import { RevenueOptimizationService } from "./revenue-optimization.service";
import { WinBackService } from "./win-back.service";

const messagingProvider = {
  provide: "MESSAGING_PROVIDER",
  useFactory: (waha: WahaMessagingProvider, mock: MockMessagingProvider) =>
    waha.isConfigured() ? waha : mock,
  inject: [WahaMessagingProvider, MockMessagingProvider],
};

@Module({
  imports: [HttpModule, GrowthModule, ShopifyModule, SettingsModule],
  controllers: [RevenueOptimizationController],
  providers: [
    PrismaService,
    WahaMessagingProvider,
    MockMessagingProvider,
    messagingProvider,
    OfferPolicyEngine,
    ProductAffinityService,
    RecoveryJourneyService,
    ReplenishmentService,
    WinBackService,
    BundleService,
    FreeShippingOptimizerService,
    RevenueExperimentService,
    RevenueAttributionService,
    NextBestActionService,
    RevenueContextService,
    RevenueOptimizationService,
  ],
  exports: [
    RevenueOptimizationService,
    RevenueContextService,
    NextBestActionService,
    OfferPolicyEngine,
    ProductAffinityService,
    RevenueAttributionService,
    RevenueExperimentService,
    ReplenishmentService,
    WinBackService,
    FreeShippingOptimizerService,
    BundleService,
    RecoveryJourneyService,
    "MESSAGING_PROVIDER",
  ],
})
export class RevenueOptimizationModule {}
