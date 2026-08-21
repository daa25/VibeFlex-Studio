import { NextRequest, NextResponse } from "next/server";
import { getProviderVariantMap } from "@/integrations/pod/catalog-service";
import { adminConfigMissing, ShopifyNotConfiguredError } from "@/integrations/shopify/admin-client";
import { publishDraftProduct } from "@/integrations/shopify/publish-draft";
import { markDesignPublished, newDesignReference, saveDesign } from "@/lib/repository";
import { prepareDesign, withIdempotency } from "@/lib/studio-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/studio/publish — creates a Shopify DRAFT product from a design.
 *
 * Always DRAFT. Protected by the admin gate in src/middleware.ts.
 * Send `Idempotency-Key` to make double-clicks safe.
 */
export async function POST(req: NextRequest) {
  let body: { design?: unknown; reference?: string } ;
  try {
    body = (await req.json()) as { design?: unknown; reference?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const missing = adminConfigMissing();
  if (missing.length) {
    return NextResponse.json(
      {
        error: "Shopify Admin API is not configured, so no draft product was created.",
        missingEnv: missing,
        howToFix:
          "Shopify Admin → Settings → Apps and sales channels → Develop apps → your app → API credentials. Install the app, copy the Admin API access token (needs write_products, read_products, read_orders), and set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_API_ACCESS_TOKEN in the deployment environment.",
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

  const result = await withIdempotency(req.headers.get("Idempotency-Key"), async () => {
    const reference = body.reference?.trim() || newDesignReference();
    const variantMap = await getProviderVariantMap(design.product);
    const providerRefs = {
      mode: variantMap.mode,
      variantIdsByColorSize: variantMap.map,
      catalogProductId: design.product.provider.printful?.catalogProductId ?? null,
    };

    if (!body.reference) {
      await saveDesign({
        reference,
        config: design.config,
        pricing,
        printGeometry: geometry as unknown as Record<string, unknown>[],
        provider,
        providerRefs,
      });
    }

    try {
      const published = await publishDraftProduct({
        design,
        pricing,
        reference,
        provider,
        providerRefs,
        imageUrl: design.config.artwork.url.startsWith("https://")
          ? design.config.artwork.url
          : undefined,
      });

      const persistence = await markDesignPublished({
        reference,
        shopifyProductId: published.productId,
        shopifyVariantIds: published.variantIds,
        shopifyAdminUrl: published.adminUrl,
      });

      return {
        status: 200,
        body: {
          reference,
          shopify: published,
          pricing,
          providerCatalogMode: variantMap.mode,
          providerWarning: variantMap.warning,
          persistence,
        },
      };
    } catch (err) {
      if (err instanceof ShopifyNotConfiguredError) {
        return { status: 503, body: { error: err.message, missingEnv: err.missing, reference } };
      }
      return {
        status: 502,
        body: {
          error: err instanceof Error ? err.message : "Shopify draft creation failed.",
          reference,
        },
      };
    }
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Idempotent-Replay": String(result.replayed) },
  });
}
