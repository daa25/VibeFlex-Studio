# VibeFlex Studio — Architecture

## What VibeFlex Studio is

VibeFlex Studio is **VibeFlex Sports' own product-creation and production-management
platform**, integrated with Shopify / LacedUp. It is not a Printful integration.
Printful is one optional fulfillment provider that Studio can send work to.

- **Shopify** is the storefront, checkout and commerce system of record.
- **VibeFlex Studio** is the production and product-intelligence / control system.

Studio owns the canonical lifecycle end to end:

```
Artwork → Product → Variant → Mockup → Pricing → Shopify Listing →
Order → Production Job → Fulfillment → Tracking
```

## Provider-neutral production

The production tail (Order → Production Job → Fulfillment → Tracking) is served by a
single provider-neutral interface, `ProductionProvider`
(`src/integrations/pod/production-types.ts`). Every provider — in-house or external —
implements exactly this interface, so routing and the rest of Studio never depend on a
vendor's API shape.

| Provider | Kind | File | Notes |
| --- | --- | --- | --- |
| `VibeFlexLocalProvider` | `local` | `providers/vibeflex-local-provider.ts` | First-class in-house line. No external dependency. |
| `PrintfulProductionProvider` | `external` | `providers/printful-production-provider.ts` | One optional external provider. Approval-gated. |
| *future* | `external` | — | Add a class implementing `ProductionProvider`; register it. |

`ProviderRegistry` (`provider-registry.ts`) tracks which providers exist and are usable.
`hasLocalCapability()` is the answer to "can Studio produce at all?" — it is true whenever
a local provider is registered, independent of any external vendor.

**Consequence:** Printful being unavailable no longer means "Studio isn't production
ready." It means `PrintfulProductionProvider` is not registered. Studio still produces
through `VibeFlexLocalProvider`.

## Routing: local-first, external gated

`routeProduction()` (`production-router.ts`) selects where an order is produced based on:

- **capability** — can the provider run the technique and ship to the destination, with a
  valid variant id?
- **capacity** — does the order fit within the provider's committed daily capacity?
- **cost / margin** — does the blended margin clear the policy floor (`minMarginPct`)?

Two invariants the router never breaks:

1. **VibeFlex owns the decision.** The in-house line is preferred whenever it is capable and
   within capacity (`preferLocal`, default true). External is a considered alternative, not
   the default.
2. **External is never an auto route.** When the chosen route is external, the decision
   carries `requiresApproval = true`.

## Approval gating for external, paid fulfillment

`ProductionProvider.submitProductionOrder(input, opts)` enforces the hard rule:

- **External, paid providers** (`externalPaidFulfillment: true`) MUST NOT bill an order
  without `opts.ownerApproved === true`. Without it they return a `PENDING_APPROVAL` job and
  send nothing to the vendor.
- **Local production** bills no outside party, so it queues directly. Live SHIPPED status
  and any customer-facing publication remain policy-gated upstream (see
  `src/lib/policy-gates.ts`), which continues to enforce `SHOPIFY ACTIVE = true` is
  impossible while `FULFILLMENT VERIFIED = false`.

No paid order is ever automatically submitted to Printful or any external provider.

## Order flow: a paid order becomes a routed production job

The Shopify `orders/create` webhook (`app/api/webhooks/shopify/orders-create/route.ts`)
is the live entry point. On a signature-verified order it now:

1. `buildFulfillmentPlan()` — maps the paid order's line items (artwork, geometry,
   supplier variant, technique, and the price the buyer paid) into a `FulfillmentPlan`.
2. `planProduction()` (`lib/fulfillment/production-planner.ts`) — converts the plan into a
   provider-neutral `ProductionOrderInput` and routes it via `routeProduction()`.
3. The routing decision (chosen provider, kind, `requiresApproval`, reason) is persisted
   with each order line and returned in the webhook response.

Providers come from `getProductionProviders()`
(`lib/fulfillment/production-runtime.ts`), which **always registers the in-house line** and
adds Printful only when a live client is supplied. So a real order routes to production even
with no external vendor configured.

This path **plans and routes only — it never submits.** In-house work queues on the local
provider; an external route is returned with `requiresApproval = true` and nothing is sent to
a paid vendor without explicit owner authorization (`FULFILLMENT_AUTO_SUBMIT` stays the
separate submission gate).

## Relationship to existing modules (preserved, not replaced)

- `integrations/pod/types.ts` — catalog / mockup adapter contracts. Still used for the
  Artwork → Mockup half of the lifecycle.
- `integrations/pod/printful/adapter.ts` — Printful catalog / mockup / sync-product client,
  including the `PrintfulPlatformError` guard for Shopify-platform stores.
- `lib/fulfillment/order-mapper.ts` — maps a paid Shopify order into fulfillment line items;
  feeds `ProductionOrderInput`.
- `lib/policy-gates.ts` — the publication / fulfillment gates. Unchanged and still
  authoritative for going live.
- Supabase storage (persistent artwork + production assets) and Shopify Admin (create /
  manage LacedUp products) are required for Studio itself, independent of any external
  fulfillment provider.

## Tests

- `tests/vibeflex-local-provider.test.ts` — the in-house line produces with no external
  dependency; idempotency; capability limits; floor-state transitions and tracking.
- `tests/production-router.test.ts` — local-first routing; external fallback with approval;
  capacity and margin gating; produces with only the local provider registered; external
  never auto-submits.
- `tests/production-planner.test.ts` — a paid Shopify order maps → routes to the in-house
  line; carries retail from the price paid; an order with blockers is not routed; produces
  with no external provider registered.
