// Shopify Admin API credential resolution — SERVER ONLY.
//
// Two authentication models are supported, because Shopify supports both and
// which one a store uses depends on how its app was created:
//
//   1. A direct Admin API access token (SHOPIFY_ADMIN_API_ACCESS_TOKEN).
//      Created by an app installed on the store. Historically these are
//      prefixed `shpat_`, but the prefix is NOT validated here — a token is a
//      token, and Shopify has shipped several formats.
//
//   2. OAuth client credentials (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET) for
//      apps using Shopify-managed installation. The app exchanges them
//      server-side for a short-lived Admin API access token.
//
// A configured static token wins, because it costs no round trip. Otherwise the
// client-credentials grant runs and the resulting token is cached in memory
// until shortly before it expires.

import { env } from "@/lib/env";

type CachedToken = { token: string; expiresAt: number };

let cache: CachedToken | null = null;

/** Seconds of headroom so a token is never used in the last moments of its life. */
const EXPIRY_MARGIN_SECONDS = 60;

export function adminAuthMode(): "access_token" | "client_credentials" | "none" {
  if (env.shopifyAdminToken()) return "access_token";
  if (env.shopifyClientId() && env.shopifyClientSecret()) return "client_credentials";
  return "none";
}

/** Variable names still missing for Admin API access, in the order to report them. */
export function adminConfigMissing(): string[] {
  const missing: string[] = [];
  if (!env.shopDomain()) missing.push("SHOPIFY_SHOP_DOMAIN");
  if (adminAuthMode() === "none") {
    missing.push("SHOPIFY_ADMIN_API_ACCESS_TOKEN (or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)");
  }
  return missing;
}

/** Drop any cached client-credentials token — used after a 401 to force a refresh. */
export function resetAdminTokenCache(): void {
  cache = null;
}

async function exchangeClientCredentials(): Promise<string> {
  const shop = env.shopDomain();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.shopifyClientId(),
      client_secret: env.shopifyClientSecret(),
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(
      `Shopify refused the client-credentials exchange (${res.status}). ` +
        `Confirm SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET belong to an app installed on ${shop} ` +
        `and that the app uses Shopify-managed installation. Response: ${detail}`
    );
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Shopify client-credentials exchange returned no access_token.");
  }

  const lifetime = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cache = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(lifetime - EXPIRY_MARGIN_SECONDS, 30) * 1000,
  };
  return cache.token;
}

/** The Admin API access token to send as `X-Shopify-Access-Token`. */
export async function getAdminAccessToken(): Promise<string> {
  const staticToken = env.shopifyAdminToken();
  if (staticToken) return staticToken;

  if (cache && cache.expiresAt > Date.now()) return cache.token;

  if (adminAuthMode() !== "client_credentials") {
    throw new Error("No Shopify Admin credentials are configured.");
  }
  return exchangeClientCredentials();
}
