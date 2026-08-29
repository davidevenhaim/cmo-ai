import { Module, OnModuleInit } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaService } from "../prisma.service";
import { FrequencyCapService } from "../growth/frequency-cap.service";
import { SettingsModule } from "../settings/settings.module";
import { WahaClient } from "./waha.client";
import { WahaWebhookController } from "./waha-webhook.controller";
import { WhatsAppAutomationService } from "./whatsapp-automation.service";
import { WhatsAppBroadcastService } from "./whatsapp-broadcast.service";
import { WhatsAppContextService } from "./whatsapp-context.service";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppInboxService } from "./whatsapp-inbox.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppTemplateService } from "./whatsapp-template.service";

@Module({
  imports: [HttpModule, SettingsModule],
  controllers: [WhatsAppController, WahaWebhookController],
  providers: [
    PrismaService,
    FrequencyCapService,
    WahaClient,
    WhatsAppSessionService,
    WhatsAppInboxService,
    WhatsAppTemplateService,
    WhatsAppBroadcastService,
    WhatsAppAutomationService,
    WhatsAppContextService,
  ],
  exports: [
    WhatsAppContextService,
    WhatsAppSessionService,
    WhatsAppTemplateService,
    WhatsAppAutomationService,
    WhatsAppInboxService,
  ],
})
export class WhatsAppModule implements OnModuleInit {
  constructor(
    private readonly templates: WhatsAppTemplateService,
    private readonly automations: WhatsAppAutomationService,
  ) {}

  /**
   * Seeds the default template library and one automation row per flow.
   * Both are idempotent, and automations are seeded DISABLED (Part D).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.templates.ensureDefaults();
      await this.automations.ensureDefaults();
    } catch {
      // Startup must not depend on the database being migrated yet.
    }
  }
}
