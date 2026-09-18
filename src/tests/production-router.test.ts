import { describe, expect, it } from "vitest";
import { VibeFlexLocalProvider } from "@/integrations/pod/providers/vibeflex-local-provider";
import {
  PrintfulProductionProvider,
  type PrintfulOrderClient,
} from "@/integrations/pod/providers/printful-production-provider";
import { routeProduction } from "@/integrations/pod/production-router";
import type { ProductionOrderInput } from "@/integrations/pod/production-types";

const printfulClient: PrintfulOrderClient = {
  createOrder: async (input) => ({ providerJobId: `pf-${input.studioOrderId}`, state: "QUEUED" }),
  getOrder: async () => ({ state: "IN_PRODUCTION" }),
  estimateCost: async () => ({ baseCost: 13.05, estimatedShipping: 4.5, currency: "USD" }),
};

function beanieOrder(overrides: Partial<ProductionOrderInput> = {}): ProductionOrderInput {
  return {
    studioOrderId: "VF-ROUTE-1",
    lineItems: [
      {
        sku: "490-UNC-BEANIE-BLK",
        quantity: 1,
        providerVariantId: "8936", // numeric so Printful will also accept it
        artworkUrl: "https://cdn.example.com/beanie.png",
        technique: "embroidery",
        printAreaId: "embroidery_front",
      },
    ],
    shipTo: { country: "US" },
    ...overrides,
  };
}

// Beanie retails at $26; local embroidery cost ~$6.50 + $4.50 ship, Printful
// ~$13.05 + $4.50. Both clear a 30% margin at $26, so preference decides.
const retail = { "8936": 26 };

describe("production router — local-first, external gated", () => {
  it("routes to the in-house line when it is capable and within capacity", async () => {
    const local = new VibeFlexLocalProvider();
    const printful = new PrintfulProductionProvider({ client: printfulClient });
    const decision = await routeProduction(beanieOrder(), [local, printful], retail);

    expect(decision.kind).toBe("local");
    expect(decision.chosenName).toBe("vibeflex-local");
    expect(decision.requiresApproval).toBe(false);
  });

  it("falls back to external when local cannot produce — and flags approval", async () => {
    // Local line only does DTG here, so an embroidery order must go external.
    const local = new VibeFlexLocalProvider({ techniques: ["dtg"] });
    const printful = new PrintfulProductionProvider({ client: printfulClient });
    const decision = await routeProduction(beanieOrder(), [local, printful], retail);

    expect(decision.kind).toBe("external");
    expect(decision.chosenName).toBe("printful");
    expect(decision.requiresApproval).toBe(true);
  });

  it("falls back to external when the order exceeds in-house capacity", async () => {
    const local = new VibeFlexLocalProvider({ dailyCapacity: 5 });
    const printful = new PrintfulProductionProvider({ client: printfulClient });
    const big = beanieOrder({
      lineItems: [
        {
          sku: "490-UNC-BEANIE-BLK",
          quantity: 40,
          providerVariantId: "8936",
          artworkUrl: "https://cdn.example.com/beanie.png",
          technique: "embroidery",
          printAreaId: "embroidery_front",
        },
      ],
    });
    const decision = await routeProduction(big, [local, printful], retail);
    expect(decision.chosenName).toBe("printful");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.candidates.find((c) => c.kind === "local")?.withinCapacity).toBe(false);
  });

  it("chooses nobody when margin is below the floor, and escalates", async () => {
    const local = new VibeFlexLocalProvider();
    const printful = new PrintfulProductionProvider({ client: printfulClient });
    // Retail $12 vs ~$11 landed cost = single-digit margin, below the 30% floor.
    const decision = await routeProduction(beanieOrder(), [local, printful], { "8936": 12 });
    expect(decision.chosen).toBeNull();
    expect(decision.reason).toMatch(/no provider/i);
  });

  it("still produces with ONLY the local provider registered (no Printful)", async () => {
    const local = new VibeFlexLocalProvider();
    const decision = await routeProduction(beanieOrder(), [local], retail);
    expect(decision.kind).toBe("local");
    expect(decision.chosen).not.toBeNull();
  });
});

describe("external provider — never auto-submits a paid order", () => {
  it("returns PENDING_APPROVAL without owner approval", async () => {
    const printful = new PrintfulProductionProvider({ client: printfulClient });
    const job = await printful.submitProductionOrder(beanieOrder());
    expect(job.state).toBe("PENDING_APPROVAL");
    expect(job.requiresApproval).toBe(true);
  });

  it("submits only when owner-approved", async () => {
    const printful = new PrintfulProductionProvider({ client: printfulClient });
    const job = await printful.submitProductionOrder(beanieOrder(), { ownerApproved: true });
    expect(job.state).toBe("QUEUED");
    expect(job.requiresApproval).toBe(false);
    expect(job.providerJobId).toBe("pf-VF-ROUTE-1");
  });
});
