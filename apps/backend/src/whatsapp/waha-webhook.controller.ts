import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { chatIdToPhone } from "./waha.client";

const DEFAULT_BRAND_ID = "luminesce-brand-001";

/**
 * WAHA event receiver.
 *
 * Two invariants live here:
 *  - 12: WAHA retries deliveries, so every event id is recorded in
 *    ProcessedWahaEvent and a repeat is a no-op.
 *  - 13: inbound messages are stored with origin INBOUND; nothing this
 *    controller writes can be mistaken for an owner or automated send.
 */
@Controller("webhooks/waha")
export class WahaWebhookController {
  private readonly logger = new Logger(WahaWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async receive(
    @Body() payload: any,
    @Headers("x-webhook-secret") secret?: string,
  ) {
    const expected = (
      this.config.get<string>("WAHA_WEBHOOK_SECRET") ?? ""
    ).trim();
    // Only enforced when a secret is configured, so a self-hosted setup on a
    // private network is not forced to configure one.
    if (expected && secret !== expected) {
      throw new UnauthorizedException("Invalid webhook secret");
    }

    const eventId = this.eventId(payload);
    if (!eventId) return { status: "ignored", reason: "no event id" };

    // Dedup guard — the unique id makes a retried delivery a no-op even if two
    // arrive concurrently.
    try {
      await this.prisma.processedWahaEvent.create({
        data: { id: eventId, eventType: String(payload?.event ?? "unknown") },
      });
    } catch {
      return { status: "duplicate", eventId };
    }

    const event = String(payload?.event ?? "");
    if (event === "message" || event === "message.any") {
      await this.handleMessage(payload);
    } else if (event === "message.ack") {
      await this.handleAck(payload);
    } else if (event === "session.status") {
      await this.handleSessionStatus(payload);
    }

    return { status: "ok", eventId };
  }

  private eventId(payload: any): string | null {
    const raw =
      payload?.id ??
      payload?.payload?.id?._serialized ??
      payload?.payload?.id ??
      null;
    return raw ? String(raw).slice(0, 200) : null;
  }

  private async handleMessage(payload: any) {
    const data = payload?.payload ?? {};
    const chatId = String(data?.from ?? data?.chatId ?? "");
    if (!chatId) return;

    // fromMe means the owner sent it from their own phone, not through us.
    const fromMe = !!data.fromMe;
    const providerMessageId = String(
      data?.id?._serialized ?? data?.id ?? `waha-${Date.now()}`,
    );
    const body = String(data?.body ?? "").slice(0, 4096);
    const timestamp =
      typeof data?.timestamp === "number"
        ? new Date(data.timestamp * 1000)
        : new Date();

    const phone = chatIdToPhone(chatId);
    const conversation = await this.prisma.whatsAppConversation.upsert({
      where: { brandId_chatId: { brandId: DEFAULT_BRAND_ID, chatId } },
      create: {
        brandId: DEFAULT_BRAND_ID,
        chatId,
        phone,
        displayName: data?.notifyName
          ? String(data.notifyName).slice(0, 160)
          : null,
        lastMessageAt: timestamp,
        lastMessagePreview: body.slice(0, 200),
        unreadCount: fromMe ? 0 : 1,
      },
      update: {
        lastMessageAt: timestamp,
        lastMessagePreview: body.slice(0, 200),
        ...(fromMe ? {} : { unreadCount: { increment: 1 } }),
      },
    });

    await this.prisma.whatsAppMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          providerMessageId,
          direction: fromMe ? "OUTBOUND" : "INBOUND",
          origin: fromMe ? "OWNER_MANUAL" : "INBOUND",
          body,
          deliveryState: fromMe ? "SENT" : "DELIVERED",
          timestamp,
          metadata: { via: "webhook" },
        },
      ],
      // Belt and braces: the message may already exist from a sync.
      skipDuplicates: true,
    });
  }

  private async handleAck(payload: any) {
    const data = payload?.payload ?? {};
    const id = data?.id?._serialized ?? data?.id;
    if (!id) return;
    const ack = typeof data?.ack === "number" ? data.ack : null;
    const state =
      ack === -1
        ? "FAILED"
        : ack === 1
          ? "SENT"
          : ack === 2
            ? "DELIVERED"
            : ack === 3 || ack === 4
              ? "READ"
              : null;
    if (!state) return;

    await this.prisma.whatsAppMessage.updateMany({
      where: { providerMessageId: String(id) },
      data: { deliveryState: state },
    });
  }

  private async handleSessionStatus(payload: any) {
    const status = String(payload?.payload?.status ?? "").toUpperCase();
    const mapped =
      status === "WORKING"
        ? "WORKING"
        : status === "SCAN_QR_CODE" || status === "SCAN_QR"
          ? "SCAN_QR"
          : status === "STARTING"
            ? "STARTING"
            : status === "FAILED"
              ? "FAILED"
              : "STOPPED";

    await this.prisma.whatsAppSession.updateMany({
      where: { brandId: DEFAULT_BRAND_ID },
      data: { status: mapped, lastSyncAt: new Date() },
    });
  }
}
