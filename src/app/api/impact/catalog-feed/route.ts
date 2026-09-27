// GET /api/impact/catalog-feed — Impact.com Side B (advertiser) product feed.
//
// Impact.com's catalog import for an Advertiser program can be configured to
// pull a live feed URL on a schedule, which is simpler and more robust than
// pushing via their Catalog API (no guessing at write-endpoint shapes). This
// route serves that feed directly from the live Shopify catalog, so it can
// never go stale independently of the store.
//
// Deliberately excludes affiliate/redirect products (tag "mode:external") —
// those are other brands' products carrying their own affiliate links, not
// VibeFlex's own catalog for outside affiliates to sell.

import { NextResponse } from "next/server";
import { adminGraphql } from "@/integrations/shopify/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  onlineStoreUrl: string | null;
  featuredImage: { url: string } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: { edges: { node: { sku: string | null; availableForSale: boolean } }[] };
};

const QUERY = `
  query CatalogFeed($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active -tag:'mode:external'") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          vendor
          onlineStoreUrl
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 1) { edges { node { sku availableForSale } } }
        }
      }
    }
  }
`;

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function GET() {
  try {
    const rows: string[] = [
      ["sku", "product_name", "price", "currency", "image_url", "product_url", "availability", "brand"]
        .map(csvField)
        .join(","),
    ];

    let cursor: string | null = null;
    do {
      const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: { node: ShopifyProductNode }[] } } =
        await adminGraphql(QUERY, { cursor });

      for (const { node } of data.products.edges) {
        const variant = node.variants.edges[0]?.node;
        rows.push(
          [
            variant?.sku ?? node.id.split("/").pop() ?? "",
            node.title,
            node.priceRangeV2.minVariantPrice.amount,
            node.priceRangeV2.minVariantPrice.currencyCode,
            node.featuredImage?.url ?? "",
            node.onlineStoreUrl ?? "",
            variant?.availableForSale ? "in stock" : "out of stock",
            node.vendor,
          ]
            .map((v) => csvField(String(v)))
            .join(",")
        );
      }

      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    } while (cursor);

    return new NextResponse(rows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Catalog feed generation failed." },
      { status: 502 }
    );
  }
}
