// Publication policy.
//
// This is the layer that lets Studio publish without a human in the loop —
// safely. Autonomy here is granted by POLICY, never by blind permission: a
// product advances only when every applicable gate is satisfied, and every
// gate failure names itself so the job router can decide between repair,
// retry and escalation.
//
// The single most important rule in this file:
//
//     A product may never be ACTIVE while fulfillment is unverified.
//
// "Customer can buy = yes / supplier can fulfil = no" is the one failure that
// takes real money from a real person with no way to deliver. It is a hard
// stop, not a warning, and it is checked independently of every other gate.

export type GateId = "ARTWORK" | "MOCKUP" | "QA" | "SUPPLIER" | "COMMERCE";

export type GateFailure = {
  gate: GateId;
  code: string;
  detail: string;
  /** How the autonomous router should react. */
  disposition: "repair" | "retry" | "escalate";
};

export type GateReport = {
  passed: boolean;
  failures: GateFailure[];
  /** Terminal state to move the job to when this report does not pass. */
  suggestedState:
    | "ARTWORK_REPAIR_REQUIRED"
    | "MOCKUP_REPAIR_REQUIRED"
    | "QA_REJECTED"
    | "SUPPLIER_BLOCKED"
    | "PRICING_HOLD"
    | "FULFILLMENT_BLOCKED"
    | "MANUAL_REVIEW"
    | "READY_FOR_APPROVAL";
};

export type PolicyConfig = {
  /** Minimum acceptable gross margin, as a percentage of retail. */
  minMarginPct: number;
  /** Minimum effective DPI for a production print file. */
  minEffectiveDpi: number;
  /** Minimum pixel dimension for a customer-facing product image. */
  minProductImagePx: number;
  /**
   * When false, a product that satisfies every gate still stops at
   * READY_FOR_APPROVAL. This is the Stage 1 -> Stage 2 switch.
   */
  autoPublishEnabled: boolean;
};

export const DEFAULT_POLICY: PolicyConfig = {
  minMarginPct: 45,
  minEffectiveDpi: 150,
  minProductImagePx: 800,
  // Deliberately off. Auto-publication is enabled only after the system has
  // demonstrated repeatable clean output, and only by explicit configuration.
  autoPublishEnabled: false,
};

export type GateInput = {
  artwork?: {
    persistedUrl?: string;
    ephemeral?: boolean;
    width?: number;
    height?: number;
    mimeType?: string;
    effectiveDpi?: number;
  };
  mockup?: {
    status: "generated" | "unavailable" | "failed";
    heroUrl?: string;
    /** Provenance matters: a print file is not a product photo. */
    provenance?: "provider_mockup" | "user_artwork" | "unknown";
    persisted?: boolean;
  };
  qa?: {
    deterministic: "PASS" | "PENDING" | "REJECTED";
    vision: "PASS" | "PENDING" | "REJECTED" | "not_configured";
  };
  supplier?: {
    catalogProductId?: string;
    variantIds?: string[];
    shopifyVariantCount?: number;
    /** True only when a real supplier sync/fulfillment product exists. */
    fulfillmentVerified?: boolean;
    printFileAttached?: boolean;
  };
  commerce?: {
    title?: string;
    description?: string;
    mediaCount?: number;
    optionCount?: number;
    variantCount?: number;
    prices?: number[];
    marginPct?: number;
    readBackVerified?: boolean;
  };
  ipRisk?: { flagged: boolean; detail?: string };
};

const PRODUCTION_FORMATS = ["image/png", "image/jpeg", "image/webp"];

export function checkArtworkGate(input: GateInput, policy: PolicyConfig): GateFailure[] {
  const f: GateFailure[] = [];
  const a = input.artwork;
  if (!a?.persistedUrl) {
    f.push({
      gate: "ARTWORK",
      code: "NO_PERSISTENT_ASSET",
      detail: "No persistent source artwork URL.",
      disposition: "repair",
    });
    return f;
  }
  if (a.ephemeral) {
    f.push({
      gate: "ARTWORK",
      code: "EPHEMERAL_STORAGE",
      detail:
        "Artwork lives on ephemeral storage. A print file must survive a redeploy or the supplier cannot fetch it at production time.",
      disposition: "repair",
    });
  }
  if (!a.width || !a.height) {
    f.push({
      gate: "ARTWORK",
      code: "UNKNOWN_DIMENSIONS",
      detail: "Artwork dimensions could not be measured.",
      disposition: "repair",
    });
  }
  if (a.mimeType && !PRODUCTION_FORMATS.includes(a.mimeType)) {
    f.push({
      gate: "ARTWORK",
      code: "UNSUPPORTED_FORMAT",
      detail: `${a.mimeType} is not a supported production format.`,
      disposition: "repair",
    });
  }
  if (a.effectiveDpi !== undefined && a.effectiveDpi < policy.minEffectiveDpi) {
    f.push({
      gate: "ARTWORK",
      code: "BELOW_DPI_FLOOR",
      detail: `Effective ${a.effectiveDpi} DPI is below the ${policy.minEffectiveDpi} DPI floor.`,
      disposition: "repair",
    });
  }
  return f;
}

export function checkMockupGate(input: GateInput): GateFailure[] {
  const f: GateFailure[] = [];
  const m = input.mockup;
  if (!m || m.status !== "generated" || !m.heroUrl) {
    f.push({
      gate: "MOCKUP",
      code: "NO_SUPPLIER_MOCKUP",
      detail: m?.status === "failed"
        ? "Mockup generation failed."
        : "No supplier-rendered mockup is available.",
      // A failed render is usually transient; an unavailable one needs repair.
      disposition: m?.status === "failed" ? "retry" : "repair",
    });
    return f;
  }
  if (m.provenance === "user_artwork") {
    f.push({
      gate: "MOCKUP",
      code: "ARTWORK_AS_PRODUCT_PHOTO",
      detail: "The raw print file is being used as the product image.",
      disposition: "repair",
    });
  }
  return f;
}

export function checkQaGate(input: GateInput): GateFailure[] {
  const f: GateFailure[] = [];
  const qa = input.qa;
  if (!qa) {
    f.push({ gate: "QA", code: "QA_NOT_RUN", detail: "Visual QA has not run.", disposition: "retry" });
    return f;
  }
  if (qa.deterministic === "REJECTED") {
    f.push({
      gate: "QA",
      code: "DETERMINISTIC_QA_REJECTED",
      detail: "Deterministic visual QA rejected the product image.",
      disposition: "repair",
    });
  }
  if (qa.deterministic === "PENDING") {
    f.push({
      gate: "QA",
      code: "DETERMINISTIC_QA_PENDING",
      detail: "Deterministic QA has not reached a verdict.",
      disposition: "retry",
    });
  }
  if (qa.vision === "REJECTED") {
    f.push({
      gate: "QA",
      code: "VISION_QA_REJECTED",
      detail: "Vision QA rejected the product image.",
      disposition: "repair",
    });
  }
  // PENDING IS NOT PASS. An unavailable vision service must never silently
  // promote a product; it escalates to a human instead.
  if (qa.vision === "PENDING" || qa.vision === "not_configured") {
    f.push({
      gate: "QA",
      code: "VISION_QA_UNAVAILABLE",
      detail:
        "Vision QA did not return a verdict. PENDING is not PASS — a product cannot advance because the inspector was unavailable.",
      disposition: "escalate",
    });
  }
  return f;
}

export function checkSupplierGate(input: GateInput): GateFailure[] {
  const f: GateFailure[] = [];
  const s = input.supplier;
  if (!s?.catalogProductId) {
    f.push({
      gate: "SUPPLIER",
      code: "NO_CATALOG_PRODUCT",
      detail: "No real supplier catalog product is mapped.",
      disposition: "repair",
    });
  }
  if (!s?.variantIds?.length) {
    f.push({
      gate: "SUPPLIER",
      code: "NO_VARIANT_IDS",
      detail: "No real supplier variant ids are mapped.",
      disposition: "repair",
    });
  }
  if (
    s?.variantIds?.length &&
    s.shopifyVariantCount !== undefined &&
    s.shopifyVariantCount > s.variantIds.length
  ) {
    f.push({
      gate: "SUPPLIER",
      code: "UNMAPPED_SHOPIFY_VARIANTS",
      detail: `${s.shopifyVariantCount} Shopify variants but only ${s.variantIds.length} supplier variants — some variants cannot be fulfilled.`,
      disposition: "repair",
    });
  }
  if (s?.printFileAttached === false) {
    f.push({
      gate: "SUPPLIER",
      code: "NO_PRINT_FILE",
      detail: "No production print file is attached to the supplier product.",
      disposition: "repair",
    });
  }
  if (!s?.fulfillmentVerified) {
    f.push({
      gate: "SUPPLIER",
      code: "FULFILLMENT_NOT_VERIFIED",
      detail:
        "No verified supplier fulfillment product exists. A variant map stored as metadata is NOT a fulfillment path.",
      disposition: "escalate",
    });
  }
  return f;
}

export function checkCommerceGate(input: GateInput, policy: PolicyConfig): GateFailure[] {
  const f: GateFailure[] = [];
  const c = input.commerce;
  const need = (cond: boolean, code: string, detail: string) => {
    if (!cond) f.push({ gate: "COMMERCE", code, detail, disposition: "repair" });
  };

  need(Boolean(c?.title?.trim()), "NO_TITLE", "Product title is missing.");
  need(Boolean(c?.description?.trim()), "NO_DESCRIPTION", "Product description is missing.");
  need((c?.mediaCount ?? 0) > 0, "NO_MEDIA", "Product has no images.");
  need((c?.optionCount ?? 0) > 0, "NO_OPTIONS", "Product has no options.");
  need((c?.variantCount ?? 0) > 0, "NO_VARIANTS", "Product has no variants.");
  need(
    Boolean(c?.prices?.length) && (c?.prices ?? []).every((p) => p > 0),
    "INVALID_PRICES",
    "One or more variants have no price."
  );

  if (c?.marginPct !== undefined && c.marginPct < policy.minMarginPct) {
    f.push({
      gate: "COMMERCE",
      code: "MARGIN_BELOW_POLICY",
      detail: `Margin ${c.marginPct}% is below the ${policy.minMarginPct}% policy floor.`,
      disposition: "escalate",
    });
  }
  if (c?.readBackVerified === false) {
    f.push({
      gate: "COMMERCE",
      code: "READ_BACK_FAILED",
      detail: "Shopify read-back verification did not pass.",
      disposition: "retry",
    });
  }
  return f;
}

/** Runs every gate and returns the state the job should move to. */
export function evaluateGates(
  input: GateInput,
  policy: PolicyConfig = DEFAULT_POLICY
): GateReport {
  const failures = [
    ...checkArtworkGate(input, policy),
    ...checkMockupGate(input),
    ...checkQaGate(input),
    ...checkSupplierGate(input),
    ...checkCommerceGate(input, policy),
  ];

  if (input.ipRisk?.flagged) {
    failures.push({
      gate: "QA",
      code: "IP_RISK_FLAGGED",
      detail: input.ipRisk.detail ?? "Possible third-party IP detected in the artwork.",
      disposition: "escalate",
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    suggestedState: suggestState(failures),
  };
}

function suggestState(failures: GateFailure[]): GateReport["suggestedState"] {
  if (failures.length === 0) return "READY_FOR_APPROVAL";
  // Order matters: the earliest blocking stage wins so repair starts at the
  // real root cause rather than at a downstream symptom.
  if (failures.some((x) => x.code === "FULFILLMENT_NOT_VERIFIED")) return "FULFILLMENT_BLOCKED";
  if (failures.some((x) => x.gate === "ARTWORK")) return "ARTWORK_REPAIR_REQUIRED";
  if (failures.some((x) => x.gate === "MOCKUP")) return "MOCKUP_REPAIR_REQUIRED";
  if (failures.some((x) => x.gate === "QA" && x.disposition === "repair")) return "QA_REJECTED";
  if (failures.some((x) => x.gate === "SUPPLIER")) return "SUPPLIER_BLOCKED";
  if (failures.some((x) => x.code === "MARGIN_BELOW_POLICY")) return "PRICING_HOLD";
  if (failures.some((x) => x.disposition === "escalate")) return "MANUAL_REVIEW";
  return "MANUAL_REVIEW";
}

export type PublicationDecision = {
  /** True only when policy permits publishing without a human. */
  autoPublish: boolean;
  /** True when the product is allowed to be ACTIVE at all. */
  mayBeActive: boolean;
  reason: string;
  failures: GateFailure[];
};

/**
 * The publication gate.
 *
 * `mayBeActive` is the hard safety rule and is evaluated on its own: no amount
 * of policy configuration can make a product publishable while its supplier
 * fulfillment is unverified.
 */
export function decidePublication(
  input: GateInput,
  policy: PolicyConfig = DEFAULT_POLICY
): PublicationDecision {
  const fulfillmentVerified = Boolean(input.supplier?.fulfillmentVerified);

  if (!fulfillmentVerified) {
    return {
      autoPublish: false,
      mayBeActive: false,
      reason:
        "FULFILLMENT BLOCKED — supplier fulfillment is not verified. A customer must never be able to buy a product the supplier cannot produce.",
      failures: [
        {
          gate: "SUPPLIER",
          code: "ACTIVE_WITHOUT_FULFILLMENT",
          detail: "Refusing publication: fulfillment verified = false.",
          disposition: "escalate",
        },
      ],
    };
  }

  const report = evaluateGates(input, policy);
  if (!report.passed) {
    return {
      autoPublish: false,
      mayBeActive: false,
      reason: `Gate failures: ${report.failures.map((x) => x.code).join(", ")}`,
      failures: report.failures,
    };
  }

  if (!policy.autoPublishEnabled) {
    return {
      autoPublish: false,
      mayBeActive: true,
      reason:
        "All gates passed. Auto-publication is disabled by policy, so the product stops at READY_FOR_APPROVAL for a human decision.",
      failures: [],
    };
  }

  return {
    autoPublish: true,
    mayBeActive: true,
    reason: "All gates passed and auto-publication is enabled by policy.",
    failures: [],
  };
}
