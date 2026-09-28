// Central, non-throwing environment access.
//
// Rule for this codebase: nothing in here may throw at import time. Missing
// configuration must degrade into a clearly-reported "not configured" state so
// the app still builds, boots and renders useful empty/error states.

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const env = {
  databaseUrl: () => read("DATABASE_URL"),

  supabaseUrl: () => read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => read("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseBucket: () => read("SUPABASE_STORAGE_BUCKET") ?? "vibeflex-artwork",

  shopDomain: () => read("SHOPIFY_SHOP_DOMAIN"),
  shopifyAdminToken: () => read("SHOPIFY_ADMIN_API_ACCESS_TOKEN"),
  // OAuth / Shopify-managed installation alternative to a static admin token.
  shopifyClientId: () => read("SHOPIFY_CLIENT_ID"),
  shopifyClientSecret: () => read("SHOPIFY_CLIENT_SECRET"),
  shopifyAdminApiVersion: () => read("SHOPIFY_API_VERSION") ?? "2025-01",
  shopifyStorefrontToken: () => read("SHOPIFY_STOREFRONT_ACCESS_TOKEN"),
  shopifyStorefrontApiVersion: () => read("SHOPIFY_STOREFRONT_API_VERSION") ?? "2025-01",
  shopifyWebhookSecret: () => read("SHOPIFY_WEBHOOK_SECRET"),

  podProvider: () => (read("POD_PROVIDER") ?? "printful").toLowerCase(),
  printfulApiKey: () => read("PRINTFUL_API_KEY"),
  printfulStoreId: () => read("PRINTFUL_STORE_ID"),
  printifyApiKey: () => read("PRINTIFY_API_KEY"),
  printifyShopId: () => read("PRINTIFY_SHOP_ID"),
  gelatoApiKey: () => read("GELATO_API_KEY"),

  openaiApiKey: () => read("OPENAI_API_KEY"),
  // Accept PROOFBG_API_KEY too — a real key was set under that name before
  // the exact env var name was confirmed; no need to re-add it.
  poofApiKey: () => read("POOF_API_KEY") ?? read("PROOFBG_API_KEY"),

  // Impact.com — two separate accounts per the two-sided model documented in
  // Impact-Affiliate-Architecture: Side A (publisher, you promote partner
  // brands) and Side B (advertiser, other publishers promote your catalog).
  // Never conflate these two credential pairs.
  impactPublisherAccountSid: () => read("IMPACT_PUBLISHER_ACCOUNT_SID"),
  impactPublisherAuthToken: () => read("IMPACT_PUBLISHER_AUTH_TOKEN"),
  impactAdvertiserAccountSid: () => read("IMPACT_ADVERTISER_ACCOUNT_SID"),
  impactAdvertiserAuthToken: () => read("IMPACT_ADVERTISER_AUTH_TOKEN"),

  airtableApiKey: () => read("AIRTABLE_API_KEY"),
  airtableBaseId: () => read("AIRTABLE_BASE_ID") ?? "appuaF1jfeBr2PPqn",

  adminAllowedEmails: () =>
    (read("ADMIN_ALLOWED_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  adminUser: () => read("STUDIO_ADMIN_USER"),
  adminPassword: () => read("STUDIO_ADMIN_PASSWORD"),

  publicBaseUrl: () =>
    read("NEXT_PUBLIC_BASE_URL") ??
    (read("VERCEL_URL") ? `https://${read("VERCEL_URL")}` : undefined),

  autoSubmitFulfillment: () => read("FULFILLMENT_AUTO_SUBMIT") === "true",
};

export type ServiceStatus = {
  key: string;
  label: string;
  configured: boolean;
  missing: string[];
  note: string;
};

/** Human-readable configuration report, surfaced at /api/health and /dashboard. */
export function serviceStatuses(): ServiceStatus[] {
  const miss = (pairs: [string, unknown][]) =>
    pairs.filter(([, v]) => !v).map(([k]) => k);

  const database = miss([["DATABASE_URL", env.databaseUrl()]]);
  const storage = miss([
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl()],
    ["SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey()],
  ]);
  const storefront = miss([
    ["SHOPIFY_SHOP_DOMAIN", env.shopDomain()],
    ["SHOPIFY_STOREFRONT_ACCESS_TOKEN", env.shopifyStorefrontToken()],
  ]);
  const hasAdminCredential =
    env.shopifyAdminToken() || (env.shopifyClientId() && env.shopifyClientSecret());
  const admin = miss([
    ["SHOPIFY_SHOP_DOMAIN", env.shopDomain()],
    [
      "SHOPIFY_ADMIN_API_ACCESS_TOKEN (or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)",
      hasAdminCredential,
    ],
  ]);
  const webhook = miss([["SHOPIFY_WEBHOOK_SECRET", env.shopifyWebhookSecret()]]);

  const provider = env.podProvider();
  const fulfillment =
    provider === "printify"
      ? miss([
          ["PRINTIFY_API_KEY", env.printifyApiKey()],
          ["PRINTIFY_SHOP_ID", env.printifyShopId()],
        ])
      : provider === "gelato"
        ? miss([["GELATO_API_KEY", env.gelatoApiKey()]])
        : miss([
            ["PRINTFUL_API_KEY", env.printfulApiKey()],
            ["PRINTFUL_STORE_ID", env.printfulStoreId()],
          ]);

  const impactPublisher = miss([
    ["IMPACT_PUBLISHER_ACCOUNT_SID", env.impactPublisherAccountSid()],
    ["IMPACT_PUBLISHER_AUTH_TOKEN", env.impactPublisherAuthToken()],
  ]);
  const impactAdvertiser = miss([
    ["IMPACT_ADVERTISER_ACCOUNT_SID", env.impactAdvertiserAccountSid()],
    ["IMPACT_ADVERTISER_AUTH_TOKEN", env.impactAdvertiserAuthToken()],
  ]);
  const airtable = miss([["AIRTABLE_API_KEY", env.airtableApiKey()]]);
  const backgroundRemoval = miss([["POOF_API_KEY", env.poofApiKey()]]);

  return [
    {
      key: "database",
      label: "Postgres (Drizzle)",
      configured: database.length === 0,
      missing: database,
      note: "Persists designs, orders and fulfillment jobs. Without it the studio still works but designs are not saved server-side.",
    },
    {
      key: "storage",
      label: "Artwork storage (Supabase)",
      configured: storage.length === 0,
      missing: storage,
      note: "Uploads fall back to ephemeral local disk, which is NOT safe for production fulfillment.",
    },
    {
      key: "shopify_storefront",
      label: "Shopify Storefront API",
      configured: storefront.length === 0,
      missing: storefront,
      note: "Powers /store and cart/checkout creation.",
    },
    {
      key: "shopify_admin",
      label: "Shopify Admin API",
      configured: admin.length === 0,
      missing: admin,
      note: "Publishing products and reading orders for fulfillment.",
    },
    {
      key: "shopify_webhook",
      label: "Shopify order webhook",
      configured: webhook.length === 0,
      missing: webhook,
      note: "HMAC secret for orders/create. Without it the webhook rejects every request.",
    },
    {
      key: "fulfillment",
      label: `POD provider (${provider})`,
      configured: fulfillment.length === 0,
      missing: fulfillment,
      note: "Mockup generation and order routing to production.",
    },
    {
      key: "impact_publisher",
      label: "Impact.com (Side A — publisher)",
      configured: impactPublisher.length === 0,
      missing: impactPublisher,
      note: "Pulls click/conversion/commission performance for the partner brands you promote.",
    },
    {
      key: "impact_advertiser",
      label: "Impact.com (Side B — advertiser)",
      configured: impactAdvertiser.length === 0,
      missing: impactAdvertiser,
      note: "Serves /api/impact/catalog-feed for outside affiliates to discover your products.",
    },
    {
      key: "airtable",
      label: "Airtable (command center sync)",
      configured: airtable.length === 0,
      missing: airtable,
      note: "Writes Impact.com performance data into the Publisher_Partners / Affiliate_Links tables.",
    },
    {
      key: "background_removal",
      label: "Background removal (Poof)",
      configured: backgroundRemoval.length === 0,
      missing: backgroundRemoval,
      note: "Powers the 'Remove background' action on uploaded artwork with no transparency.",
    },
  ];
}
