import { NextResponse } from "next/server";
import { getStudioCatalog } from "@/integrations/pod/catalog-service";

export const dynamic = "force-dynamic";

/** GET /api/catalog — normalized studio catalog (live Printful data when configured). */
export async function GET() {
  const catalog = await getStudioCatalog();
  return NextResponse.json(catalog, {
    headers: { "Cache-Control": "no-store" },
  });
}
