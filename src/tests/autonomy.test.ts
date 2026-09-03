import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  MAX_ATTEMPTS,
  nextRetryDelayMs,
  nextState,
  RESUME_FROM,
  routeFailure,
} from "@/lib/job-states";
import {
  DEFAULT_POLICY,
  decidePublication,
  evaluateGates,
  type GateInput,
} from "@/lib/policy-gates";

/** A product that satisfies every gate. Individual tests break one thing at a time. */
const cleanInput = (): GateInput => ({
  artwork: {
    persistedUrl: "https://uluyuqrikzicapnezmqd.supabase.co/storage/v1/object/public/vibeflex-artwork/a/original.png",
    ephemeral: false,
    width: 3600,
    height: 3600,
    mimeType: "image/png",
    effectiveDpi: 300,
  },
  mockup: {
    status: "generated",
    heroUrl: "https://printful-upload.s3-accelerate.amazonaws.com/tmp/x/tee-black-front.jpg",
    provenance: "provider_mockup",
    persisted: true,
  },
  qa: { deterministic: "PASS", vision: "PASS" },
  supplier: {
    catalogProductId: "71",
    variantIds: ["4016", "4017", "4018"],
    shopifyVariantCount: 3,
    fulfillmentVerified: true,
    printFileAttached: true,
  },
  commerce: {
    title: "Blood Hit The Stain Cross Tee",
    description: "<p>Real description.</p>",
    mediaCount: 1,
    optionCount: 2,
    variantCount: 3,
    prices: [32, 32, 32],
    marginPct: 63.5,
    readBackVerified: true,
  },
});

describe("publication policy — the hard fulfillment rule", () => {
  it("refuses to publish when fulfillment is unverified, even if everything else passes", () => {
    const input = cleanInput();
    input.supplier!.fulfillmentVerified = false;

    const decision = decidePublication(input, { ...DEFAULT_POLICY, autoPublishEnabled: true });
    expect(decision.mayBeActive).toBe(false);
    expect(decision.autoPublish).toBe(false);
    expect(decision.failures[0]?.code).toBe("ACTIVE_WITHOUT_FULFILLMENT");
  });

  it("routes an unverified-fulfillment product to FULFILLMENT_BLOCKED", () => {
    const input = cleanInput();
    input.supplier!.fulfillmentVerified = false;
    expect(evaluateGates(input).suggestedState).toBe("FULFILLMENT_BLOCKED");
  });

  it("still withholds auto-publish when policy disables it, but allows ACTIVE", () => {
    const decision = decidePublication(cleanInput(), DEFAULT_POLICY);
    expect(decision.mayBeActive).toBe(true);
    expect(decision.autoPublish).toBe(false);
  });

  it("auto-publishes only when every gate passes and policy enables it", () => {
    const decision = decidePublication(cleanInput(), { ...DEFAULT_POLICY, autoPublishEnabled: true });
    expect(decision.autoPublish).toBe(true);
  });
});

describe("gates", () => {
  it("passes a clean product", () => {
    expect(evaluateGates(cleanInput()).passed).toBe(true);
  });

  it("never lets PENDING vision QA become a pass", () => {
    const input = cleanInput();
    input.qa = { deterministic: "PASS", vision: "PENDING" };
    const report = evaluateGates(input);
    expect(report.passed).toBe(false);
    expect(report.failures.map((f) => f.code)).toContain("VISION_QA_UNAVAILABLE");
    expect(report.failures.find((f) => f.code === "VISION_QA_UNAVAILABLE")?.disposition).toBe("escalate");
  });

  it("treats an unconfigured vision service the same as pending", () => {
    const input = cleanInput();
    input.qa = { deterministic: "PASS", vision: "not_configured" };
    expect(evaluateGates(input).passed).toBe(false);
  });

  it("rejects the raw print file being used as the product photo", () => {
    const input = cleanInput();
    input.mockup!.provenance = "user_artwork";
    const report = evaluateGates(input);
    expect(report.failures.map((f) => f.code)).toContain("ARTWORK_AS_PRODUCT_PHOTO");
    expect(report.suggestedState).toBe("MOCKUP_REPAIR_REQUIRED");
  });

  it("rejects ephemeral artwork storage", () => {
    const input = cleanInput();
    input.artwork!.ephemeral = true;
    expect(evaluateGates(input).suggestedState).toBe("ARTWORK_REPAIR_REQUIRED");
  });

  it("blocks artwork below the DPI floor", () => {
    const input = cleanInput();
    input.artwork!.effectiveDpi = 96;
    expect(evaluateGates(input).failures.map((f) => f.code)).toContain("BELOW_DPI_FLOOR");
  });

  it("flags Shopify variants that have no supplier counterpart", () => {
    const input = cleanInput();
    input.supplier!.shopifyVariantCount = 6;
    expect(evaluateGates(input).failures.map((f) => f.code)).toContain("UNMAPPED_SHOPIFY_VARIANTS");
  });

  it("holds a product whose margin is below policy", () => {
    const input = cleanInput();
    input.commerce!.marginPct = 14.6; // the water bottle case
    const report = evaluateGates(input);
    expect(report.failures.map((f) => f.code)).toContain("MARGIN_BELOW_POLICY");
    expect(report.suggestedState).toBe("PRICING_HOLD");
  });

  it("escalates an IP risk rather than repairing it", () => {
    const input = cleanInput();
    input.ipRisk = { flagged: true, detail: "Third-party logo detected." };
    const report = evaluateGates(input);
    expect(report.passed).toBe(false);
    expect(report.failures.find((f) => f.code === "IP_RISK_FLAGGED")?.disposition).toBe("escalate");
  });

  it("reports the root cause, not a downstream symptom", () => {
    const input = cleanInput();
    input.artwork!.ephemeral = true;
    input.mockup = { status: "unavailable" };
    input.qa = { deterministic: "PENDING", vision: "PENDING" };
    // Artwork is the earliest broken stage, so repair must start there.
    expect(evaluateGates(input).suggestedState).toBe("ARTWORK_REPAIR_REQUIRED");
  });
});

describe("job state machine", () => {
  it("walks the happy path from RECEIVED to READY_FOR_APPROVAL", () => {
    const seen: string[] = ["RECEIVED"];
    let state = nextState("RECEIVED");
    while (state && state !== "READY_FOR_APPROVAL") {
      seen.push(state);
      state = nextState(state);
    }
    expect(state).toBe("READY_FOR_APPROVAL");
    expect(seen).toContain("MOCKUP_GENERATING");
    expect(seen).toContain("QA_RUNNING");
    expect(seen).toContain("VERIFYING");
  });

  it("requires a human transition from READY_FOR_APPROVAL to APPROVED", () => {
    expect(nextState("READY_FOR_APPROVAL")).toBeNull();
    expect(canTransition("READY_FOR_APPROVAL", "APPROVED")).toBe(true);
  });

  it("refuses an illegal jump straight to LIVE", () => {
    expect(canTransition("QA_RUNNING", "LIVE")).toBe(false);
    expect(() => assertTransition("QA_RUNNING", "LIVE")).toThrow(/Illegal studio job transition/);
  });

  it("treats LIVE as terminal", () => {
    expect(canTransition("LIVE", "PUBLISHING")).toBe(false);
  });

  it("resumes each exception at the stage that can actually fix it", () => {
    expect(RESUME_FROM.MOCKUP_REPAIR_REQUIRED).toBe("MOCKUP_GENERATING");
    expect(RESUME_FROM.QA_REJECTED).toBe("MOCKUP_GENERATING");
    expect(RESUME_FROM.FULFILLMENT_BLOCKED).toBe("SUPPLIER_MAPPING");
    expect(canTransition("MOCKUP_REPAIR_REQUIRED", "MOCKUP_GENERATING")).toBe(true);
  });
});

describe("failure routing and retries", () => {
  it("retries a transient failure in place", () => {
    const route = routeFailure({
      currentState: "MOCKUP_GENERATING",
      disposition: "retry",
      suggestedState: "MOCKUP_REPAIR_REQUIRED",
      attempts: 1,
    });
    expect(route.state).toBe("MOCKUP_GENERATING");
    expect(route.retryInMs).toBeGreaterThan(0);
    expect(route.requiresHuman).toBe(false);
  });

  it("stops retrying once attempts are exhausted", () => {
    const route = routeFailure({
      currentState: "MOCKUP_GENERATING",
      disposition: "retry",
      suggestedState: "MOCKUP_REPAIR_REQUIRED",
      attempts: MAX_ATTEMPTS,
    });
    expect(route.state).toBe("MANUAL_REVIEW");
    expect(route.retryInMs).toBeNull();
    expect(route.requiresHuman).toBe(true);
  });

  it("sends a repairable failure to its repair state without retrying", () => {
    const route = routeFailure({
      currentState: "MOCKUP_GENERATING",
      disposition: "repair",
      suggestedState: "MOCKUP_REPAIR_REQUIRED",
      attempts: 1,
    });
    expect(route.state).toBe("MOCKUP_REPAIR_REQUIRED");
    expect(route.retryInMs).toBeNull();
  });

  it("parks an escalation for a human", () => {
    const route = routeFailure({
      currentState: "SUPPLIER_MAPPING",
      disposition: "escalate",
      suggestedState: "FULFILLMENT_BLOCKED",
      attempts: 1,
    });
    expect(route.requiresHuman).toBe(true);
  });

  it("backs off exponentially and caps", () => {
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(60_000);
    expect(nextRetryDelayMs(50)).toBe(30 * 60_000);
  });
});
