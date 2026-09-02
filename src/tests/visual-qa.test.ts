import { describe, expect, it } from "vitest";
import { effectiveDpi, fitArtwork } from "@/lib/mockup-service";
import { runDeterministicQa, runVisualQa, visionToFindings } from "@/lib/visual-qa";

const blockers = (findings: { code: string; severity: string }[]) =>
  findings.filter((f) => f.severity === "blocker").map((f) => f.code);

describe("visual QA — deterministic", () => {
  it("rejects the raw print file being used as the product image", () => {
    const findings = runDeterministicQa({
      imageUrl: "https://cdn.example.com/artwork/original.png",
      provenance: "user_artwork",
    });
    expect(blockers(findings)).toContain("ARTWORK_USED_AS_PRODUCT_IMAGE");
  });

  it("rejects a camera-roll screenshot masquerading as a mockup", () => {
    const findings = runDeterministicQa({
      imageUrl: "https://cdn.shopify.com/s/files/1/x/files/IMG_2714.PNG",
      provenance: "unknown",
    });
    expect(blockers(findings)).toContain("SCREENSHOT_ARTIFACT");
  });

  it("rejects an image Shopify cannot fetch", () => {
    const findings = runDeterministicQa({
      imageUrl: "/api/uploads/2026/08/local.png",
      provenance: "provider_mockup",
    });
    expect(blockers(findings)).toContain("UNREACHABLE_ASSET");
  });

  it("rejects an undersized product image", () => {
    const findings = runDeterministicQa({
      imageUrl: "https://files.cdn.printful.com/m/hero.jpg",
      provenance: "provider_mockup",
      width: 400,
      height: 400,
    });
    expect(blockers(findings)).toContain("LOW_RESOLUTION");
  });

  it("passes a genuine supplier mockup with no blockers", () => {
    const findings = runDeterministicQa({
      imageUrl:
        "https://printful-upload.s3-accelerate.amazonaws.com/tmp/abc/unisex-staple-t-shirt-black-front.jpg",
      provenance: "provider_mockup",
      width: 1000,
      height: 1000,
      bytes: 180_000,
    });
    expect(blockers(findings)).toHaveLength(0);
  });

  it("flags an unverifiable host as a warning, not a blocker", () => {
    const findings = runDeterministicQa({
      imageUrl: "https://random-host.example/photo.jpg",
      provenance: "unknown",
      width: 1200,
      height: 1200,
    });
    expect(blockers(findings)).toHaveLength(0);
    expect(findings.map((f) => f.code)).toContain("UNTRUSTED_ASSET_SOURCE");
  });
});

describe("visual QA — vision findings", () => {
  it("treats a nested mockup as a blocker", () => {
    const findings = visionToFindings({
      isGarmentMockup: true,
      nestedMockup: true,
      screenshotArtifact: false,
      watermarkPresent: false,
      artworkDistorted: false,
      croppedOrCutOff: false,
      garmentColorMatches: true,
      observedGarmentType: "t-shirt",
      observedGarmentColor: "black",
      issues: [],
      usableAsHeroImage: false,
    });
    expect(blockers(findings)).toContain("NESTED_MOCKUP");
  });

  it("treats a colour mismatch as a warning, not a blocker", () => {
    const findings = visionToFindings({
      isGarmentMockup: true,
      nestedMockup: false,
      screenshotArtifact: false,
      watermarkPresent: false,
      artworkDistorted: false,
      croppedOrCutOff: false,
      garmentColorMatches: false,
      observedGarmentType: "t-shirt",
      observedGarmentColor: "navy",
      issues: [],
      usableAsHeroImage: true,
    });
    expect(blockers(findings)).toHaveLength(0);
    expect(findings.map((f) => f.code)).toContain("GARMENT_COLOR_MISMATCH");
  });
});

describe("visual QA — verdicts", () => {
  it("never returns PASS when nothing inspected the pixels", async () => {
    const result = await runVisualQa({
      imageUrl:
        "https://printful-upload.s3-accelerate.amazonaws.com/tmp/abc/beanie-black-front.jpg",
      provenance: "provider_mockup",
      width: 1000,
      height: 1000,
      useVision: false,
    });
    expect(result.verdict).toBe("PENDING");
  });

  it("rejects and raises the repair blocker for a print file", async () => {
    const result = await runVisualQa({
      imageUrl: "https://cdn.example.com/artwork/original.png",
      provenance: "user_artwork",
      useVision: false,
    });
    expect(result.verdict).toBe("REJECTED");
    expect(result.blocker).toBe("ASSET REQUIRED — STUDIO");
  });
});

describe("mockup placement geometry", () => {
  it("centres artwork in a wide strip print area (beanie cuff)", () => {
    const pos = fitArtwork({ width: 440, height: 438 }, { width: 1500, height: 525 }, "area");
    expect(pos.height).toBeLessThanOrEqual(525);
    expect(pos.left).toBe(Math.round((1500 - pos.width) / 2));
    // Vertically centred, not pinned to the top.
    expect(pos.top).toBe(Math.round((525 - pos.height) / 2));
  });

  it("places artwork at chest height on a tall apparel panel", () => {
    const pos = fitArtwork({ width: 1024, height: 1536 }, { width: 1800, height: 2400 }, "chest");
    expect(pos.top).toBe(Math.round(2400 * 0.08));
    expect(pos.height).toBeLessThanOrEqual(Math.round(2400 * 0.75));
  });

  it("never upscales beyond the print area", () => {
    const pos = fitArtwork({ width: 6000, height: 6000 }, { width: 1800, height: 2400 }, "chest");
    expect(pos.width).toBeLessThanOrEqual(1800);
    expect(pos.height).toBeLessThanOrEqual(2400);
  });

  it("computes effective DPI so low-res art can be blocked", () => {
    // 440px art rendered 527px wide inside a 300 DPI area -> ~250 DPI.
    expect(effectiveDpi(440, 527, 300)).toBe(250);
    // Upscaling drops effective DPI below the floor.
    expect(effectiveDpi(400, 1800, 150)).toBeLessThan(150);
  });
});
