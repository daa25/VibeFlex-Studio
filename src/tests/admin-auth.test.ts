import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

afterEach(() => vi.unstubAllEnvs());
const request = (auth?: string) => new NextRequest("https://studio.example.com/api/studio/publish", {
  headers: auth ? { authorization: auth } : {},
});

describe("admin gate", () => {
  it.each(["", "   "])("fails closed with missing or blank configuration", (password) => {
    vi.stubEnv("STUDIO_ADMIN_PASSWORD", password);
    expect(middleware(request()).status).toBe(503);
  });
  it.each([undefined, "Basic !!!", `Basic ${btoa("vibeflex:wrong")}`])("rejects invalid credentials", (header) => {
    vi.stubEnv("STUDIO_ADMIN_PASSWORD", "test-password");
    expect(middleware(request(header)).status).toBe(401);
  });
  it("accepts the configured credentials", () => {
    vi.stubEnv("STUDIO_ADMIN_USER", "test-admin");
    vi.stubEnv("STUDIO_ADMIN_PASSWORD", "test:password");
    expect(middleware(request(`Basic ${btoa("test-admin:test:password")}`)).headers.get("x-middleware-next")).toBe("1");
  });
});
