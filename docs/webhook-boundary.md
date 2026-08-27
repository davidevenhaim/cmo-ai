# Shopify Webhook Boundary

## Current state (M6.6)

All Shopify data arrives via polling: `GrowthSyncService.run()` calls
`ShopifyGraphqlAdapter` for customers and abandoned checkouts, then reconciles
with orders. The sync runs daily (cron) or on-demand via `POST /growth/sync`.

## Why webhooks matter

Polling introduces lag. An abandoned checkout recovered 30 minutes after
abandonment might still show ACTIVE in the local DB until the next daily sync.
Webhooks deliver state changes within seconds of the Shopify event.

## Recommended event subscriptions (future)

| Shopify topic                        | Local action                                                               | Priority |
| ------------------------------------ | -------------------------------------------------------------------------- | -------- |
| `orders/create`                      | Mark matching abandoned checkout RECOVERED; update contact's `lastOrderAt` | High     |
| `orders/updated`                     | Re-reconcile checkout status (e.g., refunds can un-recover)                | Medium   |
| `customers/update`                   | Update contact marketing consent; re-evaluate segment membership           | High     |
| `customers/marketing_consent/update` | Targeted consent patch without full customer sync                          | High     |
| `checkouts/create`                   | Early ingestion of new abandoned checkouts                                 | Medium   |
| `checkouts/update`                   | Keep checkout line items / value current before 1h abandonment window      | Medium   |
| `checkouts/delete`                   | Suppress checkout that converted via non-order path                        | Low      |

## Invariants that must hold regardless of delivery mechanism

1. **Marketing consent is fail-closed.** A webhook that cannot be parsed
   cleanly must not set consent to SUBSCRIBED. Default to NOT_SUBSCRIBED.
2. **Shopify is source of truth.** A webhook that contradicts local state wins.
   Local DB is a cache, not the record of authority.
3. **Idempotency required.** Shopify may re-deliver webhooks. All handlers
   must be safe to call twice with the same payload.
4. **No auto-send on recovered.** Recovering a checkout via webhook does not
   trigger email. Campaign approval flow is unchanged.

## Implementation notes (when building)

- Verify `X-Shopify-Hmac-SHA256` before processing any payload.
- Use a webhook registration step in setup/bootstrap, not hardcoded.
- Persist a `webhookEvents` log table for replay debugging.
- Polling sync remains as fallback/reconciliation — do not remove it.
