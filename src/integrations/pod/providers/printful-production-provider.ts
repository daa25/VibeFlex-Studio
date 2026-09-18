// PrintfulProductionProvider — Printful as ONE external fulfillment provider
// behind the provider-neutral production interface.
//
// It is deliberately thin: it adapts Printful's order API to ProductionProvider
// and enforces the one rule that must never be bypassed —
//
//   An external, paid provider is NEVER auto-submitted. Without explicit
//   opts.ownerApproved === true, submitProductionOrder returns a
//   PENDING_APPROVAL job and bills nothing.
//
// The Printful HTTP details stay behind an injected client so this provider is
// unit-testable without a live Printful account, and so the existing
// PrintfulAdapter / edge-function paths can supply the real implementation.

import type {
  ProductionCapabilities,
  ProductionJob,
  ProductionJobState,
  ProductionLineItem,
  ProductionOrderInput,
  ProductionProvider,
  SubmitOptions,
  TrackingInfo,
  UnitCostEstimate,
} from "../production-types";

// The minimal Printful order surface this provider needs. A real client wraps
// api.printful.com; a test supplies a fake.
export interface PrintfulOrderClient {
  createOrder(input: ProductionOrderInput): Promise<{ providerJobId: string; state: ProductionJobState }>;
  getOrder(providerJobId: string): Promise<{ state: ProductionJobState; tracking?: TrackingInfo }>;
  estimateCost(item: ProductionLineItem, destinationCountry: string): Promise<UnitCostEstimate>;
}

export type PrintfulProductionConfig = {
  client: PrintfulOrderClient;
  techniques?: string[];
  shipsTo?: string[];
};

export class PrintfulProductionProvider implements ProductionProvider {
  readonly providerName = "printful";
  readonly kind = "external" as const;
  readonly capabilities: ProductionCapabilities;

  private readonly client: PrintfulOrderClient;

  constructor(config: PrintfulProductionConfig) {
    this.client = config.client;
    const techniques = config.techniques ?? ["embroidery", "dtg", "dtf", "cut-sew"];
    this.capabilities = {
      catalog: true,
      mockups: true,
      insideLabels: true,
      embroidery: techniques.includes("embroidery"),
      customPackaging: false,
      fulfillmentProductCreation: true,
      orderRouting: true,
      webhooks: true,
      localProduction: false,
      externalPaidFulfillment: true,
      techniques,
      dailyCapacity: null, // external, effectively unbounded
      shipsTo: config.shipsTo ?? [], // unrestricted
    };
  }

  canProduce(item: ProductionLineItem, destinationCountry?: string): boolean {
    const technique = item.technique.toLowerCase();
    if (!this.capabilities.techniques.includes(technique)) return false;
    if (
      destinationCountry &&
      this.capabilities.shipsTo.length > 0 &&
      !this.capabilities.shipsTo.includes(destinationCountry.toUpperCase())
    ) {
      return false;
    }
    // A provider variant id is mandatory for an external order — without it the
    // printer has nothing to make.
    return /^\d+$/.test(item.providerVariantId);
  }

  estimateUnitCost(
    item: ProductionLineItem,
    destinationCountry: string
  ): Promise<UnitCostEstimate> {
    return this.client.estimateCost(item, destinationCountry);
  }

  // The hard gate. An external paid order without explicit owner approval never
  // reaches Printful — it returns PENDING_APPROVAL and bills nothing.
  async submitProductionOrder(
    input: ProductionOrderInput,
    opts?: SubmitOptions
  ): Promise<ProductionJob> {
    if (opts?.ownerApproved !== true) {
      return {
        providerJobId: `pending-${input.studioOrderId}`,
        providerName: this.providerName,
        providerKind: this.kind,
        studioOrderId: input.studioOrderId,
        state: "PENDING_APPROVAL",
        requiresApproval: true,
        message:
          "External paid fulfillment requires explicit owner approval before submission. Nothing was sent to Printful.",
      };
    }

    const created = await this.client.createOrder(input);
    return {
      providerJobId: created.providerJobId,
      providerName: this.providerName,
      providerKind: this.kind,
      studioOrderId: input.studioOrderId,
      state: created.state,
      requiresApproval: false,
      message: "Submitted to Printful under owner approval.",
    };
  }

  async getProductionJob(providerJobId: string): Promise<ProductionJob> {
    const { state, tracking } = await this.client.getOrder(providerJobId);
    return {
      providerJobId,
      providerName: this.providerName,
      providerKind: this.kind,
      studioOrderId: providerJobId,
      state,
      requiresApproval: false,
      tracking,
    };
  }

  async getTracking(providerJobId: string): Promise<TrackingInfo | null> {
    const { tracking } = await this.client.getOrder(providerJobId);
    return tracking ?? null;
  }
}
