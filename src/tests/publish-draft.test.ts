// Verifies the Shopify draft payload without touching a real store: fetch is
// stubbed, so this asserts exactly what we would send to Shopify Admin.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProduct } from "@/lib/catalog";
import { resolveDesign } from "@/lib/design";
import { calculatePrice } from "@/lib/pricing";
import { publishDraftProduct } from "@/integrations/shopify/publish-draft";

const tee = getProduct("vf-tee-classic")!;

const design = resolveDesign({
  productId: tee.id,
  colorId: "black",
  sizeId: "L",
  quantity: 1,
  artwork: {
    assetId: "asset-1",
    url: "https://cdn.example.com/built-different.png",
    fileName: "built-different.png",
    mimeType: "image/png",
    width: 2400,
    height: 3000,
  },
  placements: [{ printAreaId: "front", centerX: 0.5, centerY: 0.42, scale: 0.7, rotation: 0 }],
} as never);

if (!design.ok) throw new Error(design.error);

const pricing = calculatePrice({
  product: tee,
  sizeId: "L",
  printAreaIds: ["front"],
  quantity: 1,
});

let requests: { query: string; variables: Record<string, unknown> }[] = [];

beforeEach(() => {
  requests = [];
  vi.stubEnv("SHOPIFY_SHOP_DOMAIN", "vibeflex-813.myshopify.com");
  vi.stubEnv("SHOPIFY_ADMIN_API_ACCESS_TOKEN", "shpat_test");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const parsed = JSON.parse(init.body) as {
        query: string;
        variables: Record<string, unknown>;
      };
      requests.push(parsed);

      const data = parsed.query.includes("productCreate(")
        ? {
            productCreate: {
              product: { id: "gid://shopify/Product/1", handle: "built-different-tee", status: "DRAFT" },
              userErrors: [],
            },
          }
        : parsed.query.includes("productVariantsBulkCreate")
          ? {
              productVariantsBulkCreate: {
                productVariants: [{ id: "gid://shopify/ProductVariant/9", title: "L", sku: "X" }],
                userErrors: [],
              },
            }
          : { productCreateMedia: { media: [{ alt: "a", status: "READY" }], mediaUserErrors: [] } };

      return { ok: true, status: 200, json: async () => ({ data }) } as unknown as Response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("shopify draft publishing", () => {
  it("creates the product as DRAFT with production metafields", async () => {
    const result = await publishDraftProduct({
      design: design.value,
      pricing,
      reference: "VF-TEST01",
      provider: "printful",
      providerRefs: { variantIdsByColorSize: { "black/L": "4012" } },
      imageUrl: "https://cdn.example.com/built-different.png",
    });

    const create = requests.find((r) => r.query.includes("productCreate("))!;
    const product = create.variables.product as {
      status: string;
      vendor: string;
      metafields: { key: string; value: string; namespace: string }[];
      productOptions: { name: string }[];
    };

    expect(product.status).toBe("DRAFT");
    expect(product.vendor).toBe("VibeFlex Sports");
    expect(product.productOptions.map((o) => o.name)).toEqual(["Color", "Size"]);

    const keys = product.metafields.map((m) => m.key);
    expect(keys).toContain("artwork_url");
    expect(keys).toContain("print_geometry");
    expect(keys).toContain("studio_reference");
    expect(product.metafields.every((m) => m.namespace === "vibeflex")).toBe(true);

    // No credential may ever be written into product metadata.
    const serialized = JSON.stringify(product);
    expect(serialized).not.toContain("shpat_");

    expect(result.status).toBe("DRAFT");
    expect(result.adminUrl).toContain("vibeflex-813.myshopify.com/admin/products/1");
    expect(result.mediaAttached).toBe(true);
  });

  it("creates one variant per size with the studio reference in the SKU", async () => {
    await publishDraftProduct({
      design: design.value,
      pricing,
      reference: "VF-TEST01",
      provider: "printful",
      providerRefs: { variantIdsByColorSize: { "black/L": "4012" } },
    });

    const bulk = requests.find((r) => r.query.includes("productVariantsBulkCreate"))!;
    const variants = bulk.variables.variants as { sku: string; price: string }[];

    expect(variants).toHaveLength(tee.sizes.length);
    expect(variants.every((v) => v.sku.startsWith("VF-TEST01"))).toBe(true);
    expect(Number(variants[0]!.price)).toBeGreaterThan(pricing.unitCost);
  });

  it("still publishes when no public mockup URL is available, with a warning", async () => {
    const result = await publishDraftProduct({
      design: design.value,
      pricing,
      reference: "VF-TEST02",
      provider: "printful",
      providerRefs: {},
    });

    expect(result.mediaAttached).toBe(false);
    expect(result.mediaWarning).toMatch(/publicly reachable/);
  });
});
