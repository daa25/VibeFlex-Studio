// Local, provider-neutral studio catalog.
//
// This is the catalog the customer-facing studio renders from. It is
// deliberately independent of any POD provider so the studio works before
// Printful/Printify credentials exist. Each variant carries the provider
// variant ids we already know, so a synced catalog can replace this file
// (or be merged into it) without touching the UI.
//
// Costs are in USD and represent blank + print cost, i.e. what fulfillment
// charges us — retail price is derived in src/lib/pricing.ts.

export type PrintArea = {
  id: string; // provider placement id, e.g. "front"
  label: string;
  /** Printable area in inches — used to convert on-screen placement to print files. */
  widthIn: number;
  heightIn: number;
  /** Where the print area sits on the garment render, as % of the render box. */
  box: { top: number; left: number; width: number; height: number };
  /** Minimum artwork pixels for a clean print at ~150 DPI. */
  minPx: { width: number; height: number };
};

export type CatalogColor = {
  id: string;
  label: string;
  hex: string;
  /** Dark garments need a light-artwork warning for DTG. */
  dark: boolean;
};

export type CatalogSize = {
  id: string;
  label: string;
  /** Added to base cost (e.g. 2XL/3XL upcharges). */
  costUpchargeUsd: number;
};

export type CatalogProduct = {
  id: string;
  handle: string;
  name: string;
  blurb: string;
  category: "tee" | "hoodie" | "tank" | "longsleeve";
  /** Garment silhouette used by the preview renderer. */
  silhouette: "tee" | "hoodie" | "tank" | "longsleeve";
  baseCostUsd: number;
  printCostUsd: number;
  colors: CatalogColor[];
  sizes: CatalogSize[];
  printAreas: PrintArea[];
  provider: {
    printful?: { catalogProductId: string };
    printify?: { blueprintId: string; printProviderId: string };
    gelato?: { productUid: string };
  };
  /** Optional: Shopify product handle this maps to, once published. */
  shopifyHandle?: string;
};

const APPAREL_COLORS: CatalogColor[] = [
  { id: "black", label: "Black", hex: "#111113", dark: true },
  { id: "charcoal", label: "Charcoal", hex: "#3f4247", dark: true },
  { id: "royal", label: "Royal Blue", hex: "#1d4ed8", dark: true },
  { id: "white", label: "White", hex: "#f7f7f5", dark: false },
];

const APPAREL_SIZES: CatalogSize[] = [
  { id: "S", label: "S", costUpchargeUsd: 0 },
  { id: "M", label: "M", costUpchargeUsd: 0 },
  { id: "L", label: "L", costUpchargeUsd: 0 },
  { id: "XL", label: "XL", costUpchargeUsd: 0 },
  { id: "2XL", label: "2XL", costUpchargeUsd: 2.5 },
  { id: "3XL", label: "3XL", costUpchargeUsd: 4 },
];

const FRONT_CENTER: PrintArea = {
  id: "front",
  label: "Front (center chest)",
  widthIn: 12,
  heightIn: 16,
  box: { top: 26, left: 30, width: 40, height: 42 },
  minPx: { width: 1800, height: 2400 },
};

const BACK_FULL: PrintArea = {
  id: "back",
  label: "Back (full)",
  widthIn: 12,
  heightIn: 16,
  box: { top: 24, left: 30, width: 40, height: 44 },
  minPx: { width: 1800, height: 2400 },
};

export const CATALOG: CatalogProduct[] = [
  {
    id: "vf-tee-classic",
    handle: "built-different-tee",
    name: "VibeFlex Classic Tee",
    blurb: "Mid-weight 100% ring-spun cotton. The Built Different staple.",
    category: "tee",
    silhouette: "tee",
    baseCostUsd: 9.25,
    printCostUsd: 4.5,
    colors: APPAREL_COLORS,
    sizes: APPAREL_SIZES,
    printAreas: [FRONT_CENTER, BACK_FULL],
    provider: { printful: { catalogProductId: "71" } },
  },
  {
    id: "vf-hoodie-heavy",
    handle: "vibeflex-heavy-hoodie",
    name: "VibeFlex Heavyweight Hoodie",
    blurb: "Fleece-lined, drop-shoulder hoodie built for cold-weather training.",
    category: "hoodie",
    silhouette: "hoodie",
    baseCostUsd: 24.5,
    printCostUsd: 6,
    colors: APPAREL_COLORS,
    sizes: APPAREL_SIZES,
    printAreas: [
      { ...FRONT_CENTER, heightIn: 12, box: { top: 28, left: 32, width: 36, height: 30 } },
      BACK_FULL,
    ],
    provider: { printful: { catalogProductId: "146" } },
  },
  {
    id: "vf-tank-performance",
    handle: "vibeflex-performance-tank",
    name: "VibeFlex Performance Tank",
    blurb: "Lightweight moisture-wicking tank for lifting and game day.",
    category: "tank",
    silhouette: "tank",
    baseCostUsd: 10.75,
    printCostUsd: 4.5,
    colors: APPAREL_COLORS,
    sizes: APPAREL_SIZES.filter((s) => s.id !== "3XL"),
    printAreas: [{ ...FRONT_CENTER, widthIn: 10, box: { top: 26, left: 34, width: 32, height: 40 } }],
    provider: { printful: { catalogProductId: "162" } },
  },
  {
    id: "vf-longsleeve",
    handle: "vibeflex-long-sleeve",
    name: "VibeFlex Long Sleeve",
    blurb: "Cotton long sleeve with room for a full-front or full-back print.",
    category: "longsleeve",
    silhouette: "longsleeve",
    baseCostUsd: 13.5,
    printCostUsd: 5,
    colors: APPAREL_COLORS,
    sizes: APPAREL_SIZES,
    printAreas: [FRONT_CENTER, BACK_FULL],
    provider: { printful: { catalogProductId: "37" } },
  },
];

export function getProduct(id: string): CatalogProduct | undefined {
  return CATALOG.find((p) => p.id === id || p.handle === id);
}

export function getPrintArea(product: CatalogProduct, printAreaId: string): PrintArea | undefined {
  return product.printAreas.find((a) => a.id === printAreaId);
}
