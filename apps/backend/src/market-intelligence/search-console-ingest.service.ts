import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { KeywordUniverseService } from "./keyword-universe.service";
import type {
  SearchConsoleProvider,
  SearchConsoleRow,
} from "./providers/search-console.provider";

const BRAND_ID = "luminesce-brand-001";

// Thresholds — kept in one place for easy tuning
const STRIKING_DISTANCE_MIN = 8;
const STRIKING_DISTANCE_MAX = 20;
const STRIKING_DISTANCE_MIN_IMPRESSIONS = 100;
const HIGH_IMPRESSIONS_LOW_CTR_MIN_IMPRESSIONS = 200;
const HIGH_IMPRESSIONS_LOW_CTR_MAX_CTR = 0.02;
const RISING_QUERY_GROWTH_FACTOR = 1.5;
const RISING_QUERY_MIN_IMPRESSIONS = 50;
const DECAYING_QUERY_DECAY_FACTOR = 1.5;
const DECAYING_QUERY_MIN_PREV_IMPRESSIONS = 50;
const CONTENT_GAP_MIN_IMPRESSIONS = 100;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateMinusDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - days);
  return r;
}

@Injectable()
export class SearchConsoleIngestService {
  private readonly logger = new Logger(SearchConsoleIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keywordUniverse: KeywordUniverseService,
    @Inject("SEARCH_CONSOLE_PROVIDER")
    private readonly provider: SearchConsoleProvider,
  ) {}

  async ingest(overrideProvider?: SearchConsoleProvider): Promise<number> {
    const p = overrideProvider ?? this.provider;
    const siteUrl =
      process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL ?? "https://example.com";

    const now = new Date();
    // Account for ~3-day data delay
    const endDate = isoDate(dateMinusDays(now, 3));
    const startDate = isoDate(dateMinusDays(now, 31));

    let report;
    try {
      report = await p.getQueryReport({
        siteUrl,
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: 1000,
      });
    } catch (err: any) {
      this.logger.warn(`Search Console fetch failed: ${err.message}`);
      return 0;
    }

    const period = `${startDate}/${endDate}`;

    // Mock/unconfigured providers must never produce metrics that look live.
    const evidenceStatus =
      !p.isConfigured() || report.evidenceStatus === "MOCK"
        ? "MOCK"
        : report.evidenceStatus === "AVAILABLE"
          ? "AVAILABLE"
          : "INCOMPLETE";

    let ingested = 0;

    for (const row of report.rows) {
      // Ensure keyword exists in universe
      await this.keywordUniverse.seedFromSearchConsole([row]);

      const keyword = await this.prisma.keyword.findFirst({
        where: {
          brandId: BRAND_ID,
          normalizedKeyword: this.keywordUniverse.normalizeKeyword(row.query),
        },
      });
      if (!keyword) continue;

      await this.prisma.keywordMetric.upsert({
        where: {
          keywordId_source_period: {
            keywordId: keyword.id,
            source: "SEARCH_CONSOLE",
            period,
          },
        },
        create: {
          keywordId: keyword.id,
          source: "SEARCH_CONSOLE",
          period,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          averagePosition: row.position,
          evidenceStatus,
        },
        update: {
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          averagePosition: row.position,
          evidenceStatus,
          fetchedAt: new Date(),
        },
      });
      ingested++;
    }

    this.logger.log(`Ingested ${ingested} Search Console metrics`);
    return ingested;
  }

  async detectOpportunities(): Promise<number> {
    const now = new Date();
    const currentEnd = dateMinusDays(now, 3);
    const currentStart = dateMinusDays(currentEnd, 28);
    const prevEnd = new Date(currentStart);
    const prevStart = dateMinusDays(prevEnd, 28);

    // Aggregate metrics per keyword for current and previous periods
    // Exclude MOCK metrics — mock demand must not create real opportunities
    const allMetrics = await this.prisma.keywordMetric.findMany({
      where: {
        source: "SEARCH_CONSOLE",
        evidenceStatus: { not: "MOCK" },
        keyword: { brandId: BRAND_ID },
      },
      include: { keyword: true },
    });

    // Group by keyword
    const byKeyword = new Map<
      string,
      {
        keyword: (typeof allMetrics)[0]["keyword"];
        current?: (typeof allMetrics)[0];
        previous?: (typeof allMetrics)[0];
      }
    >();

    for (const m of allMetrics) {
      const entry = byKeyword.get(m.keywordId) ?? { keyword: m.keyword };
      // Heuristic: any metric after currentStart is "current", before is "previous"
      const fetchedAt = m.fetchedAt;
      if (fetchedAt >= currentStart) {
        entry.current = m;
      } else if (fetchedAt >= prevStart && fetchedAt < currentStart) {
        entry.previous = m;
      }
      byKeyword.set(m.keywordId, entry);
    }

    let created = 0;

    for (const { keyword, current, previous } of byKeyword.values()) {
      if (!current) continue;

      const impressions = current.impressions ?? 0;
      const clicks = current.clicks ?? 0;
      const ctr = current.ctr ?? 0;
      const position = current.averagePosition ?? 0;

      // STRIKING_DISTANCE: position 8–20, meaningful impressions
      if (
        position >= STRIKING_DISTANCE_MIN &&
        position <= STRIKING_DISTANCE_MAX &&
        impressions >= STRIKING_DISTANCE_MIN_IMPRESSIONS
      ) {
        const proximityScore =
          (STRIKING_DISTANCE_MAX - position) /
          (STRIKING_DISTANCE_MAX - STRIKING_DISTANCE_MIN);
        const score =
          0.5 + proximityScore * 0.3 + Math.min(0.2, impressions / 5000);
        await this.upsertSearchOpportunity(
          keyword,
          "STRIKING_DISTANCE",
          score,
          {
            impressions,
            clicks,
            position,
            ctr,
            reason: `Position ${position.toFixed(1)} with ${impressions} impressions — page-1 optimisation opportunity`,
          },
        );
        created++;
      }

      // HIGH_IMPRESSIONS_LOW_CTR
      if (
        impressions >= HIGH_IMPRESSIONS_LOW_CTR_MIN_IMPRESSIONS &&
        ctr < HIGH_IMPRESSIONS_LOW_CTR_MAX_CTR
      ) {
        const score = 0.4 + Math.min(0.4, impressions / 5000);
        await this.upsertSearchOpportunity(
          keyword,
          "HIGH_IMPRESSIONS_LOW_CTR",
          score,
          {
            impressions,
            clicks,
            position,
            ctr,
            reason: `${impressions} impressions but only ${(ctr * 100).toFixed(1)}% CTR — title/meta optimisation needed`,
          },
        );
        created++;
      }

      // RISING_QUERY
      if (
        previous &&
        clicks > (previous.clicks ?? 0) * RISING_QUERY_GROWTH_FACTOR &&
        impressions >= RISING_QUERY_MIN_IMPRESSIONS
      ) {
        const growth = previous.clicks ? clicks / previous.clicks : 2;
        const score = Math.min(0.9, 0.5 + (growth - 1) * 0.1);
        await this.upsertSearchOpportunity(keyword, "RISING_QUERY", score, {
          impressions,
          clicks,
          position,
          ctr,
          prevClicks: previous.clicks,
          reason: `Clicks grew from ${previous.clicks ?? 0} to ${clicks} — rising demand signal`,
        });
        created++;
      }

      // DECAYING_QUERY
      if (
        previous &&
        (previous.clicks ?? 0) > clicks * DECAYING_QUERY_DECAY_FACTOR &&
        (previous.impressions ?? 0) >= DECAYING_QUERY_MIN_PREV_IMPRESSIONS
      ) {
        const score = 0.4;
        await this.upsertSearchOpportunity(keyword, "DECAYING_QUERY", score, {
          impressions,
          clicks,
          position,
          ctr,
          prevClicks: previous.clicks,
          reason: `Clicks dropped from ${previous.clicks ?? 0} to ${clicks} — content refresh may help`,
        });
        created++;
      }

      // CONTENT_GAP: impressions but no matching content
      if (impressions >= CONTENT_GAP_MIN_IMPRESSIONS) {
        const existingContent = await this.prisma.contentBrief.findFirst({
          where: {
            brandId: BRAND_ID,
            OR: [
              { topic: { contains: keyword.keyword, mode: "insensitive" } },
              {
                primaryKeyword: {
                  contains: keyword.keyword,
                  mode: "insensitive",
                },
              },
            ],
          },
        });
        if (!existingContent) {
          const score = 0.4 + Math.min(0.3, impressions / 3000);
          await this.upsertSearchOpportunity(keyword, "CONTENT_GAP", score, {
            impressions,
            clicks,
            position,
            ctr,
            reason: `${impressions} impressions for "${keyword.keyword}" but no matching content exists`,
          });
          created++;
        }
      }
    }

    this.logger.log(`Detected ${created} Search Console opportunities`);
    return created;
  }

  private async upsertSearchOpportunity(
    keyword: { id: string; keyword: string; topic: string | null },
    opportunityType: string,
    score: number,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    const reason = (evidence.reason as string) ?? "";
    delete evidence.reason;

    const existing = await this.prisma.searchOpportunity.findFirst({
      where: {
        brandId: BRAND_ID,
        keywordId: keyword.id,
        opportunityType,
        status: { in: ["NEW", "ACTIONED"] },
      },
    });

    if (existing) {
      await this.prisma.searchOpportunity.update({
        where: { id: existing.id },
        data: {
          score,
          reason,
          evidence: evidence as any,
          updatedAt: new Date(),
        },
      });
    } else {
      await this.prisma.searchOpportunity.create({
        data: {
          brandId: BRAND_ID,
          keywordId: keyword.id,
          opportunityType,
          topic: keyword.topic ?? keyword.keyword,
          score,
          reason,
          evidence: evidence as any,
          relatedProductIds: [],
          relatedContentIds: [],
          status: "NEW",
        },
      });
    }
  }

  async getOpportunities(status?: string) {
    return this.prisma.searchOpportunity.findMany({
      where: {
        brandId: BRAND_ID,
        status: status ?? "NEW",
      },
      include: { keyword: true },
      orderBy: { score: "desc" },
      take: 50,
    });
  }

  // Utility: build previous-period rows from current rows (for testing without real DB history)
  buildPreviousPeriodRows(
    rows: SearchConsoleRow[],
    decayFactor = 0.8,
  ): SearchConsoleRow[] {
    return rows.map((r) => ({
      ...r,
      clicks: Math.floor(r.clicks * decayFactor),
      impressions: Math.floor(r.impressions * decayFactor),
    }));
  }
}
