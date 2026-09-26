import { afterEach, describe, expect, it, vi } from "vitest";
import { getProviderVariantMap } from "@/integrations/pod/catalog-service";
import type { CatalogProduct } from "@/lib/catalog";

const ENV_VARS = [
  "PRINTFUL_API_KEY",
  "PRINTFUL_STORE_ID",
  "PRINTIFY_API_KEY",
  "PRINTIFY_SHOP_ID",
  "POD_PROVIDER",
] as const;

function clearEnv() {
  for (const key of ENV_VARS) delete process.env[key];
}

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, { body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      const hit = Object.entries(routes).find(([fragment]) => href.includes(fragment));
      if (!hit) throw new Error(`Unstubbed request: ${href}`);
      return {
        ok: true,
        status: 200,
        json: async () => hit[1].body,
        text: async () => JSON.stringify(hit[1].body),
      } as unknown as Response;
    })
  );
}

function product(overrides: Partial<CatalogProduct["provider"]> = {}): CatalogProduct {
  return {
    id: "vf-tee-classic",
    handle: "built-different-tee",
    name: "VibeFlex Classic Tee",
    blurb: "",
    category: "tee",
    silhouette: "tee",
    baseCostUsd: 9.25,
    printCostUsd: 4.5,
    colors: [{ id: "black", label: "Black", hex: "#111", dark: true }],
    sizes: [{ id: "M", label: "M", costUpchargeUsd: 0 }],
    printAreas: [],
    provider: overrides,
  };
}

describe("getProviderVariantMap — provider resolution per product", () => {
  it("returns mock with a clear warning when neither provider is configured", async () => {
    const result = await getProviderVariantMap(product({ printify: { blueprintId: "12", printProviderId: "29" } }));
    expect(result.mode).toBe("mock");
    expect(result.warning).toMatch(/no configured pod provider/i);
  });

  it("resolves via Printify when only a Printify entry and credentials exist", async () => {
    process.env.PRINTIFY_API_KEY = "key";
    process.env.PRINTIFY_SHOP_ID = "shop-1";
    stubFetch({
      "/print_providers.json": { body: [{ id: 29 }] },
      "/variants.json": {
        body: { variants: [{ id: 17390, options: { color: "Black", size: "M" }, cost: 1179, is_available: true }] },
      },
    });

    const result = await getProviderVariantMap(product({ printify: { blueprintId: "12", printProviderId: "29" } }));

    expect(result.mode).toBe("live");
    expect(result.providerName).toBe("printify");
    expect(result.catalogProductExternalId).toBe("12");
    expect(result.map["black/M"]).toBe("17390");
  });

  it("prefers Printful when POD_PROVIDER is unset and both entries/credentials exist", async () => {
    process.env.PRINTFUL_API_KEY = "key";
    process.env.PRINTFUL_STORE_ID = "store-1";
    process.env.PRINTIFY_API_KEY = "key";
    process.env.PRINTIFY_SHOP_ID = "shop-1";
    stubFetch({
      "/products/71": {
        body: { result: { variants: [{ id: 4016, color: "Black", size: "M", price: "11.69", in_stock: true }] } },
      },
    });

    const result = await getProviderVariantMap(
      product({
        printful: { catalogProductId: "71" },
        printify: { blueprintId: "12", printProviderId: "29" },
      })
    );

    expect(result.providerName).toBe("printful");
    expect(result.catalogProductExternalId).toBe("71");
  });

  it("prefers Printify when POD_PROVIDER=printify, even if a Printful entry also exists", async () => {
    process.env.POD_PROVIDER = "printify";
    process.env.PRINTFUL_API_KEY = "key";
    process.env.PRINTFUL_STORE_ID = "store-1";
    process.env.PRINTIFY_API_KEY = "key";
    process.env.PRINTIFY_SHOP_ID = "shop-1";
    stubFetch({
      "/print_providers.json": { body: [{ id: 29 }] },
      "/variants.json": { body: { variants: [] } },
    });

    const result = await getProviderVariantMap(
      product({
        printful: { catalogProductId: "71" },
        printify: { blueprintId: "12", printProviderId: "29" },
      })
    );

    expect(result.providerName).toBe("printify");
  });

  it("falls back to Printful when Printify is preferred but this product has no Printify entry", async () => {
    process.env.POD_PROVIDER = "printify";
    process.env.PRINTFUL_API_KEY = "key";
    process.env.PRINTFUL_STORE_ID = "store-1";
    stubFetch({
      "/products/71": { body: { result: { variants: [] } } },
    });

    const result = await getProviderVariantMap(product({ printful: { catalogProductId: "71" } }));

    expect(result.providerName).toBe("printful");
  });
});
