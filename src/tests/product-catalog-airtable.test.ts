import { afterEach, describe, expect, it, vi } from "vitest";
import {
  airtableRecordToRoutingRecord,
  fetchProductRoutingTable,
} from "@/integrations/airtable/product-catalog";
import type { AirtableRecord } from "@/integrations/airtable/client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AIRTABLE_API_KEY;
  delete process.env.AIRTABLE_BASE_ID;
});

function fakeRecord(fields: Record<string, unknown>): AirtableRecord {
  return { id: "rec1", fields };
}

describe("airtableRecordToRoutingRecord", () => {
  it("maps every routing field from its Airtable field id", () => {
    const routing = airtableRecordToRoutingRecord(
      fakeRecord({
        fldnysyxLXqZSPtLE: "gid://shopify/Product/123",
        fld69krwwWpyGX5fI: { name: "VibeFlex Sports" },
        fldNdjrnUy2em53nk: { name: "pod" },
        fldNiwkuNfQKJuiNK: { name: "shopify" },
        fldziL5kPMjiCbLed: "Printify",
        fldhIBwC1anKMZ4wL: null,
        fldTICtNVxujsI7T1: { name: "In Stock" },
        fldwFpWkJ0d396Gc2: { name: "Ready" },
        fldNltvHRVkXskQ6n: "2026-10-05 live Shopify verification",
      })
    );

    expect(routing).toEqual({
      shopifyProductId: "gid://shopify/Product/123",
      brand: "VibeFlex Sports",
      commerceType: "pod",
      checkoutType: "shopify",
      supplier: "Printify",
      affiliateUrl: null,
      inventoryStatus: "in_stock",
      fulfillmentStatus: "ready",
      source: "2026-10-05 live Shopify verification",
    });
  });

  it("maps every field as null/unknown rather than guessing when empty", () => {
    const routing = airtableRecordToRoutingRecord(fakeRecord({}));
    expect(routing).toEqual({
      shopifyProductId: null,
      brand: null,
      commerceType: null,
      checkoutType: null,
      supplier: null,
      affiliateUrl: null,
      inventoryStatus: "unknown",
      fulfillmentStatus: "unknown",
      source: null,
    });
  });
});

describe("fetchProductRoutingTable", () => {
  it("paginates, maps records, and keys the result by Shopify Product ID", async () => {
    process.env.AIRTABLE_API_KEY = "key123";
    process.env.AIRTABLE_BASE_ID = "appuaF1jfeBr2PPqn";

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        callCount += 1;
        expect(url).toContain("/tbl7t3sguT93pYwbV");
        if (callCount === 1) {
          expect(url).not.toContain("offset=");
          return new Response(
            JSON.stringify({
              records: [fakeRecord({ fldnysyxLXqZSPtLE: "gid://shopify/Product/1" })],
              offset: "page2",
            }),
            { status: 200 }
          );
        }
        expect(url).toContain("offset=page2");
        return new Response(
          JSON.stringify({ records: [fakeRecord({ fldnysyxLXqZSPtLE: "gid://shopify/Product/2" })] }),
          { status: 200 }
        );
      })
    );

    const result = await fetchProductRoutingTable();
    expect(callCount).toBe(2);
    expect([...result.keys()]).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/2"]);
  });

  it("drops rows with no Shopify Product ID — nothing to route them to", async () => {
    process.env.AIRTABLE_API_KEY = "key123";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ records: [fakeRecord({})] }), { status: 200 }))
    );

    const result = await fetchProductRoutingTable();
    expect(result.size).toBe(0);
  });

  it("filters by brand via filterByFormula when requested", async () => {
    process.env.AIRTABLE_API_KEY = "key123";
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ records: [] }), { status: 200 });
      })
    );

    await fetchProductRoutingTable({ brand: "490 Movement" });
    const params = new URL(capturedUrl).searchParams;
    expect(params.get("filterByFormula")).toBe('{Brand} = "490 Movement"');
  });
});
