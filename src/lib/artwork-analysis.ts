// Artwork analysis.
//
// Two layers, on purpose:
//   1. Deterministic analysis computed from the file itself (always runs, never
//      fails): dimensions, aspect ratio, orientation, transparency, print-size
//      recommendation, DPI-based resolution warnings, placement recommendation.
//   2. Optional OpenAI vision pass that adds judgement: subject, dominant
//      colours, background detection, detected text, production warnings.
//
// Layer 2 is strictly additive. If OpenAI is unconfigured, rate-limited, slow
// or returns malformed JSON, the upload is preserved and the user continues
// with layer 1 plus a visible notice. AI never blocks the workflow.

import { z } from "zod";
import { CATALOG } from "./catalog";
import { env } from "./env";
import type { DetectedImage } from "./image";

export const aiAnalysisSchema = z.object({
  subject: z.string().max(200),
  style: z.string().max(120),
  dominantColors: z.array(z.string().max(24)).max(8),
  detectedText: z.array(z.string().max(120)).max(20),
  backgroundType: z.enum(["transparent", "solid", "photographic", "busy", "unknown"]),
  printSuitabilityScore: z.number().int().min(0).max(100),
  edgeOrCroppingConcerns: z.array(z.string().max(240)).max(6),
  productionWarnings: z.array(z.string().max(240)).max(8),
  recommendedProducts: z.array(z.string().max(60)).max(6),
  recommendedGarmentColors: z.array(z.string().max(40)).max(6),
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

export type DeterministicAnalysis = {
  width: number;
  height: number;
  aspectRatio: number;
  orientation: "portrait" | "landscape" | "square";
  hasTransparency: boolean;
  /** Largest print width in inches that still holds 150 DPI. */
  maxWidthIn150Dpi: number;
  recommendedPrintWidthIn: number;
  recommendedPrintAreaId: string;
  recommendedScale: number;
  lowResolution: boolean;
  warnings: string[];
};

export type ArtworkAnalysis = {
  deterministic: DeterministicAnalysis;
  ai: AiAnalysis | null;
  aiStatus: "ok" | "not_configured" | "failed";
  aiMessage?: string;
};

export function analyzeDeterministically(image: DetectedImage): DeterministicAnalysis {
  const aspectRatio = round2(image.width / image.height);
  const orientation =
    Math.abs(image.width - image.height) / Math.max(image.width, image.height) < 0.04
      ? "square"
      : image.width > image.height
        ? "landscape"
        : "portrait";

  const maxWidthIn150Dpi = round2(image.width / 150);
  // Default front print area is 12in wide; never recommend beyond what the
  // resolution supports, and cap portrait art by its height.
  const areaWidthIn = 12;
  const areaHeightIn = 16;
  const widthLimitedByHeight = (areaHeightIn * image.width) / image.height;
  const recommendedPrintWidthIn = round2(
    Math.min(maxWidthIn150Dpi, areaWidthIn, widthLimitedByHeight)
  );

  const warnings: string[] = [];
  const lowResolution = maxWidthIn150Dpi < 8;
  if (lowResolution) {
    warnings.push(
      `At 150 DPI this artwork can only print ${maxWidthIn150Dpi}in wide. For a full-front print (10–12in) upload at least ${Math.ceil(12 * 150)}px wide.`
    );
  }
  if (!image.hasAlpha) {
    warnings.push(
      "No transparent background detected. On black, charcoal or royal garments the artwork will print inside a visible rectangle."
    );
  }
  if (orientation === "landscape" && aspectRatio > 2.2) {
    warnings.push(
      "Very wide artwork — it will sit small on a center-chest placement. Consider a left-chest or back placement."
    );
  }

  return {
    width: image.width,
    height: image.height,
    aspectRatio,
    orientation,
    hasTransparency: image.hasAlpha,
    maxWidthIn150Dpi,
    recommendedPrintWidthIn,
    recommendedPrintAreaId: "front",
    recommendedScale: round2(Math.min(1, recommendedPrintWidthIn / areaWidthIn)),
    lowResolution,
    warnings,
  };
}

const SYSTEM_PROMPT = `You are a print-on-demand production analyst for VibeFlex Sports, an athletic apparel brand.
Analyse the supplied artwork for DTG (direct-to-garment) printing on apparel.
Be concrete and production-focused; never invent text that is not visible in the image.
Respond with JSON only, matching the requested schema exactly.`;

/** Never throws. Returns null with a status when the AI pass is unavailable. */
export async function analyzeWithAi(
  imageUrlOrDataUrl: string,
  deterministic: DeterministicAnalysis,
  options: { timeoutMs?: number } = {}
): Promise<{ ai: AiAnalysis | null; status: ArtworkAnalysis["aiStatus"]; message?: string }> {
  const apiKey = env.openaiApiKey();
  if (!apiKey) {
    return {
      ai: null,
      status: "not_configured",
      message: "OPENAI_API_KEY is not set — using measured file analysis only.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Artwork is ${deterministic.width}x${deterministic.height}px, ${deterministic.orientation}, transparency: ${deterministic.hasTransparency}.
Available products: ${CATALOG.map((p) => p.name).join(", ")}.
Available garment colours: Black, Charcoal, Royal Blue, White.

Return JSON with exactly these keys:
subject (string), style (string), dominantColors (array of hex strings),
detectedText (array of strings actually visible in the artwork),
backgroundType (one of: transparent, solid, photographic, busy, unknown),
printSuitabilityScore (integer 0-100),
edgeOrCroppingConcerns (array of strings),
productionWarnings (array of strings),
recommendedProducts (array of product names from the list),
recommendedGarmentColors (array of colour names from the list).`,
              },
              { type: "image_url", image_url: { url: imageUrlOrDataUrl, detail: "low" } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ai: null,
        status: "failed",
        message: `OpenAI returned ${res.status}. ${body.slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { ai: null, status: "failed", message: "OpenAI returned an empty response." };

    const parsed = aiAnalysisSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return {
        ai: null,
        status: "failed",
        message: `OpenAI response did not match the expected schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      };
    }

    return { ai: parsed.data, status: "ok" };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ai: null,
      status: "failed",
      message: aborted
        ? "Artwork analysis timed out — continuing without it."
        : err instanceof Error
          ? err.message
          : "Unknown analysis error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
