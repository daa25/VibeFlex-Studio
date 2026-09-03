CREATE TABLE IF NOT EXISTS "studio_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" text NOT NULL,
	"design_reference" text,
	"artwork_asset_id" text,
	"shopify_product_id" text,
	"state" text DEFAULT 'RECEIVED' NOT NULL,
	"requested_state" text,
	"claimed_by" text,
	"lease_expires_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"failure_reason" text,
	"evidence" jsonb DEFAULT '{}'::jsonb,
	"requires_approval" text DEFAULT 'false' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_jobs_job_key_unique" UNIQUE("job_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_jobs_state_idx" ON "studio_jobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_jobs_next_retry_idx" ON "studio_jobs" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_jobs_reference_idx" ON "studio_jobs" USING btree ("design_reference");