import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

export interface SendEmailDto {
  campaignId?: string;
  contactId?: string;
  to: string;
  subject: string;
  previewText?: string;
  body: string;
  callToAction?: string;
}

@Injectable()
export class EmailProviderService {
  private readonly logger = new Logger(EmailProviderService.name);

  constructor(private readonly prisma: PrismaService) {}

  // MockEmailProvider — records every message in EmailMessage table.
  // Does NOT send real SMTP. Marks SENT immediately after creation.
  async send(dto: SendEmailDto): Promise<string> {
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
    return message.id;
  }

  async getMessages(filters?: {
    campaignId?: string;
    deliveryStatus?: string;
  }) {
    return this.prisma.emailMessage.findMany({
      where: {
        ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters?.deliveryStatus
          ? { deliveryStatus: filters.deliveryStatus }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
