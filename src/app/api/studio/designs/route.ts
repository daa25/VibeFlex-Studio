import { NextRequest, NextResponse } from "next/server";
import { getProviderVariantMap } from "@/integrations/pod/catalog-service";
import { getDesignByReference, newDesignReference, saveDesign } from "@/lib/repository";
import { prepareDesign, withIdempotency } from "@/lib/studio-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/studio/designs — validates a configuration, prices it server-side,
 * computes print geometry, and persists it under a VF- reference.
 *
 * Send an `Idempotency-Key` header so a double submit returns the same design
 * instead of creating a second one.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const prepared = prepareDesign(body);
  if (!prepared.ok) {
    return NextResponse.json(
      { error: prepared.failure.error, warnings: prepared.failure.warnings ?? [] },
      { status: prepared.failure.status }
    );
  }

  const { design, pricing, geometry, warnings, provider } = prepared.value;

  const result = await withIdempotency(req.headers.get("Idempotency-Key"), async () => {
    const reference = newDesignReference();
    const variantMap = await getProviderVariantMap(design.product);

    const persistence = await saveDesign({
      reference,
      config: design.config,
      pricing,
      printGeometry: geometry as unknown as Record<string, unknown>[],
      provider,
      providerRefs: {
        mode: variantMap.mode,
        variantIdsByColorSize: variantMap.map,
        catalogProductId: design.product.provider.printful?.catalogProductId ?? null,
      },
    });

    return {
      status: 200,
      body: {
        reference,
        pricing,
        geometry,
        warnings,
        provider,
        providerCatalogMode: variantMap.mode,
        providerWarning: variantMap.warning,
        persistence,
      },
    };
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Idempotent-Replay": String(result.replayed) },
  });
}

/** GET /api/studio/designs?reference=VF-XXXXXX — reload a saved design. */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference");
  if (!reference) {
    return NextResponse.json({ error: "reference query parameter is required." }, { status: 400 });
  }

  const design = await getDesignByReference(reference);
  if (!design) {
    return NextResponse.json(
      {
        error:
          "No saved design found for that reference. Designs are only persisted when DATABASE_URL is configured.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ design });
}
