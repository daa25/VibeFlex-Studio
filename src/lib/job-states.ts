// Studio job state machine.
//
// The pipeline has to be resumable by a worker that was not present when the
// job started, so progress lives in a persisted state column rather than in a
// user's session or a process variable. Every transition is explicit: a worker
// that crashes mid-stage leaves a claimable job in a known state, not an
// ambiguous one.

export const PROGRESS_STATES = [
  "RECEIVED",
  "ARTWORK_VALIDATING",
  "ANALYZING",
  "PRODUCT_SELECTING",
  "SUPPLIER_MAPPING",
  "MOCKUP_GENERATING",
  "QA_RUNNING",
  "LISTING_GENERATING",
  "SHOPIFY_DRAFT_CREATING",
  "VERIFYING",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "PUBLISHING",
  "LIVE",
] as const;

export const EXCEPTION_STATES = [
  "ARTWORK_REPAIR_REQUIRED",
  "MOCKUP_REPAIR_REQUIRED",
  "SUPPLIER_BLOCKED",
  "QA_REJECTED",
  "PRICING_HOLD",
  "PUBLISH_FAILED",
  "FULFILLMENT_BLOCKED",
  "MANUAL_REVIEW",
] as const;

export type ProgressState = (typeof PROGRESS_STATES)[number];
export type ExceptionState = (typeof EXCEPTION_STATES)[number];
export type JobState = ProgressState | ExceptionState;

export const ALL_STATES: readonly JobState[] = [...PROGRESS_STATES, ...EXCEPTION_STATES];

export function isExceptionState(state: JobState): state is ExceptionState {
  return (EXCEPTION_STATES as readonly string[]).includes(state);
}

/** Terminal states: a worker must not pick these up as runnable work. */
export const TERMINAL_STATES: readonly JobState[] = ["LIVE"];

/**
 * States that require a human decision. The autonomous router parks jobs here
 * instead of retrying them, because retrying will not change the outcome.
 */
export const HUMAN_STATES: readonly JobState[] = [
  "READY_FOR_APPROVAL",
  "MANUAL_REVIEW",
  "FULFILLMENT_BLOCKED",
  "PRICING_HOLD",
];

/** The happy path. Each stage's worker advances to the next entry. */
const NEXT_ON_SUCCESS: Partial<Record<ProgressState, ProgressState>> = {
  RECEIVED: "ARTWORK_VALIDATING",
  ARTWORK_VALIDATING: "ANALYZING",
  ANALYZING: "PRODUCT_SELECTING",
  PRODUCT_SELECTING: "SUPPLIER_MAPPING",
  SUPPLIER_MAPPING: "MOCKUP_GENERATING",
  MOCKUP_GENERATING: "QA_RUNNING",
  QA_RUNNING: "LISTING_GENERATING",
  LISTING_GENERATING: "SHOPIFY_DRAFT_CREATING",
  SHOPIFY_DRAFT_CREATING: "VERIFYING",
  VERIFYING: "READY_FOR_APPROVAL",
  APPROVED: "PUBLISHING",
  PUBLISHING: "LIVE",
};

export function nextState(current: JobState): JobState | null {
  if (isExceptionState(current)) return null;
  return NEXT_ON_SUCCESS[current] ?? null;
}

/**
 * Where a stage failure sends the job. Repair states are re-enterable: fixing
 * the underlying asset puts the job back on the happy path rather than
 * forcing a new job (which would risk a duplicate Shopify product).
 */
export const RESUME_FROM: Record<ExceptionState, ProgressState | null> = {
  ARTWORK_REPAIR_REQUIRED: "ARTWORK_VALIDATING",
  MOCKUP_REPAIR_REQUIRED: "MOCKUP_GENERATING",
  QA_REJECTED: "MOCKUP_GENERATING",
  SUPPLIER_BLOCKED: "SUPPLIER_MAPPING",
  PRICING_HOLD: "LISTING_GENERATING",
  PUBLISH_FAILED: "SHOPIFY_DRAFT_CREATING",
  FULFILLMENT_BLOCKED: "SUPPLIER_MAPPING",
  MANUAL_REVIEW: null,
};

export function canTransition(from: JobState, to: JobState): boolean {
  if (from === to) return true;
  if (TERMINAL_STATES.includes(from)) return false;
  // Any stage may fail into an exception state.
  if (isExceptionState(to)) return true;
  // An exception may resume at its designated stage.
  if (isExceptionState(from)) {
    const resume = RESUME_FROM[from];
    return resume === to;
  }
  // Approval is a human transition out of READY_FOR_APPROVAL.
  if (from === "READY_FOR_APPROVAL" && to === "APPROVED") return true;
  return nextState(from) === to;
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal studio job transition: ${from} -> ${to}`);
  }
}

/** Exponential backoff with a ceiling, so a broken provider is not hammered. */
export function nextRetryDelayMs(attempt: number): number {
  const base = 30_000;
  const max = 30 * 60_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), max);
}

export const MAX_ATTEMPTS = 5;

/**
 * Routes a stage failure. `retry` re-runs the same stage until attempts are
 * exhausted; `repair` and `escalate` move the job to a state a human or a
 * repair worker owns.
 */
export function routeFailure(params: {
  currentState: ProgressState;
  disposition: "repair" | "retry" | "escalate";
  suggestedState: JobState;
  attempts: number;
}): { state: JobState; retryInMs: number | null; requiresHuman: boolean } {
  const { disposition, suggestedState, attempts } = params;

  if (disposition === "retry" && attempts < MAX_ATTEMPTS) {
    return { state: params.currentState, retryInMs: nextRetryDelayMs(attempts + 1), requiresHuman: false };
  }
  if (disposition === "retry") {
    // Out of attempts — stop retrying and let a human look at it.
    return { state: "MANUAL_REVIEW", retryInMs: null, requiresHuman: true };
  }
  return {
    state: suggestedState,
    retryInMs: null,
    requiresHuman: HUMAN_STATES.includes(suggestedState),
  };
}
