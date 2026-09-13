// Production planner — the bridge from a paid Shopify order to a routed
// production job.
//
// A verified Shopify order becomes a FulfillmentPlan (order-mapper), which this
// module turns into a provider-neutral ProductionOrderInput and routes through
// the production router. The output says WHERE the order should be produced
// (VibeFlex in-house vs an external provider) and whether owner approval is
// required before any external submission.
//
// This module PLANS and ROUTES. It never submits. Submission stays behind the
// provider's own approval gate plus the upstream policy gates.

import type { FulfillmentPlan } from "./order-mapper";
import {
  DEFAULT_ROUTING_POLICY,
  routeProduction,
  type RoutingDecision,
  type RoutingPolicy,
} from "@/integrations/pod/production-router";
import type {
  ProductionLineItem,
  ProductionOrderInput,
  ProductionProvider,
} from "@/integrations/pod/production-types";

export type ProductionPlan = {
  orderId: string;
  /** True only when every customized line is free of fulfillment blockers. */
  submittable: boolean;
  /** The routing decision, or null when the order is not submittable. */
  decision: RoutingDecision | null;
  /** Retail-per-variant used for margin routing (from the price the buyer paid). */
  retailByVariant: Record<string, number>;
  /** Blockers gathered from the fulfillment plan (missing artwork, variant id, etc.). */
  blockers: string[];
};

function toProductionOrder(plan: FulfillmentPlan): {
  order: ProductionOrderInput;
  retailByVariant: Record<string, number>;
} {
  const lineItems: ProductionLineItem[] = [];
  const retailByVariant: Record<string, number> = {};

  for (const item of plan.items) {
    const providerVariantId = item.providerVariantId ?? "";
    const geo = item.geometry[0];
    lineItems.push({
      sku: item.studioReference ?? item.lineItemId,
      quantity: item.quantity,
      providerVariantId,
      artworkUrl: item.artworkUrl ?? "",
      technique: item.technique,
      printAreaId: geo?.printAreaId ?? "front",
      position: geo
        ? {
            area_width: geo.widthIn,
            area_height: geo.heightIn,
            width: geo.widthIn,
            height: geo.heightIn,
            top: geo.topIn,
            left: geo.leftIn,
          }
        : undefined,
    });
    if (item.unitPrice !== undefined && providerVariantId) {
      retailByVariant[providerVariantId] = item.unitPrice;
    }
  }

  return {
    order: { studioOrderId: plan.orderId, lineItems, shipTo: {} },
    retailByVariant,
  };
}

/**
 * Route a fulfillment plan to a production provider. An order with blockers is
 * not routed — it returns submittable:false and the blockers so the order sits
 * in review rather than being pushed anywhere.
 */
export async function planProduction(
  plan: FulfillmentPlan,
  providers: ProductionProvider[],
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY
): Promise<ProductionPlan> {
  const blockers = plan.items.flatMap((i) => i.blockers);

  if (!plan.submittable) {
    return {
      orderId: plan.orderId,
      submittable: false,
      decision: null,
      retailByVariant: {},
      blockers,
    };
  }

  const { order, retailByVariant } = toProductionOrder(plan);
  const decision = await routeProduction(order, providers, retailByVariant, policy);

  return {
    orderId: plan.orderId,
    submittable: true,
    decision,
    retailByVariant,
    blockers,
  };
}
