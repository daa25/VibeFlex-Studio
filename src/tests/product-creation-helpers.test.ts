import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintifyAdapter } from "@/integrations/pod/printify/adapter";
import { firstPrintAreaId, markupRetailPrice } from "@/integrations/pod/printify/product-creation";

afterEach(() => vi.unstubAllGlobals());

describe("markupRetailPrice", () => {
  it("applies the markup and rounds down to a .99 price", () => {
    expect(markupRetailPrice(10)).toBe(15.99); // 10 * 1.55 = 15.5 -> floor 15 + .99
  });

  it("falls back to a floor price for a missing/zero cost rather than pricing at $0", () => {
    expect(markupRetailPrice(0)).toBe(24.99);
    expect(markupRetailPrice(NaN)).toBe(24.99);
  });

  it("accepts a custom markup", () => {
    expect(markupRetailPrice(20, 2)).toBe(40.99); // 20 * 2 = 40 -> floor 40 + .99
  });
});

describe("firstPrintAreaId", () => {
  it("returns the first placement key a variant actually exposes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/print_providers.json")) {
          return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 29, title: "MyLocker" }]) } as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              variants: [{ id: 17390, placeholders: [{ position: "embroidery_front", height: 100, width: 100 }] }],
            }),
        } as Response;
      })
    );

    const adapter = new PrintifyAdapter("key", "shop-1");
    const areaId = await firstPrintAreaId(adapter, "12", "17390");
    expect(areaId).toBe("embroidery_front");
  });

  it("returns null when the variant has no placeholders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/print_providers.json")) {
          return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 29, title: "MyLocker" }]) } as Response;
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ variants: [{ id: 1 }] }) } as Response;
      })
    );

    const adapter = new PrintifyAdapter("key", "shop-1");
    expect(await firstPrintAreaId(adapter, "12", "1")).toBeNull();
  });
});
