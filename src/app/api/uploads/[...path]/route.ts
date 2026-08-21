import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { LOCAL_UPLOAD_DIR, storageIsPersistent } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * GET /api/uploads/<path> — serves artwork from the local storage fallback.
 *
 * Only used when Supabase Storage is not configured. Paths are resolved and
 * then re-checked against the upload root so `..` traversal cannot escape it,
 * and only known image extensions are served.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (storageIsPersistent()) {
    return NextResponse.json(
      { error: "Local upload serving is disabled because Supabase Storage is configured." },
      { status: 404 }
    );
  }

  const { path: segments } = await ctx.params;
  const target = path.resolve(LOCAL_UPLOAD_DIR, segments.join("/"));
  const root = path.resolve(LOCAL_UPLOAD_DIR);

  if (target !== root && !target.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = CONTENT_TYPES[path.extname(target).toLowerCase()];
  if (!contentType) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const info = await stat(target);
    if (!info.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const stream = createReadStream(target) as unknown as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
