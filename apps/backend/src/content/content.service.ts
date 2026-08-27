import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { type DraftStatus } from "@ai-cmo/contracts";

const BRAND_ID = "luminesce-brand-001";

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async createBrief(data: {
    cmoRunId?: string;
    opportunityId?: string;
    recommendationId?: string;
    objective: string;
    topic: string;
    angle: string;
    targetAudience: string;
    channel: string;
    format: string;
    keyMessage: string;
    callToAction?: string;
    tone: string;
    constraints: string[];
    supportingEvidence: Record<string, unknown>;
  }) {
    return this.prisma.contentBrief.create({
      data: {
        brandId: BRAND_ID,
        cmoRunId: data.cmoRunId ?? null,
        opportunityId: data.opportunityId ?? null,
        recommendationId: data.recommendationId ?? null,
        status: "ACTIVE",
        objective: data.objective,
        topic: data.topic,
        angle: data.angle,
        targetAudience: data.targetAudience,
        channel: data.channel,
        format: data.format,
        keyMessage: data.keyMessage,
        callToAction: data.callToAction ?? null,
        tone: data.tone,
        constraints: data.constraints,
        supportingEvidence: data.supportingEvidence as any,
      },
    });
  }

  async getBrief(id: string) {
    const brief = await this.prisma.contentBrief.findUnique({
      where: { id },
      include: { drafts: { orderBy: { version: "desc" } } },
    });
    if (!brief) throw new NotFoundException(`ContentBrief ${id} not found`);
    return brief;
  }

  async listBriefs() {
    return this.prisma.contentBrief.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { drafts: { orderBy: { version: "desc" }, take: 1 } },
    });
  }

  async createDraft(data: {
    briefId: string;
    cmoRunId?: string;
    version: number;
    channel: string;
    format: string;
    content: Record<string, unknown>;
    headline?: string;
    caption?: string;
    callToAction?: string;
    hashtags: string[];
    generationMetadata: Record<string, unknown>;
    criticScore?: number;
    criticEvaluation?: Record<string, unknown>;
  }) {
    return this.prisma.contentDraft.create({
      data: {
        brandId: BRAND_ID,
        briefId: data.briefId,
        cmoRunId: data.cmoRunId ?? null,
        version: data.version,
        channel: data.channel,
        format: data.format,
        content: data.content as any,
        headline: data.headline ?? null,
        caption: data.caption ?? null,
        callToAction: data.callToAction ?? null,
        hashtags: data.hashtags,
        status: "GENERATED",
        generationMetadata: data.generationMetadata as any,
        criticScore: data.criticScore ?? null,
        criticEvaluation: (data.criticEvaluation ?? null) as any,
      },
    });
  }

  async getDraft(id: string) {
    const draft = await this.prisma.contentDraft.findUnique({
      where: { id },
      include: { brief: true, feedback: true },
    });
    if (!draft) throw new NotFoundException(`ContentDraft ${id} not found`);
    return draft;
  }

  async listDraftsForBrief(briefId: string) {
    return this.prisma.contentDraft.findMany({
      where: { briefId },
      orderBy: { version: "desc" },
    });
  }

  async listDrafts(status?: string) {
    return this.prisma.contentDraft.findMany({
      where: { brandId: BRAND_ID, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        brief: true,
        publishRequests: { include: { publication: true } },
      },
    });
  }

  async listPendingDrafts() {
    return this.prisma.contentDraft.findMany({
      where: { brandId: BRAND_ID, status: "PENDING_REVIEW" },
      orderBy: { createdAt: "desc" },
      include: { brief: true },
    });
  }

  async updateDraftStatus(id: string, status: DraftStatus) {
    return this.prisma.contentDraft.update({
      where: { id },
      data: { status },
    });
  }

  async supersedePreviousDrafts(briefId: string, currentVersion: number) {
    await this.prisma.contentDraft.updateMany({
      where: {
        briefId,
        version: { lt: currentVersion },
        status: { not: "SUPERSEDED" },
      },
      data: { status: "SUPERSEDED" },
    });
  }

  async addFeedback(draftId: string, source: string, feedback: string) {
    return this.prisma.contentFeedback.create({
      data: { draftId, source, feedback },
    });
  }

  async getNextVersion(briefId: string): Promise<number> {
    const latest = await this.prisma.contentDraft.findFirst({
      where: { briefId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  async linkApprovalToDraft(draftId: string, approvalId: string) {
    // Linking the owner-review approval is what makes the draft reviewable
    return this.prisma.contentDraft.update({
      where: { id: draftId },
      data: { approvalId, status: "PENDING_REVIEW" },
    });
  }
}
