// Visual QA gate.
//
// This is the stage that stops a bad asset from becoming a live product image.
// It runs BEFORE anything is attached to a Shopify draft.
//
// Two layers, mirroring artwork-analysis:
//   1. Deterministic checks that always run and never call out to a model —
//      provenance (is this actually a supplier-rendered mockup?), resolution,
//      aspect ratio, reachability. These catch the failure that actually
//      happened in this catalogue: a screenshot of a product page, or the raw
//      artwork file, being used as the product photo.
//   2. An optional OpenAI vision pass that judges what a human would notice:
//      nested mockups, picture-of-picture, wrong garment/colour, distortion,
//      watermarks.
//
// Layer 2 never silently passes an image. If the model is unavailable the
// verdict degrades to PENDING (needs a human), never to PASS.

import { z } from "zod";
import { env } from "./env";

export type QaVerdict = "PENDING" | "PASS" | "REJECTED";

export type QaFinding = {
  code: string;
  severity: "blocker" | "warning";
  detail: string;
};

export type QaResult = {
  verdict: QaVerdict;
  findings: QaFinding[];
  checkedUrl: string;
  aiStatus: "ok" | "not_configured" | "failed" | "skipped";
  aiMessage?: string;
  /** Set when the verdict is REJECTED, for the repair queue. */
  blocker?: "ASSET REQUIRED — STUDIO";
};

/** Hosts we accept as genuine supplier/first-party render output. */
const TRUSTED_MOCKUP_HOSTS = [
  "printful-upload.s3-accelerate.amazonaws.com",
  "printful-upload.s3.amazonaws.com",
  "files.cdn.printful.com",
  "cdn.shopify.com",
];

/** Filename shapes that betray a screenshot or a re-photographed product page. */
const SCREENSHOT_PATTERNS = [
  /screen\s?shot/i,
  /screenshot/i,
  /\bIMG_\d{3,}/i,
  /\bPXL_\d{8}/i,
  /photo_\d+/i,
  /\bcapture\b/i,
];

export const qaVisionSchema = z.object({
  isGarmentMockup: z.boolean(),
  nestedMockup: z.boolean(),
  screenshotArtifact: z.boolean(),
  watermarkPresent: z.boolean(),
  artworkDistorted: z.boolean(),
  croppedOrCutOff: z.boolean(),
  garmentColorMatches: z.boolean(),
  observedGarmentType: z.string().max(60),
  observedGarmentColor: z.string().max(40),
  issues: z.array(z.string().max(240)).max(10),
  usableAsHeroImage: z.boolean(),
});

export type QaVision = z.infer<typeof qaVisionSchema>;

export type DeterministicQaInput = {
  imageUrl: string;
  /** Set when we know it came from a provider mockup task rather than an upload. */
  provenance: "provider_mockup" | "user_artwork" | "unknown";
  width?: number;
  height?: number;
  bytes?: number;
};

export function runDeterministicQa(input: DeterministicQaInput): QaFinding[] {
  const findings: QaFinding[] = [];
  const url = input.imageUrl;

  if (!/^https:\/\//.test(url)) {
    findings.push({
      code: "UNREACHABLE_ASSET",
      severity: "blocker",
      detail: "Image is not a public https URL, so Shopify cannot ingest it.",
    });
  }

  // The core rule: raw artwork is a PRINT FILE, never a product photo.
  if (input.provenance === "user_artwork") {
    findings.push({
      code: "ARTWORK_USED_AS_PRODUCT_IMAGE",
      severity: "blocker",
      detail:
        "This is the uploaded print file, not a garment mockup. Print files must never be used as the customer-facing product image.",
    });
  }

  if (input.provenance === "unknown") {
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      /* handled by UNREACHABLE_ASSET above */
    }
    if (host && !TRUSTED_MOCKUP_HOSTS.includes(host)) {
      findings.push({
        code: "UNTRUSTED_ASSET_SOURCE",
        severity: "warning",
        detail: `Image is served from ${host}, which is not a known supplier or Shopify CDN host. Provenance could not be confirmed.`,
      });
    }
  }

  const name = decodeURIComponent(url.split("/").pop() ?? "");
  if (SCREENSHOT_PATTERNS.some((re) => re.test(name))) {
    findings.push({
      code: "SCREENSHOT_ARTIFACT",
      severity: "blocker",
      detail: `Filename "${name}" looks like a screenshot or camera roll photo rather than a rendered mockup.`,
    });
  }

  if (input.width && input.height) {
    if (input.width < 800 || input.height < 800) {
      findings.push({
        code: "LOW_RESOLUTION",
        severity: "blocker",
        detail: `Image is ${input.width}x${input.height}px. Shopify product images should be at least 800x800.`,
      });
    }
    const ratio = input.width / input.height;
    if (ratio < 0.5 || ratio > 2) {
      findings.push({
        code: "EXTREME_ASPECT_RATIO",
        severity: "warning",
        detail: `Aspect ratio ${ratio.toFixed(2)} is far from square and will crop badly in product grids.`,
      });
    }
  }

  if (input.bytes !== undefined && input.bytes < 15_000) {
    findings.push({
      code: "SUSPICIOUSLY_SMALL_FILE",
      severity: "warning",
      detail: `Image is only ${Math.round(input.bytes / 1024)}KB — likely a thumbnail rather than a full-size render.`,
    });
  }

  return findings;
}

const QA_SYSTEM_PROMPT = `You are a product-image QA inspector for an apparel brand.
You are shown ONE image that is proposed as the main storefront photo for a product.
Judge only what is visible. Do not speculate.
A valid image is a clean render or photo of the garment itself.
An INVALID image includes: a screenshot of a website or app, a photo of a screen,
a mockup displayed inside another mockup, a product-card or listing grid,
a watermarked image, a distorted or stretched print, or artwork with no garment.
Respond with JSON only.`;

/** Never throws. Returns null with a status when the vision pass is unavailable. */
export async function inspectWithVision(
  imageUrl: string,
  expected: { garmentType?: string; garmentColor?: string } = {},
  options: { timeoutMs?: number } = {}
): Promise<{ vision: QaVision | null; status: QaResult["aiStatus"]; message?: string }> {
  const apiKey = env.openaiApiKey();
  if (!apiKey) {
    return {
      vision: null,
      status: "not_configured",
      message: "OPENAI_API_KEY is not set — visual QA ran deterministic checks only.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: QA_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Expected garment: ${expected.garmentType ?? "unknown"}. Expected colour: ${expected.garmentColor ?? "unknown"}.

Return JSON with exactly these keys:
isGarmentMockup (boolean), nestedMockup (boolean), screenshotArtifact (boolean),
watermarkPresent (boolean), artworkDistorted (boolean), croppedOrCutOff (boolean),
garmentColorMatches (boolean), observedGarmentType (string), observedGarmentColor (string),
issues (array of strings), usableAsHeroImage (boolean).`,
              },
              { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { vision: null, status: "failed", message: `OpenAI returned ${res.status}. ${body.slice(0, 200)}` };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { vision: null, status: "failed", message: "OpenAI returned an empty response." };

    const parsed = qaVisionSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return {
        vision: null,
        status: "failed",
        message: `QA response did not match the expected schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      };
    }

    return { vision: parsed.data, status: "ok" };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      vision: null,
      status: "failed",
      message: aborted ? "Visual QA timed out." : err instanceof Error ? err.message : "Unknown QA error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function visionToFindings(vision: QaVision): QaFinding[] {
  const findings: QaFinding[] = [];
  const blocker = (code: string, detail: string) =>
    findings.push({ code, severity: "blocker" as const, detail });

  if (!vision.isGarmentMockup) blocker("NOT_A_GARMENT_MOCKUP", "The image does not show the garment.");
  if (vision.nestedMockup) blocker("NESTED_MOCKUP", "A mockup is displayed inside another mockup.");
  if (vision.screenshotArtifact) blocker("SCREENSHOT_ARTIFACT", "The image is a screenshot or a photo of a screen.");
  if (vision.watermarkPresent) blocker("WATERMARK", "A watermark is visible.");
  if (vision.artworkDistorted) blocker("ARTWORK_DISTORTED", "The printed artwork is stretched or distorted.");
  if (vision.croppedOrCutOff) {
    findings.push({
      code: "BROKEN_CROP",
      severity: "warning",
      detail: "The garment or artwork appears cut off at the frame edge.",
    });
  }
  if (!vision.garmentColorMatches) {
    findings.push({
      code: "GARMENT_COLOR_MISMATCH",
      severity: "warning",
      detail: `Observed garment colour "${vision.observedGarmentColor}" does not match the expected colour.`,
    });
  }
  if (!vision.usableAsHeroImage && findings.length === 0) {
    blocker("NOT_HERO_USABLE", `Inspector rejected the image: ${vision.issues.join("; ") || "no reason given"}`);
  }
  for (const issue of vision.issues) {
    if (!findings.some((f) => f.detail === issue)) {
      findings.push({ code: "INSPECTOR_NOTE", severity: "warning", detail: issue });
    }
  }
  return findings;
}

/**
 * Full QA gate. Deterministic checks always run; the vision pass is additive.
 *
 * Verdict rules:
 *   REJECTED — any blocker finding.
 *   PASS     — no blockers AND the vision pass actually ran and approved.
 *   PENDING  — no blockers, but nothing competent has looked at the pixels yet.
 *              PENDING is not a pass; it means a human still has to decide.
 */
export async function runVisualQa(params: {
  imageUrl: string;
  provenance: DeterministicQaInput["provenance"];
  width?: number;
  height?: number;
  bytes?: number;
  expected?: { garmentType?: string; garmentColor?: string };
  useVision?: boolean;
}): Promise<QaResult> {
  const findings = runDeterministicQa({
    imageUrl: params.imageUrl,
    provenance: params.provenance,
    width: params.width,
    height: params.height,
    bytes: params.bytes,
  });

  let aiStatus: QaResult["aiStatus"] = "skipped";
  let aiMessage: string | undefined;

  // Don't spend a vision call on something already disqualified.
  const alreadyRejected = findings.some((f) => f.severity === "blocker");
  if (params.useVision !== false && !alreadyRejected) {
    const { vision, status, message } = await inspectWithVision(params.imageUrl, params.expected ?? {});
    aiStatus = status;
    aiMessage = message;
    if (vision) findings.push(...visionToFindings(vision));
  }

  const hasBlocker = findings.some((f) => f.severity === "blocker");
  const verdict: QaVerdict = hasBlocker ? "REJECTED" : aiStatus === "ok" ? "PASS" : "PENDING";

  return {
    verdict,
    findings,
    checkedUrl: params.imageUrl,
    aiStatus,
    aiMessage,
    ...(verdict === "REJECTED" ? { blocker: "ASSET REQUIRED — STUDIO" as const } : {}),
  };
}
