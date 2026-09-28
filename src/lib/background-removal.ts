// Background removal via Poof (api.poof.bg) — SERVER ONLY.
//
// Not remove.bg: remove.bg's standalone API shuts down December 1, 2026 and
// its official successor is a separate company (Leonardo.Ai), not this one.
// Poof is a distinct, independently-run provider with its own account/key
// (get one at https://dash.poof.bg) — verified against its own published
// OpenAPI spec (github.com/poof-bg/docs), not assumed compatible by name.
//
// Same never-block philosophy as artwork-analysis.ts / product-copy.ts: an
// unconfigured key, a rate limit, or any API failure returns a typed failure
// rather than throwing, so a broken/unconfigured integration degrades to "the
// user keeps their original artwork" instead of crashing the upload flow.
//
// Deliberately NOT automatic on every upload — plenty of real artwork already
// has a background on purpose. This is called only when the user (or, in the
// auto-create pipeline, the deterministic analysis) decides a transparent
// background is actually wanted.

import { env } from "./env";

export type BackgroundRemovalResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: string };

const POOF_ENDPOINT = "https://api.poof.bg/v1/remove";

/** imageUrl must be a public https URL — Poof fetches it server-side. */
export async function removeBackgroundFromUrl(imageUrl: string): Promise<BackgroundRemovalResult> {
  const apiKey = env.poofApiKey();
  if (!apiKey) {
    return { ok: false, reason: "POOF_API_KEY is not set — background removal is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const form = new FormData();
    form.append("image_url", imageUrl);
    form.append("format", "png");
    form.append("size", "full");

    const res = await fetch(POOF_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = `Poof returned ${res.status}.`;
      try {
        const parsed = JSON.parse(body) as { message?: string; error?: string };
        const detail = parsed.message ?? parsed.error;
        if (detail) message = `Poof: ${detail}`;
      } catch {
        /* body wasn't JSON — fall back to the generic status message */
      }
      return { ok: false, reason: message };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: true, bytes };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "Background removal timed out." : err instanceof Error ? err.message : "Unknown background-removal error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
