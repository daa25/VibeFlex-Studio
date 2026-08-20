import { NextRequest, NextResponse } from "next/server";
import { createCart, type CartAttribute } from "@/integrations/shopify/storefront-client";
import { getDesignByReference, setDesignCheckoutUrl } from "@/lib/repository";
import { env } from "@/lib/env";
import { prepareDesign, withIdempotency } from "@/lib/studio-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/studio/cart — hands a customized configuration to Shopify checkout.
 *
 * The customization travels as line-item attributes, which Shopify keeps on
 * the order permanently. That is what makes the order fulfillable: artwork URL,
 * print geometry in inches, garment, colour, placement and the studio
 * reference are all readable from the order in Admin and via the Orders API.
 */
export async function POST(req: NextRequest) {
  let body: { design?: unknown; reference?: string; merchandiseId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!env.shopDomain() || !env.shopifyStorefrontToken()) {
    return NextResponse.json(
      {
        error: "Shopify checkout is not configured, so this design could not be added to a cart.",
        missingEnv: [
          ...(env.shopDomain() ? [] : ["SHOPIFY_SHOP_DOMAIN"]),
          ...(env.shopifyStorefrontToken() ? [] : ["SHOPIFY_STOREFRONT_ACCESS_TOKEN"]),
        ],
        howToFix:
          "Shopify Admin → Settings → Apps and sales channels → Develop apps → your app → API credentials → Storefront API. Install, then copy the Storefront API access token.",
      },
      { status: 503 }
    );
  }

  const prepared = prepareDesign(body.design);
  if (!prepared.ok) {
    return NextResponse.json(
      { error: prepared.failure.error, warnings: prepared.failure.warnings ?? [] },
      { status: prepared.failure.status }
    );
  }

  const { design, pricing, geometry, provider } = prepared.value;

  // Resolve the variant to buy: explicit merchandiseId wins, otherwise the
  // published Shopify variant recorded against the saved design.
  let merchandiseId = body.merchandiseId;
  if (!merchandiseId && body.reference) {
    const saved = await getDesignByReference(body.reference);
    merchandiseId = saved?.shopifyVariantIds?.[0];
  }
  if (!merchandiseId) {
    return NextResponse.json(
      {
        error:
          "No Shopify variant is associated with this design yet. Publish it as a draft product first (and make the product available to the Storefront sales channel), then add it to a cart.",
        reference: body.reference ?? null,
      },
      { status: 409 }
    );
  }

  const attributes: CartAttribute[] = [
    { key: "Studio reference", value: body.reference ?? "unsaved" },
    { key: "Product", value: design.product.name },
    { key: "Colour", value: design.color.label },
    { key: "Size", value: design.size.label },
    { key: "Artwork file", value: design.config.artwork.fileName },
    { key: "_artwork_url", value: design.config.artwork.url },
    { key: "_artwork_asset_id", value: design.config.artwork.assetId },
    { key: "_print_geometry_in", value: JSON.stringify(geometry) },
    { key: "_pod_provider", value: provider },
    { key: "_unit_cost_usd", value: pricing.unitCost.toFixed(2) },
  ];

  const result = await withIdempotency(req.headers.get("Idempotency-Key"), async () => {
    try {
      const cart = await createCart(merchandiseId!, design.config.quantity, {
        lineAttributes: attributes,
        cartAttributes: [{ key: "studio_reference", value: body.reference ?? "unsaved" }],
      });

      if (body.reference) await setDesignCheckoutUrl(body.reference, cart.checkoutUrl);

      return { status: 200, body: { cart, pricing, attributes: attributes.map((a) => a.key) } };
    } catch (err) {
      return {
        status: 502,
        body: { error: err instanceof Error ? err.message : "Cart creation failed." },
      };
    }
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Idempotent-Replay": String(result.replayed) },
  });
}
