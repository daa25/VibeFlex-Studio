import { afterEach, describe, expect, it, vi } from "vitest";
import { removeBackgroundFromUrl } from "@/lib/background-removal";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("removeBackgroundFromUrl", () => {
  it("returns a clear not-configured failure rather than throwing when REMOVEBG_API_KEY is unset", async () => {
    vi.stubEnv("REMOVEBG_API_KEY", "");
    const result = await removeBackgroundFromUrl("https://cdn.example.com/art.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/REMOVEBG_API_KEY/);
  });

  it("sends the image_url and api key, returning the raw PNG bytes on success", async () => {
    vi.stubEnv("REMOVEBG_API_KEY", "rb-test-key");
    let capturedHeaders: Record<string, string> = {};
    let capturedForm: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        capturedForm = init.body as FormData;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        } as unknown as Response;
      })
    );

    const result = await removeBackgroundFromUrl("https://cdn.example.com/art.png");

    expect(capturedHeaders["X-Api-Key"]).toBe("rb-test-key");
    expect(capturedForm!.get("image_url")).toBe("https://cdn.example.com/art.png");
    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.bytes)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("surfaces remove.bg's own error title rather than a generic status message", async () => {
    vi.stubEnv("REMOVEBG_API_KEY", "rb-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ errors: [{ title: "Insufficient credits" }] }),
      }))
    );

    const result = await removeBackgroundFromUrl("https://cdn.example.com/art.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Insufficient credits");
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    vi.stubEnv("REMOVEBG_API_KEY", "rb-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "oops" })));

    const result = await removeBackgroundFromUrl("https://cdn.example.com/art.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("500");
  });
});
