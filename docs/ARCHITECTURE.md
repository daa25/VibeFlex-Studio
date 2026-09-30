# VibeFlex Studio — Architecture

> **Canonical architecture document.** Last reviewed **2026-09-24** against `main` @ `3b29697`
> and the live production deployment. This file replaces the two earlier documents
> (`docs/ARCHITECTURE.md` — the original POD-studio path — and `docs/architecture.md` —
> provider-neutral production). They differed only in letter case, which collides on
> macOS/Windows checkouts, so their content is merged here.
>
> Anything marked **[status, date]** is a point-in-time fact; re-verify with
> `GET /api/health` before relying on it.

---

## 1. Where Studio sits in the VibeFlex business

```
                    ┌────────────────────────────────────────────┐
  Customers ──────▶ │ Shopify storefront  (commerce system of    │  LIVE — revenue today
                    │ record: catalog, cart, checkout, orders)   │
                    └───────────────┬───────────────▲────────────┘
                                    │ orders/create │ DRAFT products
                                    ▼ webhook       │ (Admin GraphQL)
                    ┌────────────────────────────────────────────┐
                    │ VibeFlex Studio  (this repo)               │  Phase 2 — deployed,
                    │ artwork → product → mockup → QA → pricing  │  awaiting credentials
                    │ → Shopify DRAFT → order → production job   │
                    └──────┬──────────────┬──────────────┬───────┘
                           │              │              │
                 Supabase Storage   Postgres (Drizzle)   Production providers
                 (runtime artwork)  (designs, jobs,      VibeFlex local line ·
                                     orders, audit)      Printful · (Printify, Gelato)
```

| System | Role | Owner of truth for |
|---|---|---|
| **Shopify** | Storefront + checkout | Products customers see, prices, orders |
| **VibeFlex Studio** | Product-creation + production control plane | Artwork, configuration, QA verdicts, routing decisions |
| **Supabase** | Runtime storage + database | Canonical artwork files, Studio records |
| **POD / production providers** | Make and ship goods | Supplier cost, variant availability, tracking |
| **Airtable** (`VibeOS Intelligence Command Center`) | Operations tracking | Task/launch status. *Its Product Master is currently stale — rebuild it from Shopify, never the reverse.* |
| **Google Drive** | Historical source-asset library | Original design files (read-only input) |

**Studio is not required to sell.** The Shopify store is live and takes orders today through
Shopify's own apps (the current sellable POD products are fulfilled via Printify's Shopify
app). Studio is the phase-2 engine that makes *new* products faster and to a higher visual
standard. [live store read, 2026-09-18]

---

## 2. The Studio lifecycle

```
Artwork → Product → Variant → Mockup → QA → Pricing → Shopify DRAFT →
Owner approval → Live → Order → Production Job → Fulfillment → Tracking
```

### 2a. Creation half (artwork → Shopify DRAFT)

```
/studio
  → upload artwork                POST /api/uploads
      · magic-byte validation (PNG/JPG/WebP, ≤30 MB, ≥400 px)
      · Supabase Storage (or local ephemeral fallback — never fulfillable)
      · deterministic analysis (always) + OpenAI vision analysis (best effort)
  → pick product / colour / size  src/lib/catalog.ts · integrations/pod/catalog-service.ts
  → position + scale              normalized print-area coordinates
  → preview                       vector garment + live overlay; supplier mockups via lib/mockup-service.ts
  → visual QA                     lib/visual-qa.ts
  → price                         lib/pricing.ts (recomputed server-side)
  → approve                       POST /api/studio/designs → VF-XXXXXX reference
  → staff publishes DRAFT         POST /api/studio/publish → integrations/shopify/publish-draft.ts
  → draft re-read + verified      integrations/shopify/verify-draft.ts
```

**Write boundary:** Studio creates Shopify products as **DRAFT only**. It never activates,
publishes to channels, edits collections, touches the theme, or changes existing live
products.

### 2b. Autonomous job pipeline

Batch work (e.g. turning a list of artworks into verified drafts) runs through a persisted
state machine so any worker can resume a job it did not start.

- `lib/job-states.ts` — states and legal transitions
  - Progress: `RECEIVED → ARTWORK_VALIDATING → ANALYZING → PRODUCT_SELECTING →
    SUPPLIER_MAPPING → MOCKUP_GENERATING → QA_RUNNING → LISTING_GENERATING →
    SHOPIFY_DRAFT_CREATING → VERIFYING → READY_FOR_APPROVAL → APPROVED → PUBLISHING → LIVE`
  - Exceptions: `ARTWORK_REPAIR_REQUIRED`, `MOCKUP_REPAIR_REQUIRED`, `SUPPLIER_BLOCKED`,
    `QA_REJECTED`, `PRICING_HOLD`, `PUBLISH_FAILED`, `FULFILLMENT_BLOCKED`, `MANUAL_REVIEW`
- `lib/job-queue.ts` / `lib/job-runner.ts` — claim, run one stage, persist, release
  (`studio_jobs` table)
- `POST /api/studio/jobs` (enqueue) · `POST /api/studio/jobs/run` (worker tick, ≤300 s)

Everything up to `READY_FOR_APPROVAL` is autonomous. `APPROVED` and beyond require the owner.

### 2c. Hard gates (`lib/policy-gates.ts`)

Five gates — `ARTWORK`, `MOCKUP`, `QA`, `SUPPLIER`, `COMMERCE` — evaluated before a product
can advance. Rules that never bend:

- **Visual quality is its own gate.** Having images, mapped variants, good copy or a healthy
  margin never makes a product READY. (The "Blood Hit The Stain" rule.)
- **QA never silently passes.** If the vision model is unavailable the verdict is `PENDING`
  (needs a human), never `PASS`. Screenshots, raw artwork-as-photo, nested/picture-in-picture
  mockups, wrong garment/colour, distortion and watermarks are rejected.
- **`SHOPIFY ACTIVE` is impossible while `FULFILLMENT VERIFIED = false`.**
- Activation, publication, price changes, supplier changes, deletions and theme changes are
  owner-approval actions.

### 2d. Production half (order → tracking)

The Shopify `orders/create` webhook (`app/api/webhooks/shopify/orders-create/route.ts`) is the
live entry point. On an HMAC-verified order it:

1. `buildFulfillmentPlan()` (`lib/fulfillment/order-mapper.ts`) — maps line items (artwork,
   geometry, supplier variant, technique, price paid) into a `FulfillmentPlan`.
2. `planProduction()` (`lib/fulfillment/production-planner.ts`) — converts it to a
   provider-neutral `ProductionOrderInput` and routes it with `routeProduction()`.
3. Persists the routing decision per order line and returns it in the response.

This path **plans and routes only — it never submits** to a paid vendor.

---

## 3. Provider-neutral production

All production goes through one interface, `ProductionProvider`
(`integrations/pod/production-types.ts`). Routing and the rest of Studio never depend on a
vendor's API shape.

| Provider | Kind | File | Status |
|---|---|---|---|
| `VibeFlexLocalProvider` | local | `providers/vibeflex-local-provider.ts` | Implemented. Always registered. |
| `PrintfulProductionProvider` | external | `providers/printful-production-provider.ts` | Implemented. Registered only with a live Printful client. |
| Printify | external | — | **Not yet implemented.** Env names reserved (`PRINTIFY_API_KEY`, `PRINTIFY_SHOP_ID`). Highest-value next adapter: the store's ready POD products already run on Printify. |
| Gelato | external | — | **Not yet implemented.** Env name reserved (`GELATO_API_KEY`). Anticipated by the earlier Manus storefront. |

- `ProviderRegistry` (`provider-registry.ts`) tracks what is registered/usable;
  `hasLocalCapability()` answers "can Studio produce at all?"
- `getProductionProviders()` (`lib/fulfillment/production-runtime.ts`) always registers the
  local line and adds Printful when configured.
- Catalog/mockup side: `PodProviderAdapter` (`integrations/pod/types.ts`) with the Printful
  adapter (`integrations/pod/printful/adapter.ts`, incl. the `PrintfulPlatformError` guard for
  Shopify-platform stores). `catalog-service.ts` normalizes any provider into Studio's own
  product model — adding a provider means one adapter, no UI or pricing changes.

**Routing** (`routeProduction()`, `production-router.ts`) weighs capability (technique,
destination, valid variant id), capacity (daily committed capacity) and cost/margin
(`minMarginPct` floor). Two invariants:

1. **Local-first.** The in-house line wins whenever it is capable and within capacity
   (`preferLocal`, default true).
2. **External is never an auto route.** An external decision carries `requiresApproval = true`;
   external paid providers return `PENDING_APPROVAL` and bill nothing without
   `opts.ownerApproved === true`. `FULFILLMENT_AUTO_SUBMIT` is a separate, additional gate.

---

## 4. Data

### Why customization lives on the order

Line-item properties are written at cart creation and Shopify keeps them on the order
forever, so fulfillment needs **nothing** from our database. The database is the audit trail
and staff dashboard, not a production dependency. `_`-prefixed properties are hidden on the
storefront but present in Admin and the Orders API.

| Where | What | Survives checkout |
|---|---|---|
| Line-item properties | artwork URL, geometry, provider, cost, reference | yes |
| Cart attributes | studio reference | yes |
| Product metafields (`vibeflex.*`) | artwork, geometry, provider ids, cost | yes (product-level) |
| Variant SKU | `VF-XXXXXX-PRODUCT-COLOR-SIZE` | yes |
| Studio tables | full config, pricing, status, jobs | yes (our side) |

### Tables (Drizzle, `src/db/schema/`)

- **Studio runtime:** `studio_artworks`, `studio_designs`, `studio_orders`, `studio_jobs`
- **Platform model:** `organizations`, `brand_profiles`, `assets`, `artworks`,
  `artwork_analyses`, `pod_provider_connections`, `pod_catalog_products`,
  `pod_catalog_variants`, `product_projects`, `product_configurations`,
  `product_variant_drafts`, `mockups`, `campaign_assets`, `shopify_stores`,
  `published_products`, `published_variants`, `jobs`, `audit_logs`
- Migrations: `src/db/migrations/0001…`, `0002_rainy_red_hulk.sql` — **not yet run against
  production** (no `DATABASE_URL`). [health, 2026-09-24]

### Placement maths

Placement is stored as fractions of the printable area (`centerX`, `centerY`, `scale`,
`rotation`), never pixels. `toPrintGeometry()` converts to inches plus effective DPI, so the
same numbers drive the preview and the printer's file positioning. Below 150 DPI or overflowing
the print area is shown to the customer before approval.

---

## 5. Shopify integration

- **Admin API** (`integrations/shopify/admin-client.ts`, `token.ts`) supports two auth models —
  a static Admin token, or OAuth client credentials exchanged server-side for a short-lived,
  cached, auto-refreshed token. Prefixes are never validated. If both are set, the static
  token wins. Scopes: `read_products`, `write_products`, `read_orders`.
- **Storefront API** (`storefront-client.ts`) powers `/store` and cart/checkout.
- **Webhook** `orders/create`, HMAC-verified with `SHOPIFY_WEBHOOK_SECRET`; without the secret
  it rejects every request.
- Canonical store: `hbipmy-3g.myshopify.com` (public storefront `vibeflex-813.myshopify.com`).

All Shopify secrets are server-side only; none may be prefixed `NEXT_PUBLIC_`.

---

## 6. Degradation rules

Nothing throws at import time and no route needs credentials to boot.

| Missing | Behaviour |
|---|---|
| `DATABASE_URL` | Studio works; responses report `persisted: false` with the reason |
| Supabase | Uploads go to `.uploads/`, flagged ephemeral + not fulfillable |
| `OPENAI_API_KEY` | Deterministic analysis only; QA verdicts stay `PENDING` |
| Printful | Catalog from `src/lib/catalog.ts`, badged "Demo catalog"; local line still routes |
| Shopify Admin | Publish returns 503 naming the missing variables |
| Shopify Storefront | Add to cart disabled with an explanation |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook refuses every request |

`GET /api/health` reports all of this (names only, never values).

---

## 7. Deployment and current status

- **Host:** Vercel, team *VibeLink*, project `vibe-flex-studio`. Git-linked: every push to
  `main` deploys to production. Env vars bind at **build** time — redeploy after changing them.
- **Production:** https://vibe-flex-studio.vercel.app — serving `main` @ `3b29697`.
  `/`, `/studio`, `/store`, `/dashboard`, `/api/health` all return 200. [live, 2026-09-24]
- **Health:** `studioUsable: true`, `readyForProductionFulfillment: false`,
  artwork storage `local-ephemeral`. **1 of 6 services configured.** [health, 2026-09-24]

| Service | Configured | Missing |
|---|---|---|
| Shopify Admin | ✅ (client credentials set; last exchange test returned `app_not_installed` — the app must be installed on the store) | — |
| Database | ❌ | `DATABASE_URL` |
| Artwork storage | ❌ | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Shopify Storefront | ❌ | `SHOPIFY_STOREFRONT_ACCESS_TOKEN` |
| Shopify webhook | ❌ | `SHOPIFY_WEBHOOK_SECRET` |
| POD provider (Printful) | ❌ | `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID` |

Setup steps, where each credential comes from, and the order they unlock value:
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## 8. Design system

Premium dark athletic ("Digital Locker Room"), not generic SaaS.

| Token | Value | Use |
|---|---|---|
| Matte Black | `#0a0a0c` | Base background |
| Charcoal | `#1c1c1e` | Surfaces / cards |
| Royal Blue | `#2563eb` | Primary accent + CTAs |
| Electric Blue | `#3b82f6` | Hover |
| Gold | `#C9A84C` | **Built Different / faith sub-brand only** |
| Hype Red | `#EF4444` | Drops / urgency |
| Soft Gray | `#8E8E93` | Secondary text |

Type: Bebas Neue (display) · DM Sans (body) · Cinzel (faith sub-brand).

---

## 9. Decisions carried from the Manus handoff (Aug 2026)

The Manus material describes a *different* storefront (Vite + wouter + tRPC + Gelato). It is
**reference only** — its code is not merged here.

- **Kept:** multi-provider intent (now the `ProductionProvider` seam), the palette above,
  collection taxonomy and Built Different product data as content sources.
- **Deprecated:** static product arrays as the catalog (Shopify is the catalog), Printful-only
  assumptions, the Manus "readiness %" and connector-auth notes (historical — re-verify).
- **Deferred:** devotional-PDF and TikTok/Canva template generators → a future Content Engine;
  not on the commerce path.
- No credentials were found in the handoff.

---

## 10. Next steps, in order of value

1. **Credentials** (owner, in Vercel → Settings → Environment Variables, then redeploy):
   Supabase URL + service-role key → `DATABASE_URL` → Storefront token → webhook secret →
   Printful key + store id. Install the Shopify app on `hbipmy-3g` so the Admin token
   exchange succeeds.
2. Run migrations; verify `studio_*` tables and a real Supabase upload.
3. **Printify adapter** implementing `ProductionProvider` + `PodProviderAdapter`.
4. Built Different canary end-to-end → exactly one verified Shopify DRAFT.
5. Enable CI: move `docs/ci-workflow.yml` to `.github/workflows/ci.yml` (the GitHub App used
   by agents cannot create workflow files).

---

## Tests

`npm test` (Vitest) — 11 suites, including:

- `vibeflex-local-provider.test.ts` — in-house line with no external dependency; idempotency;
  capability limits; floor-state transitions and tracking.
- `production-router.test.ts` — local-first; external fallback requires approval; capacity and
  margin gating; external never auto-submits.
- `production-planner.test.ts` — paid order → routed to the in-house line; retail from price
  paid; blocked orders not routed.
- `visual-qa.test.ts`, `autonomy.test.ts`, `job-runner.test.ts`, `shopify-token.test.ts`,
  `printful-adapter.test.ts`, `order-mapper.test.ts`, …
