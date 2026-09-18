// Job runner.
//
// The worker that actually advances a product through the pipeline. This is
// what makes "upload once, Studio does the rest" true: each stage is a pure-ish
// handler keyed by job state, so a cron, a webhook or a queue consumer can run
// the same code with no browser session and no human step-by-step input.
//
// Two rules shape everything here:
//
//   1. A stage reports an OUTCOME, never a side effect on the job row. The
//      runner owns the state transition, so a handler cannot accidentally skip
//      a gate or promote its own work.
//   2. Nothing reaches Shopify until the gates say so, and nothing is called
//      verified because a service was unavailable. Unknown is not success.

import { getProviderVariantMap } from "@/integrations/pod/catalog-service";
import { adminConfigMissing } from "@/integrations/shopify/admin-client";
import { publishDraftProduct } from "@/integrations/shopify/publish-draft";
import { findExistingDraftByReference, verifyDraftProduct } from "@/integrations/shopify/verify-draft";
import { resolveDesign, type DesignConfig, type ResolvedDesign } from "./design";
import { claimNextJob, completeStage, failStage } from "./job-queue";
import type { JobState, ProgressState } from "./job-states";
import { generateMockup, type MockupOutcome } from "./mockup-service";
import { DEFAULT_POLICY, evaluateGates, type GateInput, type PolicyConfig } from "./policy-gates";
import { calculatePrice } from "./pricing";
import { getDesignByReference, markDesignPublished } from "./repository";
import { runVisualQa, type QaResult } from "./visual-qa";

export type StageOutcome =
  | { ok: true; evidence?: Record<string, unknown>; shopifyProductId?: string }
  | {
      ok: false;
      reason: string;
      disposition: "repair" | "retry" | "escalate";
      suggestedState: JobState;
      evidence?: Record<string, unknown>;
    };

export type RunnableJob = {
  id: string;
  jobKey: string;
  state: string;
  attempts: number;
  designReference: string | null;
  shopifyProductId: string | null;
  evidence: Record<string, unknown> | null;
};

/** Accumulated pipeline facts, carried on the job row between stages. */
type Ctx = Record<string, unknown>;

function fail(
  reason: string,
  disposition: "repair" | "retry" | "escalate",
  suggestedState: JobState,
  evidence?: Record<string, unknown>
): StageOutcome {
  return { ok: false, reason, disposition, suggestedState, evidence };
}

/**
 * Loads the design a job operates on. Every product stage needs it, so a
 * missing design is a hard escalation rather than a retry — retrying will not
 * make it appear.
 */
type LoadedDesign =
  | { ok: false; outcome: StageOutcome }
  | { ok: true; design: ResolvedDesign };

async function loadDesign(job: RunnableJob): Promise<LoadedDesign> {
  if (!job.designReference) {
    return { ok: false, outcome: fail("Job has no design reference.", "escalate", "MANUAL_REVIEW") };
  }
  const record = await getDesignByReference(job.designReference);
  if (!record) {
    return {
      ok: false,
      outcome: fail(
        `No saved design for reference ${job.designReference}.`,
        "escalate",
        "MANUAL_REVIEW"
      ),
    };
  }
  const resolved = resolveDesign(record.config as DesignConfig);
  if (!resolved.ok) {
    return {
      ok: false,
      outcome: fail(
        `Design could not be resolved: ${resolved.error}`,
        "repair",
        "ARTWORK_REPAIR_REQUIRED"
      ),
    };
  }
  return { ok: true, design: resolved.value };
}

// ---------------------------------------------------------------------------
// Stage handlers
// ---------------------------------------------------------------------------

const HANDLERS: Partial<Record<ProgressState, (job: RunnableJob, ctx: Ctx, policy: PolicyConfig) => Promise<StageOutcome>>> = {
  RECEIVED: async () => ({ ok: true, evidence: { received: true } }),

  ARTWORK_VALIDATING: async (job) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;
    const art = loaded.design.config.artwork;

    if (!/^https:\/\//.test(art.url)) {
      return fail(
        "Artwork is not on a public https URL. Ephemeral local storage cannot be fetched by the supplier at production time.",
        "repair",
        "ARTWORK_REPAIR_REQUIRED",
        { artwork: { url: art.url } }
      );
    }
    return {
      ok: true,
      evidence: {
        artwork: {
          persistedUrl: art.url,
          ephemeral: false,
          width: art.width,
          height: art.height,
          assetId: art.assetId,
        },
      },
    };
  },

  // Analysis and product selection happen at upload/configure time in the
  // studio; by the time a job exists the design already names a product. The
  // stages stay in the machine so an autonomous trigger can fill them later
  // without renumbering the pipeline.
  ANALYZING: async (job) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;
    return { ok: true, evidence: { analysisSource: "upload-time" } };
  },

  PRODUCT_SELECTING: async (job) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;
    return { ok: true, evidence: { productId: loaded.design.product.id } };
  },

  SUPPLIER_MAPPING: async (job) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;

    const map = await getProviderVariantMap(loaded.design.product);
    const variantIds = Object.values(map.map);

    if (map.mode !== "live" || variantIds.length === 0) {
      return fail(
        map.warning ?? "No live supplier variant mapping is available.",
        "retry",
        "SUPPLIER_BLOCKED",
        { supplier: { mode: map.mode, warning: map.warning } }
      );
    }

    return {
      ok: true,
      evidence: {
        supplier: {
          catalogProductId: loaded.design.product.provider.printful?.catalogProductId ?? null,
          variantIds,
          variantIdsByColorSize: map.map,
          // Deliberately NOT set here. A variant map is not a fulfillment path;
          // only a verified supplier sync product may set this true.
          fulfillmentVerified: false,
        },
      },
    };
  },

  MOCKUP_GENERATING: async (job, ctx) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;

    const supplier = (ctx.supplier ?? {}) as { variantIds?: string[] };
    const mockup: MockupOutcome = await generateMockup({
      design: loaded.design,
      artworkUrl: loaded.design.config.artwork.url,
      variantExternalIds: supplier.variantIds ?? [],
    });

    if (mockup.status !== "generated" || !mockup.heroUrl) {
      return fail(
        mockup.message ?? "No mockup was produced.",
        // A failed render is usually transient; unavailable means something
        // upstream must be fixed first.
        mockup.status === "failed" ? "retry" : "repair",
        "MOCKUP_REPAIR_REQUIRED",
        { mockup }
      );
    }

    return {
      ok: true,
      evidence: {
        mockup: {
          status: mockup.status,
          heroUrl: mockup.heroUrl,
          alternateUrls: mockup.alternateUrls,
          provenance: "provider_mockup",
          effectiveDpi: mockup.effectiveDpi,
        },
        artworkDpi: mockup.effectiveDpi,
      },
    };
  },

  QA_RUNNING: async (job, ctx) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;

    const mockup = (ctx.mockup ?? {}) as { heroUrl?: string };
    if (!mockup.heroUrl) {
      return fail("No mockup to inspect.", "repair", "MOCKUP_REPAIR_REQUIRED");
    }

    const qa: QaResult = await runVisualQa({
      imageUrl: mockup.heroUrl,
      provenance: "provider_mockup",
      expected: {
        garmentType: loaded.design.product.name,
        garmentColor: loaded.design.color.label,
      },
    });

    if (qa.verdict === "REJECTED") {
      return fail(
        `Visual QA rejected the mockup: ${qa.findings.map((f) => f.code).join(", ")}`,
        "repair",
        "QA_REJECTED",
        { qa }
      );
    }

    // PENDING is recorded and carried forward. It does NOT stop the job here —
    // the draft is still worth creating — but the gates will refuse to mark the
    // product ready, so an unavailable inspector can never promote anything.
    return {
      ok: true,
      evidence: {
        qa: {
          verdict: qa.verdict,
          deterministic: qa.findings.some((f) => f.severity === "blocker") ? "REJECTED" : "PASS",
          vision: qa.aiStatus === "ok" ? "PASS" : qa.aiStatus === "failed" ? "PENDING" : "not_configured",
          findings: qa.findings,
        },
      },
    };
  },

  LISTING_GENERATING: async (job) => {
    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;

    const pricing = calculatePrice({
      product: loaded.design.product,
      sizeId: loaded.design.config.sizeId,
      printAreaIds: loaded.design.printAreas.map((a) => a.id),
      quantity: 1,
    });

    return {
      ok: true,
      evidence: {
        pricing: {
          unitCost: pricing.unitCost,
          unitPrice: pricing.unitPrice,
          marginPct: pricing.marginPct,
        },
      },
    };
  },

  SHOPIFY_DRAFT_CREATING: async (job, ctx) => {
    const missing = adminConfigMissing();
    if (missing.length) {
      return fail(
        `Shopify Admin API is not configured: ${missing.join(", ")}`,
        "escalate",
        "MANUAL_REVIEW",
        { missingEnv: missing }
      );
    }

    const loaded = await loadDesign(job);
    if (!loaded.ok) return loaded.outcome;
    const reference = job.designReference!;

    // Idempotency that survives cold starts and redeploys.
    const existing = await findExistingDraftByReference(reference).catch(() => null);
    if (existing) {
      return { ok: true, shopifyProductId: existing, evidence: { deduplicated: true } };
    }

    const supplier = (ctx.supplier ?? {}) as Record<string, unknown>;
    const mockup = (ctx.mockup ?? {}) as { heroUrl?: string };
    const qa = (ctx.qa ?? {}) as { verdict?: string };

    const pricing = calculatePrice({
      product: loaded.design.product,
      sizeId: loaded.design.config.sizeId,
      printAreaIds: loaded.design.printAreas.map((a) => a.id),
      quantity: 1,
    });

    try {
      const published = await publishDraftProduct({
        design: loaded.design,
        pricing,
        reference,
        provider: "printful",
        providerRefs: supplier,
        // Never attach an image QA rejected, and never fall back to the print file.
        imageUrl: qa.verdict === "REJECTED" ? undefined : mockup.heroUrl,
      });

      await markDesignPublished({
        reference,
        shopifyProductId: published.productId,
        shopifyVariantIds: published.variantIds,
        shopifyAdminUrl: published.adminUrl,
      });

      return {
        ok: true,
        shopifyProductId: published.productId,
        evidence: { shopify: published },
      };
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Shopify draft creation failed.",
        "retry",
        "PUBLISH_FAILED"
      );
    }
  },

  VERIFYING: async (job, ctx, policy) => {
    if (!job.shopifyProductId) {
      return fail("No Shopify product id to verify.", "retry", "PUBLISH_FAILED");
    }

    const verification = await verifyDraftProduct(job.shopifyProductId);
    if (!verification.verified) {
      return fail(
        `Shopify read-back failed: ${verification.failures.join("; ")}`,
        "retry",
        "PUBLISH_FAILED",
        { verification }
      );
    }

    // Final gate evaluation against everything the pipeline actually observed.
    const gateInput: GateInput = {
      artwork: ctx.artwork as GateInput["artwork"],
      mockup: ctx.mockup as GateInput["mockup"],
      qa: ctx.qa as GateInput["qa"],
      supplier: {
        ...(ctx.supplier as GateInput["supplier"]),
        shopifyVariantCount: verification.snapshot.variantCount,
      },
      commerce: {
        title: verification.snapshot.title,
        description: verification.snapshot.hasDescription ? "present" : "",
        mediaCount: verification.snapshot.mediaCount,
        optionCount: verification.snapshot.optionNames.length,
        variantCount: verification.snapshot.variantCount,
        prices: verification.snapshot.prices.map(Number),
        marginPct: (ctx.pricing as { marginPct?: number } | undefined)?.marginPct,
        readBackVerified: true,
      },
    };

    const report = evaluateGates(gateInput, policy);
    if (!report.passed) {
      const worst =
        report.failures.find((f) => f.disposition === "escalate") ?? report.failures[0]!;
      return fail(
        `Gates not satisfied: ${report.failures.map((f) => f.code).join(", ")}`,
        worst.disposition,
        report.suggestedState,
        { verification, gates: report }
      );
    }

    return { ok: true, evidence: { verification, gates: report } };
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Executes one stage of one job. Returns what happened, for logging. */
export async function runJobStage(
  job: RunnableJob,
  policy: PolicyConfig = DEFAULT_POLICY
): Promise<{ jobKey: string; state: string; outcome: StageOutcome }> {
  const state = job.state as ProgressState;
  const handler = HANDLERS[state];

  if (!handler) {
    return {
      jobKey: job.jobKey,
      state,
      outcome: fail(`No handler for state ${state}.`, "escalate", "MANUAL_REVIEW"),
    };
  }

  const ctx: Ctx = { ...(job.evidence ?? {}) };
  let outcome: StageOutcome;
  try {
    outcome = await handler(job, ctx, policy);
  } catch (err) {
    outcome = fail(
      err instanceof Error ? err.message : "Unhandled stage error.",
      "retry",
      "MANUAL_REVIEW"
    );
  }

  const evidence = { ...ctx, ...(outcome.evidence ?? {}) };

  if (outcome.ok) {
    await completeStage({
      jobId: job.id,
      from: state,
      evidence,
      shopifyProductId: outcome.shopifyProductId,
    });
  } else {
    await failStage({
      jobId: job.id,
      currentState: state,
      disposition: outcome.disposition,
      suggestedState: outcome.suggestedState,
      attempts: job.attempts,
      reason: outcome.reason,
      evidence,
    });
  }

  return { jobKey: job.jobKey, state, outcome };
}

/**
 * Claims and runs up to `max` stages. Designed to be called by a cron or a
 * webhook: it does a bounded amount of work and returns, rather than looping
 * forever inside a request.
 */
export async function runWorker(options: { workerId: string; max?: number; policy?: PolicyConfig } = { workerId: "worker" }) {
  const max = options.max ?? 10;
  const results: { jobKey: string; state: string; ok: boolean; reason?: string }[] = [];

  for (let i = 0; i < max; i++) {
    const claim = await claimNextJob(options.workerId);
    if (!claim.available) {
      return { autonomyAvailable: false as const, reason: claim.reason, results };
    }
    if (!claim.value) break;

    const { jobKey, state, outcome } = await runJobStage(
      claim.value as unknown as RunnableJob,
      options.policy ?? DEFAULT_POLICY
    );
    results.push({
      jobKey,
      state,
      ok: outcome.ok,
      reason: outcome.ok ? undefined : outcome.reason,
    });
  }

  return { autonomyAvailable: true as const, processed: results.length, results };
}
