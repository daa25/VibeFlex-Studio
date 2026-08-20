import { NextResponse } from "next/server";
import { serviceStatuses } from "@/lib/env";
import { storageIsPersistent } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — configuration report.
 *
 * Deliberately exposes only variable NAMES that are missing, never any value,
 * so it is safe to hit in production while diagnosing a deployment.
 */
export async function GET() {
  const services = serviceStatuses();
  return NextResponse.json(
    {
      status: "ok",
      time: new Date().toISOString(),
      studioUsable: true,
      artworkStorage: storageIsPersistent() ? "supabase" : "local-ephemeral",
      services,
      readyForProductionFulfillment:
        storageIsPersistent() &&
        services.filter((s) => s.key !== "shopify_webhook").every((s) => s.configured),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
