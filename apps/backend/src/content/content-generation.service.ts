import { Injectable, Logger } from "@nestjs/common";
import { ContentBrainAdapter } from "./content-brain.adapter";
import { ContentService } from "./content.service";
import { BrandService } from "../brand/brand.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ResearchService } from "../research/research.service";
import { ApprovalService } from "../approval/approval.service";
import {
  type GeneratedContent,
  type CriticEvaluation,
} from "@ai-cmo/contracts";

const MAX_REVISIONS = 2;

export interface GenerateForBriefOptions {
  briefId: string;
  cmoRunId?: string;
  revisionFeedback?: string;
}

@Injectable()
export class ContentGenerationService {
  private readonly logger = new Logger(ContentGenerationService.name);

  constructor(
    private readonly brain: ContentBrainAdapter,
    private readonly contentService: ContentService,
    private readonly brandService: BrandService,
    private readonly shopifyService: ShopifyService,
    private readonly researchService: ResearchService,
    private readonly approvalService: ApprovalService,
  ) {}

  async generateForBrief(opts: GenerateForBriefOptions) {
    const briefRecord = await this.contentService.getBrief(opts.briefId);
    const profile = await this.brandService.getFullProfile();

    const [commerceContext, researchContext] = await Promise.all([
      this.shopifyService.getCommerceContext().catch((err) => {
        this.logger.warn(`Commerce context fetch failed: ${err.message}`);
        return undefined;
      }),
      this.researchService.getResearchContext().catch((err) => {
        this.logger.warn(`Research context fetch failed: ${err.message}`);
        return undefined;
      }),
    ]);

    const brandContext = {
      name: profile.name,
      voice: profile.voice ?? undefined,
      audience: profile.audience ?? undefined,
      guidelines: profile.guidelines.map((g: any) => ({
        category: g.category,
        rule: g.rule,
        example: g.example ?? undefined,
      })),
      activeProducts: profile.products.map((p: any) => ({
        name: p.name,
        description: p.description ?? undefined,
        category: p.category ?? undefined,
        tags: p.tags ?? [],
      })),
    };

    const evidence = {
      brandFacts: profile.facts.map((f: any) => f.content),
      commerceSummary: commerceContext
        ? this._buildCommerceSummary(commerceContext)
        : undefined,
      researchFindings:
        (researchContext as any)?.topFindings?.map((f: any) => f.excerpt) ?? [],
      opportunitySummary: (briefRecord.supportingEvidence as any)
        ?.opportunitySummary,
      ownerHint: (briefRecord.supportingEvidence as any)?.ownerHint,
    };

    const brief = {
      objective: briefRecord.objective,
      topic: briefRecord.topic,
      angle: briefRecord.angle,
      targetAudience: briefRecord.targetAudience,
      channel: briefRecord.channel as any,
      format: briefRecord.format as any,
      keyMessage: briefRecord.keyMessage,
      callToAction: briefRecord.callToAction ?? undefined,
      tone: briefRecord.tone,
      constraints: briefRecord.constraints as string[],
    };

    const version = await this.contentService.getNextVersion(opts.briefId);
    const revisionPass = Math.min(version - 1, MAX_REVISIONS);

    let generated: GeneratedContent;
    let evaluation: CriticEvaluation;
    let currentFeedback = opts.revisionFeedback;

    // Initial generation
    generated = await this.brain.generate({
      brief,
      brandContext,
      evidence,
      revisionFeedback: currentFeedback,
    });

    evaluation = await this.brain.critique({
      content: generated,
      brief,
      brandContext,
    });

    // Auto-revision loop (bounded by MAX_REVISIONS)
    let autoRevisions = 0;
    while (!evaluation.passesReview && autoRevisions < MAX_REVISIONS) {
      const issuesSummary = evaluation.issues.join("; ");
      this.logger.log(
        `Draft failed critic (overall=${evaluation.overall}), auto-revising. Issues: ${issuesSummary}`,
      );

      currentFeedback = `Auto-revision ${autoRevisions + 1}: Address these issues: ${issuesSummary}`;

      generated = await this.brain.generate({
        brief,
        brandContext,
        evidence,
        revisionFeedback: currentFeedback,
      });

      evaluation = await this.brain.critique({
        content: generated,
        brief,
        brandContext,
      });

      autoRevisions++;
    }

    // Supersede older drafts for this brief
    if (version > 1) {
      await this.contentService.supersedePreviousDrafts(opts.briefId, version);
    }

    const draft = await this.contentService.createDraft({
      briefId: opts.briefId,
      cmoRunId: opts.cmoRunId,
      version,
      channel: generated.channel,
      format: generated.format,
      content: generated as any,
      headline: (generated as any).title ?? undefined,
      caption: generated.caption ?? undefined,
      callToAction: generated.callToAction ?? undefined,
      hashtags: generated.hashtags ?? [],
      generationMetadata: {
        autoRevisions,
        passesReview: evaluation.passesReview,
        model: "claude",
      },
      criticScore: evaluation.overall,
      criticEvaluation: evaluation as any,
    });

    // Create approval request for owner review
    const approval = await this.approvalService.create({
      cmoRunId: opts.cmoRunId,
      type: "CONTENT",
      subject: `Content approval: ${brief.channel} ${brief.format} — ${brief.topic}`,
      description: `Generated content for brief ${opts.briefId} (version ${version}). Critic score: ${evaluation.overall.toFixed(2)}. ${evaluation.issues.length > 0 ? `Issues: ${evaluation.issues.join("; ")}` : "No issues found."}`,
      metadata: {
        briefId: opts.briefId,
        draftId: draft.id,
        criticScore: evaluation.overall,
        passesReview: evaluation.passesReview,
      },
    });

    // Link approval to draft
    await this.contentService.linkApprovalToDraft(draft.id, approval.id);

    return { draft, approval, evaluation };
  }

  private _buildCommerceSummary(ctx: any): string {
    if (!ctx) return "";
    const status = ctx.evidenceStatus ?? "UNKNOWN";
    const prefix =
      status === "STALE" ? "[STALE DATA — do not cite as current] " : "";
    const m = ctx.metrics;
    if (!m) return `${prefix}Commerce data available but no metrics.`;
    const curr = m.currencyCode ?? "USD";
    return (
      `${prefix}Revenue: ${curr} ${m.revenue?.toFixed(2) ?? "N/A"}, ` +
      `Orders: ${m.orderCount ?? "N/A"}, ` +
      `AOV: ${curr} ${m.aov?.toFixed(2) ?? "N/A"}`
    );
  }
}
