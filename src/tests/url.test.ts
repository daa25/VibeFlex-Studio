import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicUrl } from "@/lib/url";

afterEach(() => vi.unstubAllEnvs());

describe("resolvePublicUrl", () => {
  it("passes an already-absolute https URL through unchanged", () => {
    expect(resolvePublicUrl("https://cdn.example.com/art.png")).toBe("https://cdn.example.com/art.png");
  });

  it("prefixes a relative local-fallback path with the public base URL", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://vibe-flex-studio.vercel.app");
    expect(resolvePublicUrl("/api/uploads/2026/09/art.png")).toBe(
      "https://vibe-flex-studio.vercel.app/api/uploads/2026/09/art.png"
    );
  });

  it("falls back to an empty prefix (leaving an unresolvable relative path) when no base URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(resolvePublicUrl("/api/uploads/art.png")).toBe("/api/uploads/art.png");
  });
});
