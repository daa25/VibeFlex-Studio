# VibeFlex Product Studio

Stage One of the AI-powered print-on-demand product creation platform: an
internal tool for turning one uploaded design into a complete, publishable
Shopify product (mockups, copy, pricing, variants) for the 490 Movement /
VibeFlex Sports stores.

## What's in this scaffold

- Next.js 15 (App Router) + TypeScript, strict mode, Tailwind
- Drizzle ORM schema covering the full MVP data model (brand profile,
  artwork + AI analysis, POD catalog, product project pipeline, mockups,
  campaign assets, Shopify publishing, jobs, audit log)
- Provider-neutral `PodProviderAdapter` interface (`src/integrations/pod/types.ts`)
- First working adapter: **Printful** (`src/integrations/pod/printful/adapter.ts`)
- Minimal dashboard page that reads from the DB, to confirm the pipeline works

## Headless storefront (`/store`)

This adds a second, independent layer on top of everything above: a
customer-facing storefront that is completely decoupled from Shopify's
theme editor.

**How updating products stays easy:** the storefront never hardcodes any
product data. `/store` and `/store/product/[handle]` call Shopify's
**Storefront API** live, on every request (revalidated every 60s). So:

- Publish or edit a product from the Product Studio → it appears/updates on
  the storefront automatically.
- Edit a product directly in Shopify Admin (price, images, description) →
  same thing, no code change, no redeploy.
- Add-to-cart goes straight to Shopify checkout via `cartCreate`, so orders,
  taxes, and fulfillment stay on Shopify's commerce backend — you're only
  replacing the *storefront presentation layer*, not rebuilding checkout.

This is the standard "headless commerce" pattern: Shopify Admin (+ this
platform) stays the source of truth for products; the Storefront API is the
read layer; your own Next.js pages are the only thing that changed visually.

Files:
- `src/integrations/shopify/storefront-client.ts` — Storefront API client
  (separate from the Admin API client used by the publishing pipeline)
- `src/app/store/page.tsx` — product listing, pulled live
- `src/app/store/product/[handle]/page.tsx` — product detail page
- `src/app/api/cart/route.ts` — server-side cart creation (keeps the
  Storefront token off the client, even though it's a public-scoped token)

To enable it: create a Storefront API access token in Shopify Admin
(Settings → Apps → Develop apps → your app → API credentials → Storefront
API), add it to `.env.local`, then visit `/store`.

## What's NOT built yet (by design — see phased plan)

- Auth (Supabase Auth / Clerk) — Phase 1 remainder
- Artwork upload UI + Supabase Storage wiring — Phase 2
- AI artwork analysis workflow (OpenAI structured output) — Phase 2
- POD catalog sync job — Phase 3
- Product Studio wizard UI — Phase 4
- Mockup job polling (Inngest) — Phase 5
- AI product copy generation — Phase 6
- Shopify GraphQL client + draft publishing — Phase 7
- Campaign/lifestyle image workflow (Canva handoff) — Phase 8
- Tests, webhook verification, idempotency hardening — Phase 9

## Setup

```bash
npm install
cp .env.example .env.local
# fill in DATABASE_URL, SHOPIFY_*, PRINTFUL_*, OPENAI_API_KEY

npm run db:generate   # generates SQL migration from schema
npm run db:migrate    # applies it to your Supabase Postgres instance
npm run dev
```

Visit `http://localhost:3000/dashboard`.

## First build target

The initial end-to-end proof of concept is a VibeFlex Sports "Built
Different" T-shirt: black / charcoal / royal blue / white, sizes S–3XL,
center-chest placement, published as a Shopify **draft** product on
`vibeflex-813.myshopify.com`.

## Continuing this build

This scaffold is meant to be picked up in **Claude Code**, where the AI
analysis workflow, Shopify GraphQL calls, and Printful mockup jobs can be
implemented and tested against real credentials iteratively, rather than
written blind in chat.
