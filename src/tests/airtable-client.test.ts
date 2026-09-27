import { afterEach, describe, expect, it, vi } from "vitest";
import { AirtableNotConfiguredError, createAirtableRecords } from "@/integrations/airtable/client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AIRTABLE_API_KEY;
  delete process.env.AIRTABLE_BASE_ID;
});

describe("createAirtableRecords", () => {
  it("throws AirtableNotConfiguredError when no API key is set", async () => {
    await expect(createAirtableRecords("Affiliate_Links", [])).rejects.toThrow(
      AirtableNotConfiguredError
    );
  });

  it("posts records to the configured base and table, and returns created ids", async () => {
    process.env.AIRTABLE_API_KEY = "key123";
    process.env.AIRTABLE_BASE_ID = "appTest123";

    let capturedUrl = "";
    let capturedAuth = "";
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedAuth = (init.headers as Record<string, string>).Authorization ?? "";
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ records: [{ id: "rec1" }] }), { status: 200 });
      })
    );

    const result = await createAirtableRecords("Affiliate_Links", [
      { fields: { "Product/Content": "Fanatics" } },
    ]);

    expect(capturedUrl).toBe("https://api.airtable.com/v0/appTest123/Affiliate_Links");
    expect(capturedAuth).toBe("Bearer key123");
    expect(capturedBody).toEqual({
      records: [{ fields: { "Product/Content": "Fanatics" } }],
      typecast: true,
    });
    expect(result).toEqual([{ id: "rec1" }]);
  });

  it("throws a clear error including the response body on failure", async () => {
    process.env.AIRTABLE_API_KEY = "key123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request detail", { status: 422 })));

    await expect(createAirtableRecords("Affiliate_Links", [{ fields: {} }])).rejects.toThrow(
      /422.*bad request detail/s
    );
  });
});
