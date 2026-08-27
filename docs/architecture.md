# Architecture

## Service map

```
                        +------------------+      +--------------------+
                        |  Telegram Bot API |      |  Shopify Admin API |
                        +--------+---------+      +--------+-----------+
                                 | webhook                  | GraphQL (read-only)
                                 | callback_query           v
+-----------------+     +--------+---------+      +--------------------+
|  admin (3000)   | --> |  backend (3001)   | -->  |   brain (8000)     |
|  Next.js 14     | <-- |  NestJS + Prisma  | <--  |  FastAPI + Claude  |
+-----------------+     +--------+---------+      +--------------------+
                                 |                          ^
                                 | Prisma (write only)      | Anthropic API
                                 v                          v
                        +--------+---------+      +--------------------+
                        |  postgres 5432   |      |  Anthropic Claude  |
                        +------------------+      +--------------------+
```

## Data flows

### Read path (admin → backend)

1. Admin server components fetch `/brand`, `/cmo/runs`, `/telegram/status`, `/approvals?status=PENDING`.
2. NestJS reads Postgres via Prisma, returns JSON.
3. Admin renders SSR HTML — no client-side JS for data fetching.

### CMO run trigger (backend → brain → backend)

1. Trigger arrives via `POST /dev/cmo/run`, `POST /telegram/webhook` (command or NL message), or the daily brief cron.
2. `CmoService.triggerRun(triggeredBy, hint?)` loads the full brand profile.
3. `BrainAdapter.callBrain(context)` posts context to `POST http://brain:8000/brain/run`.
4. Python brain calls Claude, parses JSON response, validates via Pydantic, returns `CmoRunResult`.
5. `BrainAdapter` validates the response with Zod (`CmoRunResultSchema`) before returning to NestJS.
6. `CmoService` re-validates with Zod, persists `CmoRun`.
7. If `decisionType === REQUEST_APPROVAL`, `CmoService` creates an `Approval` record linked to the run.
8. Caller (e.g. `TelegramCommandService`) sends formatted result to Telegram.

### Telegram inbound flow

1. User sends message to bot → Telegram posts update to `POST /telegram/webhook`.
2. Controller validates `X-Telegram-Bot-Api-Secret-Token` header.
3. Controller checks `chat.id` against `TELEGRAM_ALLOWED_CHAT_IDS`. Unauthorized updates are silently dropped.
4. Controller attempts `ProcessedTelegramUpdate.create(updateId)`. If Prisma raises P2002 (unique violation), the update has already been processed — returns `{ ok: true }` without further action (idempotent replay safety).
5. Inbound message is persisted as a `TelegramMessage` record (direction: "inbound").
6. Text is routed: `/today` → `handleToday`, `/status` → `handleStatus`, `/runs` → `handleRuns`, anything else → `handleNaturalLanguage`.
7. NL messages are passed as `hint` to `CmoService.triggerRun("telegram", hint)`.

### Approval flow

1. Brain returns `REQUEST_APPROVAL` decision → `CmoService` creates `Approval` (status: PENDING).
2. `TelegramCommandService` sends approval request message with inline `[✅ Approve] [❌ Reject]` buttons.
3. User taps a button → Telegram sends `callback_query` to webhook.
4. Controller routes to `handleCallbackQuery`.
5. `ApprovalService.resolve(id, status, "telegram")` updates Approval in Postgres.
6. Bot answers callback query and sends confirmation message.
7. All approval mutations happen in NestJS. Telegram is a UI surface only.

### Telegram outbound / observability

Every outbound message is persisted as `TelegramMessage` before the HTTP call:

- On success: `delivered: true`, `deliveredAt`, `telegramMsgId` filled in.
- On failure: `failureReason` set, `delivered: false`.
- Failed messages are retryable via `POST /telegram/messages/:id/retry`.

### Daily brief

`TelegramBriefService.onModuleInit()` registers a cron job using `@nestjs/schedule` with the expression from `TELEGRAM_BRIEF_CRON` (default `0 9 * * *`). On fire: triggers a CMO run tagged `triggeredBy: "schedule"`, formats the result, sends to all allowed chat IDs.

## Why NestJS is authoritative

- All Postgres writes go through Prisma inside NestJS. The brain has no DB credentials.
- The brain is stateless: it receives a `BrandContext` and returns a `CmoRunResult`. All persistence, approval management, and side effects sit on the NestJS side.
- Telegram bot logic lives entirely in NestJS — Telegram never talks to Python or directly to Postgres.

## LLM output validation (two layers + cross-field)

1. **Pydantic (Python)** — `CmoRunResult` uses a discriminated Union over decision types with confidence bounds validation. `@model_validator(mode="after")` rejects if `decisionType` does not match `decisionPayload.type`. Malformed LLM output raises before the brain returns 200.
2. **Zod (TypeScript)** — `CmoRunResultSchema` re-validates in `BrainAdapter.callBrain`. `.superRefine()` rejects if `decisionType !== decisionPayload.type`. Any schema drift is caught at the trust boundary.
3. `CmoService` calls `CmoRunResultSchema.parse()` once more before writing to Postgres. Redundant, deliberate.

## Shopify data flow

1. `CmoService.triggerRun` calls `ShopifyService.getCommerceContext()` before building the brain context.
2. `ShopifyService` calls `ShopifyGraphqlAdapter` (two static GraphQL queries: products + orders). Python never touches Shopify.
3. `ShopifyNormalizer` (pure functions) converts raw API responses to `CommerceProduct[]` and `CommerceOrder[]`.
4. `ShopifyService` calls `computeMetrics()` deterministically in NestJS — no LLM-generated queries.
5. A `CommerceSnapshot` row is persisted. If Shopify is down, the latest snapshot is returned with `evidenceStatus: "STALE"`.
6. `CommerceContext` is attached to `BrandContext.commerceContext` and sent to the brain.
7. Python brain includes commerce data in the prompt when `commerceContext.evidenceStatus === "AVAILABLE"`. Stale data is included with an explicit warning so Claude does not represent cached numbers as current performance.

### Shopify failure states

| State                                  | `evidenceStatus` | Source           |
| -------------------------------------- | ---------------- | ---------------- |
| Configured, fresh                      | `"AVAILABLE"`    | Live Shopify API |
| Configured, API error + prior snapshot | `"STALE"`        | DB snapshot      |
| Configured, API error + no snapshot    | `"UNAVAILABLE"`  | —                |
| Not configured / placeholder token     | `"UNAVAILABLE"`  | —                |

### Commerce metric definitions

- **Revenue**: sum of `(totalPrice − totalRefunded)` across non-cancelled, non-test, non-voided, non-fully-refunded orders in the period.
- **Repeat customers**: count of unique customer emails appearing in orders where `numberOfOrders > 1`. Counts unique customers, not order count.
- **Repeat rate**: `min(1.0, repeatCustomers / totalCustomers)` — capped to prevent >100% from data anomalies.
- **`metricsIncomplete: true`**: set when either products or orders hit the 2500-item pagination cap (10 pages × 250 per page). Signals that metrics are a lower bound, not the full picture.
- **Currency**: carried from Shopify `shop.currencyCode`, not inferred.

## Adapter pattern

External integrations live behind interfaces in `apps/backend/src/adapters/`:

| Interface             | Status     | Notes                                                    |
| --------------------- | ---------- | -------------------------------------------------------- |
| `SocialAdapter`       | Stub       | `NotImplementedSocialAdapter` throws                     |
| `ShopifyAdapter`      | Superseded | Replaced by `ShopifyGraphqlAdapter` in `shopify/` module |
| `NotificationAdapter` | Stub       | Replaced by `TelegramService` for Telegram channel       |

`TelegramService` and `ShopifyGraphqlAdapter` implement their integrations directly in dedicated modules rather than through the generic stub interfaces — the stubs were too coarse for the actual API surfaces.

## `hint` field

`BrandContext.hint?: string` carries additional context from the caller (a Telegram user's message, a schedule tag) into the brain prompt. The brain appends it as "Additional context from user" when present.

## `commerceContext` field

`BrandContext.commerceContext?: CommerceContext` carries normalized Shopify data into the brain prompt. The brain includes revenue, top products, low inventory, and customer summary when `evidenceStatus === "AVAILABLE"`. Stale data is included with a warning label. Computed deterministically in NestJS; Python never calls Shopify.

## Access control

Telegram access is controlled by `TELEGRAM_ALLOWED_CHAT_IDS` (comma-separated). Requests from unlisted chat IDs are silently dropped at the controller level — no error response is sent to avoid bot enumeration.

Development-only endpoints (`POST /telegram/dev/simulate`, `POST /telegram/webhook/setup`) throw `ForbiddenException` outside `NODE_ENV=development`.

Startup guards in `main.ts` (non-development only):

- If `TELEGRAM_BOT_TOKEN` is set and `TELEGRAM_ALLOWED_CHAT_IDS` is empty → process exits with error.
- If `TELEGRAM_BOT_TOKEN` is set and `TELEGRAM_WEBHOOK_SECRET` is empty → process exits with error.

## Environment configuration

All integrations degrade explicitly when unconfigured — nothing silently pretends to be live. Placeholder values from `.env.example` (e.g. `your-store.myshopify.com`, `shpat_...`) are detected and treated as not configured.

| Integration                | Env vars                                                                                                                                                                                                                                                                              | Behavior when absent                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shopify (read-only)        | `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`, `SHOPIFY_DEFAULT_PERIOD_DAYS`, `SHOPIFY_LOW_STOCK_THRESHOLD`, `SHOPIFY_REQUEST_TIMEOUT_MS`                                                                                                                      | Commerce context `UNAVAILABLE`; stale snapshot used as fallback where one exists                                                                           |
| Telegram                   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BRIEF_CRON`                                                                                                                                                                                   | Bot disabled; dev/simulate endpoint still works in development. Token without allow-list/secret in non-dev → startup fails                                 |
| WAHA (WhatsApp)            | `WAHA_BASE_URL`, `WAHA_SESSION`                                                                                                                                                                                                                                                       | Messaging provider reports not configured; recovery journey steps are skipped, never faked                                                                 |
| WordPress                  | `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APPLICATION_PASSWORD`                                                                                                                                                                                                          | Blog publishing unavailable; publish attempts fail with a configuration error                                                                              |
| Postiz (social)            | `POSTIZ_BASE_URL`, `POSTIZ_API_KEY`                                                                                                                                                                                                                                                   | Social publishing unavailable; publish attempts fail with a configuration error                                                                            |
| Google Search Console      | `GOOGLE_SEARCH_CONSOLE_SITE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`                                                                                                                                                                                                                       | Mock provider used; metrics persisted with `evidenceStatus=MOCK`, excluded from opportunity detection/scoring, reported as `NOT_CONFIGURED` in CMO context |
| Google Trends (SerpAPI)    | `SERPAPI_KEY`                                                                                                                                                                                                                                                                         | Same mock/`NOT_CONFIGURED` handling as Search Console                                                                                                      |
| Google Ads Keyword Planner | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`                                                                                                                                                | Same mock/`NOT_CONFIGURED` handling as Search Console                                                                                                      |
| Research                   | `BRAVE_SEARCH_API_KEY`, `FIRECRAWL_API_KEY`, `RESEARCH_REQUEST_TIMEOUT_MS`                                                                                                                                                                                                            | External research providers disabled                                                                                                                       |
| Revenue policy             | `REVENUE_MAX_DISCOUNT_PCT`, `REVENUE_MIN_MARGIN_PCT`, `REVENUE_MIN_ORDER_VALUE`, `REVENUE_MAX_DISCOUNTS_PER_JOURNEY`, `REVENUE_MIN_HOURS_BEFORE_DISCOUNT`, `REVENUE_RECOVERY_LADDER_HOURS`, `REVENUE_WIN_BACK_DAYS`, `REVENUE_VIP_LTV_THRESHOLD`, `REVENUE_FREE_SHIPPING_NEAR_FACTOR` | Defaults apply (see `.env.example`); safety caps always enforced in code                                                                                   |

## Growth vs Revenue ownership boundaries

`GrowthModule` (`src/growth`) and `RevenueOptimizationModule` (`src/revenue-optimization`) evolved in separate milestones and intentionally overlap in four areas. Structural consolidation is deferred to M9/M10; until then these ownership rules apply:

| Concern         | Growth owns                                                                                                           | Revenue owns                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Replenishment   | `growth/replenishment.service.ts` — email-campaign candidates from manual `ReplenishmentConfig` + `lastOrderAt` proxy | `revenue-optimization/replenishment.service.ts` — `RevenueOpportunity` (type REPLENISHMENT) creation from per-product purchase cycles |
| Attribution     | `ConversionAttribution` — email/campaign conversions (abandoned-checkout emails)                                      | `RevenueAttribution` — recovery/offer revenue with contribution profit and ATTRIBUTED vs INCREMENTAL_ESTIMATE honesty split           |
| Opportunities   | Campaign/segment targeting (segments, frequency caps, suppressions)                                                   | `RevenueOpportunity` lifecycle (NEW → IN_JOURNEY → RECOVERED/EXPIRED) and WhatsApp recovery journeys                                  |
| Recommendations | `ProductRecommendation` via `upsell.service.ts` (manual + commerce co-purchase)                                       | `ProductAffinity` via `product-affinity.service.ts` (order co-purchase scoring for offers/bundles)                                    |

Shared infrastructure lives in Growth and is reused by Revenue (never duplicated): `FrequencyCapService`, `ContactSuppression`, `CampaignTouch` (every Revenue WhatsApp send records a `SEND` touch so caps apply across both modules). Consent state (`Contact.smsMarketingStatus`) is enforced at the single WhatsApp send point in `recovery-journey.service.ts`.

Rule of thumb: contact-level email marketing = Growth; opportunity-level revenue recovery with offer economics = Revenue. New attribution or recommendation logic must extend the owning module's service rather than adding a third implementation.

## Not implemented (and why)

- **Social publishing** — needs OAuth per platform; scope explosion. Adapter interface only.
- **Email / Slack notifications** — `NotificationAdapter` stub exists; no concrete impl.
- **Content generation pipeline** — `CREATE_CONTENT` decisions are proposals only. No drafts created.
- **Research execution** — `START_RESEARCH` decisions are recorded but no fetch/scrape runs.
- **Redpanda / event bus** — single-brand tool; direct HTTP is sufficient.
- **LangGraph** — the CMO decision is one prompt in, one JSON out.
- **Multi-tenancy / billing** — internal tool; `BRAND_ID = "luminesce-brand-001"` is a constant.
- **Auth on admin / API** — internal network tool; deferred.
- **Shopify write operations** — read-only by design. No mutations, no LLM-generated GraphQL.
- **Webhook auto-setup** — call `POST /telegram/webhook/setup` with your public URL manually, or use ngrok locally.

## Database schema

| Table                   | Purpose                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Brand                   | Single row — brand identity, voice, audience                                                  |
| BrandFact               | Atomic factual claims with confidence + source provenance                                     |
| BrandGuideline          | Tone / visual / messaging rules                                                               |
| BrandSource             | Provenance for facts                                                                          |
| Product                 | Catalog with tags array; `active` flag gates inclusion in brain context                       |
| CmoRun                  | Every brain invocation — decision, rationale, evidence, model metadata, failure flag          |
| Approval                | Generic approval record — PENDING → APPROVED/REJECTED, linked to CmoRun, resolver recorded    |
| TelegramMessage         | Every inbound/outbound Telegram message — delivered flag, failure reason, Telegram message_id |
| CommerceSnapshot        | Shopify metrics snapshot — used as stale fallback when Shopify API is unreachable             |
| ProcessedTelegramUpdate | `updateId Int @id` — unique constraint used as idempotency signal for webhook deduplication   |
