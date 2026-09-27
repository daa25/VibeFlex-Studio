// GET /api/admin/create-490-products — one-off setup endpoint.
//
// Creates three real "490 Movement" apparel products (tee, hoodie, cap) in
// the connected Printify shop, using the real live Printify catalog to pick
// blueprint + print provider (never a guessed/hardcoded id — this sandbox
// has no network egress to api.printify.com, so blueprint selection can only
// happen inside a real Printify API call, which this route makes at request
// time from Vercel's runtime).
//
// Artwork is the real "490" varsity logo, already uploaded to Shopify Files
// for a permanent CDN URL (Printify fetches it directly).
//
// Products are created UNPUBLISHED in Printify (the API's default) — nothing
// here activates a product or pushes it live. Run this once by visiting the
// URL with the configured secret; it is not on a schedule and is safe to
// re-run (it just creates additional products rather than mutating existing
// ones).

import { NextRequest, NextResponse } from "next/server";
import { getPrintifyAdapter } from "@/integrations/pod/catalog-service";
import type { PrintifyAdapter } from "@/integrations/pod/printify/adapter";
import type { PodProduct } from "@/integrations/pod/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARTWORK_URL =
  "https://cdn.shopify.com/s/files/1/0703/7059/0958/files/490-movement-varsity-logo.png?v=1790542115";

type BlueprintMatch = {
  slug: string;
  title: string;
  keywords: string[];
};

// Ordered by preference within each product type — first keyword match wins,
// so "unisex" / well-known blank styles are tried before a generic fallback.
const TARGETS: BlueprintMatch[] = [
  { slug: "tee", title: "490 Movement Tee", keywords: ["bella+canvas 3001", "unisex jersey short sleeve tee", "unisex t-shirt", "t-shirt"] },
  { slug: "hoodie", title: "490 Movement Hoodie", keywords: ["gildan 18500", "unisex heavy blend hooded sweatshirt", "hooded sweatshirt", "hoodie"] },
  { slug: "cap", title: "490 Movement Cap", keywords: ["snapback", "trucker cap", "dad hat", "5-panel", "cap"] },
];

type CreatedProduct = {
  slug: string;
  blueprintId: string;
  blueprintTitle: string;
  productId: string;
  variantCount: number;
  printAreaId: string;
};

type SkippedProduct = {
  slug: string;
  reason: string;
};

export async function GET(req: NextRequest) {
  const secret = process.env.ADMIN_SETUP_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_SETUP_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }
  if (req.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adapter = getPrintifyAdapter();
  if (!adapter) {
    return NextResponse.json(
      { error: "Printify is not configured (PRINTIFY_API_KEY / PRINTIFY_SHOP_ID missing)." },
      { status: 503 }
    );
  }

  const catalog = await adapter.getCatalog();
  const created: CreatedProduct[] = [];
  const skipped: SkippedProduct[] = [];

  for (const target of TARGETS) {
    try {
      const blueprint = findBlueprint(catalog, target.keywords);
      if (!blueprint) {
        skipped.push({ slug: target.slug, reason: `No catalog blueprint matched keywords: ${target.keywords.join(", ")}` });
        continue;
      }

      const variants = await adapter.getVariants(blueprint.externalId);
      const available = variants.filter((v) => v.availability !== "discontinued" && v.externalId);
      if (available.length === 0) {
        skipped.push({ slug: target.slug, reason: `Blueprint "${blueprint.name}" (${blueprint.externalId}) has no available variants.` });
        continue;
      }

      const printAreaId = await firstPrintAreaId(adapter, blueprint.externalId, available[0]!.externalId);
      if (!printAreaId) {
        skipped.push({ slug: target.slug, reason: `Blueprint "${blueprint.name}" (${blueprint.externalId}) exposes no print-area placeholders.` });
        continue;
      }

      const retailPriceByVariant: Record<string, number> = {};
      for (const v of available) {
        retailPriceByVariant[v.externalId] = retailPrice(v.baseCost);
      }

      const product = await adapter.createFulfillmentProduct({
        name: target.title,
        catalogProductExternalId: blueprint.externalId,
        printAreaId,
        artworkFileUrl: ARTWORK_URL,
        variantExternalIds: available.map((v) => v.externalId),
        retailPriceByVariant,
      });

      created.push({
        slug: target.slug,
        blueprintId: blueprint.externalId,
        blueprintTitle: blueprint.name,
        productId: product.providerProductId,
        variantCount: available.length,
        printAreaId,
      });
    } catch (err) {
      skipped.push({
        slug: target.slug,
        reason: err instanceof Error ? err.message : "Unknown error creating this product.",
      });
    }
  }

  return NextResponse.json({
    artworkUrl: ARTWORK_URL,
    created,
    skipped,
    note:
      "Products are created UNPUBLISHED in Printify. Review them in the Printify dashboard and publish " +
      "to Shopify manually once artwork placement and pricing are approved.",
  });
}

function findBlueprint(catalog: PodProduct[], keywords: string[]): PodProduct | null {
  for (const keyword of keywords) {
    const match = catalog.find((item) => item.name.toLowerCase().includes(keyword.toLowerCase()));
    if (match) return match;
  }
  return null;
}

async function firstPrintAreaId(
  adapter: PrintifyAdapter,
  blueprintId: string,
  variantId: string
): Promise<string | null> {
  const placeholders = await adapter.getPlaceholders(blueprintId, variantId);
  const [firstKey] = Object.keys(placeholders);
  return firstKey ?? null;
}

function retailPrice(baseCost: number): number {
  if (!Number.isFinite(baseCost) || baseCost <= 0) return 24.99;
  const marked = baseCost * 1.55;
  return Math.floor(marked) + 0.99;
}
