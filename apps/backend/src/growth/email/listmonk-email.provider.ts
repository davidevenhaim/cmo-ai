import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "../../prisma.service";
import {
  EmailProvider,
  EmailSendDto,
  EmailSendResult,
  NormalizedEmailEvent,
  ProviderStatus,
} from "./email-provider.interface";

/**
 * listmonk transactional send adapter.
 * AI-CMO remains authoritative for audience, consent, frequency caps, and approval.
 * listmonk only executes delivery after Nest gates pass.
 */
@Injectable()
export class ListmonkEmailProvider implements EmailProvider {
  readonly name = "listmonk";
  private readonly logger = new Logger(ListmonkEmailProvider.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  get configured(): boolean {
    return !!(
      this.baseUrl &&
      this.config.get<string>("LISTMONK_USERNAME", "").trim() &&
      this.config.get<string>("LISTMONK_PASSWORD", "").trim()
    );
  }

  private get baseUrl(): string {
    return (this.config.get<string>("LISTMONK_BASE_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  private authHeader(): string {
    const user = this.config.get<string>("LISTMONK_USERNAME", "").trim();
    const pass = this.config.get<string>("LISTMONK_PASSWORD", "").trim();
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  async status(): Promise<ProviderStatus> {
    if (!this.configured) {
      return {
        healthy: false,
        name: this.name,
        message: "NOT_CONFIGURED — set LISTMONK_BASE_URL + credentials",
      };
    }
    try {
      await firstValueFrom(
        this.http.get(`${this.baseUrl}/api/health`, {
          timeout: 4000,
          headers: { Authorization: this.authHeader() },
        }),
      );
      return { healthy: true, name: this.name, message: "CONNECTED" };
    } catch (err: any) {
      return {
        healthy: false,
        name: this.name,
        message: `UNAVAILABLE: ${err.message}`,
      };
    }
  }

  async send(dto: EmailSendDto): Promise<EmailSendResult> {
    if (!this.configured) {
      return {
        messageId: "",
        status: "FAILED",
        error: "listmonk not configured",
      };
    }

    const message = await this.prisma.emailMessage.create({
      data: {
        campaignId: dto.campaignId ?? null,
        contactId: dto.contactId ?? null,
        to: dto.to,
        subject: dto.subject,
        previewText: dto.previewText ?? null,
        body: dto.body,
        callToAction: dto.callToAction ?? null,
        deliveryStatus: "QUEUED",
      },
    });

    const fromEmail =
      this.config.get<string>("LISTMONK_FROM_EMAIL", "").trim() ||
      "noreply@localhost";
    const templateId = parseInt(
      this.config.get<string>("LISTMONK_TX_TEMPLATE_ID", "0"),
      10,
    );

    try {
      // Transactional API — https://listmonk.app/docs/apis/transactional/
      const payload: Record<string, unknown> = {
        subscriber_email: dto.to,
        from_email: fromEmail,
        data: {
          subject: dto.subject,
          body: dto.body,
          previewText: dto.previewText ?? "",
          callToAction: dto.callToAction ?? "",
        },
        content_type: "html",
      };
      if (templateId > 0) {
        payload.template_id = templateId;
      } else {
        // Inline body when no template configured
        payload.messenger = "email";
        payload.subject = dto.subject;
        payload.body = `<p>${escapeHtml(dto.body)}</p>`;
      }

      const response = await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/tx`, payload, {
          timeout: 15000,
          headers: {
            Authorization: this.authHeader(),
            "Content-Type": "application/json",
          },
        }),
      );

      const providerMessageId = String(
        response.data?.data?.id ?? response.data?.id ?? "",
      );

      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          deliveryStatus: "SENT",
          sentAt: new Date(),
          providerMessageId: providerMessageId || null,
        } as any,
      });

      this.logger.log(
        `listmonk sent to ${dto.to} messageId=${message.id} provider=${providerMessageId || "n/a"}`,
      );

      return {
        messageId: message.id,
        providerMessageId: providerMessageId || undefined,
        status: "SENT",
      };
    } catch (err: any) {
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { deliveryStatus: "FAILED" },
      });
      this.logger.warn(`listmonk send failed: ${err.message}`);
      return {
        messageId: message.id,
        status: "FAILED",
        error: err.message,
      };
    }
  }

  async batchSend(dtos: EmailSendDto[]): Promise<EmailSendResult[]> {
    const out: EmailSendResult[] = [];
    for (const dto of dtos) {
      out.push(await this.send(dto));
    }
    return out;
  }

  getDeliveryStatus(_messageId: string): Promise<NormalizedEmailEvent | null> {
    return Promise.resolve(null);
  }

  normalizeWebhookEvent(_payload: unknown): NormalizedEmailEvent | null {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
