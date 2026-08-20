import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  pgEnum,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums / state machines
// ---------------------------------------------------------------------------

export const productProjectStatus = pgEnum("product_project_status", [
  "DRAFT",
  "ARTWORK_ANALYZING",
  "ARTWORK_READY",
  "PRODUCT_SELECTED",
  "CONFIGURING",
  "MOCKUPS_GENERATING",
  "CONTENT_GENERATING",
  "REVIEW_REQUIRED",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "PUBLISHED",
  "PUBLISH_FAILED",
  "ARCHIVED",
]);

export const jobStatus = pgEnum("job_status", [
  "QUEUED",
  "RUNNING",
  "WAITING_EXTERNAL",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const assetStatus = pgEnum("asset_status", [
  "UPLOADING",
  "PROCESSING",
  "READY",
  "FAILED",
  "ARCHIVED",
]);

// ---------------------------------------------------------------------------
// Core org / brand
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("internal"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const brandProfiles = pgTable("brand_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  audience: text("audience"),
  voice: text("voice"),
  primaryColors: jsonb("primary_colors").$type<string[]>().default([]),
  secondaryColors: jsonb("secondary_colors").$type<string[]>().default([]),
  fonts: jsonb("fonts").$type<string[]>().default([]),
  logoAssetId: uuid("logo_asset_id"),
  defaultMargin: numeric("default_margin", { precision: 5, scale: 2 }),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  defaultShopifyStoreId: uuid("default_shopify_store_id"),
  preferredProductCategories: jsonb("preferred_product_categories")
    .$type<string[]>()
    .default([]),
  preferredProviders: jsonb("preferred_providers").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Assets / Artwork
// ---------------------------------------------------------------------------

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  type: text("type").notNull(), // original | preview | mockup | campaign | export
  storageProvider: text("storage_provider").notNull().default("supabase"),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  checksum: text("checksum"),
  source: text("source"), // upload | canva | ai_generated | provider
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const artworks = pgTable("artworks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  name: text("name").notNull(),
  originalAssetId: uuid("original_asset_id")
    .references(() => assets.id)
    .notNull(),
  previewAssetId: uuid("preview_asset_id").references(() => assets.id),
  fileType: text("file_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  dpi: integer("dpi"),
  hasTransparency: boolean("has_transparency").default(false),
  status: assetStatus("status").notNull().default("UPLOADING"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const artworkAnalyses = pgTable("artwork_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  artworkId: uuid("artwork_id")
    .references(() => artworks.id)
    .notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull(),
  detectedText: jsonb("detected_text").$type<string[]>().default([]),
  category: text("category"),
  audience: jsonb("audience").$type<string[]>().default([]),
  dominantColors: jsonb("dominant_colors").$type<string[]>().default([]),
  recommendedProducts: jsonb("recommended_products").$type<string[]>().default([]),
  recommendedColors: jsonb("recommended_colors").$type<string[]>().default([]),
  warnings: jsonb("warnings").$type<string[]>().default([]),
  printSuitabilityScore: integer("print_suitability_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// POD catalog (provider-neutral)
// ---------------------------------------------------------------------------

export const podProviderConnections = pgTable("pod_provider_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  provider: text("provider").notNull(), // printful | printify | gelato | ...
  encryptedCredentials: text("encrypted_credentials").notNull(),
  status: text("status").notNull().default("disconnected"),
  capabilities: jsonb("capabilities").$type<Record<string, boolean>>().default({}),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const podCatalogProducts = pgTable("pod_catalog_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  brand: text("brand"),
  model: text("model"),
  category: text("category"),
  description: text("description"),
  printAreas: jsonb("print_areas").$type<string[]>().default([]),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}),
  capabilities: jsonb("capabilities").$type<Record<string, boolean>>().default({}),
  active: boolean("active").notNull().default(true),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const podCatalogVariants = pgTable("pod_catalog_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  catalogProductId: uuid("catalog_product_id")
    .references(() => podCatalogProducts.id)
    .notNull(),
  externalId: text("external_id").notNull(),
  color: text("color"),
  colorHex: text("color_hex"),
  size: text("size"),
  baseCost: numeric("base_cost", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  availability: text("availability").notNull().default("in_stock"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

// ---------------------------------------------------------------------------
// Product creation pipeline
// ---------------------------------------------------------------------------

export const productProjects = pgTable("product_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  brandProfileId: uuid("brand_profile_id")
    .references(() => brandProfiles.id)
    .notNull(),
  artworkId: uuid("artwork_id")
    .references(() => artworks.id)
    .notNull(),
  name: text("name").notNull(),
  status: productProjectStatus("status").notNull().default("DRAFT"),
  currentStep: text("current_step").notNull().default("artwork"),
  selectedProvider: text("selected_provider"),
  selectedCatalogProductId: uuid("selected_catalog_product_id").references(
    () => podCatalogProducts.id
  ),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productConfigurations = pgTable("product_configurations", {
  id: uuid("id").defaultRandom().primaryKey(),
  productProjectId: uuid("product_project_id")
    .references(() => productProjects.id)
    .notNull(),
  title: text("title"),
  subtitle: text("subtitle"),
  descriptionHtml: text("description_html"),
  productType: text("product_type"),
  vendor: text("vendor"),
  handle: text("handle"),
  tags: jsonb("tags").$type<string[]>().default([]),
  collections: jsonb("collections").$type<string[]>().default([]),
  seoTitle: text("seo_title"),
  metaDescription: text("meta_description"),
  selectedColors: jsonb("selected_colors").$type<string[]>().default([]),
  selectedSizes: jsonb("selected_sizes").$type<string[]>().default([]),
  placements: jsonb("placements").$type<Record<string, unknown>>().default({}),
  pricingRules: jsonb("pricing_rules").$type<Record<string, unknown>>().default({}),
  careInstructions: text("care_instructions"),
  materialDetails: text("material_details"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

export const productVariantDrafts = pgTable("product_variant_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  productProjectId: uuid("product_project_id")
    .references(() => productProjects.id)
    .notNull(),
  providerVariantId: text("provider_variant_id"),
  color: text("color"),
  size: text("size"),
  sku: text("sku").notNull(),
  baseCost: numeric("base_cost", { precision: 10, scale: 2 }).notNull(),
  additionalCost: numeric("additional_cost", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  retailPrice: numeric("retail_price", { precision: 10, scale: 2 }).notNull(),
  compareAtPrice: numeric("compare_at_price", { precision: 10, scale: 2 }),
  profit: numeric("profit", { precision: 10, scale: 2 }),
  margin: numeric("margin", { precision: 5, scale: 2 }),
  enabled: boolean("enabled").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

export const mockups = pgTable("mockups", {
  id: uuid("id").defaultRandom().primaryKey(),
  productProjectId: uuid("product_project_id")
    .references(() => productProjects.id)
    .notNull(),
  variantDraftId: uuid("variant_draft_id").references(() => productVariantDrafts.id),
  type: text("type").notNull(), // front | back | detail | color_swap
  assetId: uuid("asset_id").references(() => assets.id),
  provider: text("provider"),
  providerJobId: text("provider_job_id"),
  status: text("status").notNull().default("pending"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaignAssets = pgTable("campaign_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  productProjectId: uuid("product_project_id")
    .references(() => productProjects.id)
    .notNull(),
  type: text("type").notNull(),
  assetId: uuid("asset_id").references(() => assets.id),
  prompt: text("prompt"),
  provider: text("provider"),
  status: text("status").notNull().default("pending"),
  dimensions: text("dimensions"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Shopify publishing
// ---------------------------------------------------------------------------

export const shopifyStores = pgTable("shopify_stores", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  shopDomain: text("shop_domain").notNull().unique(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  apiVersion: text("api_version").notNull(),
  status: text("status").notNull().default("connected"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const publishedProducts = pgTable("published_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  productProjectId: uuid("product_project_id")
    .references(() => productProjects.id)
    .notNull(),
  shopifyStoreId: uuid("shopify_store_id")
    .references(() => shopifyStores.id)
    .notNull(),
  shopifyProductId: text("shopify_product_id"),
  providerProductId: text("provider_product_id"),
  status: text("status").notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

export const publishedVariants = pgTable("published_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  publishedProductId: uuid("published_product_id")
    .references(() => publishedProducts.id)
    .notNull(),
  productVariantDraftId: uuid("product_variant_draft_id")
    .references(() => productVariantDrafts.id)
    .notNull(),
  shopifyVariantId: text("shopify_variant_id"),
  providerVariantId: text("provider_variant_id"),
  sku: text("sku").notNull(),
  status: text("status").notNull().default("draft"),
});

// ---------------------------------------------------------------------------
// Jobs / Audit
// ---------------------------------------------------------------------------

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  type: text("type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  status: jobStatus("status").notNull().default("QUEUED"),
  progress: integer("progress").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  externalJobId: text("external_job_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  input: jsonb("input").$type<Record<string, unknown>>().default({}),
  output: jsonb("output").$type<Record<string, unknown>>().default({}),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
