import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import {
  EmailProvider,
  EmailSendDto,
  EmailSendResult,
  NormalizedEmailEvent,
  ProviderStatus,
} from "./email-provider.interface";

// MockEmailProvider — records messages in EmailMessage table, never sends real email.
// Default provider until a real transactional provider is configured.
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  private readonly logger = new Logger(MockEmailProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  async status(): Promise<ProviderStatus> {
    return {
      healthy: true,
      name: this.name,
      message: "Mock provider — no real sends",
    };
  }

  async send(dto: EmailSendDto): Promise<EmailSendResult> {
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

    await this.prisma.emailMessage.update({
      where: { id: message.id },
      data: { deliveryStatus: "SENT", sentAt: new Date() },
    });

    this.logger.log(`[MOCK] Email sent to ${dto.to} — messageId=${message.id}`);

    return {
      messageId: message.id,
      status: "SENT",
    };
  }

  async batchSend(dtos: EmailSendDto[]): Promise<EmailSendResult[]> {
    const results: EmailSendResult[] = [];
    for (const dto of dtos) {
      results.push(await this.send(dto));
    }
    return results;
  }

  getDeliveryStatus(_messageId: string): Promise<NormalizedEmailEvent | null> {
    return Promise.resolve(null);
  }

  normalizeWebhookEvent(_payload: unknown): NormalizedEmailEvent | null {
    return null;
  }
}
