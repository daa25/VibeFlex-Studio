CREATE TYPE "public"."asset_status" AS ENUM('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'WAITING_EXTERNAL', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."product_project_status" AS ENUM('DRAFT', 'ARTWORK_ANALYZING', 'ARTWORK_READY', 'PRODUCT_SELECTED', 'CONFIGURING', 'MOCKUPS_GENERATING', 'CONTENT_GENERATING', 'REVIEW_REQUIRED', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artwork_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"result_json" jsonb NOT NULL,
	"detected_text" jsonb DEFAULT '[]'::jsonb,
	"category" text,
	"audience" jsonb DEFAULT '[]'::jsonb,
	"dominant_colors" jsonb DEFAULT '[]'::jsonb,
	"recommended_products" jsonb DEFAULT '[]'::jsonb,
	"recommended_colors" jsonb DEFAULT '[]'::jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb,
	"print_suitability_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"original_asset_id" uuid NOT NULL,
	"preview_asset_id" uuid,
	"file_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"dpi" integer,
	"has_transparency" boolean DEFAULT false,
	"status" "asset_status" DEFAULT 'UPLOADING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_provider" text DEFAULT 'supabase' NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text,
	"source" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"audience" text,
	"voice" text,
	"primary_colors" jsonb DEFAULT '[]'::jsonb,
	"secondary_colors" jsonb DEFAULT '[]'::jsonb,
	"fonts" jsonb DEFAULT '[]'::jsonb,
	"logo_asset_id" uuid,
	"default_margin" numeric(5, 2),
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"default_shopify_store_id" uuid,
	"preferred_product_categories" jsonb DEFAULT '[]'::jsonb,
	"preferred_providers" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"asset_id" uuid,
	"prompt" text,
	"provider" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dimensions" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"external_job_id" text,
	"error_code" text,
	"error_message" text,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mockups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_project_id" uuid NOT NULL,
	"variant_draft_id" uuid,
	"type" text NOT NULL,
	"asset_id" uuid,
	"provider" text,
	"provider_job_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'internal' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pod_catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"category" text,
	"description" text,
	"print_areas" jsonb DEFAULT '[]'::jsonb,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pod_catalog_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_product_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"color" text,
	"color_hex" text,
	"size" text,
	"base_cost" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"availability" text DEFAULT 'in_stock' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pod_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_project_id" uuid NOT NULL,
	"title" text,
	"subtitle" text,
	"description_html" text,
	"product_type" text,
	"vendor" text,
	"handle" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"collections" jsonb DEFAULT '[]'::jsonb,
	"seo_title" text,
	"meta_description" text,
	"selected_colors" jsonb DEFAULT '[]'::jsonb,
	"selected_sizes" jsonb DEFAULT '[]'::jsonb,
	"placements" jsonb DEFAULT '{}'::jsonb,
	"pricing_rules" jsonb DEFAULT '{}'::jsonb,
	"care_instructions" text,
	"material_details" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand_profile_id" uuid NOT NULL,
	"artwork_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "product_project_status" DEFAULT 'DRAFT' NOT NULL,
	"current_step" text DEFAULT 'artwork' NOT NULL,
	"selected_provider" text,
	"selected_catalog_product_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_variant_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_project_id" uuid NOT NULL,
	"provider_variant_id" text,
	"color" text,
	"size" text,
	"sku" text NOT NULL,
	"base_cost" numeric(10, 2) NOT NULL,
	"additional_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"retail_price" numeric(10, 2) NOT NULL,
	"compare_at_price" numeric(10, 2),
	"profit" numeric(10, 2),
	"margin" numeric(5, 2),
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "published_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_project_id" uuid NOT NULL,
	"shopify_store_id" uuid NOT NULL,
	"shopify_product_id" text,
	"provider_product_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"last_synced_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "published_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"published_product_id" uuid NOT NULL,
	"product_variant_draft_id" uuid NOT NULL,
	"shopify_variant_id" text,
	"provider_variant_id" text,
	"sku" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"shop_domain" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"api_version" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_stores_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artwork_analyses" ADD CONSTRAINT "artwork_analyses_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artworks" ADD CONSTRAINT "artworks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artworks" ADD CONSTRAINT "artworks_original_asset_id_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artworks" ADD CONSTRAINT "artworks_preview_asset_id_assets_id_fk" FOREIGN KEY ("preview_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_product_project_id_product_projects_id_fk" FOREIGN KEY ("product_project_id") REFERENCES "public"."product_projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mockups" ADD CONSTRAINT "mockups_product_project_id_product_projects_id_fk" FOREIGN KEY ("product_project_id") REFERENCES "public"."product_projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mockups" ADD CONSTRAINT "mockups_variant_draft_id_product_variant_drafts_id_fk" FOREIGN KEY ("variant_draft_id") REFERENCES "public"."product_variant_drafts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mockups" ADD CONSTRAINT "mockups_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pod_catalog_variants" ADD CONSTRAINT "pod_catalog_variants_catalog_product_id_pod_catalog_products_id_fk" FOREIGN KEY ("catalog_product_id") REFERENCES "public"."pod_catalog_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pod_provider_connections" ADD CONSTRAINT "pod_provider_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_configurations" ADD CONSTRAINT "product_configurations_product_project_id_product_projects_id_fk" FOREIGN KEY ("product_project_id") REFERENCES "public"."product_projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_projects" ADD CONSTRAINT "product_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_projects" ADD CONSTRAINT "product_projects_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_projects" ADD CONSTRAINT "product_projects_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_projects" ADD CONSTRAINT "product_projects_selected_catalog_product_id_pod_catalog_products_id_fk" FOREIGN KEY ("selected_catalog_product_id") REFERENCES "public"."pod_catalog_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_variant_drafts" ADD CONSTRAINT "product_variant_drafts_product_project_id_product_projects_id_fk" FOREIGN KEY ("product_project_id") REFERENCES "public"."product_projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "published_products" ADD CONSTRAINT "published_products_product_project_id_product_projects_id_fk" FOREIGN KEY ("product_project_id") REFERENCES "public"."product_projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "published_products" ADD CONSTRAINT "published_products_shopify_store_id_shopify_stores_id_fk" FOREIGN KEY ("shopify_store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "published_variants" ADD CONSTRAINT "published_variants_published_product_id_published_products_id_fk" FOREIGN KEY ("published_product_id") REFERENCES "public"."published_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "published_variants" ADD CONSTRAINT "published_variants_product_variant_draft_id_product_variant_drafts_id_fk" FOREIGN KEY ("product_variant_draft_id") REFERENCES "public"."product_variant_drafts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
