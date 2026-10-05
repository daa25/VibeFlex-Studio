import { describe, expect, it } from "vitest";
import {
  ProductRoutingError,
  isSellable,
  resolveProductDestination,
  type ProductRoutingRecord,
} from "@/integrations/routing/product-router";

function record(overrides: Partial<ProductRoutingRecord> = {}): ProductRoutingRecord {
  return {
    shopifyProductId: null,
    brand: null,
    commerceType: null,
    checkoutType: null,
    supplier: null,
    affiliateUrl: null,
    inventoryStatus: "unknown",
    fulfillmentStatus: "unknown",
    source: null,
    ...overrides,
  };
}

describe("resolveProductDestination", () => {
  it.each(["owned", "pod", "dropship"] as const)(
    "routes commerce type %s with a Shopify product id to Shopify",
    (commerceType) => {
      const dest = resolveProductDestination(record({ commerceType, shopifyProductId: "gid://shopify/Product/1" }));
      expect(dest).toEqual({ kind: "shopify", productId: "gid://shopify/Product/1", fulfillmentMode: commerceType });
    }
  );

  it("routes digital products to Shopify digital fulfillment", () => {
    const dest = resolveProductDestination(
      record({ commerceType: "digital", shopifyProductId: "gid://shopify/Product/2" })
    );
    expect(dest).toEqual({ kind: "shopify-digital", productId: "gid://shopify/Product/2" });
  });

  it("routes affiliate products to their Impact.com URL", () => {
    const dest = resolveProductDestination(
      record({ commerceType: "affiliate", affiliateUrl: "https://goto.impact.com/abc" })
    );
    expect(dest).toEqual({ kind: "impact", url: "https://goto.impact.com/abc" });
  });

  it("throws rather than guessing when Commerce Type is unset", () => {
    expect(() => resolveProductDestination(record())).toThrow(ProductRoutingError);
    expect(() => resolveProductDestination(record())).toThrow(/Commerce Type/);
  });

  it.each(["owned", "pod", "dropship", "digital"] as const)(
    "throws rather than guessing a Shopify destination when %s has no Shopify Product ID",
    (commerceType) => {
      expect(() => resolveProductDestination(record({ commerceType }))).toThrow(
        /no Shopify Product ID/
      );
    }
  );

  it("throws rather than guessing an affiliate URL when one isn't on record", () => {
    expect(() => resolveProductDestination(record({ commerceType: "affiliate" }))).toThrow(
      /no Impact\.com URL|none is on record/
    );
  });
});

describe("isSellable", () => {
  it("is false when the record can't be routed at all", () => {
    expect(isSellable(record())).toBe(false);
  });

  it("is false when fulfillment is blocked even if routing would succeed", () => {
    expect(
      isSellable(
        record({ commerceType: "owned", shopifyProductId: "gid://1", fulfillmentStatus: "blocked" })
      )
    ).toBe(false);
  });

  it("is false when inventory is out of stock", () => {
    expect(
      isSellable(
        record({ commerceType: "owned", shopifyProductId: "gid://1", inventoryStatus: "out_of_stock" })
      )
    ).toBe(false);
  });

  it("is true when routable and not blocked/out of stock", () => {
    expect(
      isSellable(
        record({
          commerceType: "owned",
          shopifyProductId: "gid://1",
          fulfillmentStatus: "ready",
          inventoryStatus: "in_stock",
        })
      )
    ).toBe(true);
  });
});
