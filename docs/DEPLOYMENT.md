# Deployment and credentials

The app is a standard Next.js 15 App Router project with a Node runtime. It
builds with **zero environment variables** — every integration degrades to a
reported "not configured" state — so it can be deployed first and credentialed
afterwards.

## Target: Vercel (fastest compatible option)

No adapter, Dockerfile or infra change is needed; `next build` output is
natively supported.

1. vercel.com → **Add New… → Project → Import Git Repository** → `daa25/VibeFlex-Studio`.
2. Framework preset: Next.js (auto-detected). Root directory: `/`. Build command
   and output: defaults.
3. Deploy. The studio is live at `/studio` immediately, in demo mode.
4. **Settings → Environment Variables** → add the variables below → **Redeploy**.

Node 22 is recommended (`engines` is not pinned; Vercel's default is fine).

## Credentials, in the order they unlock value

| # | Variable(s) | Service | Scope / permission | Where to get it |
|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Supabase | service_role key; create a **public** bucket named `vibeflex-artwork` | supabase.com → project → Settings → API (keys) and Storage → New bucket |
| 2 | `DATABASE_URL` | Supabase Postgres | connection string (session pooler is fine) | Supabase → Settings → Database → Connection string → URI |
| 3 | `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | Shopify | `write_products`, `read_products`, `read_orders` | Shopify Admin → Settings → Apps and sales channels → Develop apps → *app* → Configure Admin API scopes → Install → API credentials |
| 4 | `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Shopify | Storefront API: `unauthenticated_read_product_listings`, `unauthenticated_write_checkouts` | same app → API credentials → Storefront API |
| 5 | `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID` | Printful | private token with catalog + orders | developers.printful.com → Tokens; store id from Printful → Stores |
| 6 | `OPENAI_API_KEY` | OpenAI | any key with vision model access | platform.openai.com → API keys |
| 7 | `SHOPIFY_WEBHOOK_SECRET` | Shopify | webhook signing secret | Shopify Admin → Settings → Notifications → Webhooks → create `orders/create` → `https://<your-domain>/api/webhooks/shopify/orders-create`, then copy the signing secret |
| 8 | `STUDIO_ADMIN_USER`, `STUDIO_ADMIN_PASSWORD` | (self-chosen) | protects `/dashboard` and draft publishing | pick any strong password |

After step 2, run the migrations once against the database:

```bash
DATABASE_URL="…" npm run db:migrate
```

## Verifying a deployment

```bash
curl https://<domain>/api/health     # every service reports configured/missing
```

- `/` marketing entry
- `/studio` customer designer (public)
- `/store`, `/store/product/[handle]` headless storefront (needs Storefront token)
- `/dashboard` staff view (protected once `STUDIO_ADMIN_PASSWORD` is set)

## Self-hosting instead

Any Node 20+ host works: `npm ci && npm run build && npm start` behind a
reverse proxy. The only stateful requirement is Supabase Storage — the local
`.uploads/` fallback is for development only and is not fulfillment-safe.

## Continuous integration

`docs/ci-workflow.yml` is a ready GitHub Actions workflow (install → typecheck →
test → build on every push and PR). It is parked in `docs/` because the GitHub
App used to push this branch is not allowed to create workflow files. To enable
it, move it yourself:

```bash
mkdir -p .github/workflows && git mv docs/ci-workflow.yml .github/workflows/ci.yml
```

## Shopify Admin authentication — two supported models

The adapter does not care which model the store uses, and it never validates a
token's prefix (`shpat_` is a convention, not a rule).

**Model A — direct Admin API access token**

```
SHOPIFY_SHOP_DOMAIN=hbipmy-3g.myshopify.com
SHOPIFY_ADMIN_API_ACCESS_TOKEN=<token>
```

**Model B — OAuth client credentials (Shopify-managed installation)**

```
SHOPIFY_SHOP_DOMAIN=hbipmy-3g.myshopify.com
SHOPIFY_CLIENT_ID=<client id>
SHOPIFY_CLIENT_SECRET=<client secret>
```

With Model B the server exchanges the credentials at
`POST https://{shop}/admin/oauth/access_token` (`grant_type=client_credentials`)
and caches the resulting short-lived token in memory until a minute before it
expires. A 401/403 clears the cache so the next call re-exchanges.

If both are present the static token wins. Either way the value stays
server-side; none of these names may ever be prefixed `NEXT_PUBLIC_`.

Required Admin API scopes remain `read_products`, `write_products`, and
`read_orders` for downstream order verification. The studio's write boundary is
unchanged: it creates DRAFT products and nothing else.
