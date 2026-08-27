import { Controller, Get, Post, Query, Param, Body } from "@nestjs/common";
import { RevenueOptimizationService } from "./revenue-optimization.service";
import {
  RevenueAttributionService,
  AttributionInput,
} from "./revenue-attribution.service";
import {
  RevenueExperimentService,
  ExperimentVariant,
} from "./revenue-experiment.service";
import { RevenueContextService } from "./revenue-context.service";
import { NextBestActionService, NBAInput } from "./next-best-action.service";
import { BundleService } from "./bundle.service";
import { ProductAffinityService } from "./product-affinity.service";

@Controller("revenue")
export class RevenueOptimizationController {
  constructor(
    private readonly revenue: RevenueOptimizationService,
    private readonly attribution: RevenueAttributionService,
    private readonly experiments: RevenueExperimentService,
    private readonly context: RevenueContextService,
    private readonly nba: NextBestActionService,
    private readonly bundles: BundleService,
    private readonly affinity: ProductAffinityService,
  ) {}

  @Get("affinity")
  listAffinity(@Query("limit") limit?: string) {
    return this.affinity.listTopAffinities(limit ? parseInt(limit, 10) : 20);
  }

  @Get("dashboard/abandonment")
  getAbandonmentDashboard() {
    return this.revenue.getAbandonmentDashboard();
  }

  @Get("opportunities")
  getOpportunities(
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.revenue.getAllOpportunities(
      type,
      status,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Post("opportunities/sync")
  syncOpportunities(
    @Body()
    body: {
      freeShippingThreshold?: number;
      estimatedMarginPct?: number;
    },
  ) {
    void body;
    return this.revenue.syncOpportunitiesFromCheckouts();
  }

  @Post("opportunities/:id/recovered")
  markRecovered(
    @Param("id") id: string,
    @Body()
    body: {
      shopifyOrderId: string;
      revenue: number;
      incentiveCost?: number;
      estimatedCogs?: number;
    },
  ) {
    return this.revenue.markOpportunityRecovered(
      id,
      body.shopifyOrderId,
      body.revenue,
      body.incentiveCost,
      body.estimatedCogs,
    );
  }

  @Post("affinity/compute")
  computeAffinity() {
    return this.revenue.computeAffinityFromOrders();
  }

  @Post("recovery/process")
  processRecovery() {
    return this.revenue.processRecoverySteps();
  }

  @Get("attribution/summary")
  getAttributionSummary(@Query("days") days?: string) {
    return this.attribution.getSummary(days ? parseInt(days, 10) : 30);
  }

  @Post("attribution")
  recordAttribution(@Body() body: AttributionInput) {
    return this.attribution.record(body);
  }

  @Get("experiments")
  getExperimentResults(@Query("id") id: string) {
    return this.experiments.getExperimentResults(id);
  }

  @Post("experiments")
  createExperiment(
    @Body()
    body: {
      name: string;
      description?: string;
      variants: ExperimentVariant[];
    },
  ) {
    return this.experiments.createExperiment(
      body.name,
      body.variants,
      body.description,
    );
  }

  @Post("experiments/:id/end")
  endExperiment(@Param("id") id: string) {
    return this.experiments.endExperiment(id);
  }

  @Get("context")
  getContext() {
    return this.context.build();
  }

  @Post("next-best-action")
  getNextBestAction(@Body() body: NBAInput) {
    return this.nba.decide(body);
  }

  @Get("bundles")
  getBundles(@Query("approvedOnly") approvedOnly?: string) {
    return this.bundles.getActiveBundles(approvedOnly === "true");
  }
}
