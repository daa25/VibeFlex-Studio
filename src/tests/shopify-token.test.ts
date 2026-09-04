import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = { ...process.env };

async function loadToken() {
  vi.resetModules();
  return import("@/integrations/shopify/token");
}

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("shopify admin credential resolution", () => {
  it("reports what is missing when nothing is configured", async () => {
    delete process.env.SHOPIFY_SHOP_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
    const { adminAuthMode, adminConfigMissing } = await loadToken();

    expect(adminAuthMode()).toBe("none");
    expect(adminConfigMissing()).toEqual([
      "SHOPIFY_SHOP_DOMAIN",
      "SHOPIFY_ADMIN_API_ACCESS_TOKEN (or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)",
    ]);
  });

  it("accepts a static admin token of any prefix without a network call", async () => {
    process.env.SHOPIFY_SHOP_DOMAIN = "hbipmy-3g.myshopify.com";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "atkn_not_a_legacy_prefix";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { adminAuthMode, adminConfigMissing, getAdminAccessToken } = await loadToken();

    expect(adminAuthMode()).toBe("access_token");
    expect(adminConfigMissing()).toEqual([]);
    await expect(getAdminAccessToken()).resolves.toBe("atkn_not_a_legacy_prefix");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exchanges client credentials once and caches the result", async () => {
    process.env.SHOPIFY_SHOP_DOMAIN = "hbipmy-3g.myshopify.com";
    delete process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
    process.env.SHOPIFY_CLIENT_ID = "client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "client-secret";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "exchanged-token", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { adminAuthMode, getAdminAccessToken, resetAdminTokenCache } = await loadToken();

    expect(adminAuthMode()).toBe("client_credentials");
    await expect(getAdminAccessToken()).resolves.toBe("exchanged-token");
    await expect(getAdminAccessToken()).resolves.toBe("exchanged-token");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://hbipmy-3g.myshopify.com/admin/oauth/access_token");
    expect(JSON.parse(init.body as string).grant_type).toBe("client_credentials");

    resetAdminTokenCache();
    await getAdminAccessToken();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces a useful message when Shopify refuses the exchange", async () => {
    process.env.SHOPIFY_SHOP_DOMAIN = "hbipmy-3g.myshopify.com";
    delete process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
    process.env.SHOPIFY_CLIENT_ID = "client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "wrong-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid_client" })
    );
    const { getAdminAccessToken } = await loadToken();

    await expect(getAdminAccessToken()).rejects.toThrow(/client-credentials exchange \(401\)/);
  });
});
