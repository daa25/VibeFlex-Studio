import { afterEach, describe, expect, it, vi } from "vitest";

// The runner talks to Supabase, Printful and Shopify. Mock those boundaries so
// the tests exercise the ORCHESTRATION — which stage runs, what it decides, and
// where a failure routes — rather than the providers.
const completeStage = vi.fn(async () => ({ available: true as const, value: null }));
const failStage = vi.fn(async () => ({ available: true as const, value: null }));

vi.mock("@/lib/job-queue", () => ({
  completeStage: (...args: unknown[]) => completeStage(...(args as [])),
  failStage: (...args: unknown[]) => failStage(...(args as [])),
  claimNextJob: vi.fn(async () => ({ available: true, value: null })),
}));

const getDesignByReference = vi.fn();
const markDesignPublished = vi.fn(async () => ({ persisted: true }));
vi.mock("@/lib/repository", () => ({
  getDesignByReference: (...a: unknown[]) => getDesignByReference(...(a as [])),
  markDesignPublished: (...a: unknown[]) => markDesignPublished(...(a as [])),
}));

const getProviderVariantMap = vi.fn();
vi.mock("@/integrations/pod/catalog-service", () => ({
  getProviderVariantMap: (...a: unknown[]) => getProviderVariantMap(...(a as [])),
}));

const generateMockup = vi.fn();
vi.mock("@/lib/mockup-service", () => ({
  generateMockup: (...a: unknown[]) => generateMockup(...(a as [])),
}));

const runVisualQa = vi.fn();
vi.mock("@/lib/visual-qa", () => ({
  runVisualQa: (...a: unknown[]) => runVisualQa(...(a as [])),
}));

vi.mock("@/integrations/shopify/admin-client", () => ({ adminConfigMissing: () => [] }));

const verifyDraftProduct = vi.fn();
const findExistingDraftByReference = vi.fn(async () => null);
vi.mock("@/integrations/shopify/verify-draft", () => ({
  verifyDraftProduct: (...a: unknown[]) => verifyDraftProduct(...(a as [])),
  findExistingDraftByReference: (...a: unknown[]) => findExistingDraftByReference(...(a as [])),
}));

const publishDraftProduct = vi.fn();
vi.mock("@/integrations/shopify/publish-draft", () => ({
  publishDraftProduct: (...a: unknown[]) => publishDraftProduct(...(a as [])),
}));

import { runJobStage, type RunnableJob } from "@/lib/job-runner";
import { CATALOG } from "@/lib/catalog";

const product = CATALOG[0]!;

const design = {
  product,
  color: product.colors[0]!,
  printAreas: [product.printAreas[0]!],
  config: {
    artwork: {
      assetId: "asset-1",
      url: "https://cdn.example.com/artwork/original.png",
      width: 3600,
      height: 3600,
      fileName: "grace.png",
    },
    productId: product.id,
    colorId: product.colors[0]!.id,
    sizeId: product.sizes[0]!.id,
    placements: [{ printAreaId: product.printAreas[0]!.id, x: 0, y: 0, scale: 1, rotation: 0 }],
  },
};

function job(state: string, extra: Partial<RunnableJob> = {}): RunnableJob {
  return {
    id: "job-uuid",
    jobKey: "JOB-TEST01",
    state,
    attempts: 1,
    designReference: "VF-TEST01",
    shopifyProductId: null,
    evidence: {},
    ...extra,
  };
}

afterEach(() => vi.clearAllMocks());

describe("runner — artwork stage", () => {
  it("rejects ephemeral artwork that the supplier could never fetch", async () => {
    getDesignByReference.mockResolvedValue({
      config: { ...design.config, artwork: { ...design.config.artwork, url: "/api/uploads/x.png" } },
    });

    const { outcome } = await runJobStage(job("ARTWORK_VALIDATING"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.suggestedState).toBe("ARTWORK_REPAIR_REQUIRED");
      expect(outcome.disposition).toBe("repair");
    }
    expect(failStage).toHaveBeenCalled();
  });

  it("accepts persisted https artwork", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    const { outcome } = await runJobStage(job("ARTWORK_VALIDATING"));
    expect(outcome.ok).toBe(true);
    expect(completeStage).toHaveBeenCalled();
  });
});

describe("runner — supplier stage", () => {
  it("never marks fulfillment verified from a variant map alone", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    getProviderVariantMap.mockResolvedValue({ mode: "live", map: { "black/S": "4016" } });

    const { outcome } = await runJobStage(job("SUPPLIER_MAPPING"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const supplier = (outcome.evidence as { supplier: { fulfillmentVerified: boolean } }).supplier;
      expect(supplier.fulfillmentVerified).toBe(false);
    }
  });

  it("blocks when no live supplier mapping exists", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    getProviderVariantMap.mockResolvedValue({ mode: "mock", map: {}, warning: "Printful not configured" });

    const { outcome } = await runJobStage(job("SUPPLIER_MAPPING"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.suggestedState).toBe("SUPPLIER_BLOCKED");
  });
});

describe("runner — mockup and QA stages", () => {
  it("routes a failed render to retry and an unavailable one to repair", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });

    generateMockup.mockResolvedValue({ status: "failed", alternateUrls: [], message: "Printful 500" });
    const failed = await runJobStage(job("MOCKUP_GENERATING", { evidence: { supplier: { variantIds: ["4016"] } } }));
    expect(failed.outcome.ok).toBe(false);
    if (!failed.outcome.ok) expect(failed.outcome.disposition).toBe("retry");

    generateMockup.mockResolvedValue({ status: "unavailable", alternateUrls: [], message: "below DPI floor" });
    const unavailable = await runJobStage(job("MOCKUP_GENERATING", { evidence: { supplier: { variantIds: ["4016"] } } }));
    expect(unavailable.outcome.ok).toBe(false);
    if (!unavailable.outcome.ok) expect(unavailable.outcome.disposition).toBe("repair");
  });

  it("sends a QA rejection to the repair queue", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    runVisualQa.mockResolvedValue({
      verdict: "REJECTED",
      findings: [{ code: "NESTED_MOCKUP", severity: "blocker", detail: "nested" }],
      checkedUrl: "https://cdn/x.jpg",
      aiStatus: "ok",
    });

    const { outcome } = await runJobStage(
      job("QA_RUNNING", { evidence: { mockup: { heroUrl: "https://cdn/x.jpg" } } })
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.suggestedState).toBe("QA_REJECTED");
  });

  it("carries a PENDING verdict forward instead of treating it as a pass", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    runVisualQa.mockResolvedValue({
      verdict: "PENDING",
      findings: [],
      checkedUrl: "https://cdn/x.jpg",
      aiStatus: "not_configured",
    });

    const { outcome } = await runJobStage(
      job("QA_RUNNING", { evidence: { mockup: { heroUrl: "https://cdn/x.jpg" } } })
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const qa = (outcome.evidence as { qa: { vision: string } }).qa;
      expect(qa.vision).toBe("not_configured");
    }
  });
});

describe("runner — draft creation", () => {
  it("reuses an existing draft instead of creating a duplicate", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    findExistingDraftByReference.mockResolvedValue("gid://shopify/Product/1" as never);

    const { outcome } = await runJobStage(job("SHOPIFY_DRAFT_CREATING"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.shopifyProductId).toBe("gid://shopify/Product/1");
    expect(publishDraftProduct).not.toHaveBeenCalled();
  });

  it("never attaches an image that QA rejected", async () => {
    getDesignByReference.mockResolvedValue({ config: design.config });
    findExistingDraftByReference.mockResolvedValue(null as never);
    publishDraftProduct.mockResolvedValue({
      productId: "gid://shopify/Product/2",
      variantIds: ["v1"],
      adminUrl: "https://admin",
      handle: "h",
      status: "DRAFT",
      mediaAttached: false,
    });

    await runJobStage(
      job("SHOPIFY_DRAFT_CREATING", {
        evidence: { qa: { verdict: "REJECTED" }, mockup: { heroUrl: "https://cdn/bad.jpg" } },
      })
    );

    expect(publishDraftProduct).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: undefined })
    );
  });
});

describe("runner — verification gate", () => {
  const verifiedSnapshot = {
    verified: true,
    productId: "gid://shopify/Product/3",
    checks: [],
    failures: [],
    snapshot: {
      title: "Tee",
      status: "DRAFT",
      handle: "tee",
      mediaCount: 1,
      variantCount: 1,
      optionNames: ["Color", "Size"],
      prices: ["32.00"],
      hasDescription: true,
    },
  };

  it("refuses to reach READY_FOR_APPROVAL without verified fulfillment", async () => {
    verifyDraftProduct.mockResolvedValue(verifiedSnapshot);

    const { outcome } = await runJobStage(
      job("VERIFYING", {
        shopifyProductId: "gid://shopify/Product/3",
        evidence: {
          artwork: { persistedUrl: "https://cdn/a.png", ephemeral: false, width: 3600, height: 3600, effectiveDpi: 300 },
          mockup: { status: "generated", heroUrl: "https://cdn/h.jpg", provenance: "provider_mockup" },
          qa: { deterministic: "PASS", vision: "PASS" },
          supplier: { catalogProductId: "71", variantIds: ["4016"], fulfillmentVerified: false },
          pricing: { marginPct: 63.5 },
        },
      })
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.suggestedState).toBe("FULFILLMENT_BLOCKED");
      expect(outcome.disposition).toBe("escalate");
    }
  });

  it("fails read-back rather than trusting the publish response", async () => {
    verifyDraftProduct.mockResolvedValue({
      ...verifiedSnapshot,
      verified: false,
      failures: ["MEDIA: 0"],
    });

    const { outcome } = await runJobStage(
      job("VERIFYING", { shopifyProductId: "gid://shopify/Product/3" })
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.suggestedState).toBe("PUBLISH_FAILED");
  });

  it("passes only when every gate is satisfied", async () => {
    verifyDraftProduct.mockResolvedValue(verifiedSnapshot);

    const { outcome } = await runJobStage(
      job("VERIFYING", {
        shopifyProductId: "gid://shopify/Product/3",
        evidence: {
          artwork: { persistedUrl: "https://cdn/a.png", ephemeral: false, width: 3600, height: 3600, effectiveDpi: 300 },
          mockup: { status: "generated", heroUrl: "https://cdn/h.jpg", provenance: "provider_mockup" },
          qa: { deterministic: "PASS", vision: "PASS" },
          supplier: { catalogProductId: "71", variantIds: ["4016"], fulfillmentVerified: true },
          pricing: { marginPct: 63.5 },
        },
      })
    );

    expect(outcome.ok).toBe(true);
    expect(completeStage).toHaveBeenCalledWith(
      expect.objectContaining({ from: "VERIFYING" })
    );
  });
});
