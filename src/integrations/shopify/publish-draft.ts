// Creates a Shopify DRAFT product from a studio design.
//
// Hard rule: status is always DRAFT. Nothing in this module can publish a
// product to the online store — activation stays a human decision in Shopify
// Admin.
//
// Production metadata (artwork URL, placement geometry, provider ids, studio
// reference) is written as product metafields in the `vibeflex` namespace AND
// mirrored onto each variant's SKU/reference so it survives into orders.
// Credentials are never written into metadata.

import { toPrintGeometry, type ResolvedDesign } from "@/lib/design";
import type { PriceBreakdown } from "@/lib/pricing";
import { adminGraphql, adminProductUrl, throwOnUserErrors, type UserError } from "./admin-client";

export type PublishResult = {
  productId: string;
  handle: string;
  status: string;
  adminUrl: string;
  variantIds: string[];
  mediaAttached: boolean;
  mediaWarning?: string;
};

const PRODUCT_CREATE = `
mutation CreateDraftProduct($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product { id handle status options { id name optionValues { id name } } }
    userErrors { field message }
  }
}`;

const VARIANTS_BULK_CREATE = `
mutation AddVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
    productVariants { id title sku }
    userErrors { field message }
  }
}`;

const CREATE_MEDIA = `
mutation AttachMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { alt status }
    mediaUserErrors { field message }
  }
}`;

export function buildProductTitle(design: ResolvedDesign, artworkName: string): string {
  const base = artworkName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  const label = base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Custom Design";
  return `${label} — ${design.product.name}`;
}

export function buildSku(reference: string, product: string, color: string, size: string): string {
  return [reference, product.replace(/^vf-/, "").toUpperCase(), color.toUpperCase(), size]
    .join("-")
    .replace(/[^A-Z0-9-]/gi, "")
    .toUpperCase();
}

export function buildDescriptionHtml(design: ResolvedDesign, reference: string): string {
  const { product, color, printAreas } = design;
  const placements = printAreas.map((a) => a.label).join(", ");
  return [
    `<p>${escapeHtml(product.blurb)}</p>`,
    `<ul>`,
    `<li><strong>Colour:</strong> ${escapeHtml(color.label)}</li>`,
    `<li><strong>Print placement:</strong> ${escapeHtml(placements)}</li>`,
    `<li><strong>Print method:</strong> DTG, made to order</li>`,
    `<li><strong>Studio reference:</strong> ${escapeHtml(reference)}</li>`,
    `</ul>`,
    `<p>Printed and shipped on demand for VibeFlex Sports. Allow 2–5 business days for production.</p>`,
  ].join("");
}

export async function publishDraftProduct(params: {
  design: ResolvedDesign;
  pricing: PriceBreakdown;
  reference: string;
  provider: string;
  providerRefs: Record<string, unknown>;
  /** Public mockup/preview image URL. Skipped (with a warning) if not reachable. */
  imageUrl?: string;
}): Promise<PublishResult> {
  const { design, pricing, reference } = params;
  const { product, color, config } = design;

  const geometry = design.printAreas.map((area, i) =>
    toPrintGeometry(config.placements[i]!, area, config.artwork)
  );

  const metafields = [
    mf("studio_reference", "single_line_text_field", reference),
    mf("artwork_url", "url", config.artwork.url),
    mf("artwork_asset_id", "single_line_text_field", config.artwork.assetId),
    mf("artwork_dimensions", "single_line_text_field", `${config.artwork.width}x${config.artwork.height}`),
    mf("print_geometry", "json", JSON.stringify(geometry)),
    mf("placement_config", "json", JSON.stringify(config.placements)),
    mf("pod_provider", "single_line_text_field", params.provider),
    mf("provider_refs", "json", JSON.stringify(params.providerRefs)),
    mf("studio_product_id", "single_line_text_field", product.id),
    mf("unit_cost_usd", "single_line_text_field", pricing.unitCost.toFixed(2)),
  ];

  const created = await adminGraphql<{
    productCreate: {
      product: { id: string; handle: string; status: string } | null;
      userErrors: UserError[];
    };
  }>(PRODUCT_CREATE, {
    product: {
      title: buildProductTitle(design, config.artwork.fileName),
      descriptionHtml: buildDescriptionHtml(design, reference),
      vendor: "VibeFlex Sports",
      productType: product.category === "tee" ? "T-Shirt" : product.name,
      status: "DRAFT", // never ACTIVE — activation is a manual decision
      tags: ["vibeflex", "print-on-demand", "studio", params.provider, reference],
      productOptions: [
        { name: "Color", values: [{ name: color.label }] },
        { name: "Size", values: product.sizes.map((s) => ({ name: s.label })) },
      ],
      metafields,
    },
  });

  throwOnUserErrors("Shopify productCreate", created.productCreate.userErrors);
  const shopifyProduct = created.productCreate.product;
  if (!shopifyProduct) throw new Error("Shopify productCreate returned no product.");

  const variantInputs = product.sizes.map((size) => {
    const variantPricing =
      size.id === config.sizeId
        ? pricing
        : { ...pricing, unitPrice: priceForSize(pricing, size.costUpchargeUsd) };
    return {
      optionValues: [
        { optionName: "Color", name: color.label },
        { optionName: "Size", name: size.label },
      ],
      price: variantPricing.unitPrice.toFixed(2),
      inventoryItem: { tracked: false, cost: (pricing.unitCost + size.costUpchargeUsd).toFixed(2) },
      inventoryPolicy: "CONTINUE",
      taxable: true,
      metafields: [
        mf("studio_reference", "single_line_text_field", reference),
        mf("provider_variant_id", "single_line_text_field", providerVariantId(params.providerRefs, color.id, size.id)),
      ],
      // SKU carries the studio reference so it appears on every order line.
      ...{ sku: buildSku(reference, product.id, color.id, size.id) },
    };
  });

  const variants = await adminGraphql<{
    productVariantsBulkCreate: {
      productVariants: { id: string }[];
      userErrors: UserError[];
    };
  }>(VARIANTS_BULK_CREATE, { productId: shopifyProduct.id, variants: variantInputs });

  throwOnUserErrors(
    "Shopify productVariantsBulkCreate",
    variants.productVariantsBulkCreate.userErrors
  );

  let mediaAttached = false;
  let mediaWarning: string | undefined;
  if (params.imageUrl && /^https:\/\//.test(params.imageUrl)) {
    try {
      const media = await adminGraphql<{
        productCreateMedia: { mediaUserErrors: UserError[] };
      }>(CREATE_MEDIA, {
        productId: shopifyProduct.id,
        media: [
          {
            originalSource: params.imageUrl,
            alt: `${product.name} — ${color.label} — ${reference}`,
            mediaContentType: "IMAGE",
          },
        ],
      });
      const errors = media.productCreateMedia.mediaUserErrors;
      if (errors?.length) mediaWarning = errors.map((e) => e.message).join("; ");
      else mediaAttached = true;
    } catch (err) {
      mediaWarning = err instanceof Error ? err.message : "Unknown media error";
    }
  } else {
    mediaWarning =
      "No publicly reachable mockup URL was available, so the draft was created without images. Configure Supabase Storage (or Printful mockups) and re-publish to attach one.";
  }

  return {
    productId: shopifyProduct.id,
    handle: shopifyProduct.handle,
    status: shopifyProduct.status,
    adminUrl: adminProductUrl(shopifyProduct.id),
    variantIds: variants.productVariantsBulkCreate.productVariants.map((v) => v.id),
    mediaAttached,
    mediaWarning,
  };
}

function priceForSize(pricing: PriceBreakdown, upcharge: number): number {
  if (upcharge <= 0) return pricing.unitPrice;
  return Math.round((pricing.unitPrice + upcharge) * 100) / 100;
}

function providerVariantId(
  refs: Record<string, unknown>,
  colorId: string,
  sizeId: string
): string {
  const map = (refs.variantIdsByColorSize ?? {}) as Record<string, string | number>;
  return String(map[`${colorId}/${sizeId}`] ?? "");
}

function mf(key: string, type: string, value: string) {
  return { namespace: "vibeflex", key, type, value };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
