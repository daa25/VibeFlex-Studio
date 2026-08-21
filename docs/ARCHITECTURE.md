# VibeFlex POD Studio — production architecture

## The one path that matters

```
Customer opens /studio
  → uploads artwork            POST /api/uploads
      · magic-byte validation (PNG/JPG/WebP only, ≤30MB, ≥400px)
      · stored in Supabase Storage (or local ephemeral fallback)
      · deterministic analysis (always) + OpenAI vision analysis (best effort)
  → picks product / colour / size          (src/lib/catalog.ts)
  → positions + scales artwork             (normalized print-area coordinates)
  → sees the preview                       (vector garment + live overlay)
  → price is computed                      (src/lib/pricing.ts, recomputed server-side)
  → approves                               POST /api/studio/designs  → VF-XXXXXX reference
  → staff publishes a Shopify DRAFT        POST /api/studio/publish
  → customer checks out                    POST /api/studio/cart  → Shopify checkout
  → Shopify order created
  → orders/create webhook                  POST /api/webhooks/shopify/orders-create
  → fulfillment plan built from the order's own line-item properties
  → Printful order payload (submission gated by FULFILLMENT_AUTO_SUBMIT)
```

## Why customization data lives on the order, not only in our database

Line-item properties are written at cart creation and Shopify keeps them on the
order forever. Fulfillment therefore needs **nothing** from our database:
artwork URL, print geometry in inches, placement, provider and the studio
reference all travel with the order. The database is the audit trail and the
staff dashboard, not a dependency of production.

Properties prefixed with `_` are hidden from the storefront UI but present in
Admin and the Orders API — that is where machine-readable values go.

| Where | What | Survives checkout |
|---|---|---|
| Line-item properties | artwork URL, geometry, provider, cost, reference | yes |
| Cart attributes | studio reference | yes |
| Product metafields (`vibeflex.*`) | artwork, geometry, provider ids, cost | yes (product-level) |
| Variant SKU | `VF-XXXXXX-PRODUCT-COLOR-SIZE` | yes |
| `studio_designs` / `studio_orders` tables | full config, pricing, status | yes (our side) |

## Placement maths

Placement is stored as fractions of the printable area (`centerX`, `centerY`,
`scale`, `rotation`) — never pixels. `toPrintGeometry()` converts that into
inches plus an effective DPI, so the same numbers drive the browser preview and
the printer's file positioning. Anything below 150 DPI, or overflowing the
print area, is surfaced to the customer before they can approve it.

## Degradation rules

Nothing throws at import time and no route requires credentials to boot:

| Missing | Behaviour |
|---|---|
| `DATABASE_URL` | Studio works; responses report `persisted: false` with the reason |
| Supabase | Uploads go to `.uploads/` and are flagged ephemeral + not fulfillable |
| `OPENAI_API_KEY` | Deterministic analysis only, visible notice, upload preserved |
| Printful | Catalog served from `src/lib/catalog.ts`, badged "Demo catalog" |
| Shopify Admin | Publish returns 503 listing the exact missing variable names |
| Shopify Storefront | Add to cart disabled with an explanation |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook refuses every request rather than trusting it |

`GET /api/health` reports all of this (names only, never values).

## Provider neutrality

`PodProviderAdapter` (`src/integrations/pod/types.ts`) is the contract; Printful
is the implemented adapter. `catalog-service.ts` normalizes any provider into
the studio's own product model, so swapping to Printify or Gelato means writing
one adapter — no UI or pricing changes.
