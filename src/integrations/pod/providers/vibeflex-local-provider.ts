// VibeFlexLocalProvider — VibeFlex's own in-house production line.
//
// This is a FIRST-CLASS provider, not a fallback or a stub. It lets Studio
// create products, take orders, and drive production jobs entirely on VibeFlex's
// own capacity, with zero dependency on Printful or any external vendor. When
// external providers are unavailable, Studio is still production-capable through
// this provider.
//
// It does not bill an outside party, so submitting a job does not require the
// external-fulfillment approval gate. Operators advance the job (queued ->
// in production -> fulfilled -> shipped) and attach tracking as work completes;
// those transitions live here so the rest of Studio observes one uniform
// ProductionProvider surface.

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

// Pluggable persistence so this works in tests (in-memory) and in production
// (a DB-backed store) without changing the provider logic.
export interface LocalJobStore {
  get(jobId: string): ProductionJob | undefined;
  put(job: ProductionJob): void;
  findByStudioOrderId(studioOrderId: string): ProductionJob | undefined;
}

export class InMemoryLocalJobStore implements LocalJobStore {
  private readonly jobs = new Map<string, ProductionJob>();
  private readonly byOrder = new Map<string, string>();

  get(jobId: string): ProductionJob | undefined {
    return this.jobs.get(jobId);
  }
  put(job: ProductionJob): void {
    this.jobs.set(job.providerJobId, job);
    this.byOrder.set(job.studioOrderId, job.providerJobId);
  }
  findByStudioOrderId(studioOrderId: string): ProductionJob | undefined {
    const id = this.byOrder.get(studioOrderId);
    return id ? this.jobs.get(id) : undefined;
  }
}

export type VibeFlexLocalConfig = {
  /** Decoration methods the in-house line can run. */
  techniques?: string[];
  /** Units/day the line commits to. */
  dailyCapacity?: number;
  /** ISO countries the line ships to. */
  shipsTo?: string[];
  /** Flat in-house cost per unit by technique, in USD. */
  unitCostByTechnique?: Record<string, number>;
  /** Flat in-house shipping estimate per order line, in USD. */
  shippingEstimate?: number;
  store?: LocalJobStore;
  /** Deterministic id + clock hooks for testability. */
  now?: () => Date;
  idFactory?: () => string;
};

const DEFAULT_UNIT_COST: Record<string, number> = {
  embroidery: 6.5,
  dtg: 5.0,
  dtf: 4.5,
  screenprint: 4.0,
};

export class VibeFlexLocalProvider implements ProductionProvider {
  readonly providerName = "vibeflex-local";
  readonly kind = "local" as const;
  readonly capabilities: ProductionCapabilities;

  private readonly store: LocalJobStore;
  private readonly unitCost: Record<string, number>;
  private readonly shippingEstimate: number;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private seq = 0;

  constructor(config: VibeFlexLocalConfig = {}) {
    const techniques = config.techniques ?? ["embroidery", "dtg", "dtf", "screenprint"];
    this.capabilities = {
      catalog: true,
      mockups: true,
      insideLabels: true,
      embroidery: techniques.includes("embroidery"),
      customPackaging: true,
      fulfillmentProductCreation: true,
      orderRouting: true,
      webhooks: false,
      localProduction: true,
      externalPaidFulfillment: false,
      techniques,
      dailyCapacity: config.dailyCapacity ?? 25,
      shipsTo: config.shipsTo ?? ["US"],
    };
    this.store = config.store ?? new InMemoryLocalJobStore();
    this.unitCost = { ...DEFAULT_UNIT_COST, ...(config.unitCostByTechnique ?? {}) };
    this.shippingEstimate = config.shippingEstimate ?? 4.5;
    this.now = config.now ?? (() => new Date());
    this.idFactory =
      config.idFactory ?? (() => `vfl-${Date.now()}-${(this.seq += 1)}`);
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
    return true;
  }

  estimateUnitCost(
    item: ProductionLineItem,
    _destinationCountry: string
  ): Promise<UnitCostEstimate> {
    const baseCost = this.unitCost[item.technique.toLowerCase()] ?? 6.5;
    return Promise.resolve({
      baseCost,
      estimatedShipping: this.shippingEstimate,
      currency: "USD",
    });
  }

  // In-house production bills no outside party, so it does not require the
  // external-fulfillment approval gate. It queues directly. Idempotent on
  // studioOrderId so a webhook replay or a repeated click never double-produces.
  submitProductionOrder(
    input: ProductionOrderInput,
    _opts?: SubmitOptions
  ): Promise<ProductionJob> {
    const existing = this.store.findByStudioOrderId(input.studioOrderId);
    if (existing) return Promise.resolve(existing);

    const producible = input.lineItems.every((i) =>
      this.canProduce(i, input.shipTo.country)
    );
    const job: ProductionJob = {
      providerJobId: this.idFactory(),
      providerName: this.providerName,
      providerKind: this.kind,
      studioOrderId: input.studioOrderId,
      state: producible ? "QUEUED" : "FAILED",
      requiresApproval: false,
      message: producible
        ? "Queued to the VibeFlex in-house production line."
        : "One or more line items cannot be produced in-house (technique or destination).",
    };
    this.store.put(job);
    return Promise.resolve(job);
  }

  getProductionJob(providerJobId: string): Promise<ProductionJob> {
    const job = this.store.get(providerJobId);
    if (!job) return Promise.reject(new Error(`Unknown local job ${providerJobId}`));
    return Promise.resolve(job);
  }

  getTracking(providerJobId: string): Promise<TrackingInfo | null> {
    const job = this.store.get(providerJobId);
    return Promise.resolve(job?.tracking ?? null);
  }

  // ----- operator transitions (in-house floor control) --------------------
  // These are the local line's own controls. External providers report state
  // via their APIs; the in-house line reports it through these.

  advance(providerJobId: string, state: ProductionJobState): ProductionJob {
    const job = this.store.get(providerJobId);
    if (!job) throw new Error(`Unknown local job ${providerJobId}`);
    const next: ProductionJob = { ...job, state };
    this.store.put(next);
    return next;
  }

  attachTracking(providerJobId: string, tracking: TrackingInfo): ProductionJob {
    const job = this.store.get(providerJobId);
    if (!job) throw new Error(`Unknown local job ${providerJobId}`);
    const next: ProductionJob = {
      ...job,
      state: "SHIPPED",
      tracking: { ...tracking, shippedAt: tracking.shippedAt ?? this.now().toISOString() },
    };
    this.store.put(next);
    return next;
  }
}
