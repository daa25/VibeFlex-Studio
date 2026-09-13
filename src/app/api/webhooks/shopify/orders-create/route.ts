import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { buildFulfillmentPlan, type ShopifyOrderPayload } from "@/lib/fulfillment/order-mapper";
import { planProduction } from "@/lib/fulfillment/production-planner";
import { getProductionProviders } from "@/lib/fulfillment/production-runtime";
import { recordOrderLine } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/shopify/orders-create
 *
 * Verifies Shopify's HMAC over the RAW body (any JSON re-serialization breaks
 * the signature), records each customized line, and builds the provider
 * payload. Submission to the printer stays behind FULFILLMENT_AUTO_SUBMIT so
 * nobody accidentally sends live production orders while testing.
 */
export async function POST(req: NextRequest) {
  const secret = env.shopifyWebhookSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "SHOPIFY_WEBHOOK_SECRET is not set, so webhook signatures cannot be verified. Refusing the request.",
      },
      { status: 503 }
    );
  }

  const raw = await req.text();
  const signature = req.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!verifyHmac(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let order: ShopifyOrderPayload;
  try {
    order = JSON.parse(raw) as ShopifyOrderPayload;
  } catch {
    return NextResponse.json({ error: "Malformed webhook body." }, { status: 400 });
  }

  const plan = buildFulfillmentPlan(order, env.podProvider());

  // Route the order to a production provider. The in-house line is always a
  // candidate, so a verified order becomes a routed production decision even
  // when no external vendor is configured. This PLANS and ROUTES only — it
  // never submits. External routes carry requiresApproval so nothing paid is
  // sent to a vendor without explicit owner authorization.
  const production = await planProduction(plan, getProductionProviders());

  // Always 200 after a verified signature: a non-2xx makes Shopify retry, and
  // a business-logic problem is not something a retry can fix.
  for (const item of plan.items) {
    await recordOrderLine({
      shopifyOrderId: plan.orderId,
      shopifyLineItemId: item.lineItemId,
      designReference: item.studioReference,
      artworkUrl: item.artworkUrl,
      provider: item.provider,
      payload: {
        item,
        orderName: plan.orderName,
        routedTo: production.decision?.chosenName ?? null,
        routeKind: production.decision?.kind ?? null,
        requiresApproval: production.decision?.requiresApproval ?? false,
      },
    });
  }

  return NextResponse.json({
    received: true,
    orderId: plan.orderId,
    customizedLines: plan.items.length,
    skippedLines: plan.skipped.length,
    submittable: plan.submittable,
    autoSubmitEnabled: env.autoSubmitFulfillment(),
    blockers: plan.items.flatMap((i) => i.blockers),
    routing: production.decision
      ? {
          chosen: production.decision.chosenName,
          kind: production.decision.kind,
          requiresApproval: production.decision.requiresApproval,
          reason: production.decision.reason,
        }
      : null,
  });
}

function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
