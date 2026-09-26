import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrintifyOrderClient } from "@/integrations/pod/printify/order-client";
import type { ProductionOrderInput } from "@/integrations/pod/production-types";

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

function order(overrides: Partial<ProductionOrderInput> = {}): ProductionOrderInput {
  return {
    studioOrderId: "VF-PY-ORDER-1",
    lineItems: [
      {
        sku: "490-UNC-BEANIE-BLK",
        quantity: 2,
        providerVariantId: "17390",
        catalogProductExternalId: "12",
        artworkUrl: "https://cdn.example.com/beanie.png",
        technique: "embroidery",
        printAreaId: "front",
      },
    ],
    shipTo: {
      name: "Jordan Rivera",
      address1: "123 Main St",
      city: "Tampa",
      state: "FL",
      country: "US",
      zip: "33602",
      email: "jordan@example.com",
    },
    ...overrides,
  };
}

describe("Printify order client — raw print-provider order mode", () => {
  it("builds blueprint_id + print_provider_id + a flat print_areas map, not linked-product ids", async () => {
    const fetchSpy = stubFetch({
      "/print_providers.json": { body: [{ id: 29 }] },
      "/shops/shop-1/orders.json": { body: { id: "py-order-1", status: "pending" } },
    });

    const client = createPrintifyOrderClient("key", "shop-1");
    const job = await client.createOrder(order());

    expect(job.providerJobId).toBe("py-order-1");
    expect(job.state).toBe("QUEUED");

    const createCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/shops/shop-1/orders.json"));
    const sent = JSON.parse(String(createCall?.[1]?.body));
    expect(sent.line_items[0]).toMatchObject({
      print_provider_id: 29,
      blueprint_id: 12,
      variant_id: 17390,
      quantity: 2,
      print_areas: { front: "https://cdn.example.com/beanie.png" },
    });
    expect(sent.address_to.first_name).toBe("Jordan");
    expect(sent.address_to.last_name).toBe("Rivera");
  });

  it("refuses to place an order for a line item with no blueprint id, rather than guessing", async () => {
    const client = createPrintifyOrderClient("key", "shop-1");
    const bad = order({
      lineItems: [
        {
          sku: "x",
          quantity: 1,
          providerVariantId: "17390",
          artworkUrl: "https://cdn.example.com/a.png",
          technique: "embroidery",
          printAreaId: "front",
        },
      ],
    });

    await expect(client.createOrder(bad)).rejects.toThrow(/catalogProductExternalId/);
  });

  it("maps fulfilled status and shipment fields to shared tracking info", async () => {
    stubFetch({
      "/orders/py-order-1.json": {
        body: {
          status: "fulfilled",
          shipments: [{ carrier: "USPS", number: "9400111", url: "https://track/9400111" }],
        },
      },
    });

    const client = createPrintifyOrderClient("key", "shop-1");
    const result = await client.getOrder("py-order-1");

    expect(result.state).toBe("SHIPPED");
    expect(result.tracking?.trackingNumber).toBe("9400111");
  });

  it("estimates cost from a catalog lookup plus a shipping-only call", async () => {
    stubFetch({
      "/print_providers.json": { body: [{ id: 29 }] },
      "/variants.json": { body: { variants: [{ id: 17390, cost: 1179 }] } },
      "/orders/shipping.json": { body: { standard: 450 } },
    });

    const client = createPrintifyOrderClient("key", "shop-1");
    const cost = await client.estimateCost(order().lineItems[0]!, "US");

    expect(cost.baseCost).toBeCloseTo(11.79);
    expect(cost.estimatedShipping).toBeCloseTo(4.5);
  });
});
