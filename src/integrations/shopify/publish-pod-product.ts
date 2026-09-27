// Creates a Shopify DRAFT product from a full print-on-demand variant list
// (many colors x many sizes from one Printify blueprint) — the generalized,
// many-variant sibling of publish-draft.ts, which models one design as one
// color with size variants. This one is for the auto-create pipeline, where
// a single Printify product created from the live catalog already carries
// its whole real color/size range.
//
// Hard rule, same as publish-draft.ts: status is always DRAFT. Nothing here
// can publish a product to the online store.

import { adminGraphql, adminProductUrl, throwOnUserErrors, type UserError } from "./admin-client";

export type PodVariantInput = {
  color: string;
  size: string;
  price: number;
  cost: number;
  providerVariantId: string;
  sku: string;
};

export type PublishPodResult = {
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
    product { id handle status }
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

export async function publishPodDraftProduct(params: {
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  variants: PodVariantInput[];
  /** Public https artwork/mockup URL. Skipped (with a warning) if not reachable. */
  imageUrl?: string;
  metafields?: { key: string; type: string; value: string }[];
}): Promise<PublishPodResult> {
  if (params.variants.length === 0) {
    throw new Error("publishPodDraftProduct requires at least one variant.");
  }

  const colors = uniqueInOrder(params.variants.map((v) => v.color));
  const sizes = uniqueInOrder(params.variants.map((v) => v.size));

  const created = await adminGraphql<{
    productCreate: {
      product: { id: string; handle: string; status: string } | null;
      userErrors: UserError[];
    };
  }>(PRODUCT_CREATE, {
    product: {
      title: params.title,
      descriptionHtml: params.descriptionHtml,
      vendor: params.vendor,
      productType: params.productType,
      status: "DRAFT", // never ACTIVE — activation is a manual decision
      tags: params.tags,
      productOptions: [
        { name: "Color", values: colors.map((name) => ({ name })) },
        { name: "Size", values: sizes.map((name) => ({ name })) },
      ],
      metafields: params.metafields?.map((mf) => ({ namespace: "vibeflex", ...mf })) ?? [],
    },
  });

  throwOnUserErrors("Shopify productCreate", created.productCreate.userErrors);
  const product = created.productCreate.product;
  if (!product) throw new Error("Shopify productCreate returned no product.");

  const variantInputs = params.variants.map((v) => ({
    optionValues: [
      { optionName: "Color", name: v.color },
      { optionName: "Size", name: v.size },
    ],
    price: v.price.toFixed(2),
    inventoryItem: { tracked: false, cost: v.cost.toFixed(2) },
    inventoryPolicy: "CONTINUE",
    taxable: true,
    sku: v.sku,
    metafields: [{ namespace: "vibeflex", key: "provider_variant_id", type: "single_line_text_field", value: v.providerVariantId }],
  }));

  const variants = await adminGraphql<{
    productVariantsBulkCreate: {
      productVariants: { id: string }[];
      userErrors: UserError[];
    };
  }>(VARIANTS_BULK_CREATE, { productId: product.id, variants: variantInputs });

  throwOnUserErrors("Shopify productVariantsBulkCreate", variants.productVariantsBulkCreate.userErrors);

  let mediaAttached = false;
  let mediaWarning: string | undefined;
  if (params.imageUrl && /^https:\/\//.test(params.imageUrl)) {
    try {
      const media = await adminGraphql<{ productCreateMedia: { mediaUserErrors: UserError[] } }>(CREATE_MEDIA, {
        productId: product.id,
        media: [{ originalSource: params.imageUrl, alt: params.title, mediaContentType: "IMAGE" }],
      });
      const errors = media.productCreateMedia.mediaUserErrors;
      if (errors?.length) mediaWarning = errors.map((e) => e.message).join("; ");
      else mediaAttached = true;
    } catch (err) {
      mediaWarning = err instanceof Error ? err.message : "Unknown media error";
    }
  } else {
    mediaWarning = "No publicly reachable artwork URL was available, so the draft was created without images.";
  }

  return {
    productId: product.id,
    handle: product.handle,
    status: product.status,
    adminUrl: adminProductUrl(product.id),
    variantIds: variants.productVariantsBulkCreate.productVariants.map((v) => v.id),
    mediaAttached,
    mediaWarning,
  };
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
