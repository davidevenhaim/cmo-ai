import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { KeywordUniverseService } from "./keyword-universe.service";
import { KeywordIntentService } from "./keyword-intent.service";
import { SearchConsoleIngestService } from "./search-console-ingest.service";
import { FunnelAnalyticsService } from "./funnel-analytics.service";
import { AudienceLanguageService } from "./audience-language.service";
import { ContentGapService } from "./content-gap.service";
import { OpportunityScoringService } from "./opportunity-scoring.service";
import type { SearchConsoleProvider } from "./providers/search-console.provider";

const BRAND_ID = "luminesce-brand-001";

interface StepResult {
  ok: boolean;
  count?: number;
  error?: string;
}

@Injectable()
export class MarketIntelligenceSyncService {
  private readonly logger = new Logger(MarketIntelligenceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keywordUniverse: KeywordUniverseService,
    private readonly keywordIntent: KeywordIntentService,
    private readonly searchConsoleIngest: SearchConsoleIngestService,
    private readonly funnelAnalytics: FunnelAnalyticsService,
    private readonly audienceLanguage: AudienceLanguageService,
    private readonly contentGap: ContentGapService,
    private readonly opportunityScoring: OpportunityScoringService,
    @Inject("SEARCH_CONSOLE_PROVIDER")
    private readonly scProvider: SearchConsoleProvider,
  ) {}

  async runSync(triggeredBy = "manual"): Promise<{
    status: string;
    providersSucceeded: string[];
    providersFailed: string[];
    keywordsSeeded: number;
    metricsIngested: number;
    opportunitiesCreated: number;
    steps: Record<string, StepResult>;
  }> {
    const syncRun = await this.prisma.marketIntelligenceSyncRun.create({
      data: {
        brandId: BRAND_ID,
        status: "RUNNING",
        providersAttempted: [],
        providersSucceeded: [],
        providersFailed: [],
      },
    });

    const steps: Record<string, StepResult> = {};
    const providersSucceeded: string[] = [];
    const providersFailed: string[] = [];
    let keywordsSeeded = 0;
    let metricsIngested = 0;
    let opportunitiesCreated = 0;

    const run = async (
      name: string,
      fn: () => Promise<number>,
    ): Promise<void> => {
      try {
        const count = await fn();
        steps[name] = { ok: true, count };
        this.logger.log(`Step ${name}: ${count}`);
      } catch (err: any) {
        steps[name] = { ok: false, error: err.message };
        this.logger.warn(`Step ${name} failed: ${err.message}`);
      }
    };

    // 1. Seed keyword universe
    await run("seedBrand", async () => {
      const c = await this.keywordUniverse.seedFromBrand();
      keywordsSeeded += c;
      return c;
    });
    await run("seedProducts", async () => {
      const c = await this.keywordUniverse.seedFromProducts();
      keywordsSeeded += c;
      return c;
    });

    // 2. Classify intents
    await run("classifyIntents", () => this.keywordIntent.classifyAll());

    // 3. Search Console ingest
    const scAttempted = "search-console";
    try {
      const count = await this.searchConsoleIngest.ingest(this.scProvider);
      metricsIngested += count;
      if (this.scProvider.isConfigured()) providersSucceeded.push(scAttempted);
      steps["ingestSearchConsole"] = { ok: true, count };
    } catch (err: any) {
      providersFailed.push(scAttempted);
      steps["ingestSearchConsole"] = { ok: false, error: err.message };
    }

    // 4. Detect Search Console opportunities
    await run("detectSCOpportunities", () =>
      this.searchConsoleIngest.detectOpportunities(),
    );

    // 5. Audience language from research findings
    await run("ingestAudienceLanguage", () =>
      this.audienceLanguage.ingestFromFindings(),
    );
    await run("ingestQuestions", () => this.audienceLanguage.ingestQuestions());

    // 6. Content gap analysis
    await run("analyzeContentGaps", async () => {
      const r = await this.contentGap.analyzeGaps();
      return r.gapsFound + r.updatesFound;
    });

    // 7. Opportunity scoring pass
    await run("scoreOpportunities", async () => {
      const c = await this.opportunityScoring.runScoringPass();
      opportunitiesCreated += c;
      return c;
    });

    const allStepsOk = Object.values(steps).every((s) => s.ok);
    const anyStepOk = Object.values(steps).some((s) => s.ok);
    const status = allStepsOk ? "COMPLETED" : anyStepOk ? "PARTIAL" : "FAILED";

    await this.prisma.marketIntelligenceSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status,
        providersAttempted: [scAttempted],
        providersSucceeded,
        providersFailed,
        keywordsSeeded,
        metricsIngested,
        opportunitiesCreated,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Market intelligence sync ${status}: ${keywordsSeeded} keywords, ${metricsIngested} metrics, ${opportunitiesCreated} opportunities`,
    );

    return {
      status,
      providersSucceeded,
      providersFailed,
      keywordsSeeded,
      metricsIngested,
      opportunitiesCreated,
      steps,
    };
  }

  async getStatus() {
    const lastRun = await this.prisma.marketIntelligenceSyncRun.findFirst({
      where: { brandId: BRAND_ID },
      orderBy: { startedAt: "desc" },
    });

    const [keywordCount, opportunityCount, searchOppCount] = await Promise.all([
      this.prisma.keyword.count({ where: { brandId: BRAND_ID, active: true } }),
      this.prisma.marketOpportunity.count({
        where: { brandId: BRAND_ID, status: "NEW" },
      }),
      this.prisma.searchOpportunity.count({
        where: { brandId: BRAND_ID, status: "NEW" },
      }),
    ]);

    return {
      lastRun,
      keywords: keywordCount,
      newMarketOpportunities: opportunityCount,
      newSearchOpportunities: searchOppCount,
      searchConsoleConfigured: this.scProvider.isConfigured(),
    };
  }
}
