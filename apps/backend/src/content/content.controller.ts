import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Body,
  NotFoundException,
  Query,
} from "@nestjs/common";
import { ContentService } from "./content.service";
import { ContentGenerationService } from "./content-generation.service";
import { RecommendationService } from "../measurement/recommendation.service";

@Controller("content")
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly generationService: ContentGenerationService,
    private readonly recommendationService: RecommendationService,
  ) {}

  @Get("briefs")
  listBriefs() {
    return this.contentService.listBriefs();
  }

  // Manual "Create content" from the operator UI. Creates one brief per
  // channel and kicks off draft generation in the background.
  @Post("briefs")
  async createBriefs(
    @Body()
    body: {
      topic: string;
      instruction?: string;
      channels?: string[];
      opportunityId?: string;
      generate?: boolean;
    },
  ) {
    if (!body.topic?.trim()) {
      throw new BadRequestException("topic is required");
    }
    const channels =
      body.channels && body.channels.length > 0 ? body.channels : ["BLOG"];

    // Acting on a market opportunity is a CMO suggestion being executed —
    // persist it as a Recommendation so the resulting content is measured
    // (lineage: signal → recommendation → brief → draft → publication).
    let recommendationId: string | undefined;
    if (body.opportunityId) {
      const rec = await this.recommendationService.propose({
        type: "CREATE_CONTENT",
        title: `Create content: ${body.topic.trim()}`,
        rationale:
          "Owner accepted a market opportunity and requested content for it",
        evidenceRefs: [
          {
            source: "market_intelligence",
            refType: "MARKET_OPPORTUNITY",
            refId: body.opportunityId,
            note: null,
          },
        ],
        confidence: 0.7,
        targetType: "MARKET_OPPORTUNITY",
        targetId: body.opportunityId,
        actionClass: "PROPOSE",
      });
      recommendationId = rec.id;
    }

    const briefs = [];
    for (const channel of channels) {
      const upper = channel.toUpperCase();
      const brief = await this.contentService.createBrief({
        opportunityId: body.opportunityId,
        recommendationId,
        objective: "Owner-requested content",
        topic: body.topic.trim(),
        angle: body.instruction ?? "Practical, evidence-based angle",
        targetAudience: "Existing and prospective customers",
        channel: upper,
        format: upper === "BLOG" ? "LONG_FORM" : "POST",
        keyMessage: body.topic.trim(),
        tone: "confident, helpful",
        constraints: body.instruction ? [body.instruction] : [],
        supportingEvidence: { items: [] },
      });
      briefs.push(brief);
      if (body.generate !== false) {
        void this.generationService
          .generateForBrief({ briefId: brief.id })
          .catch(() => undefined);
      }
    }
    return { briefs, generationStarted: body.generate !== false };
  }

  @Get("briefs/:id")
  getBrief(@Param("id") id: string) {
    return this.contentService.getBrief(id);
  }

  @Get("drafts")
  listDrafts(@Query("status") status?: string) {
    return this.contentService.listDrafts(status);
  }

  @Get("drafts/pending")
  listPendingDrafts() {
    return this.contentService.listPendingDrafts();
  }

  @Get("drafts/:id")
  getDraft(@Param("id") id: string) {
    return this.contentService.getDraft(id);
  }

  @Post("briefs/:id/generate")
  async generateForBrief(
    @Param("id") id: string,
    @Body() body: { revisionFeedback?: string },
  ) {
    return this.generationService.generateForBrief({
      briefId: id,
      revisionFeedback: body.revisionFeedback,
    });
  }

  @Post("drafts/:id/feedback")
  async addFeedback(
    @Param("id") id: string,
    @Body() body: { source: string; feedback: string },
  ) {
    return this.contentService.addFeedback(id, body.source, body.feedback);
  }
}
