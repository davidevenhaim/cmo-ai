# Milestones

## M0 — Foundation (done)

- Monorepo: `apps/{admin,backend,brain}`, `packages/contracts`, Turbo + npm workspaces.
- Docker Compose: postgres, backend, brain, admin with healthchecks and service dependencies.
- Shared contracts (`@ai-cmo/contracts`): Zod schemas for Brand, BrandFact, BrandGuideline, BrandSource, Product, BrandContext, CmoDecision discriminated union, CmoRunResult.
- `.env.example`, `.gitignore`, root `CLAUDE.md`.

## M1 — Brand Brain / NestJS (done)

- Prisma schema: Brand, BrandFact, BrandGuideline, BrandSource, Product, CmoRun.
- Idempotent seed: Luminesce skincare brand (6 facts, 4 guidelines, 1 source, 3 products).
- Modules: HealthModule, BrandModule, BrainModule, CmoModule.
- Two-layer validation: Zod in BrainAdapter + CmoService before every Postgres write.
- Failed brain calls persisted as CmoRun rows with `failed: true`.
- Adapter stubs: SocialAdapter, ShopifyAdapter, NotificationAdapter.

## M2 — CMO Brain / Python (done)

- FastAPI: `GET /health`, `POST /brain/run`.
- Pydantic schemas mirroring shared contracts.
- ClaudeAdapter wrapping `anthropic.Anthropic`, model pinned to `claude-sonnet-4-6`.
- CmoService: builds structured prompt from BrandContext, calls Claude, strips fences, parses JSON, validates Pydantic, returns CmoRunResult.
- System prompt instructs Claude to output JSON only, cite evidenceRefs, assign confidence.

## M2 — Admin UI (done, same milestone scope)

- Next.js 14 App Router SSR page fetching `/brand` and `/cmo/runs`.
- Brand summary, last 20 CMO runs with decision type, rationale, confidence, model, trigger, duration, failure flag.
- Graceful degradation when backend unreachable.

## M3 — Foundation fixes + Telegram CMO (done)

### Foundation fixes

- **Request validation**: `ValidationPipe` (whitelist, forbidNonWhitelisted, transform) added globally in `main.ts`. `UpdateBrandDto` and `AddFactDto` with class-validator decorators replace raw body types in BrandController.
- **Docker seed fix**: `docker-entrypoint.sh` runs `prisma db push --accept-data-loss` + `prisma db seed` before starting the process. Dockerfile updated to use the entrypoint. Schema always synced on container start in dev.
- **`BrandContext.hint`**: Optional string field added to contracts + Python schema. Brain prompt builder appends it as "Additional context from user" when present.

### Schema additions

- **Approval**: Generic approval model — type (CONTENT/CAMPAIGN/REPLY/SHOPIFY_ACTION/GENERAL), subject, description, status (PENDING/APPROVED/REJECTED), resolvedAt, resolvedBy, metadata (JSON), linked to Brand and optionally CmoRun.
- **TelegramMessage**: Every inbound and outbound Telegram message — chatId, direction, text, telegramMsgId, approvalId (FK), delivered, deliveredAt, failureReason.

### ApprovalModule

- `ApprovalService`: create, list, listPending, getById, resolve (idempotent guard on already-resolved).
- `ApprovalController`: `GET /approvals`, `GET /approvals?status=PENDING`, `GET /approvals/:id`, `PATCH /approvals/:id/resolve`.

### CmoService refactor

- `triggerRun(triggeredBy, hint?)` replaces the dev-only method. `triggerDevRun()` is now a thin alias.
- Returns `{ run, approval? }` — approval is created automatically when `decisionType === REQUEST_APPROVAL`.
- CmoModule now exports CmoService for use by TelegramModule.

### TelegramModule

- **TelegramService**: wraps Telegram Bot API via HttpService. Every outbound send is persisted as `TelegramMessage` (delivered: false) before the HTTP call; updated to delivered/failed after. `retrySend(messageId)` re-delivers failed messages.
- **TelegramController**:
  - `POST /telegram/webhook` — validates `X-Telegram-Bot-Api-Secret-Token`, drops unauthorized chat IDs, routes messages.
  - `POST /telegram/dev/simulate` — bypasses secret + access checks for local dev without ngrok.
  - `POST /telegram/webhook/setup` — calls Telegram `setWebhook` API.
  - `GET /telegram/webhook/status` — returns current webhook info from Telegram.
  - `GET /telegram/status` — bot configured flag, allowed chat count, last delivered timestamp.
  - `POST /telegram/messages/:id/retry` — re-delivers a failed outbound message.
- **TelegramCommandService**:
  - `/today` — triggers CMO run (triggeredBy: "telegram"), sends formatted decision or approval request.
  - `/status` — brand summary (facts/guidelines/products counts), last run, pending approvals count.
  - `/runs` — last 5 CMO runs formatted with type, confidence, rationale preview, timestamp.
  - Natural language (non-command text) — triggers CMO run with user text as `hint`.
  - `handleCallbackQuery` — parses `approval:{id}:APPROVED|REJECTED` callback data, calls `ApprovalService.resolve`, answers callback, sends confirmation.
  - Inline approval buttons sent when `REQUEST_APPROVAL` decision returned.
- **TelegramBriefService**: registers a cron job on `TELEGRAM_BRIEF_CRON` (default `0 9 * * *`) via `SchedulerRegistry`. On fire: triggers CMO run (`triggeredBy: "schedule"`), sends formatted brief to all allowed chat IDs. Disabled gracefully when `TELEGRAM_BOT_TOKEN` not set.
- **Access control**: `TELEGRAM_ALLOWED_CHAT_IDS` env var (comma-separated). Unauthorized updates silently dropped.

### Admin UI updates

- Telegram status card: configured flag, allowed chat count, last delivered timestamp.
- Pending approvals card: visible when approvals are PENDING.
- CMO run cards now show `triggeredBy` source (telegram, schedule, dev).

### Tests

31 backend unit tests passing (all mocked, no live DB or Telegram required):

| Suite                         | Tests                                            |
| ----------------------------- | ------------------------------------------------ |
| health.controller.spec        | 1                                                |
| brand.controller.spec         | 2                                                |
| brand.service.spec            | 3                                                |
| brain.adapter.spec            | 2                                                |
| cmo.service.spec              | 5                                                |
| approval.service.spec         | 4                                                |
| telegram.service.spec         | 4                                                |
| telegram-command.service.spec | 7                                                |
| **Total**                     | **28** (+ 3 carried from M2 Python = **31 + 8**) |

8 Python brain tests passing.

### New env vars (all optional for basic operation)

| Var                         | Default     | Purpose                                                         |
| --------------------------- | ----------- | --------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | —           | Bot token from @BotFather. Bot disabled if absent.              |
| `TELEGRAM_ALLOWED_CHAT_IDS` | —           | Comma-separated allowed chat IDs. Empty = allow all (dev only). |
| `TELEGRAM_WEBHOOK_SECRET`   | —           | Secret for webhook signature validation.                        |
| `TELEGRAM_BRIEF_CRON`       | `0 9 * * *` | Cron for daily brief.                                           |

### Local dev without a real bot

```bash
# Simulate a /today command
curl -X POST http://localhost:3001/telegram/dev/simulate \
  -H 'Content-Type: application/json' \
  -d '{"update_id":1,"message":{"message_id":1,"chat":{"id":12345,"type":"private"},"text":"/today"}}'

# Simulate natural language
curl -X POST http://localhost:3001/telegram/dev/simulate \
  -H 'Content-Type: application/json' \
  -d '{"update_id":2,"message":{"message_id":2,"chat":{"id":12345,"type":"private"},"text":"What should we focus on for summer?"}}'

# Simulate approval button press
curl -X POST http://localhost:3001/telegram/dev/simulate \
  -H 'Content-Type: application/json' \
  -d '{"update_id":3,"callback_query":{"id":"cq1","from":{"id":12345},"message":{"chat":{"id":12345}},"data":"approval:APPROVAL_ID:APPROVED"}}'
```

## M4 — Shopify read integration (done)

### Telegram hardening (pre-requisite fixes)

- **Startup guard**: `main.ts` exits with error if `TELEGRAM_BOT_TOKEN` is set and `TELEGRAM_ALLOWED_CHAT_IDS` is empty in non-development environments.
- **Dev simulate guard**: `POST /telegram/dev/simulate` throws `ForbiddenException` outside `NODE_ENV=development`.

### Contracts

- `packages/contracts/src/commerce.ts` — new file with Zod schemas and TypeScript types: `CommerceVariant`, `CommerceProduct`, `InventorySnapshot`, `CommerceOrderLineItem`, `CommerceOrder`, `CommerceCustomerSummary`, `RevenueByProduct`, `CommerceMetrics`, `CommerceContext`.
- `BrandContextSchema` extended with `commerceContext: CommerceContextSchema.optional()`.
- `packages/contracts/src/index.ts` exports the new commerce module.

### Shopify module (NestJS)

- **`ShopifyGraphqlAdapter`**: Calls Shopify Admin GraphQL API with two static queries (products + orders). No LLM-generated queries, no mutations. Configurable via `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`, `SHOPIFY_REQUEST_TIMEOUT_MS`.
- **`ShopifyNormalizer`**: Pure functions `normalizeProduct`, `normalizeOrder`, `computeMetrics`. No side effects — deterministic metrics computed in NestJS, not Python.
- **`ShopifyService`**: Orchestrates fetch → normalize → persist. Returns `CommerceContext` with `available/stale/failureReason` states. On failure falls back to latest `CommerceSnapshot` with `stale: true`. Configurable via `SHOPIFY_DEFAULT_PERIOD_DAYS` (default 30) and `SHOPIFY_LOW_STOCK_THRESHOLD` (default 5).
- **`ShopifyController`**: `GET /shopify/status`, `GET /shopify/snapshot`, `POST /shopify/refresh`.

### CmoService integration

- `CmoService.triggerRun` calls `ShopifyService.getCommerceContext()` and attaches result to `BrandContext.commerceContext`. If Shopify call fails, run continues with `commerceContext: undefined` (graceful degradation).

### Python brain

- `apps/brain/app/schemas/commerce.py` — Pydantic models mirroring TypeScript commerce contracts.
- `BrandContext` extended with `commerceContext: Optional[CommerceContext] = None`.
- `_build_user_message` extended: includes revenue, orders, AOV, top products, low inventory, and period-over-period comparison when `commerceContext.available === true`.

### Telegram commands

- `/shopify` — shop status: name, revenue, AOV, low stock alert list.
- `/sales` — sales detail: full metrics with top products by revenue, customer repeat rate, period-over-period delta.
- Unknown command message updated to list all available commands.

### Admin UI

- Shopify status card: shop name, connected/unavailable, last fetch timestamp, revenue, order count.

### Database

- `CommerceSnapshot` model: `brandId`, `snapshotAt`, `available`, `shopName`, `metricsJson`, `topProductsJson`, `failureReason`. Used as stale-read fallback when Shopify API is unreachable.
- `Brand.commerceSnapshots` relation added.

### Tests (57 NestJS + 8 Python, all pass)

| Suite                                   | Tests                    |
| --------------------------------------- | ------------------------ |
| shopify-normalizer.spec                 | 10                       |
| shopify-graphql.adapter.spec            | 4                        |
| shopify.service.spec                    | 5                        |
| cmo.service.spec (updated)              | 6                        |
| telegram-command.service.spec (updated) | 9                        |
| All prior suites                        | 23                       |
| **Total**                               | **57 NestJS + 8 Python** |

### New env vars

| Var                           | Default   | Purpose                       |
| ----------------------------- | --------- | ----------------------------- |
| `SHOPIFY_SHOP_DOMAIN`         | —         | `your-store.myshopify.com`    |
| `SHOPIFY_ACCESS_TOKEN`        | —         | Admin API token (`shpat_...`) |
| `SHOPIFY_API_VERSION`         | `2024-10` | Shopify API version           |
| `SHOPIFY_DEFAULT_PERIOD_DAYS` | `30`      | Metrics window in days        |
| `SHOPIFY_LOW_STOCK_THRESHOLD` | `5`       | Units at/below = low stock    |
| `SHOPIFY_REQUEST_TIMEOUT_MS`  | `10000`   | HTTP timeout                  |

## M5 — Research integration (done)

### Research module (NestJS)

- **`ResearchService`**: runs external research pipeline (Brave Search + Firecrawl). Persists `ResearchFinding` records (content, source, confidence, category). `triggerRun()` returns `{ findingsCreated, findingsUpdated, opportunitiesCreated, status }`.
- **`OpportunityService`**: manages `Opportunity` records derived from findings. `list(brandId, { status, minRelevance })` returns filtered opportunities sorted by relevance × urgency score.

### Telegram commands

- `/research` — fire-and-forget: sends immediate acknowledgement, runs research in background, sends completion/error message when done.
- `/opportunities` — lists NEW opportunities with type, relevance score, urgency score, and reason. Prompts `/research` when none exist.

### Tests (NestJS added, all mocked)

| Suite                                   | Coverage                                           |
| --------------------------------------- | -------------------------------------------------- |
| telegram-command.service.spec (updated) | handleResearch + handleOpportunities (5 new tests) |

## M5.5 — Foundation Hardening Gate (done)

All items required before M6. No new user-visible features — correctness, reliability, security.

### 1. Shared contracts — real JS build output

- `packages/contracts/tsconfig.build.json` added — emits to `./dist/` with declarations.
- `packages/contracts/package.json`: `"main"` and `"types"` now point to `./dist/index.js` / `./dist/index.d.ts` (was TypeScript source, broken at Docker runtime).
- Build script changed from `tsc --noEmit` to `tsc -p tsconfig.build.json`; typecheck-only script kept as `"typecheck"`.

### 2. Docker startup

- **Brain**: `curl` installed in Dockerfile (`apt-get install -y curl`) — required for compose healthcheck.
- **Backend Docker context**: changed from `./apps/backend` to monorepo root `./` so `npm install` creates workspace symlinks and `packages/contracts/dist` is accessible at runtime.
- **Admin SSR**: `BACKEND_URL: http://backend:3001` added to compose environment so Next.js server components resolve backend inside Docker network.

### 3. CommerceEvidenceStatus enum

Replaced `available: boolean + stale: boolean` with `evidenceStatus: "AVAILABLE" | "STALE" | "UNAVAILABLE"` throughout:

- Contracts: `CommerceEvidenceStatusSchema = z.enum(["AVAILABLE", "STALE", "UNAVAILABLE"])` in `packages/contracts/src/commerce.ts`.
- NestJS `ShopifyService` returns explicit enum value.
- Python brain schema updated (`Literal["AVAILABLE", "STALE", "UNAVAILABLE"]`).
- Telegram commands (`/shopify`, `/sales`) branch on `evidenceStatus`.
- Brain prompt branches on `evidenceStatus` — `"STALE"` data flagged explicitly so Claude doesn't present cached numbers as current performance.

### 4. Shopify cursor pagination + bounded queries

- `ShopifyGraphqlAdapter.fetchProducts` and `fetchOrders` now use full cursor pagination (10-page cap = 2500 items max).
- `fetchOrders(sinceDate, untilDate)` takes two bounds — uses `created_at:>=${since} AND created_at:<${until}` in the GraphQL filter.
- Previous-period orders are fetched with their own bounded call (`fetchOrders(previousStart, periodStart)`) rather than filtering a single over-fetched result.
- `FetchResult<T>` shape: `{ items: T[], truncated: boolean }` — `truncated: true` when cap hit.
- `fetchCurrencyCode()` added.

### 5. Shopify metric correctness

- `normalizeOrder` returns `null` for: cancelled (`cancelledAt !== null`), test (`test === true`), voided (`financialStatus === "voided"`), fully refunded (`financialStatus === "refunded"`).
- Partial refunds subtracted: `totalPrice = gross − totalRefundedSet.shopMoney.amount`.
- Repeat customer count: `new Set(orders.filter(isRepeat && email).map(email)).size` — unique emails, not order count.
- `repeatRate = Math.min(1.0, repeatCustomers / totalCustomers)` — capped.
- `currencyCode` carried from Shopify `fetchCurrencyCode()` through metrics.
- `metricsIncomplete: true` when either products or orders result was `truncated`.

### 6. Atomic approval resolution

`ApprovalService.resolve()` uses `updateMany({ where: { id, status: "PENDING" } })`:

- If `count === 0`: approval was already resolved — returns existing record (idempotent, no error).
- Race-safe: two concurrent callers cannot double-resolve.

### 7. Telegram webhook hardening

- `main.ts` startup guard: exits if `TELEGRAM_BOT_TOKEN` is set and `TELEGRAM_WEBHOOK_SECRET` is empty in non-development environments.
- `POST /telegram/webhook/setup` throws `ForbiddenException` outside `NODE_ENV=development` (was unprotected).

### 8. Telegram update deduplication

- `ProcessedTelegramUpdate` Prisma model: `updateId Int @id` — unique constraint.
- Controller tries `processedTelegramUpdate.create` before routing any update. Catches Prisma `P2002` (unique violation) → returns `{ ok: true }` without processing (idempotent replay safe).

### 9. Timeouts

| Layer        | Timeout        | Config                       |
| ------------ | -------------- | ---------------------------- |
| Claude API   | 60 s           | Hardcoded in ClaudeAdapter   |
| Brain HTTP   | 30 s (default) | `BRAIN_TIMEOUT_MS` env var   |
| Telegram API | 10 s           | Hardcoded in TelegramService |

### 10. Decision type consistency

- **Zod** (`CmoRunResultSchema`): `.superRefine()` rejects if `decisionType !== decisionPayload.type`.
- **Pydantic** (`CmoRunResult`): `@model_validator(mode="after")` raises `ValueError` on same mismatch.
- Both layers catch drift between the discriminant field and the payload's own `type` tag.

### 11. Approvals remain non-executing

Invariant enforced: `ApprovalService.resolve()` only updates the `Approval` record status. No side effects, no content generation, no downstream actions triggered. Approvals are a decision surface, not an execution surface.

### 12. Brand Brain context quality

- `BrandService.getFullProfile()` filters products: `products: { where: { active: true } }` — inactive products excluded from brain context.
- Brain prompt for BrandFacts includes `confidence` and `sourceId` (provenance): `[fact-id] (category, confidence=0.92, source=src-001): ...`.
- Brain prompt for BrandGuidelines includes `example` field when present.
- Brain prompt for commerce: `"STALE"` data section explicitly warns Claude not to represent cached numbers as current performance.

### 13. Failed-run Telegram messaging

`handleToday` and `handleNaturalLanguage` check `run.failed === true` before any decision routing:

- If failed: sends "❌ CMO run failed — {failureReason}" and returns.
- Failed runs with `decisionType: "NO_ACTION"` are NOT rendered as a "No Action" decision — the failure message takes priority.

### 14. M5 regression protection

All 160 NestJS tests + 8 Python tests pass after all changes. 35 new tests added.

### Test coverage added (M5.5)

| Suite                         | New tests | Coverage area                                                                                        |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| shopify-normalizer.spec       | +7        | null returns, refund subtraction, repeat uniqueness, repeatRate cap, currencyCode, metricsIncomplete |
| shopify-graphql.adapter.spec  | +7        | cursor pagination, FetchResult shape, placeholder detection, bounded dates, fetchCurrencyCode        |
| shopify.service.spec          | +3        | evidenceStatus enum, bounded date ranges, metricsIncomplete                                          |
| approval.service.spec         | +3        | atomic updateMany, idempotent already-resolved                                                       |
| telegram-command.service.spec | +7        | failed run messaging, evidenceStatus, stale labels                                                   |
| telegram.controller.spec      | +8        | dedup, webhook/setup dev-only, callback validation, routing                                          |
| **Total new**                 | **+35**   |                                                                                                      |

### New env vars

| Var                | Default | Purpose                                          |
| ------------------ | ------- | ------------------------------------------------ |
| `BRAIN_TIMEOUT_MS` | `30000` | HTTP timeout for calls to the Python brain (ms). |

`TELEGRAM_WEBHOOK_SECRET` was already documented; it is now enforced as a startup requirement in non-development environments when `TELEGRAM_BOT_TOKEN` is set.

## Deferred to M6+

- **Content generation pipeline**: `CREATE_CONTENT` decisions are proposals only. No ContentDraft model or Claude content generation call yet.
- **Social publishing**: SocialAdapter interface exists; no concrete impl.
- **Firecrawl / MCP integrations**: not started.
- **Email / Slack notifications**: NotificationAdapter stub only.
- **Auth**: admin UI and API have no access control.
- **Richer admin views**: fact/guideline editors, per-run detail pages, approval action buttons.
- **Shopify write operations**: read-only by design. No mutations planned.
- **Metrics / observability**: beyond CmoRun + TelegramMessage tables.
