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
  const admin = miss([
    ["SHOPIFY_SHOP_DOMAIN", env.shopDomain()],
    ["SHOPIFY_ADMIN_API_ACCESS_TOKEN", env.shopifyAdminToken()],
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
  ];
}
