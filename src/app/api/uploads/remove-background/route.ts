// POST /api/uploads/remove-background — runs an already-uploaded artwork
// through remove.bg and stores the result as a NEW asset (the original is
// left untouched, so the user can compare or revert by re-uploading).
//
// Deliberately a separate, user-triggered action rather than automatic on
// every upload: plenty of real artwork already has a background on purpose,
// and the person who made the design should decide, not a heuristic.

import { NextRequest, NextResponse } from "next/server";
import { removeBackgroundFromUrl } from "@/lib/background-removal";
import { analyzeDeterministically } from "@/lib/artwork-analysis";
import { inspectImage } from "@/lib/image";
import { saveArtworkRecord } from "@/lib/repository";
import { storeArtwork } from "@/lib/storage";
import { resolvePublicUrl } from "@/lib/url";
import type { UploadResponse } from "@/app/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  artwork: { url: string; fileName: string };
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with an 'artwork' object." }, { status: 400 });
  }

  if (!body.artwork?.url) {
    return NextResponse.json({ error: "Missing artwork.url." }, { status: 400 });
  }

  const sourceUrl = resolvePublicUrl(body.artwork.url);
  if (!/^https:\/\//.test(sourceUrl)) {
    return NextResponse.json(
      { error: "Could not resolve a public https URL for this artwork — remove.bg needs one to fetch it from." },
      { status: 422 }
    );
  }

  const removed = await removeBackgroundFromUrl(sourceUrl);
  if (!removed.ok) {
    return NextResponse.json({ error: removed.reason }, { status: 502 });
  }

  const image = inspectImage(removed.bytes);
  if ("error" in image) {
    return NextResponse.json({ error: `remove.bg returned an unreadable image: ${image.error}` }, { status: 502 });
  }

  let stored;
  try {
    stored = await storeArtwork({
      bytes: removed.bytes,
      originalName: body.artwork.fileName.replace(/\.[a-z0-9]+$/i, "") + "-no-bg",
      extension: image.extension,
      mimeType: image.mimeType,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Storing the result failed: ${err.message}` : "Storing the result failed." },
      { status: 502 }
    );
  }

  const deterministic = analyzeDeterministically(image);
  const persistence = await saveArtworkRecord({ asset: stored, image, deterministic, ai: null });

  const response: Pick<UploadResponse, "artwork" | "storage" | "analysis" | "persistence"> = {
    artwork: {
      assetId: stored.assetId,
      url: stored.url,
      fileName: `${body.artwork.fileName.replace(/\.[a-z0-9]+$/i, "")}-no-bg.${image.extension}`,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
    },
    storage: {
      provider: stored.storageProvider,
      ephemeral: stored.ephemeral,
      bytes: stored.bytes,
      checksum: stored.checksum,
      warning: stored.ephemeral
        ? "Stored on local disk because Supabase Storage is not configured. This URL will not survive a redeploy."
        : undefined,
    },
    analysis: { deterministic, ai: null, aiStatus: "not_configured", aiMessage: "Skipped for background-removal results to avoid a redundant vision call." },
    persistence,
  };

  return NextResponse.json(response);
}
