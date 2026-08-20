// POD catalog service — SERVER ONLY.
//
// Normalizes provider catalogs into the studio's own product model so the UI
// never depends on a vendor's response shape. Behaviour:
//
//   live  — PRINTFUL_API_KEY present: fetch and normalize the real catalog,
//           cached in-process for CATALOG_TTL_MS.
//   mock  — no credentials: serve src/lib/catalog.ts, clearly flagged
//           `mode: "mock"` in every response so the UI can badge it.
//
// A live-mode API failure falls back to mock rather than breaking the studio,
// and reports the error alongside the data.

import { CATALOG, type CatalogProduct } from "@/lib/catalog";
import { env } from "@/lib/env";
import { PrintfulAdapter } from "./printful/adapter";
import type { PodProduct, PodVariant } from "./types";

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

export function getPrintfulAdapter(): PrintfulAdapter | null {
  if (!printfulConfigured()) return null;
  return new PrintfulAdapter(env.printfulApiKey()!, env.printfulStoreId()!);
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
      "Running on the built-in VibeFlex catalog. Set PRINTFUL_API_KEY and PRINTFUL_STORE_ID to sync live products, variants and costs.",
  });

  const adapter = getPrintfulAdapter();
  if (!adapter) {
    const value = mock();
    cache = { at: Date.now(), value };
    return value;
  }

  try {
    const products = await Promise.all(
      CATALOG.map(async (studioProduct) => {
        const externalId = studioProduct.provider.printful?.catalogProductId;
        if (!externalId) return studioProduct;
        const [providerProduct, variants] = await Promise.all([
          adapter.getProduct(externalId),
          adapter.getVariants(externalId),
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
      `Printful catalog sync failed, serving the built-in catalog instead: ${
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

/** Provider variant ids keyed as "colorId/sizeId", stored on the Shopify draft. */
export async function getProviderVariantMap(
  studioProduct: CatalogProduct
): Promise<{ map: Record<string, string>; mode: CatalogMode; warning?: string }> {
  const adapter = getPrintfulAdapter();
  const externalId = studioProduct.provider.printful?.catalogProductId;
  if (!adapter || !externalId) {
    return {
      map: {},
      mode: "mock",
      warning:
        "Printful is not configured, so no provider variant ids were mapped. The Shopify draft is created without fulfillment variant ids; re-publish after adding PRINTFUL_API_KEY to attach them.",
    };
  }

  try {
    const variants = await adapter.getVariants(externalId);
    const map: Record<string, string> = {};
    for (const variant of variants) {
      const colorId = slug(variant.color ?? "");
      const sizeId = (variant.size ?? "").toUpperCase();
      if (colorId && sizeId) map[`${colorId}/${sizeId}`] = variant.externalId;
    }
    return { map, mode: "live" };
  } catch (err) {
    return {
      map: {},
      mode: "mock",
      warning: `Printful variant lookup failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
