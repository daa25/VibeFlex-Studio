// Shared server-side pipeline for a submitted design.
//
// Both the "save design" and "publish to Shopify" routes run through here so
// pricing, geometry and validation can never diverge between them. Prices are
// always recomputed from the catalog server-side; a client-supplied price is
// ignored entirely.

import {
  designConfigSchema,
  designWarnings,
  hasBlockingError,
  resolveDesign,
  toPrintGeometry,
  type DesignWarning,
  type ResolvedDesign,
} from "./design";
import { env } from "./env";
import { calculatePrice, type PriceBreakdown } from "./pricing";

export type PreparedDesign = {
  design: ResolvedDesign;
  pricing: PriceBreakdown;
  geometry: ReturnType<typeof toPrintGeometry>[];
  warnings: DesignWarning[];
  provider: string;
};

export type PrepareFailure = { status: number; error: string; warnings?: DesignWarning[] };

export function prepareDesign(
  body: unknown,
  options: { allowBlocking?: boolean } = {}
): { ok: true; value: PreparedDesign } | { ok: false; failure: PrepareFailure } {
  const parsed = designConfigSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      failure: {
        status: 400,
        error: `Invalid design configuration: ${issue?.path.join(".") ?? "body"} — ${issue?.message ?? "unknown"}`,
      },
    };
  }

  const resolved = resolveDesign(parsed.data);
  if (!resolved.ok) return { ok: false, failure: { status: 422, error: resolved.error } };

  const warnings = designWarnings(resolved.value);
  if (!options.allowBlocking && hasBlockingError(warnings)) {
    return {
      ok: false,
      failure: {
        status: 422,
        error: "This configuration cannot be produced as-is.",
        warnings,
      },
    };
  }

  let pricing: PriceBreakdown;
  try {
    pricing = calculatePrice({
      product: resolved.value.product,
      sizeId: resolved.value.config.sizeId,
      printAreaIds: resolved.value.config.placements.map((p) => p.printAreaId),
      quantity: resolved.value.config.quantity,
    });
  } catch (err) {
    return {
      ok: false,
      failure: { status: 422, error: err instanceof Error ? err.message : "Pricing failed" },
    };
  }

  const geometry = resolved.value.printAreas.map((area, i) =>
    toPrintGeometry(resolved.value.config.placements[i]!, area, resolved.value.config.artwork)
  );

  return {
    ok: true,
    value: { design: resolved.value, pricing, geometry, warnings, provider: env.podProvider() },
  };
}

// ---------------------------------------------------------------------------
// Idempotency
//
// The publish and cart routes are not safe to run twice: a double-click would
// create two Shopify drafts. Clients send an Idempotency-Key; the first result
// for that key is replayed for 10 minutes.
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; status: number; body: unknown };
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const inFlight = new Map<string, Promise<CacheEntry>>();
const completed = new Map<string, CacheEntry>();

export async function withIdempotency(
  key: string | null,
  run: () => Promise<{ status: number; body: unknown }>
): Promise<{ status: number; body: unknown; replayed: boolean }> {
  if (!key) {
    const result = await run();
    return { ...result, replayed: false };
  }

  prune();

  const done = completed.get(key);
  if (done) return { status: done.status, body: done.body, replayed: true };

  const pending = inFlight.get(key);
  if (pending) {
    const result = await pending;
    return { status: result.status, body: result.body, replayed: true };
  }

  const promise = run()
    .then((result) => {
      const entry: CacheEntry = { at: Date.now(), ...result };
      completed.set(key, entry);
      return entry;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  const result = await promise;
  return { status: result.status, body: result.body, replayed: false };
}

function prune() {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, entry] of completed) if (entry.at < cutoff) completed.delete(key);
}
