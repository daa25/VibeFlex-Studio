import { describe, expect, it } from "vitest";
import { VibeFlexLocalProvider } from "@/integrations/pod/providers/vibeflex-local-provider";
import {
  PrintifyProductionProvider,
  type PrintifyOrderClient,
} from "@/integrations/pod/providers/printify-production-provider";
import { routeProduction } from "@/integrations/pod/production-router";
import type { ProductionOrderInput } from "@/integrations/pod/production-types";

const printifyClient: PrintifyOrderClient = {
  createOrder: async (input) => ({ providerJobId: `py-${input.studioOrderId}`, state: "QUEUED" }),
  getOrder: async () => ({ state: "IN_PRODUCTION" }),
  estimateCost: async () => ({ baseCost: 11.79, estimatedShipping: 4.5, currency: "USD" }),
};

function beanieOrder(overrides: Partial<ProductionOrderInput> = {}): ProductionOrderInput {
  return {
    studioOrderId: "VF-ROUTE-PY-1",
    lineItems: [
      {
        sku: "490-UNC-BEANIE-BLK",
        quantity: 1,
        providerVariantId: "17390",
        artworkUrl: "https://cdn.example.com/beanie.png",
        technique: "embroidery",
        printAreaId: "embroidery_front",
      },
    ],
    shipTo: { country: "US" },
    ...overrides,
  };
}

const retail = { "17390": 26 };

describe("Printify production provider — same gate as Printful", () => {
  it("returns PENDING_APPROVAL without owner approval, and bills nothing", async () => {
    const printify = new PrintifyProductionProvider({ client: printifyClient });
    const job = await printify.submitProductionOrder(beanieOrder());
    expect(job.state).toBe("PENDING_APPROVAL");
    expect(job.requiresApproval).toBe(true);
  });

  it("submits only when owner-approved", async () => {
    const printify = new PrintifyProductionProvider({ client: printifyClient });
    const job = await printify.submitProductionOrder(beanieOrder(), { ownerApproved: true });
    expect(job.state).toBe("QUEUED");
    expect(job.requiresApproval).toBe(false);
    expect(job.providerJobId).toBe("py-VF-ROUTE-PY-1");
  });

  it("refuses to produce a technique it does not support", () => {
    const printify = new PrintifyProductionProvider({ client: printifyClient, techniques: ["dtg"] });
    const canDo = printify.canProduce(beanieOrder().lineItems[0]!);
    expect(canDo).toBe(false);
  });
});

describe("routing with both external providers registered", () => {
  it("still prefers the in-house line over either external provider", async () => {
    const local = new VibeFlexLocalProvider();
    const printify = new PrintifyProductionProvider({ client: printifyClient });
    const decision = await routeProduction(beanieOrder(), [local, printify], retail);

    expect(decision.kind).toBe("local");
    expect(decision.chosenName).toBe("vibeflex-local");
  });

  it("routes to Printify when local cannot produce the technique", async () => {
    const local = new VibeFlexLocalProvider({ techniques: ["dtg"] });
    const printify = new PrintifyProductionProvider({ client: printifyClient });
    const decision = await routeProduction(beanieOrder(), [local, printify], retail);

    expect(decision.kind).toBe("external");
    expect(decision.chosenName).toBe("printify");
    expect(decision.requiresApproval).toBe(true);
  });

  it("produces with only Printify registered (no local, no Printful)", async () => {
    const printify = new PrintifyProductionProvider({ client: printifyClient });
    const decision = await routeProduction(beanieOrder(), [printify], retail);
    expect(decision.chosenName).toBe("printify");
  });
});
