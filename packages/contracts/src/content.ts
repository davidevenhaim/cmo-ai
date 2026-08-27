import { z } from "zod";

export const ChannelSchema = z.enum([
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "X",
  "REDDIT",
  "BLOG",
  "EMAIL",
  "GENERIC",
]);

export const ContentFormatSchema = z.enum([
  "POST",
  "CAROUSEL",
  "STORY",
  "SHORT_VIDEO",
  "LONG_FORM",
  "COMMENT",
  "THREAD",
]);

export const DraftStatusSchema = z.enum([
  "GENERATED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUPERSEDED",
]);

export const ContentEvidenceItemSchema = z.object({
  type: z.enum([
    "BRAND_FACT",
    "COMMERCE_METRIC",
    "RESEARCH_FINDING",
    "OPPORTUNITY",
    "OWNER_HINT",
  ]),
  ref: z.string(),
  summary: z.string(),
});

export const CarouselSlideSchema = z.object({
  slideNumber: z.number().int().positive(),
  text: z.string(),
  visualDirection: z.string().optional(),
});

// Flexible generated content — NestJS validates channel-specific fields at service level.
export const GeneratedContentSchema = z.object({
  channel: ChannelSchema,
  format: ContentFormatSchema,
  // Instagram / general
  caption: z.string().optional(),
  callToAction: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  // Instagram carousel
  hookSlide: z.string().optional(),
  slides: z.array(CarouselSlideSchema).optional(),
  closingCta: z.string().optional(),
  // X
  text: z.string().optional(),
  thread: z.array(z.string()).optional(),
  // LinkedIn
  // (text field reused)
  // Reddit
  title: z.string().optional(),
  body: z.string().optional(),
  subredditSuggestion: z.string().optional(),
  // Blog
  outline: z.array(z.string()).optional(),
  metaDescription: z.string().optional(),
  // Weave creative direction (M8)
  creativeDirection: z
    .object({
      aspectRatio: z.string().optional(),
      visualObjective: z.string().optional(),
      mood: z.string().optional(),
      requiredElements: z.array(z.string()).optional(),
      forbiddenElements: z.array(z.string()).optional(),
      productRefs: z.array(z.string()).optional(),
      textHierarchy: z.array(z.string()).optional(),
    })
    .optional(),
});

export const CriticEvaluationSchema = z.object({
  brandFit: z.number().min(0).max(1),
  channelFit: z.number().min(0).max(1),
  evidenceAlignment: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  originality: z.number().min(0).max(1),
  promotionalIntensity: z.number().min(0).max(1),
  claimRisk: z.number().min(0).max(1),
  ctaQuality: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  issues: z.array(z.string()),
  passesReview: z.boolean(),
});

const ContentBriefSummarySchema = z.object({
  objective: z.string(),
  topic: z.string(),
  angle: z.string(),
  targetAudience: z.string(),
  channel: ChannelSchema,
  format: ContentFormatSchema,
  keyMessage: z.string(),
  callToAction: z.string().optional(),
  tone: z.string(),
  constraints: z.array(z.string()),
});

const ContentBrandContextSchema = z.object({
  name: z.string(),
  voice: z.string().optional(),
  audience: z.string().optional(),
  guidelines: z.array(
    z.object({
      category: z.string(),
      rule: z.string(),
      example: z.string().optional(),
    }),
  ),
  activeProducts: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()),
    }),
  ),
});

const ContentEvidenceSchema = z.object({
  // Trusted sources
  brandFacts: z.array(z.string()),
  commerceSummary: z.string().optional(),
  // Untrusted external research — labeled clearly in prompt
  researchFindings: z.array(z.string()),
  opportunitySummary: z.string().optional(),
  ownerHint: z.string().optional(),
});

export const ContentGenerationRequestSchema = z.object({
  brief: ContentBriefSummarySchema,
  brandContext: ContentBrandContextSchema,
  evidence: ContentEvidenceSchema,
  revisionFeedback: z.string().optional(),
});

export const ContentCriticRequestSchema = z.object({
  content: GeneratedContentSchema,
  brief: ContentBriefSummarySchema,
  brandContext: ContentBrandContextSchema,
});

export type Channel = z.infer<typeof ChannelSchema>;
export type ContentFormat = z.infer<typeof ContentFormatSchema>;
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
export type ContentEvidenceItem = z.infer<typeof ContentEvidenceItemSchema>;
export type CarouselSlide = z.infer<typeof CarouselSlideSchema>;
export type GeneratedContent = z.infer<typeof GeneratedContentSchema>;
export type CriticEvaluation = z.infer<typeof CriticEvaluationSchema>;
export type ContentGenerationRequest = z.infer<
  typeof ContentGenerationRequestSchema
>;
export type ContentCriticRequest = z.infer<typeof ContentCriticRequestSchema>;
