// Product routing engine — pure, provider-neutral, no I/O.
//
// This is the single place that decides where a buyer goes to actually buy
// a product. Every page (Studio, store, TikTok feed, future headless pages)
// calls resolveProductDestination() instead of hardcoding "if affiliate,
// link out" logic per page. Configuration (which products are which
// commerce_type) lives in Airtable — see ../airtable/product-catalog.ts for
// the fetch/mapping side. This module never talks to Airtable, Shopify, or
// Impact directly, so it can be unit-tested with plain objects.

export type CommerceType = "owned" | "pod" | "dropship" | "affiliate" | "digital";
export type CheckoutType = "shopify" | "impact";
export type Brand = "VibeFlex Sports" | "490 Movement";

export type InventoryStatus = "in_stock" | "low_stock" | "out_of_stock" | "unknown";
export type FulfillmentStatus = "ready" | "pending" | "blocked" | "unknown";

/**
 * The routing-relevant shape of a product, regardless of where it came
 * from. Airtable is the source of truth for every field here except
 * `affiliateUrl`, which must itself have come from a real Impact.com
 * generateDeepLink() call — never fabricate one.
 */
export type ProductRoutingRecord = {
  shopifyProductId: string | null;
  brand: Brand | null;
  commerceType: CommerceType | null;
  checkoutType: CheckoutType | null;
  supplier: string | null;
  affiliateUrl: string | null;
  inventoryStatus: InventoryStatus;
  fulfillmentStatus: FulfillmentStatus;
  source: string | null;
};

export type ProductDestination =
  | { kind: "shopify"; productId: string; fulfillmentMode: "owned" | "pod" | "dropship" }
  | { kind: "shopify-digital"; productId: string }
  | { kind: "impact"; url: string };

export class ProductRoutingError extends Error {
  constructor(
    public readonly code:
      | "MISSING_COMMERCE_TYPE"
      | "MISSING_SHOPIFY_PRODUCT_ID"
      | "MISSING_AFFILIATE_URL"
      | "UNKNOWN_COMMERCE_TYPE",
    message: string
  ) {
    super(message);
    this.name = "ProductRoutingError";
  }
}

/**
 * Decides where a buyer should be sent to purchase this product.
 *
 * Deliberately throws rather than guessing when a record is incomplete —
 * a product with no destination should block the page from rendering a
 * buy button, not silently fall back to some default that sends a buyer
 * nowhere or to the wrong place. Callers render a "not ready to sell" state
 * on ProductRoutingError instead of catching-and-hardcoding a fallback.
 */
export function resolveProductDestination(record: ProductRoutingRecord): ProductDestination {
  if (!record.commerceType) {
    throw new ProductRoutingError(
      "MISSING_COMMERCE_TYPE",
      "Product has no Commerce Type set in Airtable — cannot route it. Set owned/pod/dropship/affiliate/digital."
    );
  }

  switch (record.commerceType) {
    case "owned":
    case "pod":
    case "dropship": {
      if (!record.shopifyProductId) {
        throw new ProductRoutingError(
          "MISSING_SHOPIFY_PRODUCT_ID",
          `Commerce Type "${record.commerceType}" routes to Shopify but no Shopify Product ID is on record.`
        );
      }
      return { kind: "shopify", productId: record.shopifyProductId, fulfillmentMode: record.commerceType };
    }

    case "digital": {
      if (!record.shopifyProductId) {
        throw new ProductRoutingError(
          "MISSING_SHOPIFY_PRODUCT_ID",
          "Commerce Type \"digital\" routes to Shopify digital fulfillment but no Shopify Product ID is on record."
        );
      }
      return { kind: "shopify-digital", productId: record.shopifyProductId };
    }

    case "affiliate": {
      if (!record.affiliateUrl) {
        throw new ProductRoutingError(
          "MISSING_AFFILIATE_URL",
          "Commerce Type \"affiliate\" routes to an Impact.com URL but none is on record. Generate one via " +
            "integrations/impact/client.ts generateDeepLink() — never construct this URL by hand."
        );
      }
      return { kind: "impact", url: record.affiliateUrl };
    }

    default: {
      // Exhaustiveness guard — if CommerceType grows a new member this
      // becomes a real compile error upstream, and a real runtime error here.
      const unreachable: never = record.commerceType;
      throw new ProductRoutingError(
        "UNKNOWN_COMMERCE_TYPE",
        `Unrecognized Commerce Type: ${String(unreachable)}`
      );
    }
  }
}

/** True when the product has enough data to render a working buy button at all. */
export function isSellable(record: ProductRoutingRecord): boolean {
  try {
    resolveProductDestination(record);
  } catch {
    return false;
  }
  return record.fulfillmentStatus !== "blocked" && record.inventoryStatus !== "out_of_stock";
}
