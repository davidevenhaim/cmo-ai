import { Injectable } from "@nestjs/common";
import {
  ExperimentEvaluation,
  ExperimentVariantResult,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { RevenueExperimentService } from "../revenue-optimization/revenue-experiment.service";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

// Deterministic experiment evaluation on top of the existing M7.7
// RevenueExperiment infrastructure (no third attribution system). Winners are
// never declared from tiny samples — minimum sample and confidence thresholds
// are config, not judgment.
@Injectable()
export class ExperimentMeasurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly experiments: RevenueExperimentService,
  ) {}

  async evaluate(experimentId: string): Promise<ExperimentEvaluation> {
    const experiment = await this.prisma.revenueExperiment.findUnique({
      where: { id: experimentId },
    });
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    const results = await this.experiments.getExperimentResults(experimentId);
    const incentiveCosts = await this.incentiveCostByVariant(experimentId);

    const enriched: ExperimentVariantResult[] = results.map((r) => ({
      variantId: r.variantId,
      variantName: r.variantName,
      isControl: r.isControl,
      assigned: r.assigned,
      converted: r.converted,
      conversionRate: r.assigned > 0 ? r.conversionRate : null,
      totalRevenue: r.totalRevenue,
      totalContributionProfit: r.totalContributionProfit,
      totalIncentiveCost: incentiveCosts.get(r.variantId) ?? 0,
      avgProfitPerAssigned: r.assigned > 0 ? r.avgProfitPerAssigned : null,
    }));

    const control = enriched.find((v) => v.isControl) ?? null;
    const variants = enriched.filter((v) => !v.isControl);
    const policy = MEASUREMENT_POLICY.experiment;

    const base = {
      experimentId,
      name: experiment.name,
      status: experiment.status,
      minSamplePerVariant: policy.minSamplePerVariant,
      control,
      variants,
    };

    if (!control || variants.length === 0) {
      return {
        ...base,
        state: experiment.status === "ENDED" ? "STOPPED" : "INSUFFICIENT_DATA",
        bestVariantId: null,
        profitDeltaPerAssigned: null,
        note: "Experiment needs a control group and at least one variant to be evaluated.",
      };
    }

    const groups = [control, ...variants];
    const underSampled = groups.filter(
      (g) => g.assigned < policy.minSamplePerVariant,
    );
    if (underSampled.length > 0) {
      return {
        ...base,
        state: experiment.status === "ENDED" ? "STOPPED" : "INSUFFICIENT_DATA",
        bestVariantId: null,
        profitDeltaPerAssigned: null,
        note: `Not enough samples: ${underSampled
          .map(
            (g) =>
              `${g.variantName} (${g.assigned}/${policy.minSamplePerVariant})`,
          )
          .join(", ")}. No winner declared from small samples.`,
      };
    }

    // Best variant by primary business metric: contribution profit / assigned.
    const best = variants.reduce((a, b) =>
      (b.avgProfitPerAssigned ?? 0) > (a.avgProfitPerAssigned ?? 0) ? b : a,
    );
    const profitDeltaPerAssigned =
      (best.avgProfitPerAssigned ?? 0) - (control.avgProfitPerAssigned ?? 0);

    const z = twoProportionZ(
      best.converted,
      best.assigned,
      control.converted,
      control.assigned,
    );

    if (
      best.converted < policy.minConversionsPerVariant ||
      control.converted < policy.minConversionsPerVariant
    ) {
      return {
        ...base,
        state: experiment.status === "ENDED" ? "STOPPED" : "INSUFFICIENT_DATA",
        bestVariantId: best.variantId,
        profitDeltaPerAssigned,
        note: `Fewer than ${policy.minConversionsPerVariant} conversions per group — too early to call.`,
      };
    }

    if (z >= policy.winnerZScore && profitDeltaPerAssigned > 0) {
      return {
        ...base,
        state: "WINNER",
        bestVariantId: best.variantId,
        profitDeltaPerAssigned,
        note: `${best.variantName} beats control on contribution profit per assigned (z=${z.toFixed(2)}).`,
      };
    }
    if (Math.abs(z) >= policy.directionalZScore) {
      return {
        ...base,
        state: "DIRECTIONAL",
        bestVariantId: profitDeltaPerAssigned > 0 ? best.variantId : null,
        profitDeltaPerAssigned,
        note: `Directional signal only (z=${z.toFixed(2)}) — below winner confidence threshold.`,
      };
    }
    return {
      ...base,
      state: "NO_CLEAR_WINNER",
      bestVariantId: null,
      profitDeltaPerAssigned,
      note: `No significant difference between control and variants (z=${z.toFixed(2)}).`,
    };
  }

  async evaluateRecent(limit = 10): Promise<ExperimentEvaluation[]> {
    const experiments = await this.prisma.revenueExperiment.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const evaluations: ExperimentEvaluation[] = [];
    for (const e of experiments) {
      evaluations.push(await this.evaluate(e.id));
    }
    return evaluations;
  }

  private async incentiveCostByVariant(
    experimentId: string,
  ): Promise<Map<string, number>> {
    const grouped = await this.prisma.revenueExperimentAssignment.groupBy({
      by: ["variantId"],
      where: { experimentId },
      _sum: { incentiveCost: true },
    });
    return new Map(
      grouped.map((g: any) => [g.variantId, g._sum?.incentiveCost ?? 0]),
    );
  }
}

// Two-proportion z-test. Positive when p1 (variant) > p2 (control).
function twoProportionZ(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}
