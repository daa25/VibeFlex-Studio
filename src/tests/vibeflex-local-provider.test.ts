import { describe, expect, it } from "vitest";
import { VibeFlexLocalProvider } from "@/integrations/pod/providers/vibeflex-local-provider";
import type { ProductionOrderInput } from "@/integrations/pod/production-types";

function order(overrides: Partial<ProductionOrderInput> = {}): ProductionOrderInput {
  return {
    studioOrderId: "VF-ORDER-1",
    lineItems: [
      {
        sku: "490-UNC-BEANIE-BLK",
        quantity: 1,
        providerVariantId: "local-beanie-black",
        artworkUrl: "https://cdn.example.com/beanie.png",
        technique: "embroidery",
        printAreaId: "embroidery_front",
      },
    ],
    shipTo: { country: "US", name: "Test Buyer" },
    ...overrides,
  };
}

describe("VibeFlexLocalProvider — first-class, no Printful required", () => {
  it("is a local provider that reports local production capability", () => {
    const p = new VibeFlexLocalProvider();
    expect(p.kind).toBe("local");
    expect(p.capabilities.localProduction).toBe(true);
    expect(p.capabilities.externalPaidFulfillment).toBe(false);
  });

  it("produces an order in-house without any external approval", async () => {
    const p = new VibeFlexLocalProvider({ idFactory: () => "vfl-1" });
    const job = await p.submitProductionOrder(order());
    expect(job.state).toBe("QUEUED");
    expect(job.requiresApproval).toBe(false);
    expect(job.providerName).toBe("vibeflex-local");
  });

  it("is idempotent on studioOrderId — a replay never double-produces", async () => {
    const p = new VibeFlexLocalProvider();
    const first = await p.submitProductionOrder(order());
    const second = await p.submitProductionOrder(order());
    expect(second.providerJobId).toBe(first.providerJobId);
  });

  it("refuses a technique it cannot run", () => {
    const p = new VibeFlexLocalProvider({ techniques: ["dtg"] });
    const embroidery = order().lineItems[0]!;
    expect(p.canProduce(embroidery, "US")).toBe(false);
  });

  it("refuses a destination it does not ship to", () => {
    const p = new VibeFlexLocalProvider({ shipsTo: ["US"] });
    expect(p.canProduce(order().lineItems[0]!, "DE")).toBe(false);
  });

  it("advances through the floor states and attaches tracking to ship", async () => {
    const p = new VibeFlexLocalProvider({ idFactory: () => "vfl-9" });
    const job = await p.submitProductionOrder(order());
    p.advance(job.providerJobId, "IN_PRODUCTION");
    expect((await p.getProductionJob(job.providerJobId)).state).toBe("IN_PRODUCTION");

    const shipped = p.attachTracking(job.providerJobId, {
      carrier: "USPS",
      trackingNumber: "9400111",
      trackingUrl: "https://tools.usps.com/9400111",
      shippedAt: null,
    });
    expect(shipped.state).toBe("SHIPPED");
    const tracking = await p.getTracking(job.providerJobId);
    expect(tracking?.trackingNumber).toBe("9400111");
    expect(tracking?.shippedAt).not.toBeNull();
  });
});
