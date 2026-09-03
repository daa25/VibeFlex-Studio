// Mockup generation.
//
// Turns a resolved design into a real supplier-rendered garment image. This is
// the stage that produces the customer-facing product photo. The uploaded
// artwork is the PRINT FILE and must never be used in its place.
//
// Placement geometry comes from Printful's own printfile spec for the product,
// not from a guess, so the art lands where the print area actually is.

import { getPrintfulAdapter } from "@/integrations/pod/catalog-service";
import type { PrintPosition } from "@/integrations/pod/types";
import type { ResolvedDesign } from "./design";

export type MockupOutcome = {
  status: "generated" | "unavailable" | "failed";
  /** Customer-facing hero image. Undefined unless status is "generated". */
  heroUrl?: string;
  alternateUrls: string[];
  taskKey?: string;
  printArea?: { width: number; height: number; dpi: number };
  position?: PrintPosition;
  /** Effective DPI of the artwork once scaled into the print area. */
  effectiveDpi?: number;
  message?: string;
};

const MIN_PRINT_DPI = 150;

/**
 * Fits artwork inside a print area preserving aspect ratio.
 * `mode: "area"` centres it (correct for wide strips like a beanie cuff).
 * `mode: "chest"` biases it toward the upper chest (correct for tees/hoodies).
 */
export function fitArtwork(
  artwork: { width: number; height: number },
  area: { width: number; height: number },
  mode: "area" | "chest" = "chest"
): PrintPosition {
  const usableHeight = mode === "chest" ? area.height * 0.75 : area.height;
  const scale = Math.min(area.width / artwork.width, usableHeight / artwork.height);
  const width = Math.round(artwork.width * scale);
  const height = Math.round(artwork.height * scale);
  const left = Math.round((area.width - width) / 2);
  const top = mode === "chest" ? Math.round(area.height * 0.08) : Math.round((area.height - height) / 2);

  return { area_width: area.width, area_height: area.height, width, height, top, left };
}

export function effectiveDpi(
  artworkWidth: number,
  renderedWidth: number,
  areaDpi: number
): number {
  if (renderedWidth <= 0) return 0;
  return Math.round((artworkWidth * areaDpi) / renderedWidth);
}

export async function generateMockup(params: {
  design: ResolvedDesign;
  /** Publicly reachable print file. Printful must be able to fetch it. */
  artworkUrl: string;
  variantExternalIds: string[];
  placement?: string;
}): Promise<MockupOutcome> {
  const adapter = getPrintfulAdapter();
  if (!adapter) {
    return {
      status: "unavailable",
      alternateUrls: [],
      message:
        "Printful is not configured (PRINTFUL_API_KEY / PRINTFUL_STORE_ID), so no mockup could be rendered.",
    };
  }

  const catalogProductId = params.design.product.provider.printful?.catalogProductId;
  if (!catalogProductId) {
    return {
      status: "unavailable",
      alternateUrls: [],
      message: `Studio product "${params.design.product.id}" has no Printful catalog product id mapped.`,
    };
  }

  if (!/^https:\/\//.test(params.artworkUrl)) {
    return {
      status: "unavailable",
      alternateUrls: [],
      message:
        "Artwork is not on a public https URL, so Printful cannot fetch it. Configure Supabase Storage — ephemeral local uploads cannot be rendered.",
    };
  }

  if (params.variantExternalIds.length === 0) {
    return {
      status: "unavailable",
      alternateUrls: [],
      message: "No Printful variant ids were mapped for this product, so there is nothing to render.",
    };
  }

  try {
    const printfiles = await adapter.getPrintfiles(catalogProductId);
    const placement =
      params.placement ??
      Object.keys(printfiles.availablePlacements)[0] ??
      "front";

    const printfileId = printfiles.placementToPrintfile[placement];
    const spec =
      printfiles.printfiles.find((p) => p.printfile_id === printfileId) ?? printfiles.printfiles[0];

    if (!spec) {
      return {
        status: "unavailable",
        alternateUrls: [],
        message: `Printful returned no printfile spec for catalog product ${catalogProductId}.`,
      };
    }

    const artwork = params.design.config.artwork;
    // A wide, short print area (embroidery strips, cuffs) should centre; a tall
    // apparel panel should sit at chest height.
    const mode = spec.width / spec.height > 1.6 ? "area" : "chest";
    const position = fitArtwork(
      { width: artwork.width, height: artwork.height },
      { width: spec.width, height: spec.height },
      mode
    );
    const dpi = effectiveDpi(artwork.width, position.width, spec.dpi);

    if (dpi < MIN_PRINT_DPI) {
      return {
        status: "unavailable",
        alternateUrls: [],
        printArea: { width: spec.width, height: spec.height, dpi: spec.dpi },
        position,
        effectiveDpi: dpi,
        message: `Artwork resolves to ${dpi} DPI in this print area, below the ${MIN_PRINT_DPI} DPI floor. Upload artwork at least ${Math.ceil((position.width * MIN_PRINT_DPI) / spec.dpi)}px wide.`,
      };
    }

    const job = await adapter.createMockupJob({
      catalogProductExternalId: catalogProductId,
      variantExternalIds: params.variantExternalIds,
      printAreaId: placement,
      artworkFileUrl: params.artworkUrl,
      position,
    });

    const finished = await adapter.waitForMockups(job.providerJobId);

    if (finished.status !== "completed" || !finished.mockupUrls?.length) {
      return {
        status: "failed",
        alternateUrls: [],
        taskKey: job.providerJobId,
        printArea: { width: spec.width, height: spec.height, dpi: spec.dpi },
        position,
        effectiveDpi: dpi,
        message:
          finished.errorMessage ??
          `Mockup task ended as "${finished.status}" without returning images.`,
      };
    }

    const [hero, ...rest] = finished.mockupUrls;
    return {
      status: "generated",
      heroUrl: hero,
      alternateUrls: rest,
      taskKey: job.providerJobId,
      printArea: { width: spec.width, height: spec.height, dpi: spec.dpi },
      position,
      effectiveDpi: dpi,
    };
  } catch (err) {
    return {
      status: "failed",
      alternateUrls: [],
      message: err instanceof Error ? err.message : "Unknown mockup error.",
    };
  }
}
