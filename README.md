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

- Provider-neutral POD adapter interface
- Printful adapter as the first implementation

## Headless storefront

The `/store` layer is intentionally separated from the back-office product workflow. Product information can be read from Shopify while the customer-facing storefront remains independently designed and maintained.

This supports a broader operating principle: **the system of record and the customer experience should be connected without being unnecessarily coupled.**

## Current development focus

The platform is being hardened around three production priorities:

1. Persistent artwork storage and database-backed asset records
2. A reliable Printful fulfillment and variant-mapping path
3. Idempotent Shopify draft publishing and validation

Additional workflow phases include authentication, artwork analysis, catalog synchronization, mockup generation, campaign assets, webhook verification, testing, and operational hardening.

## Portfolio focus

Presented as a **commerce operations, workflow architecture, and systems-integration case study**. The value is not simply the storefront UI; it is the operating model behind getting a product from source asset to a controlled, publishable commerce state.

---

**Designed around repeatability, validation, and operational control.**
