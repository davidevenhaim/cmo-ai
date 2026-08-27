import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { DecideRecommendationSchema } from "@ai-cmo/contracts";
import { RecommendationService } from "./recommendation.service";
import { MeasurementSchedulerService } from "./measurement-scheduler.service";
import { CmoScorecardService } from "./cmo-scorecard.service";
import { WeeklyReviewService } from "./weekly-review.service";
import { ExperimentMeasurementService } from "./experiment-measurement.service";
import { PerformanceIngestionService } from "./performance-ingestion.service";

@Controller("measurement")
export class MeasurementController {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly scheduler: MeasurementSchedulerService,
    private readonly scorecard: CmoScorecardService,
    private readonly weeklyReview: WeeklyReviewService,
    private readonly experiments: ExperimentMeasurementService,
    private readonly ingestion: PerformanceIngestionService,
  ) {}

  @Get("recommendations")
  listRecommendations(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.recommendations.list({
      status,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get("recommendations/:id")
  getRecommendation(@Param("id") id: string) {
    return this.recommendations.getDetail(id);
  }

  @Patch("recommendations/:id/decide")
  decide(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DecideRecommendationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.format());
    }
    return this.recommendations.decide(id, parsed.data);
  }

  // Manual trigger for the hourly measurement cycle — idempotent.
  @Post("run")
  run() {
    return this.scheduler.runCycle();
  }

  @Get("scorecard")
  getScorecard(@Query("days") days?: string) {
    return this.scorecard.generate(days ? parseInt(days) : 30);
  }

  @Get("weekly-review")
  getWeeklyReview() {
    return this.weeklyReview.generate();
  }

  @Get("experiments")
  getExperiments(@Query("limit") limit?: string) {
    return this.experiments.evaluateRecent(limit ? parseInt(limit) : 10);
  }

  @Get("traffic")
  getTraffic(
    @Query("days") days?: string,
    @Query("provider") provider?: string,
  ) {
    const windowDays = days ? parseInt(days) : 30;
    return this.ingestion.listBrandObservations({
      since: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
      provider,
    });
  }

  @Get("observations")
  getObservations(
    @Query("subjectType") subjectType: string,
    @Query("subjectId") subjectId: string,
    @Query("metric") metric?: string,
  ) {
    if (!subjectType || !subjectId) {
      throw new BadRequestException("subjectType and subjectId are required");
    }
    return this.ingestion.getObservations({ subjectType, subjectId, metric });
  }
}
