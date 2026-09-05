import { describe, expect, it } from "vitest";
import { buildFulfillmentPlan } from "@/lib/fulfillment/order-mapper";

const geometry = JSON.stringify([
  { printAreaId: "front", widthIn: 10, heightIn: 12, topIn: 3, leftIn: 1 },
]);

function line(overrides: Record<string, unknown> = {}) {
  const props = {
    _studio_reference: "VF-TEST01",
    _artwork_url: "https://cdn.example.com/artwork/original.png",
    _print_geometry_in: geometry,
    _pod_provider: "printful",
    _provider_variant_id: "4016",
    ...((overrides.properties as Record<string, string>) ?? {}),
  };
  return {
    id: 1,
    quantity: 1,
    properties: Object.entries(props)
      .filter(([, v]) => v !== undefined)
      .map(([name, value]) => ({ name, value: String(value) })),
  };
}

function order(lineOverrides: Record<string, unknown> = {}) {
  return { id: 100, name: "#1001", line_items: [line(lineOverrides)] };
}

describe("fulfillment plan — supplier variant is mandatory", () => {
  it("blocks a line with no supplier variant id", () => {
    const plan = buildFulfillmentPlan(
      order({ properties: { _provider_variant_id: undefined } }) as never,
      "printful"
    );

    expect(plan.items[0]!.blockers.join(" ")).toMatch(/no supplier variant id/i);
    // The real point: it must not look submittable.
    expect(plan.submittable).toBe(false);
  });

  it("blocks a non-numeric supplier variant id", () => {
    const plan = buildFulfillmentPlan(
      order({ properties: { _provider_variant_id: "not-a-variant" } }) as never,
      "printful"
    );

    expect(plan.items[0]!.blockers.join(" ")).toMatch(/not numeric/i);
    expect(plan.submittable).toBe(false);
  });

  it("stays submittable when the mapping is present and valid", () => {
    const plan = buildFulfillmentPlan(order() as never, "printful");
    expect(plan.items[0]!.blockers).toHaveLength(0);
    expect(plan.submittable).toBe(true);
  });

  it("still blocks on ephemeral artwork", () => {
    const plan = buildFulfillmentPlan(
      order({ properties: { _artwork_url: "/api/uploads/local.png" } }) as never,
      "printful"
    );
    expect(plan.items[0]!.blockers.join(" ")).toMatch(/public https/i);
    expect(plan.submittable).toBe(false);
  });

  it("reports every independent blocker at once rather than stopping at the first", () => {
    const plan = buildFulfillmentPlan(
      order({
        properties: {
          _provider_variant_id: undefined,
          _artwork_url: "/api/uploads/local.png",
          _print_geometry_in: undefined,
        },
      }) as never,
      "printful"
    );

    const joined = plan.items[0]!.blockers.join(" ");
    expect(joined).toMatch(/no supplier variant id/i);
    expect(joined).toMatch(/public https/i);
    expect(joined).toMatch(/print geometry/i);
    expect(plan.submittable).toBe(false);
  });
});
