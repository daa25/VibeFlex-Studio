import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintifyAdapter } from "@/integrations/pod/printify/adapter";

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

describe("Printify catalog", () => {
  it("converts variant cost from cents to a decimal currency amount", async () => {
    stubFetch({
      "/print_providers.json": { body: [{ id: 29, title: "MyLocker" }] },
      "/variants.json": {
        body: {
          variants: [
            { id: 17390, title: "S / Black", options: { color: "Black", size: "S" }, cost: 1179, is_available: true },
            { id: 17391, title: "M / Black", options: { color: "Black", size: "M" }, cost: 1179, is_available: false },
          ],
        },
      },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    const variants = await adapter.getVariants("12");

    expect(variants[0]!.baseCost).toBeCloseTo(11.79);
    expect(variants[0]!.availability).toBe("in_stock");
    expect(variants[1]!.availability).toBe("discontinued");
  });

  it("uses the first print provider returned for a blueprint", async () => {
    const fetchSpy = stubFetch({
      "/print_providers.json": {
        body: [
          { id: 29, title: "MyLocker" },
          { id: 42, title: "Underground" },
        ],
      },
      "/variants.json": { body: { variants: [] } },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    await adapter.getVariants("12");

    const variantsCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/variants.json"));
    expect(String(variantsCall?.[0])).toContain("/print_providers/29/variants.json");
  });
});

describe("Printify mockups are synchronous, not a task queue", () => {
  it("creates an unpublished product and returns status completed immediately", async () => {
    const fetchSpy = stubFetch({
      "/uploads/images.json": { body: { id: "img-1" } },
      "/print_providers.json": { body: [{ id: 29, title: "MyLocker" }] },
      "/variants.json": {
        body: { variants: [{ id: 17390, placeholders: [{ position: "front", height: 1200, width: 900 }] }] },
      },
      "/shops/shop-1/products.json": { body: { id: "prod-1", variants: [], images: [] } },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    const job = await adapter.createMockupJob({
      catalogProductExternalId: "12",
      variantExternalIds: ["17390"],
      printAreaId: "front",
      artworkFileUrl: "https://example.com/art.png",
    });

    // No polling required: Printify's product-creation response IS the final mockup.
    expect(job.status).toBe("completed");
    expect(job.providerJobId).toBe("prod-1");

    const createCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/shops/shop-1/products.json"));
    const sent = JSON.parse(String(createCall?.[1]?.body));
    expect(sent.print_areas[0].placeholders[0].position).toBe("front");
  });

  it("keeps the default image first so an alternate angle cannot become the hero", async () => {
    stubFetch({
      "/shops/shop-1/products/prod-1.json": {
        body: {
          id: "prod-1",
          variants: [],
          images: [
            { src: "https://cdn/back.jpg", variant_ids: [17390], is_default: false },
            { src: "https://cdn/front-hero.jpg", variant_ids: [17390], is_default: true },
          ],
        },
      },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    const status = await adapter.getMockupJob("prod-1");

    expect(status.status).toBe("completed");
    expect(status.mockupUrls?.[0]).toBe("https://cdn/front-hero.jpg");
  });
});

describe("Printify fulfillment product creation", () => {
  it("sends retail price in cents and returns a variant map", async () => {
    const fetchSpy = stubFetch({
      "/uploads/images.json": { body: { id: "img-1" } },
      "/print_providers.json": { body: [{ id: 29, title: "MyLocker" }] },
      "/shops/shop-1/products.json": {
        body: {
          id: "prod-2",
          variants: [{ id: 17390, price: 2600, is_enabled: true }],
          images: [],
        },
      },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    const created = await adapter.createFulfillmentProduct({
      name: "#UNCOOKED Cuffed Beanie",
      catalogProductExternalId: "12",
      variantExternalIds: ["17390"],
      printAreaId: "embroidery_front",
      artworkFileUrl: "https://example.com/art.png",
      retailPriceByVariant: { "17390": 26 },
    });

    expect(created.providerProductId).toBe("prod-2");
    expect(created.variantMap["17390"]).toBe("17390");

    const createCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/shops/shop-1/products.json"));
    const sent = JSON.parse(String(createCall?.[1]?.body));
    expect(sent.variants[0].price).toBe(2600);
  });

  it("archives by deleting the shop product", async () => {
    const fetchSpy = stubFetch({
      "/shops/shop-1/products/prod-2.json": { body: {} },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    await adapter.archiveFulfillmentProduct("prod-2");

    const call = fetchSpy.mock.calls[0]!;
    expect(call[1]?.method).toBe("DELETE");
  });
});

describe("Printify cost estimate — two real calls, not one", () => {
  it("combines catalog cost with a shipping-only estimate", async () => {
    stubFetch({
      "/print_providers.json": { body: [{ id: 29, title: "MyLocker" }] },
      "/variants.json": {
        body: { variants: [{ id: 17390, cost: 1179, is_available: true }] },
      },
      "/shops/shop-1/orders/shipping.json": { body: { standard: 450 } },
    });

    const adapter = new PrintifyAdapter("key", "shop-1");
    const cost = await adapter.estimateCost({
      catalogProductExternalId: "12",
      variantExternalId: "17390",
      destinationCountry: "US",
    });

    expect(cost.baseCost).toBeCloseTo(11.79);
    expect(cost.estimatedShipping).toBeCloseTo(4.5);
  });
});
