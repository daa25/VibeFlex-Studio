// Shopify Admin API (GraphQL) client — SERVER ONLY.
//
// The admin token has write access to the store, so nothing in this module may
// ever be imported into a client component. It is used for creating DRAFT
// products from the studio and for reading orders during fulfillment.

import { env } from "@/lib/env";
import { adminConfigMissing, getAdminAccessToken, resetAdminTokenCache } from "./token";

export { adminConfigMissing, adminAuthMode } from "./token";

export class ShopifyNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Shopify Admin API is not configured. Missing: ${missing.join(", ")}. Set these in .env.local (or your host's environment settings) and retry.`
    );
    this.name = "ShopifyNotConfiguredError";
  }
}

export type UserError = { field?: string[] | null; message: string };

export async function adminGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const missing = adminConfigMissing();
  if (missing.length) throw new ShopifyNotConfiguredError(missing);

  const res = await fetch(
    `https://${env.shopDomain()}/admin/api/${env.shopifyAdminApiVersion()}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": await getAdminAccessToken(),
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    }
  );

  if (res.status === 401 || res.status === 403) {
    // A cached client-credentials token may have been revoked early; drop it so
    // the next call re-exchanges instead of replaying a dead token.
    resetAdminTokenCache();
    throw new Error(
      "Shopify rejected the Admin API token (401/403). Confirm the app is installed on the store and its Admin API scopes include write_products, read_products and read_orders."
    );
  }
  if (!res.ok) {
    throw new Error(`Shopify Admin API error (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Shopify Admin GraphQL error: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  if (!json.data) throw new Error("Shopify Admin API returned no data.");
  return json.data;
}

export function throwOnUserErrors(context: string, errors: UserError[] | undefined | null) {
  if (errors && errors.length) {
    throw new Error(
      `${context}: ${errors.map((e) => `${e.field?.join(".") ?? "error"} — ${e.message}`).join("; ")}`
    );
  }
}

export function adminProductUrl(productGid: string): string {
  const numericId = productGid.split("/").pop();
  return `https://${env.shopDomain()}/admin/products/${numericId}`;
}
