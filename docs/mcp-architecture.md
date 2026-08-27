# MCP Architecture

## Data access layers

The Growth Engine uses three distinct channels to reach Shopify data.
Each has a defined role; they are not interchangeable.

### 1. Shopify Admin GraphQL API (primary, required)

Used by `ShopifyGraphqlAdapter` in the NestJS backend.

- Authenticated with a private app access token (`SHOPIFY_ACCESS_TOKEN`).
- All sync operations (customers, orders, abandoned checkouts) go through this adapter.
- Pagination capped at 10 pages / 2 500 items per collection; truncation is flagged.
- This is the **only** channel that writes to the local Postgres DB.

### 2. Shopify Webhooks (future, event delivery)

See `docs/webhook-boundary.md`.

Real-time delivery of order, customer, and checkout state changes. Will
supplement — not replace — the polling sync once implemented.

### 3. Shopify MCP (optional, exploratory only)

The Claude brain (`apps/brain`) may have access to a Shopify MCP server
through the Claude API's tool-use layer.

**Strict constraints:**

- The Growth Engine logic (segments, campaigns, replenishment, upsell) must
  **never** depend on Claude having MCP access. All required data must already
  be in Postgres by the time the brain is invoked.
- MCP is for **read-only exploration** by the CMO reasoning loop — e.g.,
  looking up a specific product or verifying a price before drafting copy.
- MCP calls must never mutate Shopify state (no draft order creation, no
  customer updates, no discount creation).
- If MCP is unavailable, the brain falls back to the Postgres snapshot.
  Unavailability is not an error.

## Dependency graph

```
Shopify Admin API ──► ShopifyGraphqlAdapter ──► GrowthSyncService ──► Postgres
                                                                           │
Shopify Webhooks (future) ──────────────────────────────────────────────► │
                                                                           ▼
                                                              Brain (FastAPI/Claude)
                                                                     ▲
Shopify MCP (optional) ──────────────────────────────────────────────┘
```

## Docker MCP Toolkit (optional development)

Docker MCP Toolkit / browser MCP tools may be used by developers for **exploration**
(e.g. inspecting a page while debugging). They are **not** the authoritative
research ingestion path.

Authoritative research path remains:

```
SEARCH / CRAWL → Nest adapter → normalize → sanitize → persist
  → bounded untrusted evidence → brain
```

Product correctness must never depend on an LLM deciding to call MCP tools.
If MCP/browser is integrated into runtime later, it must still go through a
Nest-owned adapter and the same persistence / trust boundaries.

## Why this separation matters

Claude must never be the gatekeeper for Shopify data. If the Claude API is
down, the sync must still run. If Claude hallucinates a customer count, the
real count in Postgres corrects it. The brain reasons about data; it does not
own data.
