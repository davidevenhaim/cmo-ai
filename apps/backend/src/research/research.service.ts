import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { BrandService } from "../brand/brand.service";
import { ResearchPlanService } from "./research-plan.service";
import { ResearchNormalizerService } from "./research-normalizer.service";
import { ResearchScoringService } from "./research-scoring.service";
import { OpportunityService } from "./opportunity.service";
import type { SearchProvider } from "./providers/search.provider";
import type { CrawlProvider } from "./providers/crawl.provider";
import { CRAWL_PROVIDER, SEARCH_PROVIDER } from "./providers/provider.factory";
import type { ResearchContext } from "@ai-cmo/contracts";

const BRAND_ID = "luminesce-brand-001";
const MIN_RELEVANCE_FOR_FINDING = 0.2;
const MAX_FINDINGS_PER_RUN = 30;
const MAX_CONTEXT_FINDINGS = 5;
const MAX_CONTEXT_OPPORTUNITIES = 3;

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandService: BrandService,
    private readonly planService: ResearchPlanService,
    private readonly normalizer: ResearchNormalizerService,
    private readonly scoring: ResearchScoringService,
    private readonly opportunityService: OpportunityService,
    @Inject(SEARCH_PROVIDER) private readonly searchAdapter: SearchProvider,
    @Inject(CRAWL_PROVIDER) private readonly crawlAdapter: CrawlProvider,
  ) {}

  async triggerRun(triggeredBy: string): Promise<{
    runId: string;
    findingsCreated: number;
    findingsUpdated: number;
    opportunitiesCreated: number;
    status: string;
  }> {
    const run = await this.prisma.researchRun.create({
      data: {
        brandId: BRAND_ID,
        triggeredBy,
        status: "RUNNING",
        queries: [],
        providers: [],
      },
    });

    try {
      const result = await this.executeRun(run.id);
      await this.prisma.researchRun.update({
        where: { id: run.id },
        data: {
          status: result.partialFailure ? "PARTIAL" : "COMPLETED",
          ...result.counts,
          completedAt: new Date(),
          queries: result.queries as any,
          providers: result.providers,
        },
      });
      return {
        runId: run.id,
        ...result.counts,
        status: result.partialFailure ? "PARTIAL" : "COMPLETED",
      };
    } catch (err: any) {
      await this.prisma.researchRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          failureReason: err.message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  async getResearchContext(): Promise<ResearchContext> {
    const findings = await this.prisma.researchFinding.findMany({
      where: { brandId: BRAND_ID },
      orderBy: [{ urgencyScore: "desc" }, { relevanceScore: "desc" }],
      take: MAX_CONTEXT_FINDINGS,
    });

    const opportunities = await this.opportunityService.getTopForContext(
      BRAND_ID,
      MAX_CONTEXT_OPPORTUNITIES,
    );

    const lastRun = await this.prisma.researchRun.findFirst({
      where: { brandId: BRAND_ID, status: { in: ["COMPLETED", "PARTIAL"] } },
      orderBy: { completedAt: "desc" },
    });

    const available = findings.length > 0 || opportunities.length > 0;

    return {
      runAt: lastRun?.completedAt ?? lastRun?.startedAt ?? new Date(),
      available,
      stale: !lastRun,
      topFindings: findings.map((f) => ({
        id: f.id,
        title: f.title,
        sourceType: f.sourceType,
        topic: f.topic,
        relevanceScore: f.relevanceScore,
        excerpt: f.excerpt.slice(0, 400),
        url: f.url,
        publishedAt: f.publishedAt,
      })),
      topOpportunities: opportunities.map((o) => ({
        id: o.id,
        type: o.type as any,
        title: o.title,
        summary: o.summary,
        relevanceScore: o.relevanceScore,
        urgencyScore: o.urgencyScore,
      })),
      failureReason: null,
    };
  }

  async listRuns() {
    return this.prisma.researchRun.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
  }

  async getRun(id: string) {
    return this.prisma.researchRun.findUniqueOrThrow({ where: { id } });
  }

  async listFindings(filters?: {
    sourceType?: string;
    minRelevance?: number;
    sinceDate?: Date;
  }) {
    return this.prisma.researchFinding.findMany({
      where: {
        brandId: BRAND_ID,
        ...(filters?.sourceType && { sourceType: filters.sourceType }),
        ...(filters?.minRelevance !== undefined && {
          relevanceScore: { gte: filters.minRelevance },
        }),
        ...(filters?.sinceDate && {
          discoveredAt: { gte: filters.sinceDate },
        }),
      },
      orderBy: [{ urgencyScore: "desc" }, { relevanceScore: "desc" }],
      take: 100,
    });
  }

  async getFinding(id: string) {
    return this.prisma.researchFinding.findUniqueOrThrow({ where: { id } });
  }

  // --- private ---

  private async executeRun(runId: string): Promise<{
    counts: {
      findingsCreated: number;
      findingsUpdated: number;
      opportunitiesCreated: number;
      resultCount: number;
    };
    queries: string[];
    providers: string[];
    partialFailure: boolean;
  }> {
    const profile = await this.brandService.getFullProfile();

    const competitorSources = await this.prisma.researchSource.findMany({
      where: { brandId: BRAND_ID, type: "COMPETITOR", active: true },
    });

    const plan = this.planService.buildPlanFromBrandContext({
      brand: profile,
      products: profile.products ?? [],
      facts: profile.facts ?? [],
      competitorUrls: competitorSources
        .map((s) => s.url)
        .filter(Boolean) as string[],
    });

    const signals = this.scoring.buildSignals({
      brand: profile,
      products: profile.products ?? [],
      facts: profile.facts ?? [],
    });

    let findingsCreated = 0;
    let findingsUpdated = 0;
    let opportunitiesCreated = 0;
    let resultCount = 0;
    let partialFailure = false;

    const providers: string[] = [];
    const queryStrings: string[] = plan.queries.map((q) => q.query);

    // --- search results ---
    if (this.searchAdapter.configured) {
      providers.push(this.searchAdapter.name);
      for (const q of plan.queries) {
        try {
          const results = await this.searchAdapter.search(q.query, {
            maxResults: 8,
            freshness: q.freshness,
          });
          resultCount += results.length;

          for (const result of results.slice(0, MAX_FINDINGS_PER_RUN)) {
            const normalized = this.normalizer.fromSearchResult(
              result,
              q.intent,
            );
            const scored = this.scoring.score(normalized, signals);

            if (scored.relevanceScore < MIN_RELEVANCE_FOR_FINDING) continue;

            const { created, updated, findingId } = await this.upsertFinding(
              BRAND_ID,
              runId,
              scored,
            );
            if (created) findingsCreated++;
            if (updated) findingsUpdated++;

            if (created && findingId) {
              const oppId = await this.opportunityService.createFromFinding(
                BRAND_ID,
                findingId,
                scored,
              );
              if (oppId) opportunitiesCreated++;
            }
          }
        } catch (err: any) {
          this.logger.warn(`Search query failed "${q.query}": ${err.message}`);
          partialFailure = true;
        }
      }
    } else {
      this.logger.warn("No search provider configured — skipping search phase");
      partialFailure = true;
    }

    // --- direct URL crawl ---
    if (this.crawlAdapter.configured && plan.sourceUrls.length > 0) {
      providers.push(this.crawlAdapter.name);
      for (const url of plan.sourceUrls) {
        try {
          const extracted = await this.crawlAdapter.extract(url);
          const normalized = this.normalizer.fromExtractResult(
            extracted,
            "COMPETITOR",
          );
          const scored = this.scoring.score(normalized, signals);
          resultCount++;

          if (scored.relevanceScore >= MIN_RELEVANCE_FOR_FINDING) {
            const { created, updated, findingId } = await this.upsertFinding(
              BRAND_ID,
              runId,
              scored,
            );
            if (created) findingsCreated++;
            if (updated) findingsUpdated++;
            if (created && findingId) {
              const oppId = await this.opportunityService.createFromFinding(
                BRAND_ID,
                findingId,
                scored,
              );
              if (oppId) opportunitiesCreated++;
            }
          }
        } catch (err: any) {
          this.logger.warn(`Crawl failed for ${url}: ${err.message}`);
          partialFailure = true;
        }
      }
    }

    return {
      counts: {
        findingsCreated,
        findingsUpdated,
        opportunitiesCreated,
        resultCount,
      },
      queries: queryStrings,
      providers,
      partialFailure,
    };
  }

  private async upsertFinding(
    brandId: string,
    runId: string,
    scored: import("./research-scoring.service").ScoredFinding,
  ): Promise<{ created: boolean; updated: boolean; findingId: string | null }> {
    const existing = await this.prisma.researchFinding.findUnique({
      where: { urlHash: scored.urlHash },
    });

    if (existing) {
      // Re-discovered — update discoveredAt and scores if improved
      if (scored.relevanceScore > existing.relevanceScore) {
        await this.prisma.researchFinding.update({
          where: { id: existing.id },
          data: {
            relevanceScore: scored.relevanceScore,
            urgencyScore: scored.urgencyScore,
            discoveredAt: new Date(),
          },
        });
        return { created: false, updated: true, findingId: existing.id };
      }
      return { created: false, updated: false, findingId: existing.id };
    }

    const finding = await this.prisma.researchFinding.create({
      data: {
        brandId,
        runId,
        url: scored.url,
        urlHash: scored.urlHash,
        title: scored.title,
        excerpt: scored.excerpt,
        sourceType: scored.sourceType,
        topic: scored.topic,
        relevanceScore: scored.relevanceScore,
        urgencyScore: scored.urgencyScore,
        publishedAt: scored.publishedAt,
        providerMeta: scored.providerMeta as any,
      },
    });

    return { created: true, updated: false, findingId: finding.id };
  }
}
