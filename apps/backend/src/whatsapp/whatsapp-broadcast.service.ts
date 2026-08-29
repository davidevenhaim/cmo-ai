import { Injectable, Logger } from "@nestjs/common";
import type { BroadcastAudience } from "@ai-cmo/contracts";
import { CreateBroadcastSchema } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { FrequencyCapService } from "../growth/frequency-cap.service";
import { phoneToChatId, WahaClient } from "./waha.client";
import { WhatsAppInboxService } from "./whatsapp-inbox.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppTemplateService } from "./whatsapp-template.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

const FLOW_TYPE = "BROADCAST";

export class BroadcastError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "BroadcastError";
  }
}

interface EligibilityVerdict {
  eligible: boolean;
  bucket: keyof Omit<BroadcastAudience, "total" | "eligible" | "expectedSends">;
  reason?: string;
}

/**
 * B3 — WhatsApp broadcasts.
 *
 * Reuses the existing Contact / Segment / ContactSuppression / FrequencyCap
 * machinery rather than introducing a second segmentation engine.
 *
 * Flow is strictly DRY RUN → OWNER CONFIRMATION → LIVE, and eligibility is
 * re-evaluated per recipient at send time: consent can change between approval
 * and send, and the approved snapshot must never be trusted for that.
 */
@Injectable()
export class WhatsAppBroadcastService {
  private readonly logger = new Logger(WhatsAppBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly session: WhatsAppSessionService,
    private readonly templates: WhatsAppTemplateService,
    private readonly frequencyCaps: FrequencyCapService,
    private readonly inbox: WhatsAppInboxService,
  ) {}

  async create(input: unknown, brandId = DEFAULT_BRAND_ID) {
    const parsed = CreateBroadcastSchema.safeParse(input);
    if (!parsed.success) {
      throw new BroadcastError("Invalid broadcast", "VALIDATION");
    }
    if (!parsed.data.templateId && !parsed.data.body) {
      throw new BroadcastError(
        "Either templateId or body is required",
        "VALIDATION",
      );
    }

    return this.prisma.whatsAppBroadcast.create({
      data: {
        brandId,
        name: parsed.data.name,
        segmentId: parsed.data.segmentId ?? null,
        templateId: parsed.data.templateId ?? null,
        renderedBody: parsed.data.body ?? null,
        scheduledAt: parsed.data.scheduledAt ?? null,
        status: "DRAFT",
      },
    });
  }

  async list(brandId = DEFAULT_BRAND_ID) {
    return this.prisma.whatsAppBroadcast.findMany({
      where: { brandId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { template: { select: { id: true, name: true, key: true } } },
    });
  }

  async get(id: string, brandId = DEFAULT_BRAND_ID) {
    return this.prisma.whatsAppBroadcast.findFirst({
      where: { id, brandId },
      include: {
        template: true,
        recipients: { take: 200, orderBy: { status: "asc" } },
      },
    });
  }

  /**
   * Computes the audience breakdown and freezes the message body.
   *
   * Freezing matters: editing the template after approval must not change what
   * actually goes out.
   */
  async dryRun(id: string, brandId = DEFAULT_BRAND_ID) {
    const broadcast = await this.prisma.whatsAppBroadcast.findFirst({
      where: { id, brandId },
      include: { template: true },
    });
    if (!broadcast) throw new BroadcastError("Broadcast not found", "NOT_FOUND");
    if (broadcast.status === "SENDING" || broadcast.status === "SENT") {
      throw new BroadcastError(
        `Cannot dry-run a broadcast in status ${broadcast.status}`,
        "INVALID_STATE",
      );
    }

    const body = broadcast.template?.body ?? broadcast.renderedBody;
    if (!body) {
      throw new BroadcastError("Broadcast has no message body", "NO_BODY");
    }

    const contacts = await this.resolveAudience(
      broadcast.segmentId,
      brandId,
    );

    const audience: BroadcastAudience = {
      total: contacts.length,
      eligible: 0,
      noConsent: 0,
      frequencyCapped: 0,
      invalidPhone: 0,
      suppressed: 0,
      expectedSends: 0,
    };

    const eligibleIds: string[] = [];
    const skipped: Array<{ contactId: string; reason: string }> = [];

    for (const contact of contacts) {
      const verdict = await this.evaluate(contact, body);
      if (verdict.eligible) {
        audience.eligible++;
        eligibleIds.push(contact.id);
      } else {
        audience[verdict.bucket]++;
        skipped.push({ contactId: contact.id, reason: verdict.reason ?? verdict.bucket });
      }
    }
    audience.expectedSends = audience.eligible;

    // Recipient rows are the send worklist. Rebuild them on each dry run so a
    // re-run after a segment change does not leave stale rows behind.
    await this.prisma.whatsAppBroadcastRecipient.deleteMany({
      where: { broadcastId: id },
    });
    if (contacts.length > 0) {
      await this.prisma.whatsAppBroadcastRecipient.createMany({
        data: [
          ...eligibleIds.map((contactId) => ({
            broadcastId: id,
            contactId,
            status: "PENDING",
          })),
          ...skipped.map((s) => ({
            broadcastId: id,
            contactId: s.contactId,
            status: "SUPPRESSED",
            skipReason: s.reason,
          })),
        ],
        skipDuplicates: true,
      });
    }

    const updated = await this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: {
        status: "AWAITING_CONFIRMATION",
        dryRunResult: audience as any,
        dryRunAt: new Date(),
        renderedBody: body,
        suppressedCount: audience.total - audience.eligible,
      },
    });

    return { broadcast: updated, audience };
  }

  /**
   * Owner confirmation. Explicitly separate from send so the UI can require a
   * human decision between the two.
   */
  async confirm(id: string, actor: string, brandId = DEFAULT_BRAND_ID) {
    const broadcast = await this.prisma.whatsAppBroadcast.findFirst({
      where: { id, brandId },
    });
    if (!broadcast) throw new BroadcastError("Broadcast not found", "NOT_FOUND");
    if (broadcast.status !== "AWAITING_CONFIRMATION") {
      throw new BroadcastError(
        "A dry run must be completed before confirmation",
        "DRY_RUN_REQUIRED",
      );
    }
    return this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: { confirmedAt: new Date(), confirmedBy: actor },
    });
  }

  /**
   * Executes a confirmed broadcast.
   *
   * The DRAFT → SENDING transition is an atomic conditional update, so two
   * concurrent workers cannot both execute the same broadcast (invariants
   * 11/12).
   */
  async send(id: string, brandId = DEFAULT_BRAND_ID) {
    const broadcast = await this.prisma.whatsAppBroadcast.findFirst({
      where: { id, brandId },
    });
    if (!broadcast) throw new BroadcastError("Broadcast not found", "NOT_FOUND");
    if (!broadcast.confirmedAt) {
      throw new BroadcastError(
        "Broadcast requires owner confirmation before sending",
        "CONFIRMATION_REQUIRED",
      );
    }
    if (!(await this.session.canSend(brandId))) {
      throw new BroadcastError(
        "WhatsApp session is not connected",
        "NOT_CONNECTED",
      );
    }

    const claim = await this.prisma.whatsAppBroadcast.updateMany({
      where: { id, status: "AWAITING_CONFIRMATION" },
      data: { status: "SENDING", startedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BroadcastError(
        "Broadcast already claimed by another execution",
        "ALREADY_RUNNING",
      );
    }

    const body = broadcast.renderedBody;
    if (!body) {
      await this.prisma.whatsAppBroadcast.update({
        where: { id },
        data: { status: "FAILED", completedAt: new Date() },
      });
      throw new BroadcastError("Broadcast has no frozen body", "NO_BODY");
    }

    const recipients = await this.prisma.whatsAppBroadcastRecipient.findMany({
      where: { broadcastId: id, status: "PENDING" },
    });

    let sent = 0;
    let failed = 0;
    let suppressed = 0;

    for (const recipient of recipients) {
      const contact = await this.prisma.contact.findUnique({
        where: { id: recipient.contactId },
      });
      if (!contact) {
        await this.markRecipient(recipient.id, "SUPPRESSED", "CONTACT_MISSING");
        suppressed++;
        continue;
      }

      // Re-check immediately before sending — consent, suppression and caps
      // may all have changed since the dry run was approved.
      const verdict = await this.evaluate(contact, body);
      if (!verdict.eligible) {
        await this.markRecipient(
          recipient.id,
          "SUPPRESSED",
          verdict.reason ?? verdict.bucket,
        );
        suppressed++;
        continue;
      }

      const rendered = this.templates.render(body, {
        first_name: contact.firstName,
        currency: contact.currencyCode,
      });
      if (!rendered.ok || !rendered.body) {
        await this.markRecipient(
          recipient.id,
          "SUPPRESSED",
          `TEMPLATE_INCOMPLETE:${(rendered.missing ?? []).join(",")}`,
        );
        suppressed++;
        continue;
      }

      const chatId = phoneToChatId(contact.phone ?? "");
      if (!chatId) {
        await this.markRecipient(recipient.id, "SUPPRESSED", "INVALID_PHONE");
        suppressed++;
        continue;
      }

      // Claim this recipient before the network call so a crash mid-send
      // cannot produce a second attempt.
      const recipientClaim =
        await this.prisma.whatsAppBroadcastRecipient.updateMany({
          where: { id: recipient.id, status: "PENDING" },
          data: { status: "SENDING" as any },
        });
      if (recipientClaim.count === 0) continue;

      const res = await this.waha.sendText(chatId, rendered.body);

      if (res.ok && res.data) {
        await this.prisma.whatsAppBroadcastRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            providerMessageId: res.data.providerMessageId,
            sentAt: new Date(),
          },
        });
        await this.recordTouch(contact.id, id);
        await this.inbox.recordOutboundAutomation({
          brandId,
          phone: contact.phone!,
          chatId,
          body: rendered.body,
          providerMessageId: res.data.providerMessageId,
          origin: "BROADCAST",
          metadata: { broadcastId: id },
        });
        sent++;
      } else {
        await this.markRecipient(
          recipient.id,
          "FAILED",
          res.outcome === "UNKNOWN"
            ? "SEND_UNKNOWN"
            : (res.error ?? "SEND_FAILED"),
        );
        // An UNKNOWN outcome still counts as a touch: the message may have
        // been delivered, so it must consume frequency-cap budget.
        if (res.outcome === "UNKNOWN") await this.recordTouch(contact.id, id);
        failed++;
      }
    }

    const updated = await this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: {
        status: "SENT",
        completedAt: new Date(),
        sentCount: sent,
        failedCount: failed,
        suppressedCount: { increment: suppressed },
      },
    });

    return { broadcast: updated, sent, failed, suppressed };
  }

  async cancel(id: string, brandId = DEFAULT_BRAND_ID) {
    const broadcast = await this.prisma.whatsAppBroadcast.findFirst({
      where: { id, brandId },
    });
    if (!broadcast) throw new BroadcastError("Broadcast not found", "NOT_FOUND");
    if (broadcast.status === "SENT" || broadcast.status === "SENDING") {
      throw new BroadcastError(
        `Cannot cancel a broadcast in status ${broadcast.status}`,
        "INVALID_STATE",
      );
    }
    return this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  }

  /**
   * Consent, suppression, phone validity and frequency caps, in that order.
   *
   * Unknown consent fails closed (invariant 6): only an explicit SUBSCRIBED
   * status may receive marketing.
   */
  private async evaluate(
    contact: {
      id: string;
      phone: string | null;
      smsMarketingStatus: string;
      firstName: string | null;
      currencyCode: string;
    },
    body: string,
  ): Promise<EligibilityVerdict> {
    if (contact.smsMarketingStatus !== "SUBSCRIBED") {
      return {
        eligible: false,
        bucket: "noConsent",
        reason:
          contact.smsMarketingStatus === "UNSUBSCRIBED" ||
          contact.smsMarketingStatus === "REDACTED"
            ? "UNSUBSCRIBED"
            : "NO_CONSENT",
      };
    }

    if (!contact.phone || !phoneToChatId(contact.phone)) {
      return { eligible: false, bucket: "invalidPhone", reason: "INVALID_PHONE" };
    }

    const suppression = await this.prisma.contactSuppression.findFirst({
      where: {
        contactId: contact.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (suppression) {
      return {
        eligible: false,
        bucket: "suppressed",
        reason: suppression.reason,
      };
    }

    const withinCaps = await this.frequencyCaps.isEligible(
      contact.id,
      FLOW_TYPE,
    );
    if (!withinCaps) {
      return {
        eligible: false,
        bucket: "frequencyCapped",
        reason: "FREQUENCY_CAP",
      };
    }

    // A template we cannot fully render for this contact is a suppression, not
    // a partial send.
    const rendered = this.templates.render(body, {
      first_name: contact.firstName,
      currency: contact.currencyCode,
    });
    if (!rendered.ok) {
      return {
        eligible: false,
        bucket: "suppressed",
        reason: `TEMPLATE_INCOMPLETE:${(rendered.missing ?? []).join(",")}`,
      };
    }

    return { eligible: true, bucket: "suppressed" };
  }

  /** Resolves a segment to contacts, or the whole subscriber base when unset. */
  private async resolveAudience(segmentId: string | null, brandId: string) {
    const select = {
      id: true,
      phone: true,
      smsMarketingStatus: true,
      firstName: true,
      currencyCode: true,
    };

    if (!segmentId) {
      return this.prisma.contact.findMany({
        where: { brandId, phone: { not: null } },
        select,
        take: 5000,
      });
    }

    const segment = await this.prisma.segment.findFirst({
      where: { id: segmentId, brandId },
    });
    if (!segment) {
      throw new BroadcastError("Segment not found", "SEGMENT_NOT_FOUND");
    }

    // Segment membership rules live in the growth domain; mirror the same
    // deterministic definitions rather than inventing new ones here.
    const where = this.segmentWhere(segment.type, brandId);
    return this.prisma.contact.findMany({ where, select, take: 5000 });
  }

  private segmentWhere(type: string, brandId: string): any {
    const base: any = { brandId, phone: { not: null } };
    switch (type) {
      case "VIP":
        return { ...base, orderCount: { gte: 3 } };
      case "REPEAT_CUSTOMER":
        return { ...base, orderCount: { gte: 2 } };
      case "FIRST_TIME_CUSTOMER":
        return { ...base, orderCount: 1 };
      case "PROSPECT":
        return { ...base, orderCount: 0 };
      case "LAPSED_CUSTOMER":
        return {
          ...base,
          lastOrderAt: {
            lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          },
        };
      case "RECENT_CUSTOMER":
        return {
          ...base,
          lastOrderAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        };
      default:
        return base;
    }
  }

  private async markRecipient(id: string, status: string, reason: string) {
    await this.prisma.whatsAppBroadcastRecipient.update({
      where: { id },
      data: { status, skipReason: reason.slice(0, 200) },
    });
  }

  private async recordTouch(contactId: string, broadcastId: string) {
    await this.prisma.campaignTouch.create({
      data: {
        contactId,
        touchType: "SEND",
        metadata: {
          source: "WHATSAPP_BROADCAST",
          broadcastId,
          channel: "WHATSAPP",
        },
      },
    });
  }
}
