// Shopify read-back verification.
//
// A successful mutation response is not evidence that a product exists and is
// correct. This module re-queries Shopify for what was just written and asserts
// the fields we actually care about. Until this passes, a publish is NOT
// successful, no matter what productCreate returned.

import { adminGraphql } from "./admin-client";

export type VerificationCheck = {
  key: string;
  label: string;
  ok: boolean;
  observed: string;
};

export type DraftVerification = {
  verified: boolean;
  productId: string;
  checks: VerificationCheck[];
  failures: string[];
  snapshot: {
    title: string;
    status: string;
    handle: string;
    mediaCount: number;
    variantCount: number;
    optionNames: string[];
    prices: string[];
    hasDescription: boolean;
    studioReference?: string;
    providerRefs?: string;
  };
};

const READ_BACK = `
query VerifyDraft($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    status
    descriptionHtml
    options { name }
    media(first: 20) { nodes { ... on MediaImage { id status image { url width height } } } }
    variants(first: 100) {
      nodes {
        id
        sku
        price
        inventoryItem { unitCost { amount } }
      }
    }
    metafields(first: 20, namespace: "vibeflex") { nodes { key value } }
  }
}`;

export async function verifyDraftProduct(productId: string): Promise<DraftVerification> {
  const data = await adminGraphql<{
    product: {
      id: string;
      title: string;
      handle: string;
      status: string;
      descriptionHtml: string | null;
      options: { name: string }[];
      media: { nodes: { id?: string; status?: string; image?: { url: string } }[] };
      variants: { nodes: { id: string; sku: string | null; price: string }[] };
      metafields: { nodes: { key: string; value: string }[] };
    } | null;
  }>(READ_BACK, { id: productId });

  const product = data.product;
  if (!product) {
    return {
      verified: false,
      productId,
      checks: [{ key: "product_id", label: "PRODUCT ID", ok: false, observed: "not found" }],
      failures: [`Shopify has no product with id ${productId}.`],
      snapshot: {
        title: "",
        status: "",
        handle: "",
        mediaCount: 0,
        variantCount: 0,
        optionNames: [],
        prices: [],
        hasDescription: false,
      },
    };
  }

  const meta = Object.fromEntries(product.metafields.nodes.map((m) => [m.key, m.value]));
  const mediaCount = product.media.nodes.length;
  const variantCount = product.variants.nodes.length;
  const prices = product.variants.nodes.map((v) => v.price);
  const hasDescription = Boolean(product.descriptionHtml && product.descriptionHtml.trim().length > 0);

  const checks: VerificationCheck[] = [
    { key: "product_id", label: "PRODUCT ID", ok: true, observed: product.id },
    { key: "status", label: "STATUS", ok: product.status === "DRAFT", observed: product.status },
    { key: "title", label: "TITLE", ok: product.title.trim().length > 0, observed: product.title },
    { key: "description", label: "DESCRIPTION", ok: hasDescription, observed: hasDescription ? "present" : "empty" },
    { key: "media", label: "MEDIA", ok: mediaCount > 0, observed: String(mediaCount) },
    {
      key: "options",
      label: "OPTIONS",
      ok: product.options.length > 0,
      observed: product.options.map((o) => o.name).join(", ") || "none",
    },
    { key: "variants", label: "VARIANTS", ok: variantCount > 0, observed: String(variantCount) },
    {
      key: "prices",
      label: "PRICES",
      ok: prices.length > 0 && prices.every((p) => Number(p) > 0),
      observed: prices.length ? `${prices[0]}–${prices[prices.length - 1]}` : "none",
    },
    {
      key: "supplier_mapping",
      label: "SUPPLIER MAPPING",
      ok: Boolean(meta.provider_refs && meta.provider_refs !== "{}"),
      observed: meta.pod_provider ? `${meta.pod_provider} refs present` : "missing",
    },
    {
      key: "studio_linkage",
      label: "STUDIO/JOB LINKAGE",
      ok: Boolean(meta.studio_reference),
      observed: meta.studio_reference ?? "missing",
    },
  ];

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.observed}`);

  return {
    verified: failures.length === 0,
    productId: product.id,
    checks,
    failures,
    snapshot: {
      title: product.title,
      status: product.status,
      handle: product.handle,
      mediaCount,
      variantCount,
      optionNames: product.options.map((o) => o.name),
      prices,
      hasDescription,
      studioReference: meta.studio_reference,
      providerRefs: meta.provider_refs,
    },
  };
}

/**
 * Idempotency that survives a cold start.
 *
 * The in-memory cache in studio-service only protects a single warm process. A
 * retry after a redeploy would create a duplicate product, so we ask Shopify
 * whether a draft already carries this studio reference before creating one.
 */
const FIND_BY_REFERENCE = `
query FindByReference($query: String!) {
  products(first: 5, query: $query) {
    nodes { id handle status }
  }
}`;

export async function findExistingDraftByReference(reference: string): Promise<string | null> {
  const escaped = reference.replace(/"/g, '\\"');
  const data = await adminGraphql<{
    products: { nodes: { id: string; status: string }[] };
  }>(FIND_BY_REFERENCE, { query: `tag:'${escaped}'` });

  const match = data.products.nodes.find((p) => p.status === "DRAFT") ?? data.products.nodes[0];
  return match?.id ?? null;
}
