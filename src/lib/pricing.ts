// Pricing engine.
//
// Single source of truth for what a customized product costs. The studio UI
// renders these numbers, and the cart API recomputes them server-side so a
// tampered client payload can never set its own price.

import { getPrintArea, type CatalogProduct } from "./catalog";

export type PricingInput = {
  product: CatalogProduct;
  sizeId: string;
  printAreaIds: string[];
  quantity: number;
};

export type PriceBreakdown = {
  currency: "USD";
  quantity: number;
  /** Per-unit values, in dollars. */
  blankCost: number;
  printCost: number;
  sizeUpcharge: number;
  unitCost: number;
  unitPrice: number;
  unitProfit: number;
  marginPct: number;
  subtotal: number;
  /** Human-readable lines for the UI. */
  lines: { label: string; amount: number }[];
};

/** Target gross margin on the retail price. Tuned so a $13.75 tee lands at $34.99. */
export const TARGET_MARGIN = 0.6;
/** Every additional print location beyond the first. */
export const EXTRA_PLACEMENT_COST = 4.5;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Charm pricing: always land on a .99 price point, never below cost + 30%. */
export function toCharmPrice(raw: number, floor: number): number {
  const candidate = Math.max(raw, floor);
  const price = Math.max(Math.ceil(candidate) - 0.01, Math.floor(candidate) + 0.99);
  return round2(price < candidate ? price + 1 : price);
}

export function calculatePrice(input: PricingInput): PriceBreakdown {
  const { product, sizeId, quantity } = input;

  const size = product.sizes.find((s) => s.id === sizeId);
  if (!size) throw new Error(`Unknown size "${sizeId}" for product ${product.id}`);

  const placements = input.printAreaIds.filter((id) => getPrintArea(product, id));
  if (placements.length === 0) throw new Error("At least one print area is required");

  const qty = Math.max(1, Math.min(500, Math.floor(quantity)));

  const blankCost = round2(product.baseCostUsd);
  const printCost = round2(
    product.printCostUsd + Math.max(0, placements.length - 1) * EXTRA_PLACEMENT_COST
  );
  const sizeUpcharge = round2(size.costUpchargeUsd);
  const unitCost = round2(blankCost + printCost + sizeUpcharge);

  const unitPrice = toCharmPrice(unitCost / (1 - TARGET_MARGIN), unitCost * 1.3);
  const unitProfit = round2(unitPrice - unitCost);
  const marginPct = round2((unitProfit / unitPrice) * 100);

  return {
    currency: "USD",
    quantity: qty,
    blankCost,
    printCost,
    sizeUpcharge,
    unitCost,
    unitPrice,
    unitProfit,
    marginPct,
    subtotal: round2(unitPrice * qty),
    lines: [
      { label: `${product.name} (${size.label})`, amount: unitPrice },
      ...(placements.length > 1
        ? [
            {
              label: `${placements.length - 1} extra print location${placements.length > 2 ? "s" : ""}`,
              amount: 0,
            },
          ]
        : []),
    ],
  };
}
