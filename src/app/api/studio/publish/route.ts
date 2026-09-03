import { NextRequest, NextResponse } from "next/server";
import { getProviderVariantMap } from "@/integrations/pod/catalog-service";
import { adminConfigMissing, ShopifyNotConfiguredError } from "@/integrations/shopify/admin-client";
import { publishDraftProduct } from "@/integrations/shopify/publish-draft";
import { findExistingDraftByReference, verifyDraftProduct } from "@/integrations/shopify/verify-draft";
import { generateMockup } from "@/lib/mockup-service";
import { markDesignPublished, newDesignReference, saveDesign } from "@/lib/repository";
import { prepareDesign, withIdempotency } from "@/lib/studio-service";
import { runVisualQa } from "@/lib/visual-qa";

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

    // Durable idempotency: the in-memory cache only protects a warm process, so
    // ask Shopify whether this reference already has a draft before creating one.
    if (body.reference) {
      const existing = await findExistingDraftByReference(reference).catch(() => null);
      if (existing) {
        const verification = await verifyDraftProduct(existing);
        return {
          status: 200,
          body: {
            reference,
            shopify: { productId: existing, status: verification.snapshot.status },
            verification,
            deduplicated: true,
            note: "A draft already exists for this studio reference; no duplicate was created.",
          },
        };
      }
    }

    // STAGE: production mockup. The uploaded artwork is the print file — it is
    // never the product photo. If no mockup can be rendered we publish without
    // media rather than shipping the print file as the hero image.
    const mockup = await generateMockup({
      design,
      artworkUrl: design.config.artwork.url,
      variantExternalIds: Object.values(variantMap.map),
    });

    // STAGE: visual QA. Runs before anything is attached to Shopify.
    const qa = mockup.heroUrl
      ? await runVisualQa({
          imageUrl: mockup.heroUrl,
          provenance: "provider_mockup",
          expected: {
            garmentType: design.product.name,
            garmentColor: design.color.label,
          },
        })
      : {
          verdict: "PENDING" as const,
          findings: [
            {
              code: "NO_MOCKUP",
              severity: "blocker" as const,
              detail: mockup.message ?? "No mockup was produced.",
            },
          ],
          checkedUrl: "",
          aiStatus: "skipped" as const,
        };

    const heroForShopify = mockup.heroUrl && qa.verdict !== "REJECTED" ? mockup.heroUrl : undefined;

    try {
      const published = await publishDraftProduct({
        design,
        pricing,
        reference,
        provider,
        providerRefs,
        imageUrl: heroForShopify,
      });

      const persistence = await markDesignPublished({
        reference,
        shopifyProductId: published.productId,
        shopifyVariantIds: published.variantIds,
        shopifyAdminUrl: published.adminUrl,
      });

      // STAGE: read-back. A mutation response is not proof. Re-query Shopify and
      // assert the fields we care about before calling this a success.
      const verification = await verifyDraftProduct(published.productId);

      return {
        status: 200,
        body: {
          reference,
          shopify: published,
          mockup,
          qa,
          verification,
          pricing,
          providerCatalogMode: variantMap.mode,
          providerWarning: variantMap.warning,
          persistence,
          // The pipeline only succeeded if Shopify agrees AND QA did not reject.
          pipelineOk: verification.verified && qa.verdict !== "REJECTED",
          blocker: qa.verdict === "REJECTED" ? "ASSET REQUIRED — STUDIO" : undefined,
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
