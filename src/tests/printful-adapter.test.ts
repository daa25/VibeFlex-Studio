import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PrintfulAdapter,
  PrintfulPlatformError,
  SYNC_API_PLATFORMS,
} from "@/integrations/pod/printful/adapter";

/** Minimal fetch stub: maps a URL substring to a JSON response. */
function stubFetch(routes: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  const spy = vi.fn(async (url: string | URL, init?: RequestInit) => {
    void init;
    const href = String(url);
    const hit = Object.entries(routes).find(([fragment]) => href.includes(fragment));
    if (!hit) throw new Error(`Unstubbed request: ${href}`);
    const { ok = true, status = 200, body } = hit[1];
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

const fulfillmentInput = {
  name: "#UNCOOKED Cuffed Beanie",
  catalogProductExternalId: "266",
  variantExternalIds: ["8936"],
  printAreaId: "embroidery_front",
  artworkFileUrl: "https://example.com/print-file.png",
  retailPriceByVariant: { "8936": 26 },
};

describe("Printful store platform guard", () => {
  it("refuses to create a fulfillment product on a Shopify-platform store", async () => {
    // The live account's storefront store (18501917) is platform "shopify".
    stubFetch({
      "/stores": { body: { result: [{ id: 18501917, name: "490 Movement", type: "shopify" }] } },
    });

    const adapter = new PrintfulAdapter("key", "18501917");
    await expect(adapter.createFulfillmentProduct(fulfillmentInput)).rejects.toBeInstanceOf(
      PrintfulPlatformError
    );
  });

  it("names the platform and the real remedy in the error", async () => {
    stubFetch({
      "/stores": { body: { result: [{ id: 18501917, type: "shopify" }] } },
    });
    const adapter = new PrintfulAdapter("key", "18501917");

    await expect(adapter.createFulfillmentProduct(fulfillmentInput)).rejects.toThrow(
      /shopify.*platform store/i
    );
    await expect(adapter.createFulfillmentProduct(fulfillmentInput)).rejects.toThrow(
      /create the product in Printful/i
    );
  });

  it("never silently writes to a different store on the account", async () => {
    // "Personal orders" (native) is API-capable but does not serve the storefront.
    const fetchSpy = stubFetch({
      "/stores": {
        body: {
          result: [
            { id: 18501917, name: "490 Movement", type: "shopify" },
            { id: 18529099, name: "Personal orders", type: "native" },
          ],
        },
      },
      "/store/products": { body: { result: { id: 1, sync_variants: [] } } },
    });

    const adapter = new PrintfulAdapter("key", "18501917");
    await expect(adapter.createFulfillmentProduct(fulfillmentInput)).rejects.toBeInstanceOf(
      PrintfulPlatformError
    );

    // The important assertion: no POST was attempted at all.
    const attemptedCreate = fetchSpy.mock.calls.some(([url]) => String(url).includes("/store/products"));
    expect(attemptedCreate).toBe(false);
  });

  it("allows creation on an API-capable store", async () => {
    stubFetch({
      "/stores": { body: { result: [{ id: 18529099, name: "Personal orders", type: "native" }] } },
      "/store/products": {
        body: { result: { id: 555, sync_variants: [{ variant_id: 8936, id: 999 }] } },
      },
    });

    const adapter = new PrintfulAdapter("key", "18529099");
    const created = await adapter.createFulfillmentProduct(fulfillmentInput);

    expect(created.providerProductId).toBe("555");
    expect(created.variantMap["8936"]).toBe("999");
  });

  it("still attempts creation when the platform cannot be determined", async () => {
    // An unknown platform must not block a legitimate store; Printful's own
    // error surfaces instead of us guessing.
    stubFetch({
      "/stores": { ok: false, status: 401, body: { error: "unauthorized" } },
      "/store/products": { body: { result: { id: 7, sync_variants: [] } } },
    });

    const adapter = new PrintfulAdapter("key", "18529099");
    await expect(adapter.createFulfillmentProduct(fulfillmentInput)).resolves.toMatchObject({
      providerProductId: "7",
    });
  });

  it("treats manual and api platforms as sync-capable", () => {
    expect(SYNC_API_PLATFORMS).toContain("native");
    expect(SYNC_API_PLATFORMS).toContain("manual");
    expect(SYNC_API_PLATFORMS).toContain("api");
    expect(SYNC_API_PLATFORMS).not.toContain("shopify");
  });
});

describe("Printful mockup task", () => {
  it("puts the catalog product id in the path and sends a position", async () => {
    const fetchSpy = stubFetch({
      "/mockup-generator/create-task/71": { body: { result: { task_key: "gt-1" } } },
    });

    const adapter = new PrintfulAdapter("key", "18501917");
    const job = await adapter.createMockupJob({
      catalogProductExternalId: "71",
      variantExternalIds: ["4016"],
      printAreaId: "front",
      artworkFileUrl: "https://example.com/a.png",
      position: { area_width: 1800, area_height: 2400, width: 900, height: 1200, top: 192, left: 450 },
    });

    expect(job.providerJobId).toBe("gt-1");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/mockup-generator/create-task/71");
    const sent = JSON.parse(String(init?.body));
    expect(sent.files[0].position).toBeDefined();
    expect(sent.format).toBe("jpg");
  });

  it("keeps the primary mockup first so an alternate angle cannot become the hero", async () => {
    stubFetch({
      "/mockup-generator/task": {
        body: {
          result: {
            status: "completed",
            mockups: [
              {
                placement: "front",
                variant_ids: [4016],
                mockup_url: "https://cdn/hero.jpg",
                extra: [{ url: "https://cdn/ghost-back.jpg" }],
              },
            ],
          },
        },
      },
    });

    const adapter = new PrintfulAdapter("key", "18501917");
    const status = await adapter.getMockupJob("gt-1");

    expect(status.status).toBe("completed");
    expect(status.mockupUrls?.[0]).toBe("https://cdn/hero.jpg");
    expect(status.mockupUrls).toContain("https://cdn/ghost-back.jpg");
  });
});
