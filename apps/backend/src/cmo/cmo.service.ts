import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { BrandService } from "../brand/brand.service";
import { BrainAdapter } from "../brain/brain.adapter";
import { ApprovalService } from "../approval/approval.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ResearchService } from "../research/research.service";
import { ContentService } from "../content/content.service";
import { ContentGenerationService } from "../content/content-generation.service";
import { GrowthContextService } from "../growth/growth-context.service";
import { MarketIntelligenceContextService } from "../market-intelligence/market-intelligence-context.service";
import { RevenueContextService } from "../revenue-optimization/revenue-context.service";
import { WebsiteContextService } from "../website/website-context.service";
import { WhatsAppContextService } from "../whatsapp/whatsapp-context.service";
import { CmoRunResultSchema } from "@ai-cmo/contracts";

@Injectable()
export class CmoService {
  private readonly logger = new Logger(CmoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandService: BrandService,
    private readonly brain: BrainAdapter,
    private readonly approvalService: ApprovalService,
    private readonly shopifyService: ShopifyService,
    private readonly researchService: ResearchService,
    private readonly contentService: ContentService,
    private readonly contentGenerationService: ContentGenerationService,
    private readonly growthContextService: GrowthContextService,
    private readonly marketIntelligenceContextService: MarketIntelligenceContextService,
    private readonly revenueContextService: RevenueContextService,
    private readonly websiteContextService: WebsiteContextService,
    private readonly whatsappContextService: WhatsAppContextService,
  ) {}

  async triggerRun(
    triggeredBy: string,
    hint?: string,
  ): Promise<{ run: any; approval?: any; contentBrief?: any }> {
    const profile = await this.brandService.getFullProfile();

    const [
      commerceContext,
      researchContext,
      growthContext,
      marketIntelligenceContext,
      revenueContext,
      websiteContext,
      whatsappContext,
    ] = await Promise.all([
      this.shopifyService.getCommerceContext().catch((err) => {
        this.logger.warn(`Commerce context fetch failed: ${err.message}`);
        return undefined;
      }),
      this.researchService.getResearchContext().catch((err) => {
        this.logger.warn(`Research context fetch failed: ${err.message}`);
        return undefined;
      }),
      this.growthContextService.build().catch((err) => {
        this.logger.warn(`Growth context fetch failed: ${err.message}`);
        return undefined;
      }),
      this.marketIntelligenceContextService.build().catch((err) => {
        this.logger.warn(
          `Market intelligence context fetch failed: ${err.message}`,
        );
        return undefined;
      }),
      this.revenueContextService.build().catch((err) => {
        this.logger.warn(`Revenue context fetch failed: ${err.message}`);
        return undefined;
      }),
      this.websiteContextService.build().catch((err) => {
        this.logger.warn(`Website context fetch failed: ${err.message}`);
        return undefined;
      }),
      this.whatsappContextService.build().catch((err) => {
        this.logger.warn(`WhatsApp context fetch failed: ${err.message}`);
        return undefined;
      }),
    ]);

    const context = {
      brand: profile,
      facts: profile.facts,
      guidelines: profile.guidelines,
      products: profile.products,
      hint,
      commerceContext,
      researchContext,
      growthContext,
      marketIntelligenceContext,
      revenueContext,
      websiteContext,
      whatsappContext,
    };

    const start = Date.now();
    let brainResult;
    try {
      brainResult = await this.brain.callBrain(context as any);
    } catch (err: any) {
      const run = await this.prisma.cmoRun.create({
        data: {
          brandId: profile.id,
          triggeredBy,
          inputContext: context as any,
          decisionType: "NO_ACTION",
          decisionPayload: { type: "NO_ACTION", reason: "Brain call failed" },
          rationale: err.message ?? "Unknown error",
          evidenceRefs: [],
          confidence: 0,
          modelId: "unknown",
          durationMs: Date.now() - start,
          failed: true,
          failureReason: err.message ?? "Unknown error",
        },
      });
      return { run };
    }

    const validated = CmoRunResultSchema.parse(brainResult);

    const run = await this.prisma.cmoRun.create({
      data: {
        brandId: profile.id,
        triggeredBy,
        inputContext: context as any,
        decisionType: validated.decisionType,
        decisionPayload: validated.decisionPayload as any,
        rationale: validated.rationale,
        evidenceRefs: validated.evidenceRefs,
        confidence: validated.confidence,
        modelId: validated.modelId,
        modelVersion: validated.modelVersion ?? null,
        durationMs: validated.durationMs ?? Date.now() - start,
        failed: false,
      },
    });

    let approval: any | undefined;
    let contentBrief: any | undefined;

    if (validated.decisionType === "REQUEST_APPROVAL") {
      const payload = validated.decisionPayload as any;
      approval = await this.approvalService.create({
        cmoRunId: run.id,
        type: "GENERAL",
        subject: payload.subject,
        description: payload.description,
        metadata: { urgency: payload.urgency },
      });
    }

    if (validated.decisionType === "CREATE_CONTENT") {
      const payload = validated.decisionPayload as any;
      const profile = await this.brandService.getFullProfile();
      const [commerceContext, researchContext] = await Promise.all([
        this.shopifyService.getCommerceContext().catch(() => undefined),
        this.researchService.getResearchContext().catch(() => undefined),
      ]);
      const channel = payload.suggestedChannels?.[0] ?? "GENERIC";
      const format = channel === "BLOG" ? "LONG_FORM" : "POST";

      contentBrief = await this.contentService.createBrief({
        cmoRunId: run.id,
        opportunityId: payload.opportunityId ?? undefined,
        objective: payload.keyMessages?.[0] ?? payload.topic,
        topic: payload.topic,
        angle: payload.angle ?? "",
        targetAudience: payload.targetAudience,
        channel,
        format,
        keyMessage: payload.keyMessages?.[0] ?? payload.topic,
        tone: payload.tone ?? profile.voice ?? "professional",
        constraints: payload.constraints ?? [],
        supportingEvidence: {
          opportunitySummary: payload.opportunityId
            ? `Opportunity: ${payload.opportunityId}`
            : undefined,
          commerceContext: commerceContext ?? undefined,
          researchContext: researchContext ?? undefined,
        },
      });

      // Kick off generation asynchronously — don't block CMO run response
      this.contentGenerationService
        .generateForBrief({ briefId: contentBrief.id, cmoRunId: run.id })
        .catch((err) =>
          this.logger.error(
            `Content generation failed for brief ${contentBrief.id}: ${err.message}`,
          ),
        );
    }

    return {
      run,
      approval: approval as any,
      contentBrief: contentBrief as any,
    };
  }

  async triggerDevRun() {
    return this.triggerRun("dev");
  }

  async listRuns() {
    return this.prisma.cmoRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  async getRun(id: string) {
    return this.prisma.cmoRun.findUniqueOrThrow({ where: { id } });
  }
}
