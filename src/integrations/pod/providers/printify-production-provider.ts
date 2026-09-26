// PrintifyProductionProvider — Printify as ONE external fulfillment provider
// behind the provider-neutral production interface.
//
// Same shape and the same hard rule as PrintfulProductionProvider:
//
//   An external, paid provider is NEVER auto-submitted. Without explicit
//   opts.ownerApproved === true, submitProductionOrder returns a
//   PENDING_APPROVAL job and bills nothing.
//
// The Printify HTTP details stay behind an injected client so this provider is
// unit-testable without a live Printify account.

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

// The minimal Printify order surface this provider needs. A real client wraps
// api.printify.com/v1/shops/{shop_id}/orders.json; a test supplies a fake.
export interface PrintifyOrderClient {
  createOrder(input: ProductionOrderInput): Promise<{ providerJobId: string; state: ProductionJobState }>;
  getOrder(providerJobId: string): Promise<{ state: ProductionJobState; tracking?: TrackingInfo }>;
  estimateCost(item: ProductionLineItem, destinationCountry: string): Promise<UnitCostEstimate>;
}

export type PrintifyProductionConfig = {
  client: PrintifyOrderClient;
  techniques?: string[];
  shipsTo?: string[];
};

export class PrintifyProductionProvider implements ProductionProvider {
  readonly providerName = "printify";
  readonly kind = "external" as const;
  readonly capabilities: ProductionCapabilities;

  private readonly client: PrintifyOrderClient;

  constructor(config: PrintifyProductionConfig) {
    this.client = config.client;
    // Printify's own print-provider network mostly runs DTG/embroidery/DTF,
    // not screenprint or cut-sew — narrower than Printful's default set.
    const techniques = config.techniques ?? ["embroidery", "dtg", "dtf"];
    this.capabilities = {
      catalog: true,
      mockups: true,
      insideLabels: false,
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
    // printer has nothing to make. Printify additionally needs the blueprint
    // id (catalogProductExternalId): the same numeric variant id is only
    // meaningful within one blueprint + print provider, unlike Printful, which
    // can place an order from a bare variant id. Gate here, not at submission
    // time, so routing skips Printify for this line instead of failing after
    // it has already been chosen.
    return /^\d+$/.test(item.providerVariantId) && Boolean(item.catalogProductExternalId);
  }

  estimateUnitCost(
    item: ProductionLineItem,
    destinationCountry: string
  ): Promise<UnitCostEstimate> {
    return this.client.estimateCost(item, destinationCountry);
  }

  // The hard gate. An external paid order without explicit owner approval never
  // reaches Printify — it returns PENDING_APPROVAL and bills nothing.
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
          "External paid fulfillment requires explicit owner approval before submission. Nothing was sent to Printify.",
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
      message: "Submitted to Printify under owner approval.",
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
