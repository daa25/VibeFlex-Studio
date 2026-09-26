// POD catalog service — SERVER ONLY.
//
// Normalizes provider catalogs into the studio's own product model so the UI
// never depends on a vendor's response shape. Behaviour:
//
//   live  — the configured provider's credentials are present: fetch and
//           normalize the real catalog, cached in-process for CATALOG_TTL_MS.
//   mock  — no credentials: serve src/lib/catalog.ts, clearly flagged
//           `mode: "mock"` in every response so the UI can badge it.
//
// A live-mode API failure falls back to mock rather than breaking the studio,
// and reports the error alongside the data.
//
// Provider choice per product: each CatalogProduct in src/lib/catalog.ts may
// carry a `provider.printful` and/or `provider.printify` entry. The one
// actually used is whichever adapter is configured AND the product has an
// entry for — env.podProvider() picks Printful vs Printify when a product has
// both, but a product with only one entry uses that one regardless of
// POD_PROVIDER, so a mixed catalog (some products on Printful, some on
// Printify) works without every product needing both.

import { CATALOG, type CatalogProduct } from "@/lib/catalog";
import { env } from "@/lib/env";
import { PrintfulAdapter } from "./printful/adapter";
import { PrintifyAdapter } from "./printify/adapter";
import type { PodProduct, PodProviderAdapter, PodVariant } from "./types";

export type CatalogMode = "live" | "mock";

export type CatalogResponse = {
  mode: CatalogMode;
  provider: string;
  products: CatalogProduct[];
  fetchedAt: string;
  warning?: string;
};

const CATALOG_TTL_MS = 15 * 60 * 1000;
let cache: { at: number; value: CatalogResponse } | null = null;

export function clearCatalogCache() {
  cache = null;
}

export function printfulConfigured(): boolean {
  return Boolean(env.printfulApiKey() && env.printfulStoreId());
}

export function printifyConfigured(): boolean {
  return Boolean(env.printifyApiKey() && env.printifyShopId());
}

export function getPrintfulAdapter(): PrintfulAdapter | null {
  if (!printfulConfigured()) return null;
  return new PrintfulAdapter(env.printfulApiKey()!, env.printfulStoreId()!);
}

export function getPrintifyAdapter(): PrintifyAdapter | null {
  if (!printifyConfigured()) return null;
  return new PrintifyAdapter(env.printifyApiKey()!, env.printifyShopId()!);
}

/**
 * The adapter + catalog id to use for ONE product, given which providers are
 * configured. env.podProvider() breaks a tie when a product carries entries
 * for both; a product with only one entry uses that one regardless of
 * POD_PROVIDER, so a catalog can mix providers per product without every
 * product needing both.
 */
function resolveProviderForProduct(
  studioProduct: CatalogProduct
): { adapter: PodProviderAdapter; externalId: string } | null {
  const printful = getPrintfulAdapter();
  const printify = getPrintifyAdapter();
  const preferPrintify = env.podProvider() === "printify";

  const printifyEntry = studioProduct.provider.printify?.blueprintId;
  const printfulEntry = studioProduct.provider.printful?.catalogProductId;

  if (preferPrintify && printify && printifyEntry) return { adapter: printify, externalId: printifyEntry };
  if (!preferPrintify && printful && printfulEntry) return { adapter: printful, externalId: printfulEntry };
  // Fall back to whichever the product actually has an entry AND a configured
  // adapter for, rather than reporting mock just because the preferred
  // provider's entry is missing on this one product.
  if (printify && printifyEntry) return { adapter: printify, externalId: printifyEntry };
  if (printful && printfulEntry) return { adapter: printful, externalId: printfulEntry };
  return null;
}

export async function getStudioCatalog(options: { force?: boolean } = {}): Promise<CatalogResponse> {
  if (!options.force && cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache.value;

  const provider = env.podProvider();
  const mock = (warning?: string): CatalogResponse => ({
    mode: "mock",
    provider,
    products: CATALOG,
    fetchedAt: new Date().toISOString(),
    warning:
      warning ??
      "Running on the built-in VibeFlex catalog. Set PRINTFUL_API_KEY + PRINTFUL_STORE_ID or " +
        "PRINTIFY_API_KEY + PRINTIFY_SHOP_ID to sync live products, variants and costs.",
  });

  if (!printfulConfigured() && !printifyConfigured()) {
    const value = mock();
    cache = { at: Date.now(), value };
    return value;
  }

  try {
    const products = await Promise.all(
      CATALOG.map(async (studioProduct) => {
        const resolved = resolveProviderForProduct(studioProduct);
        if (!resolved) return studioProduct;
        const [providerProduct, variants] = await Promise.all([
          resolved.adapter.getProduct(resolved.externalId),
          resolved.adapter.getVariants(resolved.externalId),
        ]);
        return mergeProviderData(studioProduct, providerProduct, variants);
      })
    );

    const value: CatalogResponse = {
      mode: "live",
      provider,
      products,
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    const value = mock(
      `POD catalog sync failed, serving the built-in catalog instead: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
    // Cache failures briefly so a broken provider does not get hammered.
    cache = { at: Date.now() - CATALOG_TTL_MS + 60_000, value };
    return value;
  }
}

/**
 * Merges live provider costs/colours onto the studio product, keeping the
 * studio's print-area geometry (providers do not express placement the way the
 * preview needs) and never dropping a colour the UI already offers.
 */
export function mergeProviderData(
  studioProduct: CatalogProduct,
  providerProduct: PodProduct,
  variants: PodVariant[]
): CatalogProduct {
  const relevant = variants.filter((v) => v.availability !== "discontinued");
  const byColor = new Map<string, PodVariant>();
  for (const variant of relevant) {
    const key = slug(variant.color ?? "");
    if (key && !byColor.has(key)) byColor.set(key, variant);
  }

  const colors = studioProduct.colors.map((color) => {
    const match = byColor.get(color.id) ?? byColor.get(slug(color.label));
    return match?.colorHex ? { ...color, hex: match.colorHex } : color;
  });

  const cheapest = relevant
    .map((v) => Number(v.baseCost))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)[0];

  return {
    ...studioProduct,
    name: providerProduct.name || studioProduct.name,
    blurb: studioProduct.blurb,
    colors,
    baseCostUsd: cheapest ?? studioProduct.baseCostUsd,
  };
}

/**
 * Provider variant ids keyed as "colorId/sizeId", stored on the Shopify draft
 * and on the saved design's providerRefs — this is what the cart route later
 * reads to put a real supplier variant id on the order.
 */
export async function getProviderVariantMap(studioProduct: CatalogProduct): Promise<{
  map: Record<string, string>;
  mode: CatalogMode;
  providerName?: string;
  catalogProductExternalId?: string;
  warning?: string;
}> {
  const resolved = resolveProviderForProduct(studioProduct);
  if (!resolved) {
    return {
      map: {},
      mode: "mock",
      warning:
        "No configured POD provider has a catalog entry for this product, so no provider variant ids " +
        "were mapped. The Shopify draft is created without fulfillment variant ids; re-publish once " +
        "credentials and a catalog entry (blueprintId for Printify, catalogProductId for Printful) exist.",
    };
  }

  try {
    const variants = await resolved.adapter.getVariants(resolved.externalId);
    const map: Record<string, string> = {};
    for (const variant of variants) {
      const colorId = slug(variant.color ?? "");
      const sizeId = (variant.size ?? "").toUpperCase();
      if (colorId && sizeId) map[`${colorId}/${sizeId}`] = variant.externalId;
    }
    return {
      map,
      mode: "live",
      providerName: resolved.adapter.providerName,
      catalogProductExternalId: resolved.externalId,
    };
  } catch (err) {
    return {
      map: {},
      mode: "mock",
      warning: `${resolved.adapter.providerName} variant lookup failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
