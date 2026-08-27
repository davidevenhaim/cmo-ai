import {
  AttributionStrength,
  MeasurementDataQuality,
  OutcomeDimension,
  ValueUnit,
} from "@ai-cmo/contracts";

// A single provider-neutral metric observation. Idempotency comes from the
// (provider, subjectType, subjectId, metric, bucketStart) key.
export interface ObservationInput {
  provider: string;
  // PUBLICATION | CONTENT_DRAFT | RECOMMENDATION | CHANNEL | BRAND | CAMPAIGN | EXPERIMENT
  subjectType: string;
  subjectId: string;
  metric: string;
  dimension: OutcomeDimension;
  value: number;
  unit: ValueUnit;
  currencyCode?: string | null;
  bucketStart: Date;
  bucketEnd: Date;
  dataQuality?: MeasurementDataQuality;
  attributionStrength?: AttributionStrength;
  isMock?: boolean;
  rawPayload?: unknown;
}

export type ProviderCollectStatus =
  "AVAILABLE" | "STALE" | "INCOMPLETE" | "NOT_CONFIGURED" | "ERROR" | "MOCK";

export interface ProviderCollectResult {
  provider: string;
  status: ProviderCollectStatus;
  observations: ObservationInput[];
  detail: string | null;
}

// Providers expose only what they genuinely know. A provider that has no
// real data source reports NOT_CONFIGURED (or MOCK) and returns nothing
// usable for real conclusions — metrics are never manufactured.
export interface PerformanceProvider {
  readonly key: string;
  collect(window: { since: Date; until: Date }): Promise<ProviderCollectResult>;
}

export const PERFORMANCE_PROVIDERS = "PERFORMANCE_PROVIDERS";
