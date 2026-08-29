import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  chatIdToPhone,
  WahaClient,
  type WahaMessage,
} from "./waha.client";
import { WhatsAppSessionService } from "./whatsapp-session.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

/** WAHA ack codes → our delivery vocabulary. */
function ackToDeliveryState(ack: number | null): string {
  switch (ack) {
    case -1:
      return "FAILED";
    case 0:
      return "PENDING";
    case 1:
      return "SENT";
    case 2:
      return "DELIVERED";
    case 3:
    case 4:
      return "READ";
    default:
      return "UNKNOWN";
  }
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONNECTED"
      | "INVALID_PHONE"
      | "SEND_FAILED"
      | "SEND_UNKNOWN",
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

/**
 * B2 — the owner-facing inbox.
 *
 * Only enough is persisted to make the inbox observable and to satisfy
 * invariant 13 (owner replies are distinguishable from automated sends). We do
 * not mirror WhatsApp's full history: message bodies are stored for the
 * conversations the owner opens, and nothing else is duplicated.
 */
@Injectable()
export class WhatsAppInboxService {
  private readonly logger = new Logger(WhatsAppInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly session: WhatsAppSessionService,
  ) {}

  /** Pulls the chat list from WAHA and reconciles it into local rows. */
  async syncConversations(brandId = DEFAULT_BRAND_ID): Promise<number> {
    if (!(await this.session.canSend(brandId))) return 0;

    const res = await this.waha.listChats(50);
    if (!res.ok || !res.data) {
      this.logger.warn(`Chat sync failed: ${res.error}`);
      return 0;
    }

    let synced = 0;
    for (const chat of res.data) {
      const phone = chatIdToPhone(chat.id);
      const contactId = phone ? await this.matchContact(phone, brandId) : null;

      await this.prisma.whatsAppConversation.upsert({
        where: { brandId_chatId: { brandId, chatId: chat.id } },
        create: {
          brandId,
          chatId: chat.id,
          displayName: chat.name,
          phone,
          contactId,
          lastMessageAt: chat.timestamp ? new Date(chat.timestamp * 1000) : null,
          lastMessagePreview: chat.lastMessage,
          unreadCount: chat.unreadCount,
        },
        update: {
          displayName: chat.name,
          phone,
          ...(contactId ? { contactId } : {}),
          lastMessageAt: chat.timestamp ? new Date(chat.timestamp * 1000) : null,
          lastMessagePreview: chat.lastMessage,
          unreadCount: chat.unreadCount,
        },
      });
      synced++;
    }
    return synced;
  }

  async listConversations(brandId = DEFAULT_BRAND_ID, take = 100) {
    return this.prisma.whatsAppConversation.findMany({
      where: { brandId, archived: false },
      orderBy: { lastMessageAt: "desc" },
      take: Math.min(take, 200),
    });
  }

  /**
   * Conversation detail. Refreshes from WAHA when connected, otherwise serves
   * what we already persisted so the inbox still renders while disconnected.
   */
  async getConversation(id: string, brandId = DEFAULT_BRAND_ID) {
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { id, brandId },
    });
    if (!conversation) return null;

    if (await this.session.canSend(brandId)) {
      const res = await this.waha.listMessages(conversation.chatId, 50);
      if (res.ok && res.data) {
        await this.persistMessages(conversation.id, res.data);
      } else {
        this.logger.warn(
          `Message fetch failed for ${conversation.id}: ${res.error}`,
        );
      }
    }

    const messages = await this.prisma.whatsAppMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { timestamp: "asc" },
      take: 200,
    });

    return { conversation, messages };
  }

  /**
   * Persists fetched messages.
   *
   * Origin inference matters: a message WAHA reports as fromMe that we have no
   * local record of was sent from the owner's phone, so it is OWNER_MANUAL.
   * Anything we sent ourselves already exists with its true origin, and the
   * `skipDuplicates` create leaves that record untouched.
   */
  private async persistMessages(
    conversationId: string,
    messages: WahaMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;

    const ids = messages.map((m) => m.id);
    const existing = await this.prisma.whatsAppMessage.findMany({
      where: { providerMessageId: { in: ids } },
      select: { providerMessageId: true },
    });
    const known = new Set(existing.map((e) => e.providerMessageId));

    const fresh = messages.filter((m) => !known.has(m.id));
    if (fresh.length > 0) {
      await this.prisma.whatsAppMessage.createMany({
        data: fresh.map((m) => ({
          conversationId,
          providerMessageId: m.id,
          direction: m.fromMe ? "OUTBOUND" : "INBOUND",
          origin: m.fromMe ? "OWNER_MANUAL" : "INBOUND",
          body: m.body,
          deliveryState: ackToDeliveryState(m.ack),
          timestamp: new Date(m.timestamp * 1000),
          metadata: { syncedFrom: "waha_history" },
        })),
        skipDuplicates: true,
      });
    }

    // Refresh delivery state on messages we already knew about.
    for (const m of messages.filter((x) => known.has(x.id))) {
      const state = ackToDeliveryState(m.ack);
      if (state === "UNKNOWN") continue;
      await this.prisma.whatsAppMessage.updateMany({
        where: { providerMessageId: m.id },
        data: { deliveryState: state },
      });
    }
  }

  /**
   * An explicit owner reply. Never called by the CMO or any automation —
   * origin is hard-coded OWNER_MANUAL so the audit trail cannot be blurred.
   */
  async sendManualReply(
    conversationId: string,
    body: string,
    brandId = DEFAULT_BRAND_ID,
  ) {
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, brandId },
    });
    if (!conversation) {
      throw new WhatsAppSendError("Conversation not found", "SEND_FAILED");
    }
    if (!(await this.session.canSend(brandId))) {
      throw new WhatsAppSendError(
        "WhatsApp session is not connected",
        "NOT_CONNECTED",
      );
    }

    const res = await this.waha.sendText(conversation.chatId, body);

    if (!res.ok) {
      // An ambiguous timeout is recorded, not retried — a blind retry is how
      // duplicate messages reach a customer (invariant 12).
      if (res.outcome === "UNKNOWN") {
        await this.prisma.whatsAppMessage.create({
          data: {
            conversationId,
            providerMessageId: `unknown-${Date.now()}-${conversationId}`,
            direction: "OUTBOUND",
            origin: "OWNER_MANUAL",
            body,
            deliveryState: "UNKNOWN",
            metadata: { note: "send outcome unknown; not retried" },
          },
        });
        throw new WhatsAppSendError(
          "Send outcome unknown — check WhatsApp before retrying",
          "SEND_UNKNOWN",
        );
      }
      throw new WhatsAppSendError(res.error ?? "send failed", "SEND_FAILED");
    }

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId,
        providerMessageId: res.data!.providerMessageId,
        direction: "OUTBOUND",
        origin: "OWNER_MANUAL",
        body,
        deliveryState: "SENT",
        metadata: { sentVia: "admin_inbox" },
      },
    });

    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: body.slice(0, 200),
        unreadCount: 0,
      },
    });

    return message;
  }

  /** Records an automated send so it shows in the inbox with its true origin. */
  async recordOutboundAutomation(opts: {
    brandId?: string;
    phone: string;
    chatId: string;
    body: string;
    providerMessageId: string;
    origin: "AUTOMATION" | "BROADCAST";
    metadata?: Record<string, unknown>;
  }) {
    const brandId = opts.brandId ?? DEFAULT_BRAND_ID;
    const contactId = await this.matchContact(opts.phone, brandId);

    const conversation = await this.prisma.whatsAppConversation.upsert({
      where: { brandId_chatId: { brandId, chatId: opts.chatId } },
      create: {
        brandId,
        chatId: opts.chatId,
        phone: opts.phone,
        contactId,
        lastMessageAt: new Date(),
        lastMessagePreview: opts.body.slice(0, 200),
      },
      update: {
        lastMessageAt: new Date(),
        lastMessagePreview: opts.body.slice(0, 200),
      },
    });

    await this.prisma.whatsAppMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          providerMessageId: opts.providerMessageId,
          direction: "OUTBOUND",
          origin: opts.origin,
          body: opts.body,
          deliveryState: "SENT",
          metadata: (opts.metadata ?? {}) as any,
        },
      ],
      skipDuplicates: true,
    });

    return conversation;
  }

  private async matchContact(
    phone: string,
    brandId: string,
  ): Promise<string | null> {
    const digits = phone.replace(/[^\d]/g, "");
    if (!digits) return null;
    // Contact.phone formatting varies by source, so match on the last 9 digits
    // — enough to identify a subscriber without over-matching.
    const suffix = digits.slice(-9);
    const contact = await this.prisma.contact.findFirst({
      where: { brandId, phone: { endsWith: suffix } },
      select: { id: true },
    });
    return contact?.id ?? null;
  }
}
