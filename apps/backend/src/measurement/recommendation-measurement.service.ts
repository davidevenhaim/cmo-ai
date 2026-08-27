import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  AttributionStrength,
  MeasurementDataQuality,
  OutcomeClassification,
  OutcomeDimension,
  ValueUnit,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { BaselineService } from "./baseline.service";
import { ContentOutcomeService } from "./content-outcome.service";
import { UtmService } from "./utm.service";

const BRAND_ID = "luminesce-brand-001";

interface MetricDraft {
  dimension: OutcomeDimension;
  metric: string;
  value: number;
  unit: ValueUnit;
  currencyCode: string | null;
  baseline: number | null;
  delta: number | null;
  deltaPct: number | null;
  source: string;
  attributionStrength: AttributionStrength;
  dataQuality: MeasurementDataQuality;
  baselineSamples: number;
}

// Causal-honesty ordering: experiment > provider-reported-for-this-object >
// linked attribution > correlation > unknown.
const STRENGTH_ORDER: AttributionStrength[] = [
  "EXPERIMENTAL",
  "DIRECT",
  "ATTRIBUTED",
  "CORRELATED",
  "UNKNOWN",
];

// Closes the loop for a recommendation: aggregates real observations from its
// lineage at the end of the measurement window, compares against baselines,
// and stores a deterministic outcome. Correlation is never presented as
// causation, and poor data can only produce INCONCLUSIVE.
@Injectable()
export class RecommendationMeasurementService {
  private readonly logger = new Logger(RecommendationMeasurementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baselines: BaselineService,
    private readonly contentOutcome: ContentOutcomeService,
    private readonly utm: UtmService,
  ) {}

  async startMeasuring(): Promise<number> {
    const result = await this.prisma.recommendation.updateMany({
      where: { brandId: BRAND_ID, status: "EXECUTED" },
      data: { status: "MEASURING" },
    });
    return result.count;
  }

  async finalizeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.recommendation.findMany({
      where: {
        brandId: BRAND_ID,
        status: "MEASURING",
        measurementWindowEndsAt: { lte: now },
      },
      select: { id: true },
    });
    for (const rec of due) {
      try {
        await this.finalize(rec.id, now);
      } catch (err: any) {
        this.logger.warn(`Finalize ${rec.id} failed: ${err.message}`);
      }
    }
    return due.length;
  }

  // Idempotent: re-finalizing replaces the outcome metrics and re-derives the
  // same deterministic classification.
  async finalize(recommendationId: string, now = new Date()) {
    const rec = await this.prisma.recommendation.findUnique({
      where: { id: recommendationId },
      include: {
        contentBriefs: {
          include: {
            drafts: {
              include: {
                publishRequests: { include: { publication: true } },
              },
            },
          },
        },
        revenueOpportunities: { include: { attributions: true } },
      },
    });
    if (!rec) {
      throw new NotFoundException(
        `Recommendation ${recommendationId} not found`,
      );
    }

    const windowStart = rec.executedAt ?? rec.createdAt;
    const windowEnd = rec.measurementWindowEndsAt ?? now;

    const metrics: MetricDraft[] = [];
    const publications = rec.contentBriefs
      .flatMap((b) => b.drafts)
      .flatMap((d) => d.publishRequests)
      .filter((r) => r.publication)
      .map((r) => ({
        publicationId: r.publication!.id,
        channel: r.provider,
      }));

    // --- Content path: provider metrics for the published objects ----------
    if (publications.length > 0) {
      const pubIds = publications.map((p) => p.publicationId);
      const observations = await this.prisma.performanceObservation.findMany({
        where: {
          brandId: BRAND_ID,
          subjectType: "PUBLICATION",
          subjectId: { in: pubIds },
          isMock: false,
        },
      });

      const byMetric = new Map<string, typeof observations>();
      for (const obs of observations) {
        const bucket = byMetric.get(obs.metric) ?? [];
        bucket.push(obs);
        byMetric.set(obs.metric, bucket);
      }

      for (const [metric, rows] of byMetric) {
        const total = rows.reduce((a, o) => a + o.value, 0);
        const channel = publications[0].channel;
        const baseline = await this.baselines.channelContentBaseline({
          channel,
          metric,
          before: windowStart,
          excludeSubjectIds: pubIds,
        });
        metrics.push({
          dimension: rows[0].dimension as OutcomeDimension,
          metric,
          value: total,
          unit: rows[0].unit as ValueUnit,
          currencyCode: rows[0].currencyCode,
          baseline: baseline.baseline,
          delta: baseline.baseline !== null ? total - baseline.baseline : null,
          deltaPct:
            baseline.baseline !== null && baseline.baseline > 0
              ? Math.round(
                  ((total - baseline.baseline) / baseline.baseline) * 1000,
                ) / 10
              : null,
          source: rows[0].provider,
          attributionStrength: "DIRECT",
          // Roll up the weakest observation quality — STALE/PARTIAL must not
          // silently become COMPLETE on the recommendation outcome.
          dataQuality: worstDataQuality(
            rows.map((r) => r.dataQuality as MeasurementDataQuality),
          ),
          baselineSamples: baseline.samples,
        });
      }
    }

    // --- UTM-tracked campaign traffic (deterministic naming) ---------------
    const campaignIds = [
      this.utm.campaignForRecommendation(rec.id),
      ...rec.contentBriefs.map((b) => this.utm.campaignForRecommendation(b.id)),
    ];
    const campaignObs = await this.prisma.performanceObservation.findMany({
      where: {
        brandId: BRAND_ID,
        subjectType: "CAMPAIGN",
        subjectId: { in: campaignIds },
        isMock: false,
      },
    });
    const campaignByMetric = new Map<string, typeof campaignObs>();
    for (const obs of campaignObs) {
      const bucket = campaignByMetric.get(obs.metric) ?? [];
      bucket.push(obs);
      campaignByMetric.set(obs.metric, bucket);
    }
    for (const [metric, rows] of campaignByMetric) {
      metrics.push({
        dimension: rows[0].dimension as OutcomeDimension,
        metric: `campaign_${metric}`,
        value: rows.reduce((a, o) => a + o.value, 0),
        unit: rows[0].unit as ValueUnit,
        currencyCode: rows[0].currencyCode,
        baseline: null,
        delta: null,
        deltaPct: null,
        source: rows[0].provider,
        attributionStrength: "ATTRIBUTED",
        dataQuality: "COMPLETE",
        baselineSamples: 0,
      });
    }

    // --- Revenue path: reuse M7.7 attribution (no third system) ------------
    const attributions = rec.revenueOpportunities
      .flatMap((o) => o.attributions)
      .filter(
        (a) => a.attributedAt >= windowStart && a.attributedAt <= windowEnd,
      );
    const attributed = attributions.filter(
      (a) => a.attributionType !== "INCREMENTAL_ESTIMATE",
    );
    const experimental = attributions.filter(
      (a) => a.attributionType === "INCREMENTAL_ESTIMATE",
    );
    if (attributed.length > 0) {
      const revenue = attributed.reduce((a, r) => a + (r.revenue ?? 0), 0);
      const profit = attributed.reduce(
        (a, r) => a + (r.contributionProfit ?? 0),
        0,
      );
      const incentiveCost = attributed.reduce(
        (a, r) => a + (r.incentiveCost ?? 0),
        0,
      );
      metrics.push(
        {
          dimension: "RECOVERY",
          metric: "attributed_revenue",
          value: revenue,
          unit: "CURRENCY",
          currencyCode: null,
          baseline: null,
          delta: null,
          deltaPct: null,
          source: "revenue_attribution",
          attributionStrength: "ATTRIBUTED",
          dataQuality: "COMPLETE",
          baselineSamples: 0,
        },
        {
          dimension: "PROFIT",
          // Contribution profit already deducts incentive cost and COGS.
          metric: "attributed_contribution_profit",
          value: profit,
          unit: "CURRENCY",
          currencyCode: null,
          baseline: null,
          delta: null,
          deltaPct: null,
          source: "revenue_attribution",
          attributionStrength: "ATTRIBUTED",
          dataQuality: "COMPLETE",
          baselineSamples: 0,
        },
        {
          dimension: "OTHER",
          metric: "incentive_cost",
          value: incentiveCost,
          unit: "CURRENCY",
          currencyCode: null,
          baseline: null,
          delta: null,
          deltaPct: null,
          source: "revenue_attribution",
          attributionStrength: "ATTRIBUTED",
          dataQuality: "COMPLETE",
          baselineSamples: 0,
        },
      );
    }
    if (experimental.length > 0) {
      metrics.push({
        dimension: "PROFIT",
        metric: "experiment_incremental_profit",
        value: experimental.reduce(
          (a, r) => a + (r.contributionProfit ?? 0),
          0,
        ),
        unit: "CURRENCY",
        currencyCode: null,
        baseline: null,
        delta: null,
        deltaPct: null,
        source: "revenue_attribution",
        attributionStrength: "EXPERIMENTAL",
        dataQuality: "COMPLETE",
        baselineSamples: 0,
      });
    }

    // --- Correlation fallback: brand movement with no linkage --------------
    const hasLinkedEvidence = metrics.length > 0;
    if (!hasLinkedEvidence) {
      const brandRevenue = await this.prisma.performanceObservation.findMany({
        where: {
          brandId: BRAND_ID,
          subjectType: "BRAND",
          metric: "revenue",
          isMock: false,
          bucketStart: { gte: windowStart, lte: windowEnd },
        },
      });
      if (brandRevenue.length > 0) {
        const avg =
          brandRevenue.reduce((a, o) => a + o.value, 0) / brandRevenue.length;
        const baseline = await this.baselines.brandDailyBaseline({
          provider: brandRevenue[0].provider,
          metric: "revenue",
          before: windowStart,
        });
        metrics.push({
          dimension: "REVENUE",
          metric: "brand_revenue_daily_avg",
          value: avg,
          unit: "CURRENCY",
          currencyCode: brandRevenue[0].currencyCode,
          baseline: baseline.baseline,
          delta: baseline.baseline !== null ? avg - baseline.baseline : null,
          deltaPct:
            baseline.baseline !== null && baseline.baseline > 0
              ? Math.round(
                  ((avg - baseline.baseline) / baseline.baseline) * 1000,
                ) / 10
              : null,
          source: brandRevenue[0].provider,
          // Brand-level movement with no direct linkage is correlation only.
          attributionStrength: "CORRELATED",
          dataQuality: "PARTIAL",
          baselineSamples: baseline.samples,
        });
      }
    }

    // --- Data quality ------------------------------------------------------
    const expectedContentData = publications.length > 0;
    const hasContentData = metrics.some(
      (m) => m.attributionStrength === "DIRECT",
    );
    let dataQuality: MeasurementDataQuality;
    if (metrics.length === 0) {
      dataQuality = "UNAVAILABLE";
    } else if (expectedContentData && !hasContentData) {
      // Publication is live but its provider analytics are missing.
      // Execution success is unrelated — measurement alone is PARTIAL.
      dataQuality = "PARTIAL";
    } else if (metrics.every((m) => m.attributionStrength === "CORRELATED")) {
      dataQuality = "PARTIAL";
    } else {
      dataQuality = worstDataQuality(metrics.map((m) => m.dataQuality));
    }

    // --- Outcome classification (deterministic) ----------------------------
    const outcome = this.classify(rec, metrics, dataQuality);
    const attributionStrength = strongest(
      metrics.map((m) => m.attributionStrength),
    );

    // Idempotent re-finalize: replace outcome metrics wholesale.
    await this.prisma.outcomeMetric.deleteMany({
      where: { recommendationId: rec.id },
    });
    for (const m of metrics) {
      await this.prisma.outcomeMetric.create({
        data: {
          recommendationId: rec.id,
          dimension: m.dimension,
          metric: m.metric,
          value: m.value,
          unit: m.unit,
          currencyCode: m.currencyCode,
          baseline: m.baseline,
          delta: m.delta,
          deltaPct: m.deltaPct,
          source: m.source,
          attributionStrength: m.attributionStrength,
          dataQuality: m.dataQuality,
          observedAt: now,
        },
      });
    }

    return this.prisma.recommendation.update({
      where: { id: rec.id },
      data: {
        status: "MEASURED",
        measuredAt: now,
        outcome: outcome.classification,
        outcomeSummary: outcome.summary,
        dataQuality,
        attributionStrength,
      },
    });
  }

  private classify(
    rec: { expectedImpactValue: number | null },
    metrics: MetricDraft[],
    dataQuality: MeasurementDataQuality,
  ): { classification: OutcomeClassification; summary: string } {
    if (metrics.length === 0) {
      return {
        classification: "INCONCLUSIVE",
        summary:
          "No observations available for the measurement window — no success or failure is claimed.",
      };
    }

    // Content: classify the primary provider-reported metric vs its baseline.
    const primaryOrder = [
      "sessions",
      "clicks",
      "engagement",
      "impressions",
      "reach",
      "views",
    ];
    const contentMetric =
      metrics.find(
        (m) =>
          m.attributionStrength === "DIRECT" && primaryOrder.includes(m.metric),
      ) ?? metrics.find((m) => m.attributionStrength === "DIRECT");
    if (contentMetric) {
      const result = this.contentOutcome.classify({
        value: contentMetric.value,
        baseline: contentMetric.baseline,
        baselineSamples: contentMetric.baselineSamples,
        dataQuality,
      });
      return {
        classification: result.classification,
        summary: `${contentMetric.metric}: ${contentMetric.value} (${result.reason}).`,
      };
    }

    // Revenue: attributed contribution profit (costs already deducted).
    const profitMetric = metrics.find(
      (m) => m.metric === "attributed_contribution_profit",
    );
    if (profitMetric) {
      const profit = profitMetric.value;
      const expected = rec.expectedImpactValue;
      if (dataQuality === "UNAVAILABLE" || dataQuality === "INSUFFICIENT") {
        return {
          classification: "INCONCLUSIVE",
          summary: "Attribution data insufficient to classify the outcome.",
        };
      }
      if (expected !== null && expected > 0) {
        if (profit >= expected * 1.2) {
          return {
            classification: "OUTPERFORMED",
            summary: `Attributed contribution profit ${round2(profit)} exceeded the expected ${round2(expected)}.`,
          };
        }
        if (profit < expected * 0.5) {
          return {
            classification: "UNDERPERFORMED",
            summary: `Attributed contribution profit ${round2(profit)} fell short of the expected ${round2(expected)}.`,
          };
        }
        return {
          classification: "EXPECTED",
          summary: `Attributed contribution profit ${round2(profit)} was in line with the expected ${round2(expected)}.`,
        };
      }
      if (profit > 0) {
        return {
          classification: "EXPECTED",
          summary: `Attributed contribution profit ${round2(profit)} (last-touch attribution — not incremental).`,
        };
      }
      return {
        classification: "UNDERPERFORMED",
        summary: "No attributed recovery value in the measurement window.",
      };
    }

    // Correlation only: honest wording — never claims the action generated it.
    const correlated = metrics.find(
      (m) => m.attributionStrength === "CORRELATED",
    );
    if (correlated) {
      const direction =
        correlated.delta !== null && correlated.delta > 0 ? "rose" : "moved";
      return {
        classification: "INCONCLUSIVE",
        summary: `Brand-level ${correlated.metric} ${direction} during the window, but no direct linkage exists — this is correlation, not attribution.`,
      };
    }

    return {
      classification: "INCONCLUSIVE",
      summary: "Only weakly attributable observations were available.",
    };
  }
}

function strongest(strengths: AttributionStrength[]): AttributionStrength {
  for (const s of STRENGTH_ORDER) {
    if (strengths.includes(s)) return s;
  }
  return "UNKNOWN";
}

// Worst-wins ordering for measurement honesty.
const QUALITY_ORDER: MeasurementDataQuality[] = [
  "UNAVAILABLE",
  "INSUFFICIENT",
  "STALE",
  "PARTIAL",
  "COMPLETE",
];

function worstDataQuality(
  qualities: MeasurementDataQuality[],
): MeasurementDataQuality {
  for (const q of QUALITY_ORDER) {
    if (qualities.includes(q)) return q;
  }
  return "COMPLETE";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
