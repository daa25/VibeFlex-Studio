// AI-assisted product copywriting for the auto-create pipeline.
//
// Same never-throw, additive pattern as artwork-analysis.ts's analyzeWithAi:
// OpenAI writes real title/description/SEO copy when configured; an
// unconfigured, rate-limited, slow, or malformed response falls back to a
// deterministic template rather than blocking product creation.

import { z } from "zod";
import { env } from "./env";
import type { AiAnalysis } from "./artwork-analysis";

export const productCopySchema = z.object({
  title: z.string().max(140),
  descriptionHtml: z.string().max(4000),
  seoTitle: z.string().max(70),
  metaDescription: z.string().max(320),
});

export type ProductCopy = z.infer<typeof productCopySchema>;

export type ProductCopyResult = {
  copy: ProductCopy;
  source: "ai" | "fallback";
  message?: string;
};

export type ProductCopyInput = {
  brandName: string;
  garmentLabel: string; // e.g. "Tee", "Hoodie"
  blueprintTitle: string; // real Printify blueprint name, e.g. "Unisex Heavy Blend Hooded Sweatshirt"
  analysis?: AiAnalysis | null; // subject/style/colors from the upload's own vision analysis, if any
};

const SYSTEM_PROMPT = `You are a product copywriter for a print-on-demand athletic apparel brand.
Write concrete, honest copy for a real garment with a custom print — never invent fabric
details, certifications, or claims not implied by the inputs. Respond with JSON only,
matching the requested schema exactly.`;

export async function generateProductCopy(input: ProductCopyInput): Promise<ProductCopyResult> {
  const apiKey = env.openaiApiKey();
  if (!apiKey) {
    return { copy: fallbackCopy(input), source: "fallback", message: "OPENAI_API_KEY is not set." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Brand: ${input.brandName}
Garment: ${input.garmentLabel} (real blank: ${input.blueprintTitle})
${input.analysis ? describeAnalysis(input.analysis) : "No artwork analysis available."}

Return JSON with exactly these keys:
title (product title, <=140 chars, include the brand and garment),
descriptionHtml (2-4 short paragraphs or a short paragraph plus a bullet list, basic HTML tags only: p, ul, li, strong),
seoTitle (<=70 chars),
metaDescription (<=320 chars, plain text, no HTML).`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        copy: fallbackCopy(input),
        source: "fallback",
        message: `OpenAI returned ${res.status}. ${body.slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return { copy: fallbackCopy(input), source: "fallback", message: "OpenAI returned an empty response." };
    }

    const parsed = productCopySchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return {
        copy: fallbackCopy(input),
        source: "fallback",
        message: `OpenAI response did not match the expected schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      };
    }

    return { copy: parsed.data, source: "ai" };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      copy: fallbackCopy(input),
      source: "fallback",
      message: aborted ? "Copy generation timed out." : err instanceof Error ? err.message : "Unknown copy-generation error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function describeAnalysis(analysis: AiAnalysis): string {
  return `Artwork subject: ${analysis.subject}
Style: ${analysis.style}
Dominant colors: ${analysis.dominantColors.join(", ") || "n/a"}`;
}

function fallbackCopy(input: ProductCopyInput): ProductCopy {
  const title = `${input.brandName} ${input.garmentLabel}`;
  const subject = input.analysis?.subject;
  return {
    title,
    descriptionHtml: [
      `<p>${escapeHtml(title)} — printed to order on a ${escapeHtml(input.blueprintTitle)}.</p>`,
      `<ul>`,
      `<li><strong>Print method:</strong> DTG, made to order</li>`,
      subject ? `<li><strong>Design:</strong> ${escapeHtml(subject)}</li>` : "",
      `</ul>`,
      `<p>Printed and shipped on demand. Allow 2–5 business days for production.</p>`,
    ]
      .filter(Boolean)
      .join(""),
    seoTitle: title.slice(0, 70),
    metaDescription: `${title}, printed to order on a ${input.blueprintTitle}.`.slice(0, 320),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
