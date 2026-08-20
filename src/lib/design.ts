// Design configuration: the customer's customization, in a form that is
// meaningful to both the browser preview and a print file.
//
// Placement is stored in *normalized print-area space*: everything is a
// fraction of the printable area, never pixels. That makes it resolution
// independent, so the same numbers drive the on-screen preview and the
// inches-based geometry fulfillment needs.

import { z } from "zod";
import { getPrintArea, getProduct, type CatalogProduct, type PrintArea } from "./catalog";

export const placementSchema = z.object({
  printAreaId: z.string().min(1),
  /** Artwork centre, as a fraction of the print area (0.5,0.5 = dead centre). */
  centerX: z.number().min(-0.5).max(1.5),
  centerY: z.number().min(-0.5).max(1.5),
  /** Artwork width as a fraction of print-area width. */
  scale: z.number().min(0.05).max(1.5),
  rotation: z.number().min(-180).max(180).default(0),
});

export const designConfigSchema = z.object({
  productId: z.string().min(1),
  colorId: z.string().min(1),
  sizeId: z.string().min(1),
  quantity: z.number().int().min(1).max(500).default(1),
  artwork: z.object({
    assetId: z.string().min(1),
    // Absolute URL (Supabase Storage) or an app-relative path (local dev fallback).
    url: z
      .string()
      .min(1)
      .refine(
        (value) => /^https?:\/\//i.test(value) || value.startsWith("/"),
        "must be an absolute https URL or an app-relative path",
      ),
    fileName: z.string().min(1).max(200),
    mimeType: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  placements: z.array(placementSchema).min(1).max(4),
  notes: z.string().max(500).optional(),
});

export type Placement = z.infer<typeof placementSchema>;
export type DesignConfig = z.infer<typeof designConfigSchema>;

export type ResolvedDesign = {
  config: DesignConfig;
  product: CatalogProduct;
  color: CatalogProduct["colors"][number];
  size: CatalogProduct["sizes"][number];
  printAreas: PrintArea[];
};

/** Validates a config against the catalog. Returns an error string, never throws. */
export function resolveDesign(config: DesignConfig): { ok: true; value: ResolvedDesign } | { ok: false; error: string } {
  const product = getProduct(config.productId);
  if (!product) return { ok: false, error: `Unknown product "${config.productId}"` };

  const color = product.colors.find((c) => c.id === config.colorId);
  if (!color) return { ok: false, error: `Unknown color "${config.colorId}"` };

  const size = product.sizes.find((s) => s.id === config.sizeId);
  if (!size) return { ok: false, error: `Unknown size "${config.sizeId}"` };

  const printAreas: PrintArea[] = [];
  for (const placement of config.placements) {
    const area = getPrintArea(product, placement.printAreaId);
    if (!area) return { ok: false, error: `Unknown print area "${placement.printAreaId}"` };
    printAreas.push(area);
  }

  return { ok: true, value: { config, product, color, size, printAreas } };
}

export type PlacementGeometry = {
  centerX: number;
  centerY: number;
  scale: number;
  rotation: number;
};

export type PrintGeometry = {
  printAreaId: string;
  widthIn: number;
  heightIn: number;
  /** Top-left offset of the artwork inside the print area, in inches. */
  leftIn: number;
  topIn: number;
  rotation: number;
  /** Effective DPI of the artwork at this size — under 150 is a production risk. */
  effectiveDpi: number;
};

/** Converts normalized placement + artwork pixel size into print-ready inches. */
export function toPrintGeometry(
  placement: PlacementGeometry & { printAreaId?: string },
  area: PrintArea,
  artwork: { width: number; height: number }
): PrintGeometry {
  const aspect = artwork.height / artwork.width;
  const widthIn = placement.scale * area.widthIn;
  const heightIn = widthIn * aspect;

  return {
    printAreaId: area.id,
    widthIn: round3(widthIn),
    heightIn: round3(heightIn),
    leftIn: round3(placement.centerX * area.widthIn - widthIn / 2),
    topIn: round3(placement.centerY * area.heightIn - heightIn / 2),
    rotation: placement.rotation,
    effectiveDpi: Math.round(artwork.width / Math.max(widthIn, 0.01)),
  };
}

/**
 * Largest scale (as a fraction of print-area width) at which the artwork still
 * fits inside the print area in both dimensions.
 */
export function maxFitScale(area: PrintArea, artwork: { width: number; height: number }): number {
  const aspect = artwork.height / Math.max(artwork.width, 1);
  const heightLimited = area.heightIn / Math.max(area.widthIn * aspect, 0.01);
  return Math.max(0.15, Math.min(1, heightLimited));
}

/**
 * Keeps a placement printable: caps the scale to what fits and pulls the centre
 * back so no part of the artwork falls outside the print area. The studio UI
 * runs every interaction through this, so the server can never receive a
 * configuration the customer was allowed to build.
 */
export function clampPlacement<P extends PlacementGeometry>(
  placement: P,
  area: PrintArea,
  artwork: { width: number; height: number },
): P {
  const scale = Math.min(Math.max(placement.scale, 0.15), maxFitScale(area, artwork));
  const aspect = artwork.height / Math.max(artwork.width, 1);
  const halfW = (scale * area.widthIn) / 2 / area.widthIn;
  const halfH = (scale * area.widthIn * aspect) / 2 / area.heightIn;

  return {
    ...placement,
    scale: round3(scale),
    centerX: round3(clamp(placement.centerX, halfW, 1 - halfW)),
    centerY: round3(clamp(placement.centerY, halfH, 1 - halfH)),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return 0.5;
  return Math.min(Math.max(value, min), max);
}

export type DesignWarning = { level: "warning" | "error"; message: string };

/** Production warnings the customer should see before approving. */
export function designWarnings(design: ResolvedDesign): DesignWarning[] {
  const warnings: DesignWarning[] = [];
  const { config, color, printAreas } = design;

  printAreas.forEach((area, i) => {
    const placement = config.placements[i]!;
    const geo = toPrintGeometry(placement, area, config.artwork);

    if (geo.effectiveDpi < 150) {
      warnings.push({
        level: geo.effectiveDpi < 100 ? "error" : "warning",
        message: `On ${area.label.toLowerCase()} your artwork prints at ~${geo.effectiveDpi} DPI. Below 150 DPI it will look soft — scale it down or upload a larger file.`,
      });
    }
    if (geo.heightIn > area.heightIn + 0.01) {
      warnings.push({
        level: "error",
        message: `Your artwork is taller than the ${area.label.toLowerCase()} print area (${round3(geo.heightIn)}in vs ${area.heightIn}in). Scale it down.`,
      });
    }
    const overflows =
      geo.leftIn < -0.01 ||
      geo.topIn < -0.01 ||
      geo.leftIn + geo.widthIn > area.widthIn + 0.01 ||
      geo.topIn + geo.heightIn > area.heightIn + 0.01;
    if (overflows) {
      warnings.push({
        level: "error",
        message: `Part of your artwork sits outside the ${area.label.toLowerCase()} print area and would be cropped in production.`,
      });
    }
  });

  if (color.dark && config.artwork.mimeType === "image/jpeg") {
    warnings.push({
      level: "warning",
      message:
        "JPGs have no transparency, so this design will print with a visible rectangle on a dark garment. Upload a PNG with a transparent background for the cleanest result.",
    });
  }

  return warnings;
}

export function hasBlockingError(warnings: DesignWarning[]): boolean {
  return warnings.some((w) => w.level === "error");
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
