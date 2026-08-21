import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATALOG, getProduct } from "@/lib/catalog";
import { clampPlacement, designConfigSchema, designWarnings, hasBlockingError, maxFitScale, resolveDesign, toPrintGeometry } from "@/lib/design";
import { buildFulfillmentPlan, toPrintfulOrder } from "@/lib/fulfillment/order-mapper";
import { inspectImage, validateArtworkDimensions } from "@/lib/image";
import { calculatePrice, toCharmPrice } from "@/lib/pricing";
import { buildSku } from "@/integrations/shopify/publish-draft";
import { safeObjectName } from "@/lib/storage";
import { analyzeDeterministically } from "@/lib/artwork-analysis";

const tee = getProduct("vf-tee-classic")!;

const artwork = {
  assetId: "asset-1",
  url: "https://example.supabase.co/storage/v1/object/public/art/a.png",
  fileName: "built-different.png",
  mimeType: "image/png",
  width: 3000,
  height: 3600,
};

function config(overrides: Record<string, unknown> = {}) {
  return {
    productId: tee.id,
    colorId: "black",
    sizeId: "L",
    quantity: 1,
    artwork,
    placements: [{ printAreaId: "front", centerX: 0.5, centerY: 0.42, scale: 0.7, rotation: 0 }],
    ...overrides,
  };
}

describe("pricing", () => {
  it("prices a tee above cost with the target margin", () => {
    const price = calculatePrice({ product: tee, sizeId: "L", printAreaIds: ["front"], quantity: 1 });
    expect(price.unitCost).toBeCloseTo(13.75, 2);
    expect(price.unitPrice).toBeGreaterThan(price.unitCost);
    expect(price.marginPct).toBeGreaterThan(50);
    expect(price.unitPrice.toFixed(2).endsWith(".99")).toBe(true);
  });

  it("applies size upcharges and quantity", () => {
    const base = calculatePrice({ product: tee, sizeId: "L", printAreaIds: ["front"], quantity: 1 });
    const big = calculatePrice({ product: tee, sizeId: "3XL", printAreaIds: ["front"], quantity: 2 });
    expect(big.unitCost).toBeGreaterThan(base.unitCost);
    expect(big.subtotal).toBeCloseTo(big.unitPrice * 2, 2);
  });

  it("charges for extra print locations", () => {
    const one = calculatePrice({ product: tee, sizeId: "L", printAreaIds: ["front"], quantity: 1 });
    const two = calculatePrice({
      product: tee,
      sizeId: "L",
      printAreaIds: ["front", "back"],
      quantity: 1,
    });
    expect(two.unitCost).toBeGreaterThan(one.unitCost);
  });

  it("never prices below the cost floor", () => {
    expect(toCharmPrice(1, 20)).toBeGreaterThanOrEqual(20);
  });

  it("rejects unknown sizes", () => {
    expect(() =>
      calculatePrice({ product: tee, sizeId: "XXS", printAreaIds: ["front"], quantity: 1 })
    ).toThrow();
  });
});

describe("design resolution and geometry", () => {
  it("resolves a valid configuration", () => {
    const resolved = resolveDesign(config() as never);
    expect(resolved.ok).toBe(true);
  });

  it("rejects an unknown product", () => {
    const resolved = resolveDesign(config({ productId: "nope" }) as never);
    expect(resolved.ok).toBe(false);
  });

  it("converts placement into print inches and DPI", () => {
    const area = tee.printAreas[0]!;
    const geo = toPrintGeometry(
      { printAreaId: "front", centerX: 0.5, centerY: 0.5, scale: 0.5, rotation: 0 },
      area,
      artwork
    );
    expect(geo.widthIn).toBeCloseTo(6, 3);
    expect(geo.effectiveDpi).toBe(500);
    expect(geo.leftIn).toBeCloseTo(3, 3);
  });

  it("flags artwork that overflows the print area", () => {
    const resolved = resolveDesign(
      config({
        placements: [{ printAreaId: "front", centerX: 0.95, centerY: 0.5, scale: 1, rotation: 0 }],
      }) as never
    );
    if (!resolved.ok) throw new Error(resolved.error);
    expect(hasBlockingError(designWarnings(resolved.value))).toBe(true);
  });

  it("warns about low DPI", () => {
    const resolved = resolveDesign(
      config({ artwork: { ...artwork, width: 500, height: 600 } }) as never
    );
    if (!resolved.ok) throw new Error(resolved.error);
    const warnings = designWarnings(resolved.value);
    expect(warnings.some((w) => /DPI/.test(w.message))).toBe(true);
  });

  it("warns when a JPG is placed on a dark garment", () => {
    const resolved = resolveDesign(
      config({ artwork: { ...artwork, mimeType: "image/jpeg" } }) as never
    );
    if (!resolved.ok) throw new Error(resolved.error);
    expect(designWarnings(resolved.value).some((w) => /transparen/i.test(w.message))).toBe(true);
  });
});

describe("image inspection", () => {
  const png = (width: number, height: number, colorType = 6) => {
    const buf = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    buf.writeUInt8(8, 24);
    buf.writeUInt8(colorType, 25);
    return buf;
  };

  it("reads PNG dimensions and alpha from the header", () => {
    const result = inspectImage(png(2400, 3000));
    expect(result).toMatchObject({ format: "png", width: 2400, height: 3000, hasAlpha: true });
  });

  it("rejects an SVG disguised as an image", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(inspectImage(svg)).toHaveProperty("error");
  });

  it("rejects an empty file", () => {
    expect(inspectImage(Buffer.alloc(0))).toHaveProperty("error");
  });

  it("rejects artwork below the minimum resolution", () => {
    const small = inspectImage(png(120, 120));
    expect("error" in small).toBe(false);
    if ("error" in small) return;
    expect(validateArtworkDimensions(small)).toMatch(/Minimum/);
  });

  it("derives a print recommendation from the file", () => {
    const image = inspectImage(png(3000, 3600));
    if ("error" in image) throw new Error(image.error);
    const analysis = analyzeDeterministically(image);
    expect(analysis.orientation).toBe("portrait");
    expect(analysis.maxWidthIn150Dpi).toBe(20);
    expect(analysis.recommendedPrintWidthIn).toBeLessThanOrEqual(12);
    expect(analysis.lowResolution).toBe(false);
  });
});

describe("storage naming", () => {
  it("never trusts the uploaded filename", () => {
    const name = safeObjectName("../../etc/passwd<script>.png", "png");
    expect(name).not.toContain("..");
    expect(name).not.toContain("<");
    expect(name.endsWith(".png")).toBe(true);
  });

  it("produces unique names for identical uploads", () => {
    expect(safeObjectName("art.png", "png")).not.toBe(safeObjectName("art.png", "png"));
  });
});

describe("shopify sku", () => {
  it("embeds the studio reference", () => {
    expect(buildSku("VF-ABC123", "vf-tee-classic", "black", "2XL")).toBe(
      "VF-ABC123-TEE-CLASSIC-BLACK-2XL"
    );
  });
});

describe("fulfillment mapping", () => {
  const order = {
    id: 555,
    name: "#1001",
    email: "customer@example.com",
    shipping_address: {
      name: "Test Customer",
      address1: "1 Main St",
      city: "Miami",
      province_code: "FL",
      country_code: "US",
      zip: "33101",
    },
    line_items: [
      {
        id: 1,
        title: "Custom tee",
        quantity: 2,
        properties: [
          { name: "Studio reference", value: "VF-ABC123" },
          { name: "_artwork_url", value: "https://cdn.example.com/a.png" },
          { name: "_pod_provider", value: "printful" },
          { name: "_provider_variant_id", value: "4012" },
          {
            name: "_print_geometry_in",
            value: JSON.stringify([
              { printAreaId: "front", widthIn: 8, heightIn: 9.6, leftIn: 2, topIn: 3, rotation: 0 },
            ]),
          },
        ],
      },
      { id: 2, title: "Plain hat", quantity: 1, properties: [] },
    ],
  };

  it("extracts customized lines and skips plain ones", () => {
    const plan = buildFulfillmentPlan(order, "printful");
    expect(plan.items).toHaveLength(1);
    expect(plan.skipped).toEqual(["2"]);
    expect(plan.submittable).toBe(true);
  });

  it("blocks lines whose artwork is not publicly reachable", () => {
    const local = structuredClone(order);
    local.line_items[0]!.properties![1]!.value = "/api/uploads/a.png";
    const plan = buildFulfillmentPlan(local, "printful");
    expect(plan.submittable).toBe(false);
    expect(plan.items[0]!.blockers.join(" ")).toMatch(/public https/);
  });

  it("maps a line into a Printful order payload", () => {
    const plan = buildFulfillmentPlan(order, "printful");
    const payload = toPrintfulOrder(order, plan.items[0]!) as {
      external_id: string;
      items: { variant_id: number; quantity: number; files: { url: string }[] }[];
    };
    expect(payload.external_id).toBe("555-1");
    expect(payload.items[0]!.variant_id).toBe(4012);
    expect(payload.items[0]!.quantity).toBe(2);
    expect(payload.items[0]!.files[0]!.url).toBe("https://cdn.example.com/a.png");
  });
});

describe("webhook signature", () => {
  it("matches Shopify's base64 HMAC over the raw body", () => {
    const body = JSON.stringify({ id: 1 });
    const secret = "shhh";
    const digest = createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(digest).toBe(createHmac("sha256", secret).update(body, "utf8").digest("base64"));
    expect(digest).not.toBe(createHmac("sha256", "wrong").update(body, "utf8").digest("base64"));
  });
});

describe("catalog", () => {
  it("every product has sizes, colours and at least one print area", () => {
    for (const product of CATALOG) {
      expect(product.sizes.length).toBeGreaterThan(0);
      expect(product.colors.length).toBeGreaterThan(0);
      expect(product.printAreas.length).toBeGreaterThan(0);
      expect(product.baseCostUsd).toBeGreaterThan(0);
    }
  });
});

describe("artwork url validation", () => {
  const base = {
    productId: "vf-tee-classic",
    colorId: "black",
    sizeId: "L",
    quantity: 1,
    placements: [{ printAreaId: "front", centerX: 0.5, centerY: 0.42, scale: 1, rotation: 0 }],
  };
  const artwork = {
    assetId: "a1",
    fileName: "built-different.png",
    mimeType: "image/png",
    width: 2400,
    height: 3000,
  };

  it("accepts an app-relative upload path from the local storage fallback", () => {
    const parsed = designConfigSchema.safeParse({
      ...base,
      artwork: { ...artwork, url: "/api/uploads/2026/08/built-different.png" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an absolute Supabase Storage URL", () => {
    const parsed = designConfigSchema.safeParse({
      ...base,
      artwork: { ...artwork, url: "https://x.supabase.co/storage/v1/object/public/a/b.png" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a javascript: artwork url", () => {
    const parsed = designConfigSchema.safeParse({
      ...base,
      artwork: { ...artwork, url: "javascript:alert(1)" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("clampPlacement", () => {
  const area = tee.printAreas[0]!;
  const tall = { width: 2400, height: 3000 };

  it("caps a portrait artwork to a scale that fits the print area", () => {
    const clamped = clampPlacement({ centerX: 0.5, centerY: 0.42, scale: 1, rotation: 0 }, area, tall);
    const geo = toPrintGeometry(clamped, area, tall);
    expect(geo.heightIn).toBeLessThanOrEqual(area.heightIn + 0.01);
    expect(clamped.scale).toBeLessThanOrEqual(maxFitScale(area, tall));
  });

  it("pulls artwork dragged off the edge back inside the print area", () => {
    const clamped = clampPlacement({ centerX: 1.4, centerY: -0.3, scale: 0.6, rotation: 0 }, area, tall);
    const geo = toPrintGeometry(clamped, area, tall);
    expect(geo.leftIn).toBeGreaterThanOrEqual(-0.01);
    expect(geo.topIn).toBeGreaterThanOrEqual(-0.01);
    expect(geo.leftIn + geo.widthIn).toBeLessThanOrEqual(area.widthIn + 0.01);
    expect(geo.topIn + geo.heightIn).toBeLessThanOrEqual(area.heightIn + 0.01);
  });

  it("produces a configuration the server accepts", () => {
    const clamped = clampPlacement({ centerX: 0.5, centerY: 0.42, scale: 1, rotation: 0 }, area, tall);
    const design = resolveDesign({
      productId: tee.id,
      colorId: "black",
      sizeId: "L",
      quantity: 1,
      artwork: { ...artwork, width: tall.width, height: tall.height },
      placements: [{ ...clamped, printAreaId: area.id }],
    });
    expect(design.ok).toBe(true);
    if (design.ok) expect(hasBlockingError(designWarnings(design.value))).toBe(false);
  });
});
