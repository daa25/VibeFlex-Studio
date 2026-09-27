"use client";

import { useState } from "react";
import type { UploadResponse } from "../types";

type GarmentResult = {
  slug: string;
  garmentLabel: string;
  blueprintId?: string;
  blueprintTitle?: string;
  printify?: { productId: string; variantCount: number };
  shopify?: { productId: string; adminUrl: string; mediaAttached: boolean; mediaWarning?: string };
  copySource?: "ai" | "fallback";
  skippedReason?: string;
  shopifyError?: string;
};

type AutoCreateResponse = {
  reference: string;
  artworkUrl: string;
  results: GarmentResult[];
  note: string;
};

type Phase = "idle" | "uploading" | "creating" | "done" | "error";

export function AutoCreateClient() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [result, setResult] = useState<AutoCreateResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function onFile(file: File) {
    setFileName(file.name);
    setError(null);
    setResult(null);
    setPhase("uploading");

    try {
      const body = new FormData();
      body.append("file", file);
      const uploadRes = await fetch("/api/uploads", { method: "POST", body });
      const uploadJson = (await uploadRes.json()) as UploadResponse & { error?: string };
      if (!uploadRes.ok || uploadJson.error) {
        throw new Error(uploadJson.error ?? "Upload failed.");
      }
      setUpload(uploadJson);

      setPhase("creating");
      const createRes = await fetch("/api/studio/auto-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artwork: uploadJson.artwork, analysis: { ai: uploadJson.analysis.ai } }),
      });
      const createJson = (await createRes.json()) as AutoCreateResponse & { error?: string };
      if (!createRes.ok || createJson.error) {
        throw new Error(createJson.error ?? "Product creation failed.");
      }
      setResult(createJson);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  return (
    <div className="space-y-6">
      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-slate-400"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
        <span className="text-sm font-medium text-slate-700">
          {fileName ?? "Drop artwork here or click to choose a file"}
        </span>
        <span className="mt-1 text-xs text-slate-500">PNG with a transparent background works best</span>
      </label>

      {phase === "uploading" && <StatusLine>Uploading artwork…</StatusLine>}
      {phase === "creating" && (
        <StatusLine>Matching Printify blueprints, creating products, writing copy…</StatusLine>
      )}
      {phase === "error" && error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {upload && (
        <div className="rounded-lg bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
          {upload.storage.warning ? (
            <p className="text-amber-600">{upload.storage.warning}</p>
          ) : (
            <p>Artwork stored ({upload.storage.provider}), {upload.artwork.width}×{upload.artwork.height}px.</p>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{result.note}</p>
          {result.results.map((r) => (
            <GarmentCard key={r.slug} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function GarmentCard({ result }: { result: GarmentResult }) {
  if (result.skippedReason) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">{result.garmentLabel} — skipped</p>
        <p className="mt-1 text-xs text-slate-500">{result.skippedReason}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{result.garmentLabel}</p>
        <span className="text-xs text-slate-400">
          {result.copySource === "ai" ? "AI copy" : "template copy"}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Real blank: {result.blueprintTitle} ({result.printify?.variantCount ?? 0} variants)
      </p>
      {result.shopify ? (
        <a
          href={result.shopify.adminUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline"
        >
          View Shopify draft →
        </a>
      ) : (
        <p className="mt-2 text-xs text-red-600">
          Created in Printify, but the Shopify draft failed: {result.shopifyError}
        </p>
      )}
      {result.shopify?.mediaWarning && (
        <p className="mt-1 text-xs text-amber-600">{result.shopify.mediaWarning}</p>
      )}
    </div>
  );
}

function StatusLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-600">{children}</p>;
}
