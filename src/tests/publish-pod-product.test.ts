import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishPodDraftProduct } from "@/integrations/shopify/publish-pod-product";

let requests: { query: string; variables: Record<string, unknown> }[] = [];

beforeEach(() => {
  requests = [];
  vi.stubEnv("SHOPIFY_SHOP_DOMAIN", "vibeflex-813.myshopify.com");
  vi.stubEnv("SHOPIFY_ADMIN_API_ACCESS_TOKEN", "shpat_test");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const parsed = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      requests.push(parsed);

      const data = parsed.query.includes("productCreate(")
        ? { productCreate: { product: { id: "gid://shopify/Product/9", handle: "auto-hoodie", status: "DRAFT" }, userErrors: [] } }
        : parsed.query.includes("productVariantsBulkCreate")
          ? {
              productVariantsBulkCreate: {
                productVariants: [{ id: "gid://shopify/ProductVariant/1" }, { id: "gid://shopify/ProductVariant/2" }],
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

const variants = [
  { color: "Black", size: "S", price: 29.99, cost: 12.5, providerVariantId: "111", sku: "AUTO-1-BLACK-S" },
  { color: "Black", size: "M", price: 29.99, cost: 12.5, providerVariantId: "112", sku: "AUTO-1-BLACK-M" },
  { color: "White", size: "S", price: 29.99, cost: 12.5, providerVariantId: "113", sku: "AUTO-1-WHITE-S" },
];

describe("publishPodDraftProduct", () => {
  it("builds Color/Size options from the distinct values actually present in the variant list", async () => {
    await publishPodDraftProduct({
      title: "VibeFlex Sports Hoodie",
      descriptionHtml: "<p>copy</p>",
      vendor: "VibeFlex Sports",
      productType: "Hoodie",
      tags: ["vibeflex", "studio-auto"],
      variants,
    });

    const create = requests.find((r) => r.query.includes("productCreate("))!;
    const product = create.variables.product as { status: string; productOptions: { name: string; values: { name: string }[] }[] };

    expect(product.status).toBe("DRAFT");
    const colorOption = product.productOptions.find((o) => o.name === "Color")!;
    const sizeOption = product.productOptions.find((o) => o.name === "Size")!;
    expect(colorOption.values.map((v) => v.name)).toEqual(["Black", "White"]);
    expect(sizeOption.values.map((v) => v.name)).toEqual(["S", "M"]);
  });

  it("sends one bulk variant per real Printify variant, with provider id in a metafield", async () => {
    await publishPodDraftProduct({
      title: "t", descriptionHtml: "d", vendor: "v", productType: "Hoodie", tags: [], variants,
    });

    const bulk = requests.find((r) => r.query.includes("productVariantsBulkCreate"))!;
    const sent = bulk.variables.variants as { sku: string; price: string; metafields: { key: string; value: string }[] }[];
    expect(sent).toHaveLength(3);
    expect(sent[0]!.sku).toBe("AUTO-1-BLACK-S");
    expect(sent[0]!.metafields.find((m) => m.key === "provider_variant_id")?.value).toBe("111");
  });

  it("rejects an empty variant list rather than creating a productless draft", async () => {
    await expect(
      publishPodDraftProduct({ title: "t", descriptionHtml: "d", vendor: "v", productType: "Hoodie", tags: [], variants: [] })
    ).rejects.toThrow(/at least one variant/);
  });

  it("attaches media when a public https image URL is given", async () => {
    const result = await publishPodDraftProduct({
      title: "t", descriptionHtml: "d", vendor: "v", productType: "Hoodie", tags: [], variants,
      imageUrl: "https://cdn.shopify.com/artwork.png",
    });
    expect(result.mediaAttached).toBe(true);
  });
});
