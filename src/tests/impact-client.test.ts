import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateDeepLink,
  getPublisherPerformanceReport,
} from "@/integrations/impact/client";

const CREDS = { accountSid: "sid123", authToken: "token456" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("getPublisherPerformanceReport", () => {
  it("sends Basic Auth built from AccountSID:AuthToken and returns the report rows", async () => {
    let capturedAuth: string | null = null;
    stubFetch(async (url, init) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? null;
      expect(url).toContain(`/Mediapartners/${CREDS.accountSid}/Reports/`);
      return new Response(
        JSON.stringify({ Records: [{ campaignId: "1", clicks: 10, actions: 2, payout: 5.5 }] }),
        { status: 200 }
      );
    });

    const rows = await getPublisherPerformanceReport(CREDS);

    expect(capturedAuth).toBe(
      "Basic " + Buffer.from(`${CREDS.accountSid}:${CREDS.authToken}`).toString("base64")
    );
    expect(rows).toEqual([{ campaignId: "1", clicks: 10, actions: 2, payout: 5.5 }]);
  });

  it("returns an empty array when the report has no records", async () => {
    stubFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    expect(await getPublisherPerformanceReport(CREDS)).toEqual([]);
  });

  it("throws a clear error on 401/403 rather than a generic fetch failure", async () => {
    stubFetch(async () => new Response("denied", { status: 401 }));
    await expect(getPublisherPerformanceReport(CREDS)).rejects.toThrow(/rejected the credentials/i);
  });

  it("throws on other non-2xx responses with the response body included", async () => {
    stubFetch(async () => new Response("rate limited", { status: 429 }));
    await expect(getPublisherPerformanceReport(CREDS)).rejects.toThrow(/429/);
  });
});

describe("generateDeepLink", () => {
  it("posts the destination URL and returns Impact's real TrackingURL", async () => {
    stubFetch(async (url, init) => {
      expect(url).toContain("/Ads/camp-1/Links");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init!.body as string)).toEqual({ Url: "https://example.com/product" });
      return new Response(JSON.stringify({ TrackingURL: "https://imp.example/xyz" }), { status: 200 });
    });

    const link = await generateDeepLink(CREDS, {
      campaignId: "camp-1",
      destinationUrl: "https://example.com/product",
    });

    expect(link).toBe("https://imp.example/xyz");
  });

  it("never fabricates a tracking URL when Impact's response omits one", async () => {
    stubFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(
      generateDeepLink(CREDS, { campaignId: "camp-1", destinationUrl: "https://example.com" })
    ).rejects.toThrow(/no TrackingURL/i);
  });
});
