# VibeFlex Product Studio

A commerce-operations platform designed to move a product from artwork and configuration through fulfillment mapping, storefront preparation, and Shopify publishing workflows.

The project treats ecommerce as an operational pipeline rather than a collection of disconnected tools. Product data, artwork, fulfillment, mockups, publishing, and audit history are modeled as parts of one repeatable system.

## What the project demonstrates

- End-to-end product workflow design
- Structured product and brand data modeling
- Shopify storefront and publishing integration patterns
- Print-on-demand provider abstraction
- Printful fulfillment adapter architecture
- Database-backed workflow state
- Audit-log and job-model design
- Headless storefront integration
- Separation between customer-facing commerce and back-office operations

## Architecture

### Application

- Next.js 15 App Router
- TypeScript in strict mode
- Tailwind CSS

### Data

- Drizzle ORM
- Schema coverage for brand profiles, artwork, product projects, POD catalog data, mockups, publishing state, campaign assets, jobs, and audit history

### Commerce

- Shopify Storefront API pattern for customer-facing product data and checkout
- Separate Admin-side publishing architecture for product operations

### Fulfillment

- Provider-neutral production interface with an in-house VibeFlex line
- Printful as the first external provider; Printify and Gelato reserved as next adapters

## Headless storefront

The `/store` layer is intentionally separated from the back-office product workflow. Product information can be read from Shopify while the customer-facing storefront remains independently designed and maintained.

This supports a broader operating principle: **the system of record and the customer experience should be connected without being unnecessarily coupled.**

## Status

**Deployed:** https://vibe-flex-studio.vercel.app (Vercel, auto-deploys `main`). The app runs with
zero credentials and reports each integration's state at `/api/health` — currently 1 of 6 services
configured, so it is usable in demo mode but not yet production-fulfillment ready. [2026-09-24]

Implemented since the first milestone:

- Provider-neutral production (`ProductionProvider`) with an in-house VibeFlex line and Printful;
  local-first routing, and external paid fulfillment always owner-approved
- Persisted, resumable job pipeline from artwork to a verified Shopify DRAFT
- Hard policy gates, including a visual-QA gate that never silently passes an image
- Shopify Admin via static token or OAuth client credentials; draft re-read verification

Next: connect Supabase storage and the database, Storefront token and webhook secret, Printful
credentials; add a Printify adapter; run the Built Different canary end to end.

**Full architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · **Deploy + credentials:**
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Portfolio focus

Presented as a **commerce operations, workflow architecture, and systems-integration case study**. The value is not simply the storefront UI; it is the operating model behind getting a product from source asset to a controlled, publishable commerce state.

---

**Designed around repeatability, validation, and operational control.**
