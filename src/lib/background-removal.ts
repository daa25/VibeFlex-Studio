// Background removal via remove.bg — SERVER ONLY.
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

const REMOVEBG_ENDPOINT = "https://api.remove.bg/v1.0/removebg";

/** imageUrl must be a public https URL — remove.bg fetches it server-side. */
export async function removeBackgroundFromUrl(imageUrl: string): Promise<BackgroundRemovalResult> {
  const apiKey = env.removeBgApiKey();
  if (!apiKey) {
    return { ok: false, reason: "REMOVEBG_API_KEY is not set — background removal is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const form = new FormData();
    form.append("image_url", imageUrl);
    form.append("size", "auto");
    form.append("format", "png");

    const res = await fetch(REMOVEBG_ENDPOINT, {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = `remove.bg returned ${res.status}.`;
      try {
        const parsed = JSON.parse(body) as { errors?: { title?: string }[] };
        const title = parsed.errors?.[0]?.title;
        if (title) message = `remove.bg: ${title}`;
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
