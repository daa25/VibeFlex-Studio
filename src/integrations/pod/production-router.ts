// Production routing.
//
// Given a Studio order and the set of registered providers, decide WHERE the
// work should be produced — VibeFlex's in-house line or an external provider —
// based on capability, capacity, cost, margin and destination.
//
// Two invariants the router never breaks:
//   1. VibeFlex owns the decision. Local is preferred when it can do the job
//      within capacity; external is a considered alternative, not the default.
//   2. External is never chosen as an AUTO route. When the best route is an
//      external provider, the decision carries requiresApproval = true so the
//      caller must obtain explicit owner authorization before submitting.

import type {
  ProductionLineItem,
  ProductionOrderInput,
  ProductionProvider,
  ProviderKind,
} from "./production-types";

export type RoutingPolicy = {
  /** Prefer the in-house line whenever it is capable and within capacity. */
  preferLocal: boolean;
  /** Reject any route whose blended margin falls below this (percent). */
  minMarginPct: number;
};

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  preferLocal: true,
  minMarginPct: 30,
};

export type RouteCandidate = {
  providerName: string;
  kind: ProviderKind;
  canProduce: boolean;
  withinCapacity: boolean;
  landedUnitCost: number | null;
  marginPct: number | null;
  eligible: boolean;
  reason: string;
};

export type RoutingDecision = {
  chosen: ProductionProvider | null;
  chosenName: string | null;
  kind: ProviderKind | null;
  /** True when the chosen route is an external provider that must be approved. */
  requiresApproval: boolean;
  reason: string;
  candidates: RouteCandidate[];
};

function totalUnits(items: ProductionLineItem[]): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

// Blended margin across the order at the given retail-by-variant.
function blendedMarginPct(
  items: ProductionLineItem[],
  landedUnitCost: number,
  retailByVariant: Record<string, number>
): number | null {
  let retail = 0;
  let cost = 0;
  for (const it of items) {
    const r = retailByVariant[it.providerVariantId];
    if (r === undefined) return null;
    retail += r * it.quantity;
    cost += landedUnitCost * it.quantity;
  }
  if (retail <= 0) return null;
  return Number((((retail - cost) / retail) * 100).toFixed(1));
}

export async function routeProduction(
  order: ProductionOrderInput,
  providers: ProductionProvider[],
  retailByVariant: Record<string, number>,
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY
): Promise<RoutingDecision> {
  const country = order.shipTo.country ?? "US";
  const units = totalUnits(order.lineItems);
  const candidates: RouteCandidate[] = [];

  for (const provider of providers) {
    const canProduce = order.lineItems.every((i) => provider.canProduce(i, country));
    const cap = provider.capabilities.dailyCapacity;
    const withinCapacity = cap === null || units <= cap;

    let landedUnitCost: number | null = null;
    let marginPct: number | null = null;

    if (canProduce) {
      // Cost the most expensive line as the per-unit landed cost proxy so the
      // margin check is conservative.
      const estimates = await Promise.all(
        order.lineItems.map((i) => provider.estimateUnitCost(i, country))
      );
      landedUnitCost = Math.max(
        ...estimates.map((e) => e.baseCost + e.estimatedShipping)
      );
      marginPct = blendedMarginPct(order.lineItems, landedUnitCost, retailByVariant);
    }

    const meetsMargin = marginPct !== null && marginPct >= policy.minMarginPct;
    const eligible = canProduce && withinCapacity && meetsMargin;

    candidates.push({
      providerName: provider.providerName,
      kind: provider.kind,
      canProduce,
      withinCapacity,
      landedUnitCost,
      marginPct,
      eligible,
      reason: !canProduce
        ? "Cannot produce one or more line items (technique, destination or missing variant id)."
        : !withinCapacity
          ? `Order of ${units} units exceeds ${provider.providerName} capacity (${cap}).`
          : marginPct === null
            ? "Retail price missing for a line item; margin uncomputable."
            : !meetsMargin
              ? `Margin ${marginPct}% is below the ${policy.minMarginPct}% floor.`
              : "Eligible.",
    });
  }

  const eligible = candidates.filter((c) => c.eligible);

  if (eligible.length === 0) {
    return {
      chosen: null,
      chosenName: null,
      kind: null,
      requiresApproval: false,
      reason:
        "No provider can produce this order within capacity and margin. Escalate to owner (adjust price, split the order, or add capacity).",
      candidates,
    };
  }

  // Local-first: if the in-house line is eligible and policy prefers local, take
  // it. Otherwise pick the eligible route with the best margin.
  const byBestMargin = [...eligible].sort(
    (a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0)
  );
  const localEligible = eligible.find((c) => c.kind === "local");
  const winner =
    policy.preferLocal && localEligible ? localEligible : byBestMargin[0]!;

  const chosen = providers.find((p) => p.providerName === winner.providerName)!;
  const requiresApproval = chosen.kind === "external";

  return {
    chosen,
    chosenName: chosen.providerName,
    kind: chosen.kind,
    requiresApproval,
    reason:
      chosen.kind === "local"
        ? `Routed to the in-house line (${winner.marginPct}% margin, within capacity).`
        : `Routed to external provider ${chosen.providerName} (${winner.marginPct}% margin). Requires owner approval before submission.`,
    candidates,
  };
}
