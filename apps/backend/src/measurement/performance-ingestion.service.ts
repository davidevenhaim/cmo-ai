import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  ObservationInput,
  PerformanceProvider,
  PERFORMANCE_PROVIDERS,
  ProviderCollectStatus,
} from "./performance-provider.interface";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

const BRAND_ID = "luminesce-brand-001";

export interface IngestionSummary {
  ranAt: Date;
  providers: Array<{
    provider: string;
    status: ProviderCollectStatus;
    ingested: number;
    detail: string | null;
  }>;
}

// Repeatable, idempotent observation ingestion. The same provider metric for
// the same time bucket upserts instead of duplicating, so re-running a sync
// is always safe. One provider failing never blocks the others — and never
// affects business execution.
@Injectable()
export class PerformanceIngestionService {
  private readonly logger = new Logger(PerformanceIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(PERFORMANCE_PROVIDERS)
    private readonly providers: PerformanceProvider[] = [],
  ) {}

  async ingest(window?: {
    since?: Date;
    until?: Date;
  }): Promise<IngestionSummary> {
    const until = window?.until ?? new Date();
    const since =
      window?.since ?? new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

    const summary: IngestionSummary = { ranAt: new Date(), providers: [] };

    for (const provider of this.providers) {
      try {
        const result = await provider.collect({ since, until });
        let ingested = 0;
        for (const obs of result.observations) {
          await this.upsertObservation(obs);
          ingested++;
        }
        summary.providers.push({
          provider: provider.key,
          status: result.status,
          ingested,
          detail: result.detail,
        });
      } catch (err: any) {
        this.logger.warn(`Provider ${provider.key} failed: ${err.message}`);
        summary.providers.push({
          provider: provider.key,
          status: "ERROR",
          ingested: 0,
          detail: err.message,
        });
      }
    }

    return summary;
  }

  async upsertObservation(obs: ObservationInput): Promise<void> {
    const rawPayload = boundPayload(obs.rawPayload);
    const key = {
      brandId: BRAND_ID,
      provider: obs.provider,
      subjectType: obs.subjectType,
      subjectId: obs.subjectId,
      metric: obs.metric,
      bucketStart: obs.bucketStart,
    };
    const data = {
      dimension: obs.dimension,
      value: obs.value,
      unit: obs.unit,
      currencyCode: obs.currencyCode ?? null,
      bucketEnd: obs.bucketEnd,
      observedAt: new Date(),
      dataQuality: obs.dataQuality ?? "COMPLETE",
      attributionStrength: obs.attributionStrength ?? "UNKNOWN",
      isMock: obs.isMock ?? false,
      rawPayload,
    };
    await this.prisma.performanceObservation.upsert({
      where: {
        brandId_provider_subjectType_subjectId_metric_bucketStart: key,
      },
      create: { ...key, ...data },
      update: data,
    });
  }

  // Real observations only — mock data never feeds conclusions.
  async getObservations(filter: {
    subjectType: string;
    subjectId: string;
    since?: Date;
    until?: Date;
    metric?: string;
    includeMock?: boolean;
  }) {
    return this.prisma.performanceObservation.findMany({
      where: {
        brandId: BRAND_ID,
        subjectType: filter.subjectType,
        subjectId: filter.subjectId,
        ...(filter.metric ? { metric: filter.metric } : {}),
        ...(filter.includeMock ? {} : { isMock: false }),
        ...(filter.since || filter.until
          ? {
              bucketStart: {
                ...(filter.since ? { gte: filter.since } : {}),
                ...(filter.until ? { lte: filter.until } : {}),
              },
            }
          : {}),
      },
      orderBy: { bucketStart: "asc" },
    });
  }

  // Brand-level daily series for the traffic view — real observations only.
  async listBrandObservations(filter: { since: Date; provider?: string }) {
    return this.prisma.performanceObservation.findMany({
      where: {
        brandId: BRAND_ID,
        subjectType: "BRAND",
        isMock: false,
        ...(filter.provider ? { provider: filter.provider } : {}),
        bucketStart: { gte: filter.since },
      },
      orderBy: { bucketStart: "asc" },
    });
  }
}

function boundPayload(payload: unknown): object | undefined {
  if (payload === undefined || payload === null) return undefined;
  const json = JSON.stringify(payload);
  if (json.length <= MEASUREMENT_POLICY.rawPayloadMaxChars) {
    return payload as object;
  }
  return {
    truncated: true,
    excerpt: json.slice(0, MEASUREMENT_POLICY.rawPayloadMaxChars),
  };
}
