import { z } from "zod";

// ---------------------------------------------------------------------------
// M9.6 — Website Intelligence contracts.
//
// Platform-neutral: a site is a URL plus a list of pages the owner cares
// about. Nothing here assumes Shopify or any other commerce platform.
// ---------------------------------------------------------------------------

export const WebsitePageTypeSchema = z.enum([
  "HOMEPAGE",
  "PRODUCT",
  "COLLECTION",
  "BLOG",
  "BLOG_POST",
  "CART",
  "CHECKOUT",
  "LANDING",
  "POLICY",
  "CONTACT",
  "OTHER",
]);
export type WebsitePageType = z.infer<typeof WebsitePageTypeSchema>;

export const WebsiteFindingCategorySchema = z.enum([
  "PERFORMANCE",
  "SEO",
  "ACCESSIBILITY",
  "BEST_PRACTICE",
  "CONVERSION",
  "CONTENT",
  "MOBILE",
  "TRUST",
  "PRODUCT_PAGE",
  "CHECKOUT",
  "TECHNICAL",
]);
export type WebsiteFindingCategory = z.infer<
  typeof WebsiteFindingCategorySchema
>;

export const WebsiteSeveritySchema = z.enum([
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);
export type WebsiteSeverity = z.infer<typeof WebsiteSeveritySchema>;

export const WebsiteFindingSourceSchema = z.enum([
  "LIGHTHOUSE",
  "CRAWLER",
  "BROWSER",
  "AI_REVIEW",
]);
export type WebsiteFindingSource = z.infer<typeof WebsiteFindingSourceSchema>;

/**
 * The A3 invariant, encoded in the type system.
 *
 * FACT           — measured by a deterministic tool (Lighthouse, crawler).
 * INTERPRETATION — a model's reading of facts. Never a metric.
 */
export const EvidenceClassSchema = z.enum(["FACT", "INTERPRETATION"]);
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

export const WebsiteFindingStatusSchema = z.enum([
  "OPEN",
  "RESOLVED",
  "IGNORED",
]);
export type WebsiteFindingStatus = z.infer<typeof WebsiteFindingStatusSchema>;

// --- Settings --------------------------------------------------------------

export const WebsiteAuditUrlSchema = z.object({
  url: z.string().url(),
  pageType: WebsitePageTypeSchema.default("OTHER"),
  label: z.string().max(120).optional(),
});
export type WebsiteAuditUrl = z.infer<typeof WebsiteAuditUrlSchema>;

export const WebsiteSettingsSchema = z.object({
  websiteUrl: z.string().url().nullable(),
  auditUrls: z.array(WebsiteAuditUrlSchema).max(50),
  enabledCategories: z.array(WebsiteFindingCategorySchema).min(1),
  cadence: z.enum(["MANUAL", "DAILY", "WEEKLY"]),
  maxPages: z.number().int().min(1).max(50),
  formFactor: z.enum(["MOBILE", "DESKTOP"]),
  croReviewEnabled: z.boolean(),
  auditTimeoutMs: z.number().int().min(10_000).max(600_000),
});
export type WebsiteSettings = z.infer<typeof WebsiteSettingsSchema>;

export const WebsiteSettingsPatchSchema = WebsiteSettingsSchema.partial();

// --- Normalized Lighthouse output ------------------------------------------

/** Category scores, 0-100. Null means the category could not be measured. */
export const WebsiteScoresSchema = z.object({
  performance: z.number().min(0).max(100).nullable(),
  accessibility: z.number().min(0).max(100).nullable(),
  seo: z.number().min(0).max(100).nullable(),
  bestPractices: z.number().min(0).max(100).nullable(),
});
export type WebsiteScores = z.infer<typeof WebsiteScoresSchema>;

/** Deterministic metrics extracted from a Lighthouse report. */
export const WebsiteMetricsSchema = z.object({
  lcpMs: z.number().nullable().optional(),
  fcpMs: z.number().nullable().optional(),
  clsScore: z.number().nullable().optional(),
  tbtMs: z.number().nullable().optional(),
  siMs: z.number().nullable().optional(),
  ttiMs: z.number().nullable().optional(),
  totalByteWeight: z.number().nullable().optional(),
  unusedJsBytes: z.number().nullable().optional(),
  unusedCssBytes: z.number().nullable().optional(),
  renderBlockingMs: z.number().nullable().optional(),
  imageOptimizationBytes: z.number().nullable().optional(),
  accessibilityViolations: z.number().nullable().optional(),
});
export type WebsiteMetrics = z.infer<typeof WebsiteMetricsSchema>;

/**
 * A single normalized finding. This is the ONLY website shape the LLM ever
 * sees — raw Lighthouse JSON is never forwarded.
 */
export const WebsiteFindingSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  ruleKey: z.string(),
  pageUrl: z.string(),
  pageType: WebsitePageTypeSchema,
  category: WebsiteFindingCategorySchema,
  severity: WebsiteSeveritySchema,
  title: z.string(),
  description: z.string(),
  evidence: z.record(z.unknown()).nullable().optional(),
  metricName: z.string().nullable().optional(),
  metricValue: z.number().nullable().optional(),
  metricUnit: z.string().nullable().optional(),
  source: WebsiteFindingSourceSchema,
  evidenceClass: EvidenceClassSchema,
  status: WebsiteFindingStatusSchema,
  detectedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().optional(),
  suggestedFix: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});
export type WebsiteFinding = z.infer<typeof WebsiteFindingSchema>;

// --- Bounded CMO context ---------------------------------------------------

/**
 * Bounded website context handed to the CMO. Deliberately small: counts,
 * scores, and a handful of top findings — never the full finding table and
 * never a raw report.
 */
export const WebsiteContextSchema = z.object({
  // AVAILABLE | STALE | NOT_CONFIGURED | UNAVAILABLE
  evidenceStatus: z.enum([
    "AVAILABLE",
    "STALE",
    "NOT_CONFIGURED",
    "UNAVAILABLE",
  ]),
  websiteUrl: z.string().nullable(),
  lastAuditAt: z.coerce.date().nullable(),
  pagesAudited: z.number().int(),
  scores: WebsiteScoresSchema,
  openCritical: z.number().int(),
  openHigh: z.number().int(),
  openMedium: z.number().int(),
  openTotal: z.number().int(),
  /** Measured findings only. evidenceClass is always FACT here. */
  topFindings: z
    .array(
      z.object({
        pageUrl: z.string(),
        pageType: WebsitePageTypeSchema,
        category: WebsiteFindingCategorySchema,
        severity: WebsiteSeveritySchema,
        title: z.string(),
        evidenceSummary: z.string(),
        metricName: z.string().nullable(),
        metricValue: z.number().nullable(),
        metricUnit: z.string().nullable(),
      }),
    )
    .max(10),
  /** AI interpretations, kept separate so the model cannot confuse the two. */
  croObservations: z
    .array(
      z.object({
        pageUrl: z.string(),
        category: WebsiteFindingCategorySchema,
        severity: WebsiteSeveritySchema,
        title: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10),
  /** Deterministic metric deltas vs the previous audit. */
  regressions: z
    .array(
      z.object({
        pageUrl: z.string(),
        metricName: z.string(),
        previousValue: z.number(),
        currentValue: z.number(),
        direction: z.enum(["IMPROVED", "REGRESSED"]),
      }),
    )
    .max(10),
  failureReason: z.string().nullable().optional(),
});
export type WebsiteContext = z.infer<typeof WebsiteContextSchema>;

// --- Brain analysis contract -----------------------------------------------

/**
 * What the brain is allowed to return for a website analysis.
 *
 * The model may NOT return metrics: it receives facts and returns only
 * interpretation + proposed fix. `findingFingerprints` must reference findings
 * that were supplied in the request, which the backend re-validates.
 */
export const WebsiteAnalysisItemSchema = z.object({
  findingFingerprints: z.array(z.string()).min(1).max(10),
  title: z.string().min(1).max(200),
  interpretation: z.string().min(1).max(2000),
  proposedFix: z.string().min(1).max(2000),
  category: WebsiteFindingCategorySchema,
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  confidence: z.number().min(0).max(1),
});
export type WebsiteAnalysisItem = z.infer<typeof WebsiteAnalysisItemSchema>;

export const WebsiteAnalysisResultSchema = z.object({
  recommendations: z.array(WebsiteAnalysisItemSchema).max(10),
  modelId: z.string(),
});
export type WebsiteAnalysisResult = z.infer<typeof WebsiteAnalysisResultSchema>;

/** Bounded CRO review output — always INTERPRETATION, never a metric. */
export const CroObservationSchema = z.object({
  pageUrl: z.string(),
  category: WebsiteFindingCategorySchema,
  severity: WebsiteSeveritySchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1500),
  suggestedFix: z.string().max(1500).optional(),
  confidence: z.number().min(0).max(1),
  /** Quoted page text the observation is grounded in. Untrusted input. */
  observedEvidence: z.string().max(600).optional(),
});
export type CroObservation = z.infer<typeof CroObservationSchema>;

export const CroReviewResultSchema = z.object({
  observations: z.array(CroObservationSchema).max(12),
  modelId: z.string(),
});
export type CroReviewResult = z.infer<typeof CroReviewResultSchema>;
