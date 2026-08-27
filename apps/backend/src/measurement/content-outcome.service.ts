import { Injectable } from "@nestjs/common";
import {
  MeasurementDataQuality,
  OutcomeClassification,
} from "@ai-cmo/contracts";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

export interface ContentOutcomeInput {
  value: number;
  baseline: number | null;
  baselineSamples: number;
  dataQuality: MeasurementDataQuality;
}

export interface ContentOutcomeResult {
  classification: OutcomeClassification;
  deltaPct: number | null;
  reason: string;
}

// Deterministic outcome classification. Thresholds come from config —
// Claude may explain a result, it never decides the raw classification.
@Injectable()
export class ContentOutcomeService {
  classify(input: ContentOutcomeInput): ContentOutcomeResult {
    // Poor/incomplete provider data must never produce a win/loss call.
    // PARTIAL and STALE stay as honest observations, but cannot classify.
    if (
      input.dataQuality === "INSUFFICIENT" ||
      input.dataQuality === "UNAVAILABLE" ||
      input.dataQuality === "PARTIAL" ||
      input.dataQuality === "STALE"
    ) {
      return {
        classification: "INCONCLUSIVE",
        deltaPct: null,
        reason: `data quality ${input.dataQuality} — cannot classify`,
      };
    }

    if (
      input.baseline === null ||
      input.baseline <= 0 ||
      input.baselineSamples < MEASUREMENT_POLICY.minBaselineSamples
    ) {
      return {
        classification: "INCONCLUSIVE",
        deltaPct: null,
        reason: `insufficient baseline (${input.baselineSamples} comparable prior items, minimum ${MEASUREMENT_POLICY.minBaselineSamples})`,
      };
    }

    const deltaPct =
      Math.round(((input.value - input.baseline) / input.baseline) * 1000) / 10;

    if (deltaPct >= MEASUREMENT_POLICY.outperformDeltaPct) {
      return {
        classification: "OUTPERFORMED",
        deltaPct,
        reason: `${deltaPct}% vs baseline (threshold +${MEASUREMENT_POLICY.outperformDeltaPct}%)`,
      };
    }
    if (deltaPct <= MEASUREMENT_POLICY.underperformDeltaPct) {
      return {
        classification: "UNDERPERFORMED",
        deltaPct,
        reason: `${deltaPct}% vs baseline (threshold ${MEASUREMENT_POLICY.underperformDeltaPct}%)`,
      };
    }
    return {
      classification: "EXPECTED",
      deltaPct,
      reason: `${deltaPct}% vs baseline — within expected range`,
    };
  }
}
