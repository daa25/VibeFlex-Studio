// Persistence layer.
//
// Every function here is *optional-database aware*: with DATABASE_URL set the
// studio persists artwork, designs and orders; without it the workflow still
// completes and the response reports `persisted: false` with the reason. That
// keeps the app demonstrable before Supabase exists, without silently
// pretending data was saved.

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { studioArtworks, studioDesigns, studioOrders } from "@/db/schema/studio";
import type { AiAnalysis, DeterministicAnalysis } from "./artwork-analysis";
import type { DesignConfig } from "./design";
import { env } from "./env";
import type { DetectedImage } from "./image";
import type { PriceBreakdown } from "./pricing";
import type { StoredAsset } from "./storage";

export type PersistenceResult = { persisted: boolean; reason?: string; id?: string };

function dbAvailable(): boolean {
  return Boolean(env.databaseUrl());
}

function failure(err: unknown): PersistenceResult {
  return {
    persisted: false,
    reason: err instanceof Error ? err.message : "Unknown database error",
  };
}

const NO_DB: PersistenceResult = {
  persisted: false,
  reason: "DATABASE_URL is not set — nothing was written to the database.",
};

/** VF-XXXXXX reference, quotable by a customer and stored on the Shopify order. */
export function newDesignReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = randomBytes(6);
  let out = "";
  for (const byte of raw) out += alphabet[byte % alphabet.length];
  return `VF-${out}`;
}

export async function saveArtworkRecord(params: {
  asset: StoredAsset;
  image: DetectedImage;
  deterministic: DeterministicAnalysis;
  ai: AiAnalysis | null;
  fileName?: string;
}): Promise<PersistenceResult> {
  if (!dbAvailable()) return NO_DB;
  try {
    const [row] = await db
      .insert(studioArtworks)
      .values({
        assetId: params.asset.assetId,
        storageProvider: params.asset.storageProvider,
        storagePath: params.asset.storagePath,
        url: params.asset.url,
        fileName: params.fileName ?? null,
        mimeType: params.image.mimeType,
        width: params.image.width,
        height: params.image.height,
        bytes: params.asset.bytes,
        checksum: params.asset.checksum,
        hasTransparency: params.image.hasAlpha,
        ephemeral: params.asset.ephemeral,
        analysis: params.deterministic as unknown as Record<string, unknown>,
        aiAnalysis: (params.ai as unknown as Record<string, unknown>) ?? null,
        aiStatus: params.ai ? "ok" : "unavailable",
      })
      .returning({ id: studioArtworks.id });
    return { persisted: true, id: row?.id };
  } catch (err) {
    return failure(err);
  }
}

export async function saveDesign(params: {
  reference: string;
  config: DesignConfig;
  pricing: PriceBreakdown;
  printGeometry: Record<string, unknown>[];
  provider: string;
  providerRefs: Record<string, unknown>;
}): Promise<PersistenceResult> {
  if (!dbAvailable()) return NO_DB;
  try {
    const [row] = await db
      .insert(studioDesigns)
      .values({
        reference: params.reference,
        artworkAssetId: params.config.artwork.assetId,
        productId: params.config.productId,
        colorId: params.config.colorId,
        sizeId: params.config.sizeId,
        quantity: params.config.quantity,
        config: params.config as unknown as Record<string, unknown>,
        printGeometry: params.printGeometry,
        unitCost: String(params.pricing.unitCost),
        unitPrice: String(params.pricing.unitPrice),
        marginPct: String(params.pricing.marginPct),
        pricing: params.pricing as unknown as Record<string, unknown>,
        provider: params.provider,
        providerRefs: params.providerRefs,
      })
      .returning({ id: studioDesigns.id });
    return { persisted: true, id: row?.id };
  } catch (err) {
    return failure(err);
  }
}

export async function markDesignPublished(params: {
  reference: string;
  shopifyProductId: string;
  shopifyVariantIds: string[];
  shopifyAdminUrl: string;
}): Promise<PersistenceResult> {
  if (!dbAvailable()) return NO_DB;
  try {
    await db
      .update(studioDesigns)
      .set({
        status: "SHOPIFY_DRAFT",
        shopifyProductId: params.shopifyProductId,
        shopifyVariantIds: params.shopifyVariantIds,
        shopifyAdminUrl: params.shopifyAdminUrl,
        updatedAt: new Date(),
      })
      .where(eq(studioDesigns.reference, params.reference));
    return { persisted: true };
  } catch (err) {
    return failure(err);
  }
}

export async function setDesignCheckoutUrl(
  reference: string,
  checkoutUrl: string
): Promise<PersistenceResult> {
  if (!dbAvailable()) return NO_DB;
  try {
    await db
      .update(studioDesigns)
      .set({ checkoutUrl, status: "IN_CART", updatedAt: new Date() })
      .where(eq(studioDesigns.reference, reference));
    return { persisted: true };
  } catch (err) {
    return failure(err);
  }
}

export async function getDesignByReference(reference: string) {
  if (!dbAvailable()) return null;
  try {
    const rows = await db
      .select()
      .from(studioDesigns)
      .where(eq(studioDesigns.reference, reference))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function recordOrderLine(params: {
  shopifyOrderId: string;
  shopifyLineItemId: string;
  designReference?: string;
  artworkUrl?: string;
  provider?: string;
  payload: Record<string, unknown>;
}): Promise<PersistenceResult> {
  if (!dbAvailable()) return NO_DB;
  try {
    const [row] = await db
      .insert(studioOrders)
      .values({
        shopifyOrderId: params.shopifyOrderId,
        shopifyLineItemId: params.shopifyLineItemId,
        designReference: params.designReference ?? null,
        artworkUrl: params.artworkUrl ?? null,
        provider: params.provider ?? null,
        payload: params.payload,
      })
      .returning({ id: studioOrders.id });
    return { persisted: true, id: row?.id };
  } catch (err) {
    return failure(err);
  }
}
