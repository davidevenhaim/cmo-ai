import { z } from "zod";

export const OpportunityTypeSchema = z.enum([
  "CONTENT_IDEA",
  "ENGAGEMENT",
  "TREND",
  "COMPETITOR_ACTIVITY",
  "CUSTOMER_QUESTION",
  "PRODUCT_INSIGHT",
]);

export const OpportunityStatusSchema = z.enum([
  "NEW",
  "REVIEWED",
  "ACTIONED",
  "IGNORED",
]);

export const ResearchSourceTypeSchema = z.enum([
  "COMPETITOR",
  "SUBREDDIT",
  "BLOG",
  "FORUM",
  "WEBSITE",
  "PUBLICATION",
  "GENERIC",
]);

export const ResearchRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "PARTIAL",
]);

// Concise finding preview — safe to send to Claude
export const ResearchFindingPreviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceType: z.string(),
  topic: z.string().nullable(),
  relevanceScore: z.number(),
  excerpt: z.string().max(400),
  url: z.string(),
  publishedAt: z.coerce.date().nullable(),
});

// Concise opportunity preview — safe to send to Claude
export const OpportunityPreviewSchema = z.object({
  id: z.string(),
  type: OpportunityTypeSchema,
  title: z.string(),
  summary: z.string(),
  relevanceScore: z.number(),
  urgencyScore: z.number(),
});

// Attached to BrandContext — stays concise, no raw scraped content
export const ResearchContextSchema = z.object({
  runAt: z.coerce.date(),
  available: z.boolean(),
  stale: z.boolean(),
  topFindings: z.array(ResearchFindingPreviewSchema),
  topOpportunities: z.array(OpportunityPreviewSchema),
  failureReason: z.string().nullable(),
});

export type OpportunityType = z.infer<typeof OpportunityTypeSchema>;
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;
export type ResearchSourceType = z.infer<typeof ResearchSourceTypeSchema>;
export type ResearchRunStatus = z.infer<typeof ResearchRunStatusSchema>;
export type ResearchFindingPreview = z.infer<
  typeof ResearchFindingPreviewSchema
>;
export type OpportunityPreview = z.infer<typeof OpportunityPreviewSchema>;
export type ResearchContext = z.infer<typeof ResearchContextSchema>;
