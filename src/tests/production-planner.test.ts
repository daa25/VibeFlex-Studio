import { describe, expect, it } from "vitest";
import { buildFulfillmentPlan, type ShopifyOrderPayload } from "@/lib/fulfillment/order-mapper";
import { planProduction } from "@/lib/fulfillment/production-planner";
import { getProductionProviders } from "@/lib/fulfillment/production-runtime";
import { VibeFlexLocalProvider } from "@/integrations/pod/providers/vibeflex-local-provider";

// A paid Shopify order for a studio-customized beanie: artwork, geometry,
// numeric supplier variant, technique and the price the buyer paid — all on the
// line-item properties, the way /api/studio/cart writes them.
function beanieOrder(overrides: Partial<ShopifyOrderPayload> = {}): ShopifyOrderPayload {
  return {
    id: 5001,
    name: "#VF-PLAN-1",
    email: "buyer@example.com",
    line_items: [
      {
        id: 900,
        title: "#UNCOOKED Cuffed Beanie — Black",
        quantity: 1,
        price: "26.00",
        variant_id: 42,
        properties: [
          { name: "Studio reference", value: "beanie-black-embroidery" },
          { name: "_artwork_url", value: "https://cdn.example.com/beanie.png" },
          { name: "_provider_variant_id", value: "8936" },
          { name: "_technique", value: "embroidery" },
          {
            name: "_print_geometry_in",
            value: JSON.stringify([
              {
                printAreaId: "embroidery_front",
                widthIn: 3,
                heightIn: 1.5,
                leftIn: 1,
                topIn: 1,
                rotation: 0,
              },
            ]),
          },
        ],
      },
    ],
    shipping_address: { country_code: "US", name: "Test Buyer" },
    ...overrides,
  };
}

describe("planProduction — order → route → production plan", () => {
  it("routes a clean order to the in-house line with no external approval", async () => {
    const plan = buildFulfillmentPlan(beanieOrder(), "printful");
    expect(plan.submittable).toBe(true);

    const local = new VibeFlexLocalProvider({ idFactory: () => "vfl-plan-1" });
    const production = await planProduction(plan, getProductionProviders({ localProvider: local }));

    expect(production.submittable).toBe(true);
    expect(production.decision).not.toBeNull();
    expect(production.decision?.kind).toBe("local");
    expect(production.decision?.chosenName).toBe("vibeflex-local");
    expect(production.decision?.requiresApproval).toBe(false);
    // Retail carried through from the price the buyer actually paid.
    expect(production.retailByVariant["8936"]).toBe(26);
  });

  it("does not route an order with blockers — it sits in review", async () => {
    // Drop the supplier variant id, which is a hard blocker in the mapper.
    const order = beanieOrder();
    order.line_items![0]!.properties = order.line_items![0]!.properties!.filter(
      (p) => p.name !== "_provider_variant_id"
    );

    const plan = buildFulfillmentPlan(order, "printful");
    expect(plan.submittable).toBe(false);

    const production = await planProduction(plan, getProductionProviders());
    expect(production.submittable).toBe(false);
    expect(production.decision).toBeNull();
    expect(production.blockers.length).toBeGreaterThan(0);
  });

  it("produces through the in-house line even with no external provider registered", async () => {
    const plan = buildFulfillmentPlan(beanieOrder(), "printful");
    // Default runtime: only the in-house line is registered.
    const providers = getProductionProviders();
    expect(providers.map((p) => p.providerName)).toEqual(["vibeflex-local"]);

    const production = await planProduction(plan, providers);
    expect(production.decision?.kind).toBe("local");
    expect(production.decision?.chosen).not.toBeNull();
  });
});
