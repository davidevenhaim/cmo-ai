import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "../prisma.service";

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface SendOptions {
  replyMarkup?: { inline_keyboard: InlineButton[][] };
  approvalId?: string;
  parseMode?: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly apiBase: string;
  private readonly token: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.token = this.config.get<string>("TELEGRAM_BOT_TOKEN", "");
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  get configured(): boolean {
    return !!this.token;
  }

  getAllowedChatIds(): string[] {
    return this.config
      .get<string>("TELEGRAM_ALLOWED_CHAT_IDS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  isChatAllowed(chatId: string): boolean {
    const allowed = this.getAllowedChatIds();
    return allowed.length === 0 || allowed.includes(chatId);
  }

  async sendMessage(
    chatId: string,
    text: string,
    options: SendOptions = {},
  ): Promise<void> {
    const record = await this.prisma.telegramMessage.create({
      data: {
        chatId,
        direction: "outbound",
        text,
        approvalId: options.approvalId ?? null,
        delivered: false,
      },
    });

    if (!this.configured) {
      this.logger.warn(
        `TELEGRAM_BOT_TOKEN not set — message not delivered (chatId: ${chatId})`,
      );
      await this.prisma.telegramMessage.update({
        where: { id: record.id },
        data: { failureReason: "Bot not configured" },
      });
      return;
    }

    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        parse_mode: options.parseMode ?? "HTML",
      };
      if (options.replyMarkup) body.reply_markup = options.replyMarkup;

      const res = await firstValueFrom(
        this.http.post(`${this.apiBase}/sendMessage`, body, { timeout: 10000 }),
      );

      await this.prisma.telegramMessage.update({
        where: { id: record.id },
        data: {
          delivered: true,
          deliveredAt: new Date(),
          telegramMsgId: res.data?.result?.message_id ?? null,
        },
      });
    } catch (err: any) {
      const reason = err.response?.data?.description ?? err.message;
      this.logger.error(`Telegram send failed (chatId: ${chatId}): ${reason}`);
      await this.prisma.telegramMessage.update({
        where: { id: record.id },
        data: { failureReason: reason },
      });
      throw err;
    }
  }

  async retrySend(messageId: string): Promise<void> {
    const msg = await this.prisma.telegramMessage.findUniqueOrThrow({
      where: { id: messageId },
    });
    if (msg.delivered) return;
    await this.sendMessage(msg.chatId, msg.text, {
      approvalId: msg.approvalId ?? undefined,
    });
  }

  async persistInbound(chatId: string, text: string): Promise<void> {
    await this.prisma.telegramMessage.create({
      data: {
        chatId,
        direction: "inbound",
        text,
        delivered: true,
        deliveredAt: new Date(),
      },
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    if (!this.configured) return;
    try {
      await firstValueFrom(
        this.http.post(
          `${this.apiBase}/answerCallbackQuery`,
          { callback_query_id: callbackQueryId, text },
          { timeout: 10000 },
        ),
      );
    } catch {
      // non-critical
    }
  }

  async setupWebhook(url: string): Promise<void> {
    const secret = this.config.get<string>("TELEGRAM_WEBHOOK_SECRET", "");
    await firstValueFrom(
      this.http.post(
        `${this.apiBase}/setWebhook`,
        {
          url,
          secret_token: secret || undefined,
          allowed_updates: ["message", "callback_query"],
        },
        { timeout: 10000 },
      ),
    );
  }

  async getWebhookInfo(): Promise<unknown> {
    if (!this.configured) return { configured: false };
    const res = await firstValueFrom(
      this.http.get(`${this.apiBase}/getWebhookInfo`, { timeout: 10000 }),
    );
    return res.data?.result;
  }

  async getLastDeliveredAt(): Promise<Date | null> {
    const msg = await this.prisma.telegramMessage.findFirst({
      where: { direction: "outbound", delivered: true },
      orderBy: { deliveredAt: "desc" },
    });
    return msg?.deliveredAt ?? null;
  }
}
