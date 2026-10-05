// Shopify Product Catalog (Airtable) -> ProductRoutingRecord mapping.
//
// Reads the canonical control-plane table (base appuaF1jfeBr2PPqn, table
// "Shopify Product Catalog") and maps it into the routing engine's input
// shape. Field IDs are used instead of field names so a rename in Airtable
// doesn't silently break routing (it would instead return undefined for
// that field, which this module treats as "unknown", never as a guess).
//
// NEVER use base app2v4oiRu7SdsdL9 — that is explicitly not the canonical
// base for this project.

import { listAirtableRecords, type AirtableRecord } from "./client";
import type {
  Brand,
  CommerceType,
  CheckoutType,
  FulfillmentStatus,
  InventoryStatus,
  ProductRoutingRecord,
} from "../routing/product-router";

export const SHOPIFY_PRODUCT_CATALOG_BASE_ID = "appuaF1jfeBr2PPqn";
const TABLE_ID = "tbl7t3sguT93pYwbV";

// Field IDs from the live "Shopify Product Catalog" table schema.
const FIELD = {
  shopifyProductId: "fldnysyxLXqZSPtLE",
  brand: "fld69krwwWpyGX5fI",
  commerceType: "fldNdjrnUy2em53nk",
  checkoutType: "fldNiwkuNfQKJuiNK",
  supplier: "fldziL5kPMjiCbLed", // "Fulfillment Provider"
  affiliateUrl: "fldhIBwC1anKMZ4wL",
  inventoryStatus: "fldTICtNVxujsI7T1",
  fulfillmentStatus: "fldwFpWkJ0d396Gc2",
  source: "fldNltvHRVkXskQ6n",
} as const;

type SingleSelectCell = { name: string } | undefined;

function selectName(value: unknown): string | null {
  const cell = value as SingleSelectCell;
  return cell?.name ?? null;
}

function mapInventoryStatus(raw: string | null): InventoryStatus {
  switch (raw) {
    case "In Stock":
      return "in_stock";
    case "Low Stock":
      return "low_stock";
    case "Out of Stock":
      return "out_of_stock";
    default:
      return "unknown";
  }
}

function mapFulfillmentStatus(raw: string | null): FulfillmentStatus {
  switch (raw) {
    case "Ready":
      return "ready";
    case "Pending":
      return "pending";
    case "Blocked":
      return "blocked";
    default:
      return "unknown";
  }
}

export function airtableRecordToRoutingRecord(record: AirtableRecord): ProductRoutingRecord {
  const f = record.fields;
  return {
    shopifyProductId: (f[FIELD.shopifyProductId] as string) ?? null,
    brand: selectName(f[FIELD.brand]) as Brand | null,
    commerceType: selectName(f[FIELD.commerceType]) as CommerceType | null,
    checkoutType: selectName(f[FIELD.checkoutType]) as CheckoutType | null,
    supplier: (f[FIELD.supplier] as string) ?? null,
    affiliateUrl: (f[FIELD.affiliateUrl] as string) ?? null,
    inventoryStatus: mapInventoryStatus(selectName(f[FIELD.inventoryStatus])),
    fulfillmentStatus: mapFulfillmentStatus(selectName(f[FIELD.fulfillmentStatus])),
    source: (f[FIELD.source] as string) ?? null,
  };
}

/**
 * Fetches every row in the Shopify Product Catalog and returns it as
 * routing records, keyed by Shopify Product ID. Rows with no Shopify
 * Product ID are dropped — there is nothing a page could route to.
 */
export async function fetchProductRoutingTable(options?: {
  brand?: Brand;
}): Promise<Map<string, ProductRoutingRecord>> {
  const filterByFormula = options?.brand ? `{Brand} = "${options.brand}"` : undefined;

  const records = await listAirtableRecords(TABLE_ID, {
    fields: Object.values(FIELD),
    filterByFormula,
  });

  const out = new Map<string, ProductRoutingRecord>();
  for (const record of records) {
    const routing = airtableRecordToRoutingRecord(record);
    if (routing.shopifyProductId) out.set(routing.shopifyProductId, routing);
  }
  return out;
}
