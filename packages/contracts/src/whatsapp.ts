import { z } from "zod";

// ---------------------------------------------------------------------------
// M9.6 — WhatsApp Operations contracts (WAHA).
// ---------------------------------------------------------------------------

/** WAHA session lifecycle, mapped onto a stable internal vocabulary. */
export const WhatsAppSessionStatusSchema = z.enum([
  "NOT_CONFIGURED",
  "STOPPED",
  "STARTING",
  "SCAN_QR",
  "WORKING",
  "FAILED",
]);
export type WhatsAppSessionStatus = z.infer<
  typeof WhatsAppSessionStatusSchema
>;

/**
 * Connection state surfaced to the admin UI.
 *
 * Invariant 14: this shape carries no API key, no session secret, and no
 * webhook token — only the safe account identifier.
 */
export const WhatsAppConnectionSchema = z.object({
  status: WhatsAppSessionStatusSchema,
  configured: z.boolean(),
  sessionName: z.string(),
  meNumber: z.string().nullable(),
  meName: z.string().nullable(),
  lastSyncAt: z.coerce.date().nullable(),
  lastQrAt: z.coerce.date().nullable(),
  /** Sanitised — provider errors are scrubbed of credentials before storage. */
  lastError: z.string().nullable(),
});
export type WhatsAppConnection = z.infer<typeof WhatsAppConnectionSchema>;

export const WhatsAppQrSchema = z.object({
  /** data: URI. Null when the session is not in SCAN_QR. */
  qrDataUrl: z.string().nullable(),
  status: WhatsAppSessionStatusSchema,
  /** Set when the QR has aged past the WAHA refresh window. */
  expired: z.boolean(),
  retrievedAt: z.coerce.date().nullable(),
});
export type WhatsAppQr = z.infer<typeof WhatsAppQrSchema>;

// --- Messages --------------------------------------------------------------

export const WhatsAppMessageDirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);

/**
 * Invariant 13 — an owner's manual reply must always be distinguishable from
 * anything the system generated.
 */
export const WhatsAppMessageOriginSchema = z.enum([
  "INBOUND",
  "OWNER_MANUAL",
  "AUTOMATION",
  "BROADCAST",
]);
export type WhatsAppMessageOrigin = z.infer<
  typeof WhatsAppMessageOriginSchema
>;

export const WhatsAppDeliveryStateSchema = z.enum([
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "UNKNOWN",
]);

export const WhatsAppMessageSchema = z.object({
  id: z.string(),
  providerMessageId: z.string(),
  direction: WhatsAppMessageDirectionSchema,
  origin: WhatsAppMessageOriginSchema,
  body: z.string(),
  deliveryState: WhatsAppDeliveryStateSchema,
  timestamp: z.coerce.date(),
});
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;

export const WhatsAppConversationSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  contactId: z.string().nullable(),
  lastMessageAt: z.coerce.date().nullable(),
  lastMessagePreview: z.string().nullable(),
  unreadCount: z.number().int(),
});
export type WhatsAppConversation = z.infer<typeof WhatsAppConversationSchema>;

export const SendManualReplySchema = z.object({
  body: z.string().min(1).max(4096),
});

// --- Templates -------------------------------------------------------------

export const WhatsAppTemplateTypeSchema = z.enum([
  "ABANDONED_CART",
  "REPLENISHMENT",
  "WIN_BACK",
  "VIP",
  "BACK_IN_STOCK",
  "ORDER_FOLLOWUP",
  "REVIEW_REQUEST",
  "CUSTOM",
]);
export type WhatsAppTemplateType = z.infer<typeof WhatsAppTemplateTypeSchema>;

/**
 * The complete set of variables a template may reference. Anything else is a
 * validation error at write time — a broken template can never reach a send.
 */
export const ALLOWED_TEMPLATE_VARIABLES = [
  "first_name",
  "cart_value",
  "currency",
  "product_names",
  "recovery_url",
  "discount_code",
  "discount_pct",
] as const;

export type TemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];

export const TEMPLATE_VARIABLE_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

/** Extracts every {{variable}} reference in a template body. */
export function extractTemplateVariables(body: string): string[] {
  const found = new Set<string>();
  // Fresh regex per call — the shared literal is stateful with /g.
  const re = new RegExp(TEMPLATE_VARIABLE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]!.toLowerCase());
  return [...found];
}

export const WhatsAppTemplateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_-]+$/i, "key must be alphanumeric, dash or underscore"),
  type: WhatsAppTemplateTypeSchema,
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(4096),
  active: z.boolean().default(true),
});
export type WhatsAppTemplateInput = z.infer<typeof WhatsAppTemplateSchema>;

export const WhatsAppTemplatePatchSchema = WhatsAppTemplateSchema.partial();

// --- Broadcasts ------------------------------------------------------------

export const BroadcastStatusSchema = z.enum([
  "DRAFT",
  "DRY_RUN",
  "AWAITING_CONFIRMATION",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
]);
export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;

/**
 * Deterministic audience breakdown. Every contact in the segment lands in
 * exactly one bucket, and `expectedSends` equals `eligible`.
 */
export const BroadcastAudienceSchema = z.object({
  total: z.number().int(),
  eligible: z.number().int(),
  noConsent: z.number().int(),
  frequencyCapped: z.number().int(),
  invalidPhone: z.number().int(),
  suppressed: z.number().int(),
  expectedSends: z.number().int(),
});
export type BroadcastAudience = z.infer<typeof BroadcastAudienceSchema>;

export const CreateBroadcastSchema = z.object({
  name: z.string().min(1).max(160),
  segmentId: z.string().optional(),
  templateId: z.string().optional(),
  body: z.string().min(1).max(4096).optional(),
  scheduledAt: z.coerce.date().optional(),
});

// --- Automations -----------------------------------------------------------

export const AutomationTypeSchema = z.enum([
  "ABANDONED_CART",
  "REPLENISHMENT",
  "WIN_BACK",
  "VIP",
  "BACK_IN_STOCK",
  "POST_PURCHASE",
  "REVIEW_REQUEST",
]);
export type AutomationType = z.infer<typeof AutomationTypeSchema>;

/** New automations never default to LIVE (Part D). */
export const AutomationModeSchema = z.enum(["DISABLED", "DRY_RUN", "LIVE"]);
export type AutomationMode = z.infer<typeof AutomationModeSchema>;

export const AutomationPatchSchema = z.object({
  mode: AutomationModeSchema.optional(),
  templateId: z.string().nullable().optional(),
  timing: z.record(z.unknown()).optional(),
  audience: z.record(z.unknown()).optional(),
  offerPolicy: z.record(z.unknown()).optional(),
  frequencyCapRuleId: z.string().nullable().optional(),
});

// --- Bounded CMO context ---------------------------------------------------

/**
 * Aggregate-only. The CMO reasons about WhatsApp performance without ever
 * seeing a phone number or message body.
 */
export const WhatsAppContextSchema = z.object({
  evidenceStatus: z.enum([
    "AVAILABLE",
    "STALE",
    "NOT_CONFIGURED",
    "UNAVAILABLE",
  ]),
  connectionStatus: WhatsAppSessionStatusSchema,
  currencyCode: z.string(),
  abandonedCart: z.object({
    eligibleCarts: z.number().int(),
    messagesSent: z.number().int(),
    recovered: z.number().int(),
    attributedRevenue: z.number(),
    attributedProfit: z.number(),
    incentiveCost: z.number(),
  }),
  suppressed: z.object({
    noConsent: z.number().int(),
    frequencyCap: z.number().int(),
    purchasedBeforeSend: z.number().int(),
    invalidPhone: z.number().int(),
    inventoryUnavailable: z.number().int(),
    other: z.number().int(),
  }),
  /** Per-ladder-step economics, so the CMO can spot a weak discount step. */
  ladderSteps: z
    .array(
      z.object({
        stepNumber: z.number().int(),
        delayHours: z.number(),
        sent: z.number().int(),
        skipped: z.number().int(),
        offerType: z.string().nullable(),
      }),
    )
    .max(12),
  automations: z
    .array(
      z.object({
        type: AutomationTypeSchema,
        mode: AutomationModeSchema,
        successCount: z.number().int(),
        failureCount: z.number().int(),
        lastRunAt: z.coerce.date().nullable(),
      }),
    )
    .max(10),
  failureReason: z.string().nullable().optional(),
});
export type WhatsAppContext = z.infer<typeof WhatsAppContextSchema>;
