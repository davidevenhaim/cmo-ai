import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PerformanceIngestionService } from "./performance-ingestion.service";
import { RecommendationService } from "./recommendation.service";
import { RecommendationMeasurementService } from "./recommendation-measurement.service";

export interface MeasurementCycleSummary {
  ranAt: Date;
  expired: number;
  executionTransitions: number;
  ingestion: { provider: string; status: string; ingested: number }[];
  startedMeasuring: number;
  finalized: number;
  errors: string[];
}

// Background measurement on the existing scheduler — no new infrastructure.
// Every step is idempotent and independently guarded: a provider or step
// failure never affects business execution or the other steps.
@Injectable()
export class MeasurementSchedulerService {
  private readonly logger = new Logger(MeasurementSchedulerService.name);

  constructor(
    private readonly recommendations: RecommendationService,
    private readonly ingestion: PerformanceIngestionService,
    private readonly measurement: RecommendationMeasurementService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    await this.runCycle();
  }

  async runCycle(now = new Date()): Promise<MeasurementCycleSummary> {
    const summary: MeasurementCycleSummary = {
      ranAt: now,
      expired: 0,
      executionTransitions: 0,
      ingestion: [],
      startedMeasuring: 0,
      finalized: 0,
      errors: [],
    };

    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err: any) {
        this.logger.warn(`Measurement step ${name} failed: ${err.message}`);
        summary.errors.push(`${name}: ${err.message}`);
      }
    };

    await step("expireStale", async () => {
      summary.expired = await this.recommendations.expireStale(now);
    });
    await step("syncExecutionTransitions", async () => {
      summary.executionTransitions =
        await this.recommendations.syncExecutionTransitions();
    });
    await step("ingest", async () => {
      const result = await this.ingestion.ingest();
      summary.ingestion = result.providers.map((p) => ({
        provider: p.provider,
        status: p.status,
        ingested: p.ingested,
      }));
    });
    await step("startMeasuring", async () => {
      summary.startedMeasuring = await this.measurement.startMeasuring();
    });
    await step("finalizeDue", async () => {
      summary.finalized = await this.measurement.finalizeDue(now);
    });

    this.logger.log(
      `Measurement cycle: ${summary.expired} expired, ${summary.executionTransitions} transitions, ${summary.startedMeasuring} started, ${summary.finalized} finalized, ${summary.errors.length} errors`,
    );
    return summary;
  }
}
