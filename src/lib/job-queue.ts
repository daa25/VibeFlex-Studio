// Job queue.
//
// The API a worker uses to do work without a human session:
//
//   claimNextJob() -> execute the stage -> completeStage() | failStage()
//
// Claims are leased. If a worker dies mid-stage the lease expires and another
// worker picks the job up in the same state, so nothing strands permanently
// and nothing runs twice concurrently.
//
// Every function degrades safely when DATABASE_URL is absent: the studio keeps
// working synchronously, it just cannot run autonomously. That is reported,
// never hidden.

import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { tryGetDb } from "@/db/client";
import { studioJobs, type StudioJobRow } from "@/db/schema/jobs";
import {
  assertTransition,
  HUMAN_STATES,
  isExceptionState,
  nextState,
  routeFailure,
  TERMINAL_STATES,
  type JobState,
  type ProgressState,
} from "./job-states";

const LEASE_MS = 5 * 60_000;
const JOB_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newJobKey(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += JOB_ALPHABET[Math.floor(Math.random() * JOB_ALPHABET.length)];
  }
  return `JOB-${out}`;
}

export type JobQueueUnavailable = { available: false; reason: string };
export type JobQueueOk<T> = { available: true; value: T };
export type JobQueueResult<T> = JobQueueOk<T> | JobQueueUnavailable;

function unavailable(): JobQueueUnavailable {
  return {
    available: false,
    reason:
      "DATABASE_URL is not configured, so studio jobs cannot be persisted. The pipeline still runs synchronously, but it cannot run autonomously or survive a restart.",
  };
}

export async function createJob(params: {
  designReference?: string;
  artworkAssetId?: string;
  shopifyProductId?: string;
  trigger?: string;
  evidence?: Record<string, unknown>;
}): Promise<JobQueueResult<StudioJobRow>> {
  const db = tryGetDb();
  if (!db) return unavailable();

  // Never open a second job for a design that already has an open one — that
  // is how duplicate Shopify products get created.
  if (params.designReference) {
    const existing = await db
      .select()
      .from(studioJobs)
      .where(eq(studioJobs.designReference, params.designReference))
      .limit(1);
    const open = existing.find((j: StudioJobRow) => !TERMINAL_STATES.includes(j.state as JobState));
    if (open) return { available: true, value: open };
  }

  const [row] = await db
    .insert(studioJobs)
    .values({
      jobKey: newJobKey(),
      designReference: params.designReference,
      artworkAssetId: params.artworkAssetId,
      shopifyProductId: params.shopifyProductId,
      trigger: params.trigger ?? "manual",
      evidence: params.evidence ?? {},
      state: "RECEIVED",
    })
    .returning();

  if (!row) {
    return { available: false, reason: "Job insert returned no row." };
  }
  return { available: true, value: row };
}

/**
 * Atomically claims the next runnable job.
 *
 * Runnable means: not terminal, not parked for a human, and either never
 * retried or past its retry time, and either unclaimed or holding an expired
 * lease. The UPDATE ... WHERE id IN (SELECT ...) shape means two workers racing
 * cannot claim the same row.
 */
export async function claimNextJob(workerId: string): Promise<JobQueueResult<StudioJobRow | null>> {
  const db = tryGetDb();
  if (!db) return unavailable();

  const now = new Date();
  const parked = [...TERMINAL_STATES, ...HUMAN_STATES];

  const candidate = await db
    .select({ id: studioJobs.id })
    .from(studioJobs)
    .where(
      and(
        sql`${studioJobs.state} NOT IN (${sql.join(parked.map((s) => sql`${s}`), sql`, `)})`,
        or(isNull(studioJobs.nextRetryAt), lt(studioJobs.nextRetryAt, now)),
        or(isNull(studioJobs.leaseExpiresAt), lt(studioJobs.leaseExpiresAt, now))
      )
    )
    .orderBy(asc(studioJobs.createdAt))
    .limit(1);

  if (!candidate.length) return { available: true, value: null };

  const [claimed] = await db
    .update(studioJobs)
    .set({
      claimedBy: workerId,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      lastAttemptAt: now,
      attempts: sql`${studioJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(studioJobs.id, candidate[0]!.id),
        or(isNull(studioJobs.leaseExpiresAt), lt(studioJobs.leaseExpiresAt, now))
      )
    )
    .returning();

  // Lost the race to another worker — that is fine, just report no work.
  return { available: true, value: claimed ?? null };
}

/** Advances a job to the next stage and releases the lease. */
export async function completeStage(params: {
  jobId: string;
  from: JobState;
  evidence?: Record<string, unknown>;
  shopifyProductId?: string;
}): Promise<JobQueueResult<StudioJobRow | null>> {
  const db = tryGetDb();
  if (!db) return unavailable();

  const to = nextState(params.from);
  if (!to) {
    return { available: true, value: await releaseJob(db, params.jobId, params.from, params.evidence) };
  }
  assertTransition(params.from, to);

  const [row] = await db
    .update(studioJobs)
    .set({
      state: to,
      claimedBy: null,
      leaseExpiresAt: null,
      nextRetryAt: null,
      failureReason: null,
      requiresApproval: String(HUMAN_STATES.includes(to)),
      ...(params.shopifyProductId ? { shopifyProductId: params.shopifyProductId } : {}),
      ...(params.evidence ? { evidence: params.evidence } : {}),
      updatedAt: new Date(),
    })
    .where(eq(studioJobs.id, params.jobId))
    .returning();

  return { available: true, value: row ?? null };
}

/** Records a stage failure and routes the job to retry, repair or a human. */
export async function failStage(params: {
  jobId: string;
  currentState: ProgressState;
  disposition: "repair" | "retry" | "escalate";
  suggestedState: JobState;
  attempts: number;
  reason: string;
  evidence?: Record<string, unknown>;
}): Promise<JobQueueResult<StudioJobRow | null>> {
  const db = tryGetDb();
  if (!db) return unavailable();

  const route = routeFailure({
    currentState: params.currentState,
    disposition: params.disposition,
    suggestedState: params.suggestedState,
    attempts: params.attempts,
  });

  if (route.state !== params.currentState) assertTransition(params.currentState, route.state);

  const [row] = await db
    .update(studioJobs)
    .set({
      state: route.state,
      claimedBy: null,
      leaseExpiresAt: null,
      nextRetryAt: route.retryInMs ? new Date(Date.now() + route.retryInMs) : null,
      failureReason: params.reason,
      requiresApproval: String(route.requiresHuman),
      ...(params.evidence ? { evidence: params.evidence } : {}),
      updatedAt: new Date(),
    })
    .where(eq(studioJobs.id, params.jobId))
    .returning();

  return { available: true, value: row ?? null };
}

async function releaseJob(
  db: NonNullable<ReturnType<typeof tryGetDb>>,
  jobId: string,
  state: JobState,
  evidence?: Record<string, unknown>
) {
  const [row] = await db
    .update(studioJobs)
    .set({
      claimedBy: null,
      leaseExpiresAt: null,
      requiresApproval: String(HUMAN_STATES.includes(state)),
      ...(evidence ? { evidence } : {}),
      updatedAt: new Date(),
    })
    .where(eq(studioJobs.id, jobId))
    .returning();
  return row ?? null;
}

/** Human approval: the one transition a worker may not make for itself. */
export async function approveJob(jobKey: string): Promise<JobQueueResult<StudioJobRow | null>> {
  const db = tryGetDb();
  if (!db) return unavailable();

  const [job] = await db.select().from(studioJobs).where(eq(studioJobs.jobKey, jobKey)).limit(1);
  if (!job) return { available: true, value: null };
  assertTransition(job.state as JobState, "APPROVED");

  const [row] = await db
    .update(studioJobs)
    .set({ state: "APPROVED", requiresApproval: "false", nextRetryAt: null, updatedAt: new Date() })
    .where(eq(studioJobs.id, job.id))
    .returning();

  return { available: true, value: row ?? null };
}

export async function listJobs(options: { state?: JobState; limit?: number } = {}): Promise<
  JobQueueResult<StudioJobRow[]>
> {
  const db = tryGetDb();
  if (!db) return unavailable();

  const rows = options.state
    ? await db
        .select()
        .from(studioJobs)
        .where(eq(studioJobs.state, options.state))
        .orderBy(asc(studioJobs.createdAt))
        .limit(options.limit ?? 100)
    : await db.select().from(studioJobs).orderBy(asc(studioJobs.createdAt)).limit(options.limit ?? 100);

  return { available: true, value: rows };
}

/** Jobs parked for a person, for the approval queue in the dashboard. */
export async function listExceptions(): Promise<JobQueueResult<StudioJobRow[]>> {
  const db = tryGetDb();
  if (!db) return unavailable();

  const rows = await db.select().from(studioJobs).orderBy(asc(studioJobs.createdAt)).limit(200);
  return {
    available: true,
    value: rows.filter(
      (r: StudioJobRow) => isExceptionState(r.state as JobState) || r.requiresApproval === "true"
    ),
  };
}
