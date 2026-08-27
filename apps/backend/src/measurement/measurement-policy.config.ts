// Deterministic measurement policy. Claude never decides these numbers —
// classification, sample minimums and windows are config, not model output.
export const MEASUREMENT_POLICY = {
  // Default measurement window after a recommendation is executed.
  defaultWindowDays: 7,
  // PROPOSED recommendations older than this expire (still kept as history).
  proposalTtlDays: 14,
  // Rolling baseline windows.
  baselineWindowsDays: [7, 30, 90] as number[],
  // Minimum comparable prior items (same channel) before a baseline is usable.
  minBaselineSamples: 3,
  // Content outcome thresholds vs baseline (percent).
  outperformDeltaPct: 20,
  underperformDeltaPct: -20,
  experiment: {
    minSamplePerVariant: 30,
    minConversionsPerVariant: 5,
    // Two-proportion z-score thresholds.
    winnerZScore: 1.96, // ~95%
    directionalZScore: 1.28, // ~80%
  },
  // Raw provider payload excerpts are bounded to this many JSON characters.
  rawPayloadMaxChars: 2000,
} as const;

export type MeasurementPolicy = typeof MEASUREMENT_POLICY;
