// Durable studio jobs.
//
// This table is the control plane for autonomous operation. A job is a unit of
// work a worker can claim, execute, verify and release without a browser
// session. State lives here rather than in memory so a redeploy, a crash or a
// cold start cannot lose a half-finished product.
//
// Locking is intentionally simple: a claim writes a worker id and a lease
// expiry. A lease that has expired is reclaimable, so a worker that dies never
// strands a job permanently.

import { pgTable, text, integer, jsonb, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const studioJobs = pgTable(
  "studio_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** Stable, human-quotable job id, e.g. JOB-7Q2K9M. */
    jobKey: text("job_key").notNull().unique(),

    /** The design/product this job operates on. */
    designReference: text("design_reference"),
    artworkAssetId: text("artwork_asset_id"),
    shopifyProductId: text("shopify_product_id"),

    state: text("state").notNull().default("RECEIVED"),
    /** Set when a human or policy requests a specific target state. */
    requestedState: text("requested_state"),

    /** Claim/lock. A null lease or an expired lease means the job is free. */
    claimedBy: text("claimed_by"),
    leaseExpiresAt: timestamp("lease_expires_at"),

    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),
    nextRetryAt: timestamp("next_retry_at"),

    failureReason: text("failure_reason"),
    /** Gate failures, QA findings, verification snapshots — the audit trail. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}),

    /** True when the job is parked waiting on a person. */
    requiresApproval: text("requires_approval").notNull().default("false"),

    /** What triggered this job: upload, order, schedule, repair, manual. */
    trigger: text("trigger").notNull().default("manual"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    stateIdx: index("studio_jobs_state_idx").on(t.state),
    retryIdx: index("studio_jobs_next_retry_idx").on(t.nextRetryAt),
    referenceIdx: index("studio_jobs_reference_idx").on(t.designReference),
  })
);

export type StudioJobRow = typeof studioJobs.$inferSelect;
export type NewStudioJob = typeof studioJobs.$inferInsert;
