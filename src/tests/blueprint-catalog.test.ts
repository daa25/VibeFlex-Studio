import { describe, expect, it } from "vitest";
import { STARTER_BLUEPRINT_TARGETS, findBlueprint } from "@/integrations/pod/printify/blueprint-catalog";
import type { PodProduct } from "@/integrations/pod/types";

function product(name: string, id: string): PodProduct {
  return { externalId: id, name, printAreas: [], attributes: {} };
}

describe("findBlueprint", () => {
  it("matches the first keyword found, case-insensitively", () => {
    const catalog = [product("Unisex Heavy Blend Hooded Sweatshirt", "77"), product("Gildan 18500", "12")];
    const match = findBlueprint(catalog, ["gildan 18500", "hooded sweatshirt"]);
    expect(match?.externalId).toBe("12");
  });

  it("falls through to a later, more generic keyword when the specific one is absent", () => {
    const catalog = [product("Some Random Snapback Cap", "5")];
    const match = findBlueprint(catalog, ["yupoong 6089m", "snapback", "cap"]);
    expect(match?.externalId).toBe("5");
  });

  it("returns null rather than guessing when nothing matches", () => {
    const catalog = [product("Ceramic Mug", "99")];
    expect(findBlueprint(catalog, ["tee", "t-shirt"])).toBeNull();
  });
});

describe("STARTER_BLUEPRINT_TARGETS", () => {
  it("covers the five-blank starter lineup with no duplicate slugs", () => {
    const slugs = STARTER_BLUEPRINT_TARGETS.map((t) => t.slug);
    expect(slugs).toEqual(["tee", "hoodie", "crewneck", "tank", "cap"]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("gives every target at least one keyword", () => {
    for (const target of STARTER_BLUEPRINT_TARGETS) {
      expect(target.keywords.length).toBeGreaterThan(0);
    }
  });
});
