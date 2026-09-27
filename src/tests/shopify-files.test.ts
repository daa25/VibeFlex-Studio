import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopifyFileProcessingError, rehostArtworkToShopify } from "@/integrations/shopify/files";

beforeEach(() => {
  vi.stubEnv("SHOPIFY_SHOP_DOMAIN", "vibeflex-813.myshopify.com");
  vi.stubEnv("SHOPIFY_ADMIN_API_ACCESS_TOKEN", "shpat_test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("rehostArtworkToShopify", () => {
  it("polls until the file is READY and returns the permanent CDN url", async () => {
    let statusCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body) as { query: string };
        if (parsed.query.includes("fileCreate")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { fileCreate: { files: [{ id: "gid://shopify/MediaImage/1", fileStatus: "UPLOADED" }], userErrors: [] } } }),
          } as unknown as Response;
        }
        statusCalls += 1;
        const ready = statusCalls >= 2;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { node: ready ? { fileStatus: "READY", image: { url: "https://cdn.shopify.com/art.png" } } : { fileStatus: "PROCESSING", image: null } },
          }),
        } as unknown as Response;
      })
    );

    const url = await rehostArtworkToShopify({
      sourceUrl: "https://export.canva.com/art.png",
      filename: "art.png",
      alt: "art",
    });

    expect(url).toBe("https://cdn.shopify.com/art.png");
    expect(statusCalls).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it("throws a clear error when Shopify reports the file failed processing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body) as { query: string };
        if (parsed.query.includes("fileCreate")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { fileCreate: { files: [{ id: "gid://shopify/MediaImage/1", fileStatus: "UPLOADED" }], userErrors: [] } } }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ data: { node: { fileStatus: "FAILED", image: null } } }) } as unknown as Response;
      })
    );

    await expect(
      rehostArtworkToShopify({ sourceUrl: "https://export.canva.com/art.png", filename: "art.png", alt: "art" })
    ).rejects.toThrow(ShopifyFileProcessingError);
  });

  it("surfaces Shopify userErrors from fileCreate rather than swallowing them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { fileCreate: { files: [], userErrors: [{ message: "bad url" }] } } }),
      }))
    );

    await expect(
      rehostArtworkToShopify({ sourceUrl: "https://export.canva.com/art.png", filename: "art.png", alt: "art" })
    ).rejects.toThrow(/bad url/);
  });
});
