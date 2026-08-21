// Artwork storage.
//
// Production: Supabase Storage (service-role key, server-side only).
// Fallback: local disk under .uploads/, so the studio is fully testable
// without credentials. The fallback is EPHEMERAL and is reported as such by
// /api/health — artwork that must reach a printer has to live in Supabase.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

export type StoredAsset = {
  assetId: string;
  url: string;
  storagePath: string;
  storageProvider: "supabase" | "local";
  checksum: string;
  bytes: number;
  /** True when the URL will not survive a redeploy — blocks production fulfillment. */
  ephemeral: boolean;
};

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".uploads");

/** Filenames are never taken from user input; we only keep a sanitized suffix. */
export function safeObjectName(originalName: string, extension: string): string {
  const stem = path
    .basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const now = new Date();
  const datePrefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${datePrefix}/${randomUUID()}${stem ? `-${stem}` : ""}.${extension}`;
}

export function storageIsPersistent(): boolean {
  return Boolean(env.supabaseUrl() && env.supabaseServiceRoleKey());
}

export async function storeArtwork(params: {
  bytes: Buffer;
  originalName: string;
  extension: string;
  mimeType: string;
}): Promise<StoredAsset> {
  const objectName = safeObjectName(params.originalName, params.extension);
  const checksum = createHash("sha256").update(params.bytes).digest("hex");
  const assetId = randomUUID();

  if (storageIsPersistent()) {
    const url = await uploadToSupabase(objectName, params.bytes, params.mimeType);
    return {
      assetId,
      url,
      storagePath: objectName,
      storageProvider: "supabase",
      checksum,
      bytes: params.bytes.byteLength,
      ephemeral: false,
    };
  }

  const target = path.join(LOCAL_UPLOAD_DIR, objectName);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, params.bytes);

  return {
    assetId,
    url: `/api/uploads/${objectName}`,
    storagePath: objectName,
    storageProvider: "local",
    checksum,
    bytes: params.bytes.byteLength,
    ephemeral: true,
  };
}

async function uploadToSupabase(
  objectName: string,
  bytes: Buffer,
  mimeType: string
): Promise<string> {
  const baseUrl = env.supabaseUrl()!.replace(/\/$/, "");
  const bucket = env.supabaseBucket();
  const serviceKey = env.supabaseServiceRoleKey()!;

  const res = await fetch(
    `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectName}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": mimeType,
        "x-upsert": "false",
        "cache-control": "31536000",
      },
      body: new Uint8Array(bytes),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Supabase Storage upload failed (${res.status}). Check that the "${bucket}" bucket exists and the service-role key is valid. ${detail.slice(0, 300)}`
    );
  }

  return `${baseUrl}/storage/v1/object/public/${bucket}/${objectName}`;
}
