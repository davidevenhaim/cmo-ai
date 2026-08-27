import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ContactService } from "./contact.service";
import { SegmentService } from "./segment.service";
import { FrequencyCapService } from "./frequency-cap.service";
import { EmailProvider } from "./email/email-provider.interface";
import { MockEmailProvider } from "./email/mock-email.provider";

const BRAND_ID = "luminesce-brand-001";

export interface SuppressionBreakdown {
  NO_CONSENT: number;
  FREQUENCY_CAP: number;
  NO_EMAIL: number;
  [reason: string]: number;
}

export interface RecipientSnapshot {
  total: number;
  eligible: number;
  suppressed: number;
  suppressionBreakdown: SuppressionBreakdown;
}

export interface ExecutionResult {
  executionId: string;
  mode: string;
  status: string;
  snapshot: RecipientSnapshot;
  sent: number;
  suppressed: number;
  failed: number;
}

@Injectable()
export class CampaignExecutionService {
  private readonly logger = new Logger(CampaignExecutionService.name);
  private provider: EmailProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactService,
    private readonly segments: SegmentService,
    private readonly frequencyCaps: FrequencyCapService,
    private readonly mockProvider: MockEmailProvider,
  ) {
    // Default provider is always mock — real provider registered via registerProvider().
    this.provider = mockProvider;
  }

  registerProvider(provider: EmailProvider): void {
    this.provider = provider;
    this.logger.log(`Email provider registered: ${provider.name}`);
  }

  // Create a CampaignExecution. Default mode is DRY_RUN.
  // Campaign must be APPROVED — approved ≠ auto-execute.
  async create(campaignId: string, mode: "DRY_RUN" | "LIVE" = "DRY_RUN") {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign)
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    if (campaign.status !== "APPROVED") {
      throw new BadRequestException(
        `Campaign must be APPROVED to create execution (current: ${campaign.status})`,
      );
    }

    return this.prisma.campaignExecution.create({
      data: {
        campaignId,
        brandId: BRAND_ID,
        mode,
        status: "PENDING",
      },
    });
  }

  // Run the execution — performs eligibility re-check at this moment.
  // DRY_RUN: compute snapshot only, no sends.
  // LIVE: send via EmailProvider after re-check.
  async execute(executionId: string): Promise<ExecutionResult> {
    const execution = await this.prisma.campaignExecution.findUnique({
      where: { id: executionId },
      include: { campaign: true },
    });
    if (!execution)
      throw new NotFoundException(`CampaignExecution ${executionId} not found`);
    if (execution.status !== "PENDING") {
      throw new BadRequestException(
        `CampaignExecution ${executionId} is ${execution.status}, only PENDING can be executed`,
      );
    }

    // Re-verify campaign still APPROVED at execution time
    if (execution.campaign.status !== "APPROVED") {
      throw new BadRequestException(
        `Campaign is no longer APPROVED (current: ${execution.campaign.status})`,
      );
    }

    await this.prisma.campaignExecution.update({
      where: { id: executionId },
      data: { status: "RUNNING" },
    });

    try {
      const result = await this.runEligibilityAndSend(execution);

      await this.prisma.campaignExecution.update({
        where: { id: executionId },
        data: {
          status: "COMPLETED",
          executedAt: new Date(),
          recipientSnapshot: result.snapshot as any,
          sent: result.sent,
          suppressed: result.suppressed,
          failed: result.failed,
        },
      });

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.campaignExecution.update({
        where: { id: executionId },
        data: { status: "FAILED", failureReason: msg },
      });
      throw err;
    }
  }

  async getExecution(executionId: string) {
    const execution = await this.prisma.campaignExecution.findUnique({
      where: { id: executionId },
      include: { campaign: true },
    });
    if (!execution)
      throw new NotFoundException(`CampaignExecution ${executionId} not found`);
    return execution;
  }

  async listForCampaign(campaignId: string) {
    return this.prisma.campaignExecution.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
    });
  }

  private async runEligibilityAndSend(execution: {
    id: string;
    campaignId: string;
    mode: string;
    campaign: {
      segmentId: string | null;
      type: string;
      subject: string | null;
      previewText: string | null;
    };
  }): Promise<ExecutionResult> {
    const campaign = execution.campaign;

    // Resolve candidate recipients
    const candidates = campaign.segmentId
      ? await this.segments.getMembersForSegment(
          await this.getSegmentType(campaign.segmentId),
        )
      : await this.contacts.list({ emailSubscribed: true });

    const breakdown: SuppressionBreakdown = {
      NO_CONSENT: 0,
      FREQUENCY_CAP: 0,
      NO_EMAIL: 0,
    };

    let sent = 0;
    let suppressed = 0;
    let failed = 0;

    for (const contact of candidates) {
      if (!contact.email) {
        breakdown.NO_EMAIL++;
        suppressed++;
        continue;
      }

      // Consent re-check at execution time — catches unsubscribes after campaign creation
      const eligible = await this.contacts.isMarketingEligible(contact.id);
      if (!eligible) {
        breakdown.NO_CONSENT++;
        suppressed++;
        continue;
      }

      // Frequency cap re-check at execution time
      const withinCap = await this.frequencyCaps.isEligible(
        contact.id,
        campaign.type,
      );
      if (!withinCap) {
        breakdown.FREQUENCY_CAP++;
        suppressed++;
        continue;
      }

      if (execution.mode === "DRY_RUN") {
        // Count but do not send
        sent++;
        continue;
      }

      // LIVE mode: actually send
      try {
        await this.provider.send({
          campaignId: execution.campaignId,
          executionId: execution.id,
          contactId: contact.id,
          to: contact.email,
          subject: campaign.subject ?? "Message from Luminesce",
          previewText: campaign.previewText ?? undefined,
          body: "",
        });

        await this.prisma.campaignTouch.create({
          data: {
            campaignId: execution.campaignId,
            contactId: contact.id,
            touchType: "SEND",
          },
        });

        sent++;
      } catch {
        failed++;
      }
    }

    const snapshot: RecipientSnapshot = {
      total: candidates.length,
      eligible: sent + failed,
      suppressed,
      suppressionBreakdown: breakdown,
    };

    return {
      executionId: execution.id,
      mode: execution.mode,
      status: "COMPLETED",
      snapshot,
      sent,
      suppressed,
      failed,
    };
  }

  private async getSegmentType(segmentId: string): Promise<string> {
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
    });
    if (!segment) throw new NotFoundException(`Segment ${segmentId} not found`);
    return segment.type;
  }
}
