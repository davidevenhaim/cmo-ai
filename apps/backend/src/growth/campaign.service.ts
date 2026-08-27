import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ApprovalService } from "../approval/approval.service";
import { ContactService } from "./contact.service";
import { SegmentService } from "./segment.service";
import { FrequencyCapService } from "./frequency-cap.service";
import { EmailProviderService } from "./email-provider.service";

const BRAND_ID = "luminesce-brand-001";

export interface CreateCampaignDto {
  type: string;
  name: string;
  objective?: string;
  segmentId?: string;
  contentBriefId?: string;
  subject?: string;
  previewText?: string;
  scheduledAt?: Date;
}

export interface QueueEmailsDto {
  subject: string;
  previewText?: string;
  body: string;
  callToAction?: string;
}

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly contacts: ContactService,
    private readonly segments: SegmentService,
    private readonly frequencyCaps: FrequencyCapService,
    private readonly emailProvider: EmailProviderService,
  ) {}

  async create(dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        brandId: BRAND_ID,
        type: dto.type,
        name: dto.name,
        objective: dto.objective ?? null,
        segmentId: dto.segmentId ?? null,
        contentBriefId: dto.contentBriefId ?? null,
        subject: dto.subject ?? null,
        previewText: dto.previewText ?? null,
        scheduledAt: dto.scheduledAt ?? null,
        status: "DRAFT",
      },
    });
  }

  async submitForApproval(campaignId: string) {
    const campaign = await this.getById(campaignId);
    if (campaign.status !== "DRAFT") {
      throw new Error(
        `Campaign ${campaignId} is ${campaign.status}, not DRAFT`,
      );
    }

    const approval = await this.approvals.create({
      type: "CAMPAIGN",
      subject: campaign.name,
      description: `Campaign approval: ${campaign.type} — ${campaign.objective ?? "no objective set"}`,
      metadata: { campaignId, type: campaign.type },
    });

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "PENDING_APPROVAL" },
    });
  }

  async approve(campaignId: string, resolvedBy: string) {
    const campaign = await this.getById(campaignId);
    if (campaign.status !== "PENDING_APPROVAL") {
      throw new Error(
        `Campaign ${campaignId} is ${campaign.status}, not PENDING_APPROVAL`,
      );
    }

    // Find the pending approval for this campaign and resolve it
    const approval = await this.prisma.approval.findFirst({
      where: {
        brandId: BRAND_ID,
        type: "CAMPAIGN",
        status: "PENDING",
        metadata: { path: ["campaignId"], equals: campaignId },
      },
    });

    if (approval) {
      await this.approvals.resolve(approval.id, "APPROVED", resolvedBy);
    }

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "APPROVED" },
    });
  }

  // APPROVED does NOT auto-send. Owner must explicitly call this.
  // Resolves segment members, checks consent + frequency caps, queues emails.
  async queueEmails(
    campaignId: string,
    content: QueueEmailsDto,
  ): Promise<{ queued: number; suppressed: number }> {
    const campaign = await this.getById(campaignId);
    if (campaign.status !== "APPROVED") {
      throw new Error(
        `Campaign ${campaignId} must be APPROVED before queuing emails (currently ${campaign.status})`,
      );
    }

    const members = campaign.segmentId
      ? await this.segments.getMembersForSegment(
          await this.getSegmentType(campaign.segmentId),
        )
      : await this.contacts.list({ emailSubscribed: true });

    let queued = 0;
    let suppressed = 0;

    for (const contact of members) {
      if (!contact.email) {
        suppressed++;
        continue;
      }

      const eligible = await this.contacts.isMarketingEligible(contact.id);
      if (!eligible) {
        suppressed++;
        continue;
      }

      const withinCap = await this.frequencyCaps.isEligible(
        contact.id,
        campaign.type,
      );
      if (!withinCap) {
        suppressed++;
        continue;
      }

      await this.emailProvider.send({
        campaignId,
        contactId: contact.id,
        to: contact.email,
        subject: content.subject,
        previewText: content.previewText,
        body: content.body,
        callToAction: content.callToAction,
      });

      await this.prisma.campaignTouch.create({
        data: {
          campaignId,
          contactId: contact.id,
          touchType: "SEND",
        },
      });

      queued++;
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENT" },
    });

    this.logger.log(
      `Campaign ${campaignId} queued: ${queued} sent, ${suppressed} suppressed`,
    );
    return { queued, suppressed };
  }

  async cancel(campaignId: string) {
    const campaign = await this.getById(campaignId);
    if (["SENT", "CANCELLED"].includes(campaign.status)) {
      throw new Error(
        `Campaign ${campaignId} cannot be cancelled from ${campaign.status}`,
      );
    }
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "CANCELLED" },
    });
  }

  async getById(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign)
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    return campaign;
  }

  async list() {
    return this.prisma.campaign.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { createdAt: "desc" },
    });
  }

  async getSummary() {
    const rows = await this.prisma.campaign.groupBy({
      by: ["status"],
      where: { brandId: BRAND_ID },
      _count: { id: true },
    });
    const byStatus: Record<string, number> = {};
    for (const row of rows) {
      byStatus[row.status] = row._count.id;
    }
    return byStatus;
  }

  private async getSegmentType(segmentId: string): Promise<string> {
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
    });
    if (!segment) throw new NotFoundException(`Segment ${segmentId} not found`);
    return segment.type;
  }
}
