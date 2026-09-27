// Real-catalog blueprint matching for the "one artwork -> many products"
// auto-create flow.
//
// This sandbox/deployment intentionally never hardcodes a Printify
// blueprint/print-provider id: those only exist as real values inside
// Printify's live catalog, which this module queries at request time
// (PrintifyAdapter.getCatalog() -> /catalog/blueprints.json). Matching is by
// keyword against real blueprint titles, first match wins, so a missing
// keyword produces a clear "no match" rather than a silently wrong guess.

import type { PodProduct } from "../types";

export type BlueprintTarget = {
  /** Stable identifier for this garment slot, independent of any blueprint id. */
  slug: string;
  /** Human label used in generated product titles/tags. */
  label: string;
  /** Tried in order against real blueprint titles (case-insensitive substring). */
  keywords: string[];
};

/**
 * The fixed starter lineup every artwork upload is matched against. Ordered
 * by preference within each slot: a well-known specific blank (e.g. Bella+
 * Canvas 3001) is tried before a generic fallback keyword.
 */
export const STARTER_BLUEPRINT_TARGETS: BlueprintTarget[] = [
  {
    slug: "tee",
    label: "Tee",
    keywords: ["bella+canvas 3001", "unisex jersey short sleeve tee", "unisex t-shirt", "t-shirt"],
  },
  {
    slug: "hoodie",
    label: "Hoodie",
    keywords: ["gildan 18500", "unisex heavy blend hooded sweatshirt", "hooded sweatshirt", "hoodie"],
  },
  {
    slug: "crewneck",
    label: "Crewneck",
    keywords: ["gildan 18000", "unisex heavy blend crewneck", "crewneck sweatshirt", "crewneck"],
  },
  {
    slug: "tank",
    label: "Tank",
    keywords: ["bella+canvas 3480", "unisex jersey tank", "tank top", "tank"],
  },
  {
    slug: "cap",
    label: "Cap",
    keywords: ["snapback", "trucker cap", "dad hat", "5-panel", "cap"],
  },
];

export function findBlueprint(catalog: PodProduct[], keywords: string[]): PodProduct | null {
  for (const keyword of keywords) {
    const match = catalog.find((item) => item.name.toLowerCase().includes(keyword.toLowerCase()));
    if (match) return match;
  }
  return null;
}
