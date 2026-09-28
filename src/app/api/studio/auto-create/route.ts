// POST /api/studio/auto-create — "upload once, get every fitting product."
//
// Takes one already-uploaded artwork (from POST /api/uploads) and, for each
// blank in the fixed starter lineup (tee, hoodie, crewneck, tank, cap):
//   1. Matches a REAL blueprint + print provider from Printify's live catalog
//      (never a hardcoded id — see blueprint-catalog.ts).
//   2. Creates the product in Printify, unpublished, across every real
//      available variant for that blueprint.
//   3. Writes real title/description/SEO copy (OpenAI when configured,
//      otherwise a deterministic fallback — see product-copy.ts).
//   4. Creates a matching Shopify DRAFT product (never ACTIVE) with the full
//      color/size variant range and the artwork attached as media.
//
// The artwork is first re-hosted to Shopify Files so every downstream step
// (Printify upload, Shopify media) has one permanent, public URL regardless
// of whether Supabase Storage is configured for the original upload.
//
// One garment failing (no blueprint match, Printify error, Shopify error)
// never aborts the others — each is reported independently in the response.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { AiAnalysis } from "@/lib/artwork-analysis";
import { generateProductCopy } from "@/lib/product-copy";
import { getPrintifyAdapter } from "@/integrations/pod/catalog-service";
import { STARTER_BLUEPRINT_TARGETS, findBlueprint } from "@/integrations/pod/printify/blueprint-catalog";
import { firstPrintAreaId, markupRetailPrice } from "@/integrations/pod/printify/product-creation";
import { rehostArtworkToShopify } from "@/integrations/shopify/files";
import { publishPodDraftProduct } from "@/integrations/shopify/publish-pod-product";
import { resolvePublicUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BRAND_NAME = "VibeFlex Sports";

type RequestBody = {
  artwork: {
    assetId: string;
    url: string;
    fileName: string;
    mimeType?: string;
    width?: number;
    height?: number;
  };
  analysis?: { ai: AiAnalysis | null };
};

type GarmentResult = {
  slug: string;
  garmentLabel: string;
  blueprintId?: string;
  blueprintTitle?: string;
  printify?: { productId: string; variantCount: number };
  shopify?: { productId: string; adminUrl: string; mediaAttached: boolean; mediaWarning?: string };
  copySource?: "ai" | "fallback";
  skippedReason?: string;
  shopifyError?: string;
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with an 'artwork' object." }, { status: 400 });
  }

  if (!body.artwork?.url || !body.artwork?.assetId) {
    return NextResponse.json(
      { error: "Missing artwork.url / artwork.assetId. Upload via POST /api/uploads first and pass its 'artwork' object here." },
      { status: 400 }
    );
  }

  const adapter = getPrintifyAdapter();
  if (!adapter) {
    return NextResponse.json(
      { error: "Printify is not configured (PRINTIFY_API_KEY / PRINTIFY_SHOP_ID missing)." },
      { status: 503 }
    );
  }

  const absoluteSourceUrl = resolvePublicUrl(body.artwork.url);
  if (!/^https:\/\//.test(absoluteSourceUrl)) {
    return NextResponse.json(
      {
        error:
          "Could not resolve a public https URL for this artwork (NEXT_PUBLIC_BASE_URL/VERCEL_URL missing and the " +
          "upload was not stored in Supabase). Printify and Shopify both require a real public URL to fetch the image from.",
      },
      { status: 422 }
    );
  }

  let artworkCdnUrl: string;
  try {
    artworkCdnUrl = await rehostArtworkToShopify({
      sourceUrl: absoluteSourceUrl,
      filename: body.artwork.fileName,
      alt: `${BRAND_NAME} artwork — ${body.artwork.fileName}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not re-host artwork to a permanent URL: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 }
    );
  }

  const reference = `AUTO-${randomUUID().slice(0, 8).toUpperCase()}`;
  const catalog = await adapter.getCatalog();
  const results: GarmentResult[] = [];

  for (const target of STARTER_BLUEPRINT_TARGETS) {
    const result: GarmentResult = { slug: target.slug, garmentLabel: target.label };

    try {
      const blueprint = findBlueprint(catalog, target.keywords);
      if (!blueprint) {
        result.skippedReason = `No catalog blueprint matched keywords: ${target.keywords.join(", ")}`;
        results.push(result);
        continue;
      }
      result.blueprintId = blueprint.externalId;
      result.blueprintTitle = blueprint.name;

      const variants = await adapter.getVariants(blueprint.externalId);
      const available = variants.filter((v) => v.availability !== "discontinued" && v.externalId && v.color && v.size);
      if (available.length === 0) {
        result.skippedReason = `Blueprint "${blueprint.name}" (${blueprint.externalId}) has no available variants.`;
        results.push(result);
        continue;
      }

      const printAreaId = await firstPrintAreaId(adapter, blueprint.externalId, available[0]!.externalId);
      if (!printAreaId) {
        result.skippedReason = `Blueprint "${blueprint.name}" (${blueprint.externalId}) exposes no print-area placeholders.`;
        results.push(result);
        continue;
      }

      const retailPriceByVariant: Record<string, number> = {};
      for (const v of available) retailPriceByVariant[v.externalId] = markupRetailPrice(v.baseCost);

      const printifyProduct = await adapter.createFulfillmentProduct({
        name: `${BRAND_NAME} ${target.label} — ${reference}`,
        catalogProductExternalId: blueprint.externalId,
        printAreaId,
        artworkFileUrl: artworkCdnUrl,
        variantExternalIds: available.map((v) => v.externalId),
        retailPriceByVariant,
      });
      result.printify = { productId: printifyProduct.providerProductId, variantCount: available.length };

      const copyResult = await generateProductCopy({
        brandName: BRAND_NAME,
        garmentLabel: target.label,
        blueprintTitle: blueprint.name,
        analysis: body.analysis?.ai ?? null,
      });
      result.copySource = copyResult.source;

      try {
        const shopifyResult = await publishPodDraftProduct({
          title: copyResult.copy.title,
          descriptionHtml: copyResult.copy.descriptionHtml,
          vendor: BRAND_NAME,
          productType: target.label,
          tags: ["vibeflex", "print-on-demand", "studio-auto", reference],
          imageUrl: artworkCdnUrl,
          metafields: [
            { key: "studio_reference", type: "single_line_text_field", value: reference },
            { key: "artwork_url", type: "url", value: artworkCdnUrl },
            { key: "artwork_asset_id", type: "single_line_text_field", value: body.artwork.assetId },
            { key: "pod_provider", type: "single_line_text_field", value: "printify" },
            { key: "provider_product_id", type: "single_line_text_field", value: printifyProduct.providerProductId },
            { key: "seo_title", type: "single_line_text_field", value: copyResult.copy.seoTitle },
            { key: "meta_description", type: "single_line_text_field", value: copyResult.copy.metaDescription },
          ],
          variants: available.map((v) => ({
            color: v.color!,
            size: v.size!,
            price: retailPriceByVariant[v.externalId]!,
            cost: v.baseCost,
            providerVariantId: v.externalId,
            sku: buildSku(reference, target.slug, v.color!, v.size!),
          })),
        });
        result.shopify = {
          productId: shopifyResult.productId,
          adminUrl: shopifyResult.adminUrl,
          mediaAttached: shopifyResult.mediaAttached,
          mediaWarning: shopifyResult.mediaWarning,
        };
      } catch (err) {
        result.shopifyError = err instanceof Error ? err.message : "Unknown error creating the Shopify draft.";
      }
    } catch (err) {
      result.skippedReason = err instanceof Error ? err.message : "Unknown error creating this product.";
    }

    results.push(result);
  }

  return NextResponse.json({
    reference,
    artworkUrl: artworkCdnUrl,
    results,
    note:
      "Printify products are created UNPUBLISHED and Shopify products as DRAFT. Nothing here is customer-visible " +
      "until you activate it yourself.",
  });
}

function buildSku(reference: string, slug: string, color: string, size: string): string {
  return [reference, slug.toUpperCase(), color, size]
    .join("-")
    .replace(/[^A-Z0-9-]/gi, "")
    .toUpperCase();
}
