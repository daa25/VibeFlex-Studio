import { afterEach, describe, expect, it } from "vitest";
import { getConfiguredProductionProviders } from "@/lib/fulfillment/production-runtime";

const PRINTIFY_VARS = ["PRINTIFY_API_KEY", "PRINTIFY_SHOP_ID"] as const;
const PRINTFUL_VARS = ["PRINTFUL_API_KEY", "PRINTFUL_STORE_ID"] as const;

function clearEnv(vars: readonly string[]) {
  for (const key of vars) delete process.env[key];
}

afterEach(() => {
  clearEnv(PRINTIFY_VARS);
  clearEnv(PRINTFUL_VARS);
});

describe("getConfiguredProductionProviders — env-gated, nothing throws on missing config", () => {
  it("registers only the in-house line when no external credentials are set", () => {
    const providers = getConfiguredProductionProviders();
    expect(providers.map((p) => p.providerName)).toEqual(["vibeflex-local"]);
  });

  it("registers Printify once both PRINTIFY_API_KEY and PRINTIFY_SHOP_ID are set", () => {
    process.env.PRINTIFY_API_KEY = "key";
    process.env.PRINTIFY_SHOP_ID = "shop-1";

    const providers = getConfiguredProductionProviders();
    expect(providers.map((p) => p.providerName)).toEqual(["vibeflex-local", "printify"]);
  });

  it("does not register Printify with only one of the two required variables", () => {
    process.env.PRINTIFY_API_KEY = "key";
    // PRINTIFY_SHOP_ID intentionally unset.

    const providers = getConfiguredProductionProviders();
    expect(providers.map((p) => p.providerName)).toEqual(["vibeflex-local"]);
  });

  it("does not register Printful when its credentials are absent, even if Printify's are present", () => {
    process.env.PRINTIFY_API_KEY = "key";
    process.env.PRINTIFY_SHOP_ID = "shop-1";

    const providers = getConfiguredProductionProviders();
    expect(providers.some((p) => p.providerName === "printful")).toBe(false);
  });
});
