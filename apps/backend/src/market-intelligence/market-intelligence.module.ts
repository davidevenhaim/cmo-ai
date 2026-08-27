/**
 * MarketIntelligenceModule
 *
 * Provider setup:
 *   SEARCH_CONSOLE_PROVIDER — set GOOGLE_SEARCH_CONSOLE_SITE_URL + GOOGLE_SERVICE_ACCOUNT_JSON
 *     (base64-encoded Google service account JSON with Search Console read-only access)
 *   TRENDS_PROVIDER        — set SERPAPI_KEY (recommended) for reliable Google Trends access
 *   KEYWORD_PLANNER_PROVIDER — set GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CLIENT_ID +
 *     GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN + GOOGLE_ADS_CUSTOMER_ID
 *
 * Mock providers are used by default when env vars are absent. Mock data is
 * persisted with evidenceStatus MOCK, excluded from opportunity detection and
 * scoring, and reported as NOT_CONFIGURED/MOCK in CMO context — it is never
 * presented as live evidence.
 *
 * Shopify Web Pixel (for full funnel data):
 *   Full funnel events (views, add-to-cart, checkout) require a Shopify Web Pixel.
 *   1. Create a custom Web Pixel in Shopify admin → Settings → Customer events
 *   2. Subscribe to: page_viewed, product_viewed, product_added_to_cart,
 *      checkout_started, checkout_completed
 *   3. POST aggregated daily summaries to POST /market-intelligence/funnel-events
 *   Current FunnelAnalyticsService ingests from existing CommerceContext (revenue/units only).
 */

import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { BrandModule } from "../brand/brand.module";
import { ResearchModule } from "../research/research.module";
import { MarketIntelligenceController } from "./market-intelligence.controller";
import { KeywordUniverseService } from "./keyword-universe.service";
import { KeywordIntentService } from "./keyword-intent.service";
import { SearchConsoleIngestService } from "./search-console-ingest.service";
import { FunnelAnalyticsService } from "./funnel-analytics.service";
import { ContentInventoryService } from "./content-inventory.service";
import { ContentGapService } from "./content-gap.service";
import { AudienceLanguageService } from "./audience-language.service";
import { OpportunityScoringService } from "./opportunity-scoring.service";
import { MarketIntelligenceSyncService } from "./market-intelligence-sync.service";
import { MarketIntelligenceContextService } from "./market-intelligence-context.service";
import { MockSearchConsoleProvider } from "./providers/mock-search-console.provider";
import { MockTrendsProvider } from "./providers/mock-trends.provider";
import { MockKeywordPlannerProvider } from "./providers/mock-keyword-planner.provider";

@Module({
  imports: [HttpModule, ConfigModule, BrandModule, ResearchModule],
  controllers: [MarketIntelligenceController],
  providers: [
    PrismaService,
    KeywordUniverseService,
    KeywordIntentService,
    SearchConsoleIngestService,
    FunnelAnalyticsService,
    ContentInventoryService,
    ContentGapService,
    AudienceLanguageService,
    OpportunityScoringService,
    MarketIntelligenceSyncService,
    MarketIntelligenceContextService,
    {
      provide: "SEARCH_CONSOLE_PROVIDER",
      useFactory: () => {
        // Swap to real provider when GOOGLE_SERVICE_ACCOUNT_JSON is set
        // Real: import { GoogleSearchConsoleProvider } from "./providers/google-search-console.provider"
        return new MockSearchConsoleProvider();
      },
    },
    {
      provide: "TRENDS_PROVIDER",
      useFactory: () => {
        // Swap to real provider when SERPAPI_KEY is set
        return new MockTrendsProvider();
      },
    },
    {
      provide: "KEYWORD_PLANNER_PROVIDER",
      useFactory: () => {
        // Swap to real provider when GOOGLE_ADS_DEVELOPER_TOKEN is set
        return new MockKeywordPlannerProvider();
      },
    },
  ],
  exports: [
    MarketIntelligenceSyncService,
    MarketIntelligenceContextService,
    KeywordUniverseService,
    FunnelAnalyticsService,
    AudienceLanguageService,
  ],
})
export class MarketIntelligenceModule {}
