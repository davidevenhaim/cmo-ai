import { z } from "zod";

export const CmoDecisionTypeSchema = z.enum([
  "CREATE_CONTENT",
  "START_RESEARCH",
  "PROPOSE_CAMPAIGN",
  "REQUEST_APPROVAL",
  "SEND_UPDATE",
  "NO_ACTION",
]);

export type CmoDecisionType = z.infer<typeof CmoDecisionTypeSchema>;

export const CreateContentDecisionSchema = z.object({
  type: z.literal("CREATE_CONTENT"),
  contentType: z.enum(["blog_post", "social_caption", "email", "ad_copy"]),
  topic: z.string(),
  angle: z.string().optional(),
  keyMessages: z.array(z.string()),
  targetAudience: z.string(),
  suggestedChannels: z.array(z.string()),
  opportunityId: z.string().optional(),
  tone: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});

export const StartResearchDecisionSchema = z.object({
  type: z.literal("START_RESEARCH"),
  topic: z.string(),
  questions: z.array(z.string()),
  rationale: z.string(),
});

export const ProposeCampaignDecisionSchema = z.object({
  type: z.literal("PROPOSE_CAMPAIGN"),
  campaignName: z.string(),
  objective: z.string(),
  targetAudience: z.string(),
  channels: z.array(z.string()),
  keyMessages: z.array(z.string()),
  estimatedDuration: z.string(),
});

export const RequestApprovalDecisionSchema = z.object({
  type: z.literal("REQUEST_APPROVAL"),
  subject: z.string(),
  description: z.string(),
  urgency: z.enum(["low", "medium", "high"]),
});

export const SendUpdateDecisionSchema = z.object({
  type: z.literal("SEND_UPDATE"),
  recipient: z.string(),
  subject: z.string(),
  summary: z.string(),
});

export const NoActionDecisionSchema = z.object({
  type: z.literal("NO_ACTION"),
  reason: z.string(),
});

export const CmoDecisionSchema = z.discriminatedUnion("type", [
  CreateContentDecisionSchema,
  StartResearchDecisionSchema,
  ProposeCampaignDecisionSchema,
  RequestApprovalDecisionSchema,
  SendUpdateDecisionSchema,
  NoActionDecisionSchema,
]);

export type CmoDecision = z.infer<typeof CmoDecisionSchema>;

export const CmoRunResultSchema = z
  .object({
    decisionType: CmoDecisionTypeSchema,
    decisionPayload: CmoDecisionSchema,
    rationale: z.string(),
    evidenceRefs: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    modelId: z.string(),
    modelVersion: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decisionType !== data.decisionPayload.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionPayload", "type"],
        message: `decisionType "${data.decisionType}" does not match decisionPayload.type "${data.decisionPayload.type}"`,
      });
    }
  });

export type CmoRunResult = z.infer<typeof CmoRunResultSchema>;
