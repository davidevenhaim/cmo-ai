import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { GrowthContextService } from "./growth-context.service";
import { GrowthSyncService } from "./growth-sync.service";
import { AbandonedCheckoutService } from "./abandoned-checkout.service";
import { SegmentService } from "./segment.service";
import { CampaignService } from "./campaign.service";
import { UpsellService } from "./upsell.service";
import { ReplenishmentService } from "./replenishment.service";
import { ContactService } from "./contact.service";

@Controller("growth")
export class GrowthController {
  constructor(
    private readonly growthContext: GrowthContextService,
    private readonly growthSync: GrowthSyncService,
    private readonly abandonedCheckouts: AbandonedCheckoutService,
    private readonly segments: SegmentService,
    private readonly campaigns: CampaignService,
    private readonly upsell: UpsellService,
    private readonly replenishment: ReplenishmentService,
    private readonly contacts: ContactService,
  ) {}

  @Get("overview")
  async getOverview() {
    return this.growthContext.build();
  }

  @Post("sync")
  async triggerSync() {
    return this.growthSync.run();
  }

  @Get("sync/status")
  async getSyncStatus() {
    return this.growthSync.getLatestRun();
  }

  @Get("abandoned")
  async getAbandoned(@Query("highValue") highValue?: string) {
    if (highValue === "true") {
      return this.abandonedCheckouts.getHighValue();
    }
    return this.abandonedCheckouts.getActive();
  }

  @Get("abandoned/summary")
  async getAbandonedSummary() {
    return this.abandonedCheckouts.getSummary();
  }

  @Post("abandoned/ingest")
  async ingestAbandoned() {
    return this.abandonedCheckouts.ingestFromShopify();
  }

  @Get("segments")
  async getSegments() {
    return this.segments.getSegmentSummary();
  }

  @Post("segments/refresh")
  async refreshSegments() {
    return this.segments.refreshAll();
  }

  @Get("segments/:type/members")
  async getSegmentMembers(@Param("type") type: string) {
    return this.segments.getMembersForSegment(type);
  }

  @Get("campaigns")
  async getCampaigns() {
    return this.campaigns.list();
  }

  @Get("campaigns/summary")
  async getCampaignSummary() {
    return this.campaigns.getSummary();
  }

  @Get("campaigns/:id")
  async getCampaign(@Param("id") id: string) {
    return this.campaigns.getById(id);
  }

  @Post("campaigns")
  async createCampaign(
    @Body()
    body: {
      type: string;
      name: string;
      objective?: string;
      segmentId?: string;
      subject?: string;
    },
  ) {
    return this.campaigns.create(body);
  }

  @Post("campaigns/:id/approve")
  async approveCampaign(
    @Param("id") id: string,
    @Body() body: { resolvedBy?: string },
  ) {
    return this.campaigns.approve(id, body.resolvedBy ?? "admin_ui");
  }

  @Get("cross-sell")
  async getCrossSell() {
    return this.upsell.listAll();
  }

  @Get("replenishment")
  async getReplenishment() {
    return this.replenishment.getCandidates();
  }

  @Get("contacts/count")
  async getContactCount() {
    return { count: await this.contacts.count() };
  }
}
