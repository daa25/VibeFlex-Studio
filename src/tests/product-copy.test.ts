import { afterEach, describe, expect, it, vi } from "vitest";
import { generateProductCopy } from "@/lib/product-copy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const input = { brandName: "VibeFlex Sports", garmentLabel: "Hoodie", blueprintTitle: "Gildan 18500" };

describe("generateProductCopy", () => {
  it("falls back to a deterministic template when OPENAI_API_KEY is unset, never blocking creation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateProductCopy(input);

    expect(result.source).toBe("fallback");
    expect(result.copy.title).toContain("VibeFlex Sports");
    expect(result.copy.title).toContain("Hoodie");
    expect(result.copy.descriptionHtml).toContain("Gildan 18500");
    expect(result.copy.seoTitle.length).toBeLessThanOrEqual(70);
  });

  it("uses OpenAI's real copy when configured and the response validates", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Rebuilt Different Hoodie",
                  descriptionHtml: "<p>Real copy.</p>",
                  seoTitle: "Rebuilt Different Hoodie",
                  metaDescription: "A hoodie about being rebuilt different.",
                }),
              },
            },
          ],
        }),
      }))
    );

    const result = await generateProductCopy(input);
    expect(result.source).toBe("ai");
    expect(result.copy.title).toBe("Rebuilt Different Hoodie");
  });

  it("falls back when OpenAI returns malformed JSON, rather than throwing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: "only a title" }) } }] }),
      }))
    );

    const result = await generateProductCopy(input);
    expect(result.source).toBe("fallback");
    expect(result.message).toMatch(/schema/i);
  });

  it("falls back on a non-2xx OpenAI response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, text: async () => "rate limited" })));

    const result = await generateProductCopy(input);
    expect(result.source).toBe("fallback");
    expect(result.message).toContain("429");
  });
});
