import { NextRequest, NextResponse } from "next/server";
import { analyzeDeterministically, analyzeWithAi } from "@/lib/artwork-analysis";
import { inspectImage, MAX_UPLOAD_BYTES, validateArtworkDimensions } from "@/lib/image";
import { saveArtworkRecord } from "@/lib/repository";
import { storeArtwork } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/uploads — accepts one artwork file (multipart/form-data, field "file").
 *
 * Validation is server-side and based on magic bytes, not the client's
 * Content-Type or the filename. Storage returns a stable URL; analysis is
 * best-effort and never fails the upload.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart/form-data upload with a 'file' field." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was included in the upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 30MB.` },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const image = inspectImage(bytes);
  if ("error" in image) {
    return NextResponse.json({ error: image.error }, { status: 415 });
  }

  const dimensionError = validateArtworkDimensions(image);
  if (dimensionError) {
    return NextResponse.json({ error: dimensionError }, { status: 422 });
  }

  let stored;
  try {
    stored = await storeArtwork({
      bytes,
      originalName: file.name || "artwork",
      extension: image.extension,
      mimeType: image.mimeType,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Upload failed: ${err.message}`
            : "Upload failed for an unknown reason.",
      },
      { status: 502 }
    );
  }

  const deterministic = analyzeDeterministically(image);

  // Vision models need a publicly reachable URL; local-fallback uploads are not
  // reachable from OpenAI, so those are sent inline as a data URL instead.
  const analysisSource =
    stored.storageProvider === "supabase"
      ? stored.url
      : `data:${image.mimeType};base64,${bytes.toString("base64")}`;

  const { ai, status, message } = await analyzeWithAi(analysisSource, deterministic);

  const persistence = await saveArtworkRecord({
    asset: stored,
    image,
    deterministic,
    ai,
  });

  return NextResponse.json({
    artwork: {
      assetId: stored.assetId,
      url: stored.url,
      fileName: file.name || `artwork.${image.extension}`,
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
        ? "Stored on local disk because Supabase Storage is not configured. This URL will not survive a redeploy and cannot be sent to a printer."
        : undefined,
    },
    analysis: { deterministic, ai, aiStatus: status, aiMessage: message },
    persistence,
  });
}
