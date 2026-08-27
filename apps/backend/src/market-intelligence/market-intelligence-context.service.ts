import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import type { SearchConsoleProvider } from "./providers/search-console.provider";
import type { TrendsProvider } from "./providers/trends.provider";
import type { KeywordPlannerProvider } from "./providers/keyword-planner.provider";

const BRAND_ID = "luminesce-brand-001";
const STALE_HOURS_SC = 72;
const STALE_HOURS_TRENDS = 72;
const STALE_HOURS_KP = 720; // 30 days

// NOT_CONFIGURED = real provider credentials absent (mock in use);
// MOCK = only fixture data present. Neither may be presented as live.
type EvidenceStatus =
  "AVAILABLE" | "STALE" | "UNAVAILABLE" | "NOT_CONFIGURED" | "MOCK";

function evidenceStatus(
  configured: boolean,
  latestMetric: { fetchedAt: Date; evidenceStatus: string } | null | undefined,
  maxAgeHours: number,
): EvidenceStatus {
  if (!configured) return "NOT_CONFIGURED";
  if (!latestMetric) return "UNAVAILABLE";
  if (latestMetric.evidenceStatus === "MOCK") return "MOCK";
  const ageHours = (Date.now() - latestMetric.fetchedAt.getTime()) / 36e5;
  return ageHours > maxAgeHours ? "STALE" : "AVAILABLE";
}

function freshnessOnly(
  fetchedAt: Date | null | undefined,
  maxAgeHours: number,
): EvidenceStatus {
  if (!fetchedAt) return "UNAVAILABLE";
  const ageHours = (Date.now() - fetchedAt.getTime()) / 36e5;
  return ageHours > maxAgeHours ? "STALE" : "AVAILABLE";
}

export interface MarketIntelligenceContext {
  topOpportunities: {
    topic: string;
    score: number;
    source: string;
    recommendedAction: string;
    explanation: string;
  }[];
  risingKeywords: {
    keyword: string;
    trendScore: number;
    searchVolume?: number;
  }[];
  searchConsoleOpportunities: {
    keyword: string;
    type: string;
    impressions?: number;
    position?: number;
  }[];
  contentGaps: string[];
  onsiteSearches: { query: string; count: number }[];
  funnelDiagnostics: {
    productName: string;
    issue: string;
    views: number;
    atcRate?: number;
    conversionRate?: number;
  }[];
  audienceQuestions: string[];
  communityLanguage: string[];
  dataFreshness: {
    lastSyncAt?: string;
    searchConsole: EvidenceStatus;
    trends: EvidenceStatus;
    keywordPlanner: EvidenceStatus;
    funnel: EvidenceStatus;
  };
}

@Injectable()
export class MarketIntelligenceContextService {
  private readonly logger = new Logger(MarketIntelligenceContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject("SEARCH_CONSOLE_PROVIDER")
    private readonly scProvider: SearchConsoleProvider,
    @Inject("TRENDS_PROVIDER")
    private readonly trendsProvider: TrendsProvider,
    @Inject("KEYWORD_PLANNER_PROVIDER")
    private readonly kpProvider: KeywordPlannerProvider,
  ) {}

  async build(): Promise<MarketIntelligenceContext> {
    const [
      topOpportunities,
      risingKeywordsRaw,
      searchOpportunities,
      contentGapRaw,
      onsiteSearches,
      funnelMetrics,
      questions,
      languageSignals,
      lastSync,
      scMetricLatest,
      trendMetricLatest,
      kpMetricLatest,
      funnelMetricLatest,
    ] = await Promise.all([
      this.prisma.marketOpportunity.findMany({
        where: { brandId: BRAND_ID, status: "NEW" },
        orderBy: { score: "desc" },
        take: 5,
      }),
      this.prisma.keywordMetric.findMany({
        where: {
          source: "TRENDS",
          trendDelta: { gt: 0 },
          evidenceStatus: { not: "MOCK" },
          keyword: { brandId: BRAND_ID, active: true },
        },
        include: { keyword: true },
        orderBy: { trendScore: "desc" },
        take: 5,
      }),
      this.prisma.searchOpportunity.findMany({
        where: { brandId: BRAND_ID, status: "NEW" },
        include: { keyword: true },
        orderBy: { score: "desc" },
        take: 5,
      }),
      this.prisma.searchOpportunity.findMany({
        where: {
          brandId: BRAND_ID,
          opportunityType: "CONTENT_GAP",
          status: "NEW",
        },
        orderBy: { score: "desc" },
        take: 5,
      }),
      this.prisma.onsiteSearchMetric.findMany({
        where: { brandId: BRAND_ID },
        orderBy: { count: "desc" },
        take: 10,
      }),
      this.prisma.productFunnelMetric.findMany({
        where: { brandId: BRAND_ID },
        orderBy: [{ period: "desc" }, { revenue: "desc" }],
        take: 20,
      }),
      this.prisma.questionSignal.findMany({
        where: { brandId: BRAND_ID },
        orderBy: { frequency: "desc" },
        take: 8,
      }),
      this.prisma.audienceLanguageSignal.findMany({
        where: { brandId: BRAND_ID },
        orderBy: { frequency: "desc" },
        take: 5,
      }),
      this.prisma.marketIntelligenceSyncRun.findFirst({
        where: { brandId: BRAND_ID },
        orderBy: { startedAt: "desc" },
      }),
      this.prisma.keywordMetric.findFirst({
        where: { source: "SEARCH_CONSOLE", keyword: { brandId: BRAND_ID } },
        orderBy: { fetchedAt: "desc" },
      }),
      this.prisma.keywordMetric.findFirst({
        where: { source: "TRENDS", keyword: { brandId: BRAND_ID } },
        orderBy: { fetchedAt: "desc" },
      }),
      this.prisma.keywordMetric.findFirst({
        where: { source: "KEYWORD_PLANNER", keyword: { brandId: BRAND_ID } },
        orderBy: { fetchedAt: "desc" },
      }),
      this.prisma.productFunnelMetric.findFirst({
        where: { brandId: BRAND_ID },
        orderBy: { fetchedAt: "desc" },
      }),
    ]);

    // Funnel diagnostics — only issues, not raw metrics
    const funnelDiagnostics = funnelMetrics
      .filter((m) => {
        const atcRate =
          m.atcRate ?? (m.views > 0 ? m.addToCart / m.views : null);
        const conversionRate =
          m.conversionRate ?? (m.views > 0 ? m.purchases / m.views : null);
        return (
          (m.views >= 100 && atcRate !== null && atcRate < 0.05) ||
          (m.views < 50 && conversionRate !== null && conversionRate > 0.1)
        );
      })
      .slice(0, 5)
      .map((m) => ({
        productName: m.productName,
        issue:
          m.views >= 100 && (m.atcRate ?? 1) < 0.05
            ? "HIGH_TRAFFIC_LOW_ATC"
            : "LOW_TRAFFIC_HIGH_CONVERSION",
        views: m.views,
        atcRate: m.atcRate ?? undefined,
        conversionRate: m.conversionRate ?? undefined,
      }));

    return {
      topOpportunities: topOpportunities.map((o) => ({
        topic: o.topic,
        score: o.score,
        source: o.source,
        recommendedAction: o.recommendedAction,
        explanation: o.explanation,
      })),
      risingKeywords: risingKeywordsRaw.map((m) => ({
        keyword: m.keyword.keyword,
        trendScore: m.trendScore ?? 0,
        searchVolume: undefined, // would come from KP metric
      })),
      searchConsoleOpportunities: searchOpportunities.map((o) => ({
        keyword: o.keyword?.keyword ?? o.topic,
        type: o.opportunityType,
        impressions: (o.evidence as Record<string, number>)?.impressions,
        position: (o.evidence as Record<string, number>)?.position,
      })),
      contentGaps: contentGapRaw.map((o) => o.topic),
      onsiteSearches: onsiteSearches.map((m) => ({
        query: m.query,
        count: m.count,
      })),
      funnelDiagnostics,
      audienceQuestions: questions.map((q) => q.question),
      communityLanguage: languageSignals.map((s) => s.phrase),
      dataFreshness: {
        lastSyncAt: lastSync?.completedAt?.toISOString(),
        searchConsole: evidenceStatus(
          this.scProvider.isConfigured(),
          scMetricLatest,
          STALE_HOURS_SC,
        ),
        trends: evidenceStatus(
          this.trendsProvider.isConfigured(),
          trendMetricLatest,
          STALE_HOURS_TRENDS,
        ),
        keywordPlanner: evidenceStatus(
          this.kpProvider.isConfigured(),
          kpMetricLatest,
          STALE_HOURS_KP,
        ),
        funnel: freshnessOnly(funnelMetricLatest?.fetchedAt, STALE_HOURS_KP),
      },
    };
  }
}
