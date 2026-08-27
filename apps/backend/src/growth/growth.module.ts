import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaService } from "../prisma.service";
import { ShopifyModule } from "../shopify/shopify.module";
import { ApprovalModule } from "../approval/approval.module";
import { GrowthController } from "./growth.controller";
import { ContactService } from "./contact.service";
import { SegmentService } from "./segment.service";
import { AbandonedCheckoutService } from "./abandoned-checkout.service";
import { FrequencyCapService } from "./frequency-cap.service";
import { ReplenishmentService } from "./replenishment.service";
import { UpsellService } from "./upsell.service";
import { CampaignService } from "./campaign.service";
import { EmailProviderService } from "./email-provider.service";
import { CampaignExecutionService } from "./campaign-execution.service";
import { MockEmailProvider } from "./email/mock-email.provider";
import { ListmonkEmailProvider } from "./email/listmonk-email.provider";
import { GrowthContextService } from "./growth-context.service";
import { GrowthSyncService } from "./growth-sync.service";

@Module({
  imports: [HttpModule, ShopifyModule, ApprovalModule],
  controllers: [GrowthController],
  providers: [
    PrismaService,
    ContactService,
    SegmentService,
    AbandonedCheckoutService,
    FrequencyCapService,
    ReplenishmentService,
    UpsellService,
    CampaignService,
    EmailProviderService,
    MockEmailProvider,
    ListmonkEmailProvider,
    CampaignExecutionService,
    GrowthContextService,
    GrowthSyncService,
  ],
  exports: [
    ContactService,
    SegmentService,
    AbandonedCheckoutService,
    FrequencyCapService,
    ReplenishmentService,
    UpsellService,
    CampaignService,
    EmailProviderService,
    MockEmailProvider,
    ListmonkEmailProvider,
    CampaignExecutionService,
    GrowthContextService,
    GrowthSyncService,
  ],
})
export class GrowthModule implements OnModuleInit {
  private readonly logger = new Logger(GrowthModule.name);

  constructor(
    private readonly execution: CampaignExecutionService,
    private readonly listmonk: ListmonkEmailProvider,
    private readonly mock: MockEmailProvider,
  ) {}

  onModuleInit() {
    if (this.listmonk.configured) {
      this.execution.registerProvider(this.listmonk);
      this.logger.log("Email execution provider: listmonk");
    } else {
      this.execution.registerProvider(this.mock);
      this.logger.log(
        "Email execution provider: mock (listmonk not configured)",
      );
    }
  }
}
