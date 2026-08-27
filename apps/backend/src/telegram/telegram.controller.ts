import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { TelegramService } from "./telegram.service";
import { TelegramCommandService } from "./telegram-command.service";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    message?: { chat: { id: number } };
    data?: string;
  };
}

@Controller("telegram")
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
    private readonly commandService: TelegramCommandService,
  ) {}

  @Post("webhook")
  async handleWebhook(
    @Body() update: TelegramUpdate,
    @Headers("x-telegram-bot-api-secret-token") secret: string,
  ): Promise<{ ok: boolean }> {
    const expectedSecret = this.config.get<string>(
      "TELEGRAM_WEBHOOK_SECRET",
      "",
    );
    if (expectedSecret && secret !== expectedSecret) {
      throw new UnauthorizedException("Invalid webhook secret");
    }

    if (!(await this.markProcessed(update.update_id))) {
      return { ok: true }; // duplicate — silently ack
    }

    await this.processUpdate(update);
    return { ok: true };
  }

  @Post("dev/simulate")
  async simulateUpdate(
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: boolean }> {
    if (this.config.get<string>("NODE_ENV") !== "development") {
      throw new ForbiddenException(
        "dev/simulate is only available in development",
      );
    }
    await this.processUpdate(update, true);
    return { ok: true };
  }

  @Post("webhook/setup")
  async setupWebhook(@Body() body: { url: string }): Promise<{ ok: boolean }> {
    if (this.config.get<string>("NODE_ENV") !== "development") {
      throw new ForbiddenException(
        "webhook/setup is only available in development — configure via CLI in production",
      );
    }
    await this.telegramService.setupWebhook(body.url);
    return { ok: true };
  }

  @Get("webhook/status")
  async webhookStatus() {
    return this.telegramService.getWebhookInfo();
  }

  @Get("status")
  async status() {
    const lastDeliveredAt = await this.telegramService.getLastDeliveredAt();
    return {
      configured: this.telegramService.configured,
      allowedChatIds: this.telegramService.getAllowedChatIds(),
      lastDeliveredAt,
    };
  }

  @Post("messages/:id/retry")
  async retryMessage(@Param("id") id: string): Promise<{ ok: boolean }> {
    await this.telegramService.retrySend(id);
    return { ok: true };
  }

  // Returns true if this update_id is new and should be processed.
  private async markProcessed(updateId: number): Promise<boolean> {
    try {
      await this.prisma.processedTelegramUpdate.create({
        data: { updateId },
      });
      return true;
    } catch {
      // Unique constraint violation — already processed
      return false;
    }
  }

  private async processUpdate(
    update: TelegramUpdate,
    skipAccessCheck = false,
  ): Promise<void> {
    if (update.message) {
      const { message } = update;
      const chatId = message.chat.id.toString();
      const text = message.text ?? "";

      if (!skipAccessCheck && !this.telegramService.isChatAllowed(chatId)) {
        this.logger.warn(`Blocked update from unauthorized chatId: ${chatId}`);
        return;
      }

      await this.telegramService.persistInbound(chatId, text);

      if (text.startsWith("/today")) {
        await this.commandService.handleToday(chatId);
      } else if (text.startsWith("/weekly")) {
        await this.commandService.handleWeekly(chatId);
      } else if (text.startsWith("/status")) {
        await this.commandService.handleStatus(chatId);
      } else if (text.startsWith("/runs")) {
        await this.commandService.handleRuns(chatId);
      } else if (text.startsWith("/shopify")) {
        await this.commandService.handleShopify(chatId);
      } else if (text.startsWith("/sales")) {
        await this.commandService.handleSales(chatId);
      } else if (text.startsWith("/research")) {
        await this.commandService.handleResearch(chatId);
      } else if (text.startsWith("/opportunities")) {
        await this.commandService.handleOpportunities(chatId);
      } else if (text.startsWith("/content")) {
        await this.commandService.handleContent(chatId);
      } else if (text.startsWith("/drafts")) {
        await this.commandService.handleDrafts(chatId);
      } else if (text.startsWith("/growth")) {
        await this.commandService.handleGrowth(chatId);
      } else if (text.startsWith("/abandoned")) {
        await this.commandService.handleAbandoned(chatId);
      } else if (text.startsWith("/segments")) {
        await this.commandService.handleSegments(chatId);
      } else if (text.startsWith("/campaigns")) {
        await this.commandService.handleCampaigns(chatId);
      } else if (text.startsWith("/wordpress")) {
        await this.commandService.handleWordPress(chatId, text);
      } else if (text.startsWith("/published")) {
        await this.commandService.handlePublished(chatId);
      } else if (text.startsWith("/scheduled")) {
        await this.commandService.handleScheduled(chatId);
      } else if (text.startsWith("/publish")) {
        await this.commandService.handlePublish(chatId, text);
      } else if (text.startsWith("/market")) {
        await this.commandService.handleMarket(chatId);
      } else if (text.startsWith("/seo")) {
        await this.commandService.handleSeo(chatId);
      } else if (text.startsWith("/keywords")) {
        await this.commandService.handleKeywords(chatId);
      } else if (text.startsWith("/revenue")) {
        await this.commandService.handleRevenue(chatId);
      } else if (text.startsWith("/")) {
        await this.telegramService.sendMessage(
          chatId,
          "Unknown command. Available: /today /weekly /status /runs /shopify /sales /research /opportunities /content /drafts /growth /abandoned /segments /campaigns /wordpress /publish /scheduled /published /market /seo /keywords /revenue",
        );
      } else if (text.trim()) {
        await this.commandService.handleNaturalLanguage(chatId, text);
      }
    } else if (update.callback_query) {
      const { callback_query } = update;
      const chatId = callback_query.message?.chat?.id?.toString() ?? "";
      const data = callback_query.data ?? "";

      if (
        !skipAccessCheck &&
        chatId &&
        !this.telegramService.isChatAllowed(chatId)
      ) {
        return;
      }

      // Validate callback format before routing
      const parts = data.split(":");
      const isApprovalCallback =
        parts[0] === "approval" &&
        parts.length === 3 &&
        ["APPROVED", "REJECTED"].includes(parts[2]);
      const isDraftCallback =
        parts[0] === "draft" && parts.length === 3 && parts[2] === "REGENERATE";

      if (isApprovalCallback || isDraftCallback) {
        await this.commandService.handleCallbackQuery(
          callback_query.id,
          chatId,
          data,
        );
      } else {
        await this.telegramService.answerCallbackQuery(
          callback_query.id,
          "Unknown action",
        );
      }
    }
  }
}
