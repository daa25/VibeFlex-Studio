// Shared helpers for creating a real Printify product from a real blueprint
// match (see blueprint-catalog.ts) — used by both the one-off admin script
// and the general auto-create pipeline so the two never drift.

import type { PrintifyAdapter } from "./adapter";

/** First print-area placement key a blueprint/variant actually exposes (e.g. "front"). */
export async function firstPrintAreaId(
  adapter: PrintifyAdapter,
  blueprintId: string,
  variantId: string
): Promise<string | null> {
  const placeholders = await adapter.getPlaceholders(blueprintId, variantId);
  const [firstKey] = Object.keys(placeholders);
  return firstKey ?? null;
}

/** cost * markup, rounded down to the nearest .99. Falls back to a floor price if cost is unknown. */
export function markupRetailPrice(baseCost: number, markup = 1.55): number {
  if (!Number.isFinite(baseCost) || baseCost <= 0) return 24.99;
  const marked = baseCost * markup;
  return Math.floor(marked) + 0.99;
}
