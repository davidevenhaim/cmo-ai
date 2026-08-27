import { z } from "zod";
import { TodayRecentResultsSchema } from "./measurement";

// ---------------------------------------------------------------------------
// Operator intents — the ONLY commands the operator layer will execute.
// Claude may propose one of these; it can never invent new executable actions.
// ---------------------------------------------------------------------------

export const OperatorIntentSchema = z.enum([
  "GET_DAILY_BRIEF",
  "ANALYZE_SALES",
  "FIND_CONTENT_OPPORTUNITIES",
  "CREATE_CONTENT_BRIEF",
  "LIST_DRAFTS",
  "LIST_MARKET_OPPORTUNITIES",
  "LIST_ABANDONED",
  "LIST_REVENUE_OPPORTUNITIES",
  "PROPOSE_BUNDLE",
  "LIST_WINBACK",
  "LIST_REPLENISHMENT",
  "LIST_CUSTOMERS",
  "GET_ANALYTICS",
  "SCHEDULE_CONTENT",
]);

export const OperatorActionClassSchema = z.enum([
  "READ",
  "PROPOSE",
  "MUTATE",
  "EXECUTE",
]);

export const OperatorCommandSchema = z
  .object({
    text: z.string().min(1).max(2000).optional(),
    intent: OperatorIntentSchema.optional(),
    params: z.record(z.unknown()).optional(),
    confirm: z.boolean().optional().default(false),
  })
  .refine((c) => c.text !== undefined || c.intent !== undefined, {
    message: "Either text or intent is required",
  });

// Brain's NL classification output. Validated before any routing happens.
export const OperatorIntentProposalSchema = z.object({
  intent: OperatorIntentSchema,
  params: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  clarification: z.string().nullable().optional(),
});

export const OperatorCommandStatusSchema = z.enum([
  "OK",
  "CONFIRMATION_REQUIRED",
  "CLARIFICATION_NEEDED",
  "UNSUPPORTED",
  "ERROR",
]);

export const OperatorCommandResultSchema = z.object({
  intent: OperatorIntentSchema.nullable(),
  classification: OperatorActionClassSchema.nullable(),
  status: OperatorCommandStatusSchema,
  summary: z.string(),
  data: z.unknown().nullable(),
  deepLink: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Suggested actions (Today page)
// ---------------------------------------------------------------------------

export const SuggestedActionCategorySchema = z.enum([
  "REVENUE",
  "CONTENT",
  "MARKET",
  "PUBLISHING",
  "CUSTOMERS",
  "CONNECTIONS",
  "COMMERCE",
]);

export const SuggestedActionSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  category: SuggestedActionCategorySchema,
  // Source of the evidence backing this action (e.g. "revenue_opportunities",
  // "market_intelligence", "publishing"). Deterministic — never LLM-invented.
  evidenceSource: z.string(),
  expectedImpact: z.string().nullable(),
  impactValue: z.number().nullable(),
  currencyCode: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  requiredAction: OperatorActionClassSchema,
  requiresApproval: z.boolean(),
  deepLink: z.string(),
  priority: z.number(),
});

// ---------------------------------------------------------------------------
// Today (operator daily brief)
// ---------------------------------------------------------------------------

export const SectionStatusSchema = z.enum([
  "AVAILABLE",
  "STALE",
  "UNAVAILABLE",
  "NOT_CONFIGURED",
  "MOCK",
]);

export const TodaySalesSchema = z.object({
  status: SectionStatusSchema,
  currencyCode: z.string().nullable(),
  periodDays: z.number().nullable(),
  revenue: z.number().nullable(),
  orderCount: z.number().nullable(),
  aov: z.number().nullable(),
  unitsSold: z.number().nullable(),
  previousRevenue: z.number().nullable(),
  revenueDeltaPct: z.number().nullable(),
  topProducts: z.array(
    z.object({
      productTitle: z.string(),
      revenue: z.number(),
      units: z.number(),
    }),
  ),
  failureReason: z.string().nullable(),
});

export const TodayRevenueSchema = z.object({
  status: SectionStatusSchema,
  currencyCode: z.string().nullable(),
  abandonedValue: z.number().nullable(),
  openOpportunities: z.number().nullable(),
  eligibleRecoveries: z.number().nullable(),
  activeJourneys: z.number().nullable(),
  replenishmentOpportunities: z.number().nullable(),
  recoveredRevenueLast30: z.number().nullable(),
  contributionProfitLast30: z.number().nullable(),
});

export const TodayMarketSchema = z.object({
  status: SectionStatusSchema,
  dataFreshness: z.record(z.string()).nullable(),
  risingTopics: z.array(z.object({ topic: z.string(), score: z.number() })),
  opportunityCount: z.number().nullable(),
  searchOpportunityCount: z.number().nullable(),
  contentGapCount: z.number().nullable(),
});

export const TodayContentSchema = z.object({
  status: SectionStatusSchema,
  awaitingReview: z.number().nullable(),
  generated: z.number().nullable(),
  approvedUnpublished: z.number().nullable(),
  scheduled: z.number().nullable(),
  failedPublications: z.number().nullable(),
  unknownPublications: z.number().nullable(),
});

export const TodayCustomersSchema = z.object({
  status: SectionStatusSchema,
  totalContacts: z.number().nullable(),
  vip: z.number().nullable(),
  winBack: z.number().nullable(),
  replenishmentDue: z.number().nullable(),
  abandoned: z.number().nullable(),
});

export const CmoInterpretationSchema = z.object({
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  headline: z.string().nullable(),
  narrative: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const OperatorTodaySchema = z.object({
  generatedAt: z.coerce.date(),
  brandName: z.string().nullable(),
  facts: z.object({
    sales: TodaySalesSchema,
    revenue: TodayRevenueSchema,
    market: TodayMarketSchema,
    content: TodayContentSchema,
    customers: TodayCustomersSchema,
  }),
  actions: z.array(SuggestedActionSchema),
  interpretation: CmoInterpretationSchema,
  // M9 feedback loop: measured outcomes of recent recommendations. Nullable —
  // rendered only when real measured data exists.
  recentResults: TodayRecentResultsSchema.nullish(),
});

// ---------------------------------------------------------------------------
// Brain prioritization (backend -> brain -> backend). The brain only reorders
// and explains candidate actions supplied by the backend; ids not present in
// the candidate set are discarded by the backend.
// ---------------------------------------------------------------------------

export const PrioritizedActionSchema = z.object({
  id: z.string(),
  why: z.string(),
  confidence: z.number().min(0).max(1),
});

export const OperatorPrioritizationSchema = z.object({
  headline: z.string(),
  narrative: z.string(),
  prioritized: z.array(PrioritizedActionSchema),
});

// ---------------------------------------------------------------------------
// Connections / provider truth
// ---------------------------------------------------------------------------

export const ProviderHealthSchema = z.enum([
  "CONNECTED",
  "NOT_CONFIGURED",
  "STALE",
  "ERROR",
  "MOCK",
]);

export const ConnectionStatusSchema = z.object({
  key: z.string(),
  name: z.string(),
  health: ProviderHealthSchema,
  detail: z.string().nullable(),
  lastSuccessAt: z.coerce.date().nullable(),
  configRequirements: z.array(z.string()),
  testable: z.boolean(),
});

export const OperatorStatusSchema = z.object({
  generatedAt: z.coerce.date(),
  connections: z.array(ConnectionStatusSchema),
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const OperatorAnalyticsSchema = z.object({
  generatedAt: z.coerce.date(),
  commerce: z
    .object({
      status: SectionStatusSchema,
      currencyCode: z.string().nullable(),
      periodDays: z.number().nullable(),
      revenue: z.number().nullable(),
      orderCount: z.number().nullable(),
      aov: z.number().nullable(),
      repeatRate: z.number().nullable(),
      topProducts: z.array(
        z.object({
          productTitle: z.string(),
          revenue: z.number(),
          units: z.number(),
        }),
      ),
    })
    .nullable(),
  content: z.object({
    generated: z.number(),
    approved: z.number(),
    rejected: z.number(),
    awaitingReview: z.number(),
    scheduled: z.number(),
    published: z.number(),
    failed: z.number(),
  }),
  market: z.object({
    opportunitiesDetected: z.number(),
    searchOpportunitiesDetected: z.number(),
    briefsCreatedFromOpportunities: z.number(),
  }),
  revenueOptimization: z.object({
    currencyCode: z.string().nullable(),
    abandonedValueOpen: z.number(),
    recoveredLast30: z.number(),
    attributedRevenueLast30: z.number(),
    attributedProfitLast30: z.number(),
    incrementalEstimateLast30: z.number(),
    incentiveCostLast30: z.number(),
    recoveryRate: z.number().nullable(),
  }),
  publishing: z.object({
    succeeded: z.number(),
    failed: z.number(),
    unknown: z.number(),
  }),
  unavailable: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperatorIntent = z.infer<typeof OperatorIntentSchema>;
export type OperatorActionClass = z.infer<typeof OperatorActionClassSchema>;
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;
export type OperatorIntentProposal = z.infer<
  typeof OperatorIntentProposalSchema
>;
export type OperatorCommandStatus = z.infer<typeof OperatorCommandStatusSchema>;
export type OperatorCommandResult = z.infer<typeof OperatorCommandResultSchema>;
export type SuggestedActionCategory = z.infer<
  typeof SuggestedActionCategorySchema
>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type SectionStatus = z.infer<typeof SectionStatusSchema>;
export type TodaySales = z.infer<typeof TodaySalesSchema>;
export type TodayRevenue = z.infer<typeof TodayRevenueSchema>;
export type TodayMarket = z.infer<typeof TodayMarketSchema>;
export type TodayContent = z.infer<typeof TodayContentSchema>;
export type TodayCustomers = z.infer<typeof TodayCustomersSchema>;
export type CmoInterpretation = z.infer<typeof CmoInterpretationSchema>;
export type OperatorToday = z.infer<typeof OperatorTodaySchema>;
export type PrioritizedAction = z.infer<typeof PrioritizedActionSchema>;
export type OperatorPrioritization = z.infer<
  typeof OperatorPrioritizationSchema
>;
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>;
export type OperatorAnalytics = z.infer<typeof OperatorAnalyticsSchema>;
