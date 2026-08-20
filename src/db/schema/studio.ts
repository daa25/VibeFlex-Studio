// Studio runtime tables.
//
// The tables in ./index.ts model the full internal product-creation pipeline
// (organizations, brand profiles, projects, jobs). Those require an org and a
// brand profile to exist before anything can be written, which is the right
// shape for the internal tool but too heavy for the customer-facing studio.
//
// These tables are the minimal, self-contained persistence the live studio
// workflow needs: an uploaded artwork, a saved design configuration, and the
// order/fulfillment record that follows it. They intentionally reference
// artwork by asset id (text) rather than by FK into the pipeline tables, so a
// customer session never needs an organization row.

import { pgTable, text, integer, boolean, jsonb, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

export const studioArtworks = pgTable("studio_artworks", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: text("asset_id").notNull().unique(),
  storageProvider: text("storage_provider").notNull(),
  storagePath: text("storage_path").notNull(),
  url: text("url").notNull(),
  fileName: text("file_name"),
  mimeType: text("mime_type").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  bytes: integer("bytes").notNull(),
  checksum: text("checksum").notNull(),
  hasTransparency: boolean("has_transparency").notNull().default(false),
  ephemeral: boolean("ephemeral").notNull().default(false),
  analysis: jsonb("analysis").$type<Record<string, unknown>>().default({}),
  aiAnalysis: jsonb("ai_analysis").$type<Record<string, unknown> | null>(),
  aiStatus: text("ai_status").notNull().default("not_configured"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const studioDesigns = pgTable("studio_designs", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Short human-quotable reference, e.g. VF-7Q2K9M. Also written to Shopify. */
  reference: text("reference").notNull().unique(),
  artworkAssetId: text("artwork_asset_id").notNull(),
  productId: text("product_id").notNull(),
  colorId: text("color_id").notNull(),
  sizeId: text("size_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  printGeometry: jsonb("print_geometry").$type<Record<string, unknown>[]>().default([]),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }),
  marginPct: numeric("margin_pct", { precision: 5, scale: 2 }),
  pricing: jsonb("pricing").$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("CONFIGURED"),
  provider: text("provider"),
  providerRefs: jsonb("provider_refs").$type<Record<string, unknown>>().default({}),
  shopifyProductId: text("shopify_product_id"),
  shopifyVariantIds: jsonb("shopify_variant_ids").$type<string[]>().default([]),
  shopifyAdminUrl: text("shopify_admin_url"),
  checkoutUrl: text("checkout_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const studioOrders = pgTable("studio_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  shopifyOrderId: text("shopify_order_id").notNull(),
  shopifyLineItemId: text("shopify_line_item_id").notNull(),
  designReference: text("design_reference"),
  artworkUrl: text("artwork_url"),
  provider: text("provider"),
  providerOrderId: text("provider_order_id"),
  status: text("status").notNull().default("RECEIVED"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
