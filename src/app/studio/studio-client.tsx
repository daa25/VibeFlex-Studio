"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GarmentSvg } from "@/components/garment";
import type { CatalogProduct } from "@/lib/catalog";
import { calculatePrice } from "@/lib/pricing";
import { clampPlacement } from "@/lib/design";
import { PlacementEditor } from "./placement-editor";
import type { UploadResponse, Artwork, StudioStep } from "./types";
import { STEPS } from "./types";

const DRAFT_KEY = "vibeflex-studio-draft-v1";

type Props = {
  products: CatalogProduct[];
  catalogMode: "live" | "mock";
  persistentStorage: boolean;
  shopifyReady: boolean;
};

type SavedDraft = {
  productId: string;
  colorId: string;
  sizeId: string;
  quantity: number;
  printAreaId: string;
  placement: { centerX: number; centerY: number; scale: number; rotation: number };
  artwork: Artwork | null;
  analysis: UploadResponse["analysis"] | null;
  storage: UploadResponse["storage"] | null;
};

export function StudioClient({ products, catalogMode, persistentStorage, shopifyReady }: Props) {
  const [step, setStep] = useState<StudioStep>("upload");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [colorId, setColorId] = useState(products[0]?.colors[0]?.id ?? "");
  const [sizeId, setSizeId] = useState("L");
  const [quantity, setQuantity] = useState(1);
  const [printAreaId, setPrintAreaId] = useState(products[0]?.printAreas[0]?.id ?? "front");
  const [rawPlacement, setPlacement] = useState({ centerX: 0.5, centerY: 0.42, scale: 0.7, rotation: 0 });

  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [analysis, setAnalysis] = useState<UploadResponse["analysis"] | null>(null);
  const [storage, setStorage] = useState<UploadResponse["storage"] | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "publishing" | "carting">("idle");
  const [result, setResult] = useState<{ kind: "saved" | "published" | "cart"; message: string; url?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? products[0],
    [products, productId]
  );
  const color = product?.colors.find((c) => c.id === colorId) ?? product?.colors[0];
  const printArea = product?.printAreas.find((a) => a.id === printAreaId) ?? product?.printAreas[0];

  // Every placement the rest of the UI sees is already constrained to the print
  // area, so the customer cannot build a configuration the server would reject.
  const placement = useMemo(
    () => (artwork && printArea ? clampPlacement(rawPlacement, printArea, artwork) : rawPlacement),
    [rawPlacement, printArea, artwork]
  );

  // ---- draft persistence (survives refresh) --------------------------------
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as SavedDraft;
      if (draft.productId && products.some((p) => p.id === draft.productId)) setProductId(draft.productId);
      if (draft.colorId) setColorId(draft.colorId);
      if (draft.sizeId) setSizeId(draft.sizeId);
      if (draft.quantity) setQuantity(draft.quantity);
      if (draft.printAreaId) setPrintAreaId(draft.printAreaId);
      if (draft.placement) setPlacement(draft.placement);
      if (draft.artwork) {
        setArtwork(draft.artwork);
        setAnalysis(draft.analysis);
        setStorage(draft.storage);
        setStep("configure");
        setRestored(true);
      }
    } catch {
      /* a corrupt draft must never break the studio */
    }
  }, [products]);

  useEffect(() => {
    if (!artwork) return;
    const draft: SavedDraft = {
      productId, colorId, sizeId, quantity, printAreaId, placement, artwork, analysis, storage,
    };
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full or blocked — non-fatal */
    }
  }, [artwork, analysis, storage, productId, colorId, sizeId, quantity, printAreaId, placement]);

  // Keep colour/size/placement valid when the product changes.
  useEffect(() => {
    if (!product) return;
    if (!product.colors.some((c) => c.id === colorId)) setColorId(product.colors[0]!.id);
    if (!product.sizes.some((s) => s.id === sizeId)) setSizeId(product.sizes[0]!.id);
    if (!product.printAreas.some((a) => a.id === printAreaId)) setPrintAreaId(product.printAreas[0]!.id);
  }, [product, colorId, sizeId, printAreaId]);

  // ---- upload --------------------------------------------------------------
  const upload = useCallback((file: File) => {
    setUploadError(null);
    setResult(null);
    setUploadProgress(0);

    const body = new FormData();
    body.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 90));
    };
    xhr.onload = () => {
      setUploadProgress(null);
      let payload: UploadResponse & { error?: string };
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        setUploadError("The server returned an unreadable response. Please try again.");
        return;
      }
      if (xhr.status >= 400 || payload.error) {
        setUploadError(payload.error ?? `Upload failed (${xhr.status}).`);
        return;
      }
      setArtwork(payload.artwork);
      setAnalysis(payload.analysis);
      setStorage(payload.storage);
      setRestored(false);
      const rec = payload.analysis?.deterministic;
      if (rec) {
        setPlacement((p) => ({ ...p, scale: Math.max(0.2, Math.min(1, rec.recommendedScale || p.scale)) }));
      }
      setStep("configure");
    };
    xhr.onerror = () => {
      setUploadProgress(null);
      setUploadError("Network error during upload. Check your connection and try again.");
    };
    xhr.send(body);
  }, []);

  const pricing = useMemo(() => {
    if (!product) return null;
    try {
      return calculatePrice({ product, sizeId, printAreaIds: [printAreaId], quantity });
    } catch {
      return null;
    }
  }, [product, sizeId, printAreaId, quantity]);

  const designConfig = useMemo(() => {
    if (!artwork || !product) return null;
    return {
      productId: product.id,
      colorId,
      sizeId,
      quantity,
      artwork,
      placements: [{ printAreaId, ...placement }],
    };
  }, [artwork, product, colorId, sizeId, quantity, printAreaId, placement]);

  const idempotencyKey = useRef(cryptoRandom());

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json } as {
      ok: boolean;
      status: number;
      json: Record<string, unknown>;
    };
  }

  async function saveDesign() {
    if (!designConfig) return;
    setSubmitState("saving");
    setActionError(null);
    const { ok, json } = await post("/api/studio/designs", designConfig);
    setSubmitState("idle");
    if (!ok) {
      setActionError(String(json.error ?? "Could not save this design."));
      return;
    }
    setResult({
      kind: "saved",
      message: `Design saved as ${json.reference}. ${
        (json.persistence as { persisted?: boolean })?.persisted
          ? "Stored in the database."
          : "Not stored — the database is not configured yet."
      }`,
    });
  }

  async function publishDraft() {
    if (!designConfig) return;
    setSubmitState("publishing");
    setActionError(null);
    const { ok, json } = await post("/api/studio/publish", { design: designConfig });
    setSubmitState("idle");
    if (!ok) {
      const missing = (json.missingEnv as string[] | undefined)?.join(", ");
      setActionError(
        `${json.error ?? "Publishing failed."}${missing ? ` Missing: ${missing}.` : ""}${
          json.howToFix ? ` ${json.howToFix}` : ""
        }`
      );
      return;
    }
    const shopify = json.shopify as { adminUrl: string; status: string };
    setResult({
      kind: "published",
      message: `Created Shopify ${shopify.status.toLowerCase()} product for ${json.reference}.`,
      url: shopify.adminUrl,
    });
  }

  async function addToCart() {
    if (!designConfig) return;
    setSubmitState("carting");
    setActionError(null);
    const { ok, json } = await post("/api/studio/cart", { design: designConfig });
    setSubmitState("idle");
    if (!ok) {
      setActionError(String(json.error ?? "Could not create a checkout."));
      return;
    }
    const cart = json.cart as { checkoutUrl: string };
    setResult({ kind: "cart", message: "Checkout ready.", url: cart.checkoutUrl });
  }

  if (!product || !color || !printArea) {
    return <p className="text-neutral-400">No products are available in the catalog.</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ---------------- preview column ---------------- */}
      <section className="order-1 lg:order-2">
        <div className="sticky top-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
          <PlacementEditor
            product={product}
            colorHex={color.hex}
            printArea={printArea}
            artworkUrl={artwork?.url ?? null}
            artworkAspect={artwork ? artwork.height / artwork.width : 1}
            placement={placement}
            onChange={setPlacement}
            renderGarment={(hex) => (
              <GarmentSvg silhouette={product.silhouette} color={hex} className="h-full w-full" />
            )}
          />
          <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
            <span>
              {product.name} · {color.label} · {printArea.label}
            </span>
            <span>{catalogMode === "live" ? "Live catalog" : "Demo catalog"}</span>
          </div>
        </div>
      </section>

      {/* ---------------- controls column ---------------- */}
      <section className="order-2 flex flex-col gap-5 lg:order-1">
        <Stepper current={step} onSelect={(s) => (artwork || s === "upload") && setStep(s)} />

        {step === "upload" && (
          <UploadPanel
            onFile={upload}
            progress={uploadProgress}
            error={uploadError}
            persistentStorage={persistentStorage}
          />
        )}

        {step !== "upload" && artwork && (
          <>
            {restored && (
              <p className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
                Restored your last design from this browser.
              </p>
            )}
            {storage?.warning && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {storage.warning}
              </p>
            )}

            <AnalysisPanel analysis={analysis} />

            <Panel title="Product">
              <div className="grid gap-2 sm:grid-cols-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProductId(p.id)}
                    className={`rounded-xl border p-3 text-left transition ${
                      p.id === product.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-neutral-800 hover:border-neutral-600"
                    }`}
                  >
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      from ${p.baseCostUsd.toFixed(2)} cost
                    </span>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Colour">
              <div className="flex flex-wrap gap-2">
                {product.colors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setColorId(c.id)}
                    aria-label={c.label}
                    aria-pressed={c.id === color.id}
                    title={c.label}
                    className={`h-10 w-10 rounded-full border-2 transition ${
                      c.id === color.id ? "border-blue-400 ring-2 ring-blue-400/30" : "border-neutral-700"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="Size">
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSizeId(s.id)}
                    className={`min-w-[3rem] rounded-lg border px-3 py-2 text-sm transition ${
                      s.id === sizeId
                        ? "border-blue-500 bg-blue-500/10 text-white"
                        : "border-neutral-800 text-neutral-300 hover:border-neutral-600"
                    }`}
                  >
                    {s.label}
                    {s.costUpchargeUsd > 0 && (
                      <span className="ml-1 text-[10px] text-neutral-500">+</span>
                    )}
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Placement">
              <div className="flex flex-wrap gap-2">
                {product.printAreas.map((area) => (
                  <button
                    key={area.id}
                    onClick={() => setPrintAreaId(area.id)}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      area.id === printArea.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-neutral-800 hover:border-neutral-600"
                    }`}
                  >
                    {area.label}
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-xs text-neutral-400">
                Size on garment — {(placement.scale * printArea.widthIn).toFixed(1)} in wide
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.01}
                  value={placement.scale}
                  onChange={(e) => setPlacement((p) => ({ ...p, scale: Number(e.target.value) }))}
                  className="mt-2 w-full accent-blue-500"
                />
              </label>
              <label className="mt-3 block text-xs text-neutral-400">
                Rotation — {placement.rotation}°
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={1}
                  value={placement.rotation}
                  onChange={(e) => setPlacement((p) => ({ ...p, rotation: Number(e.target.value) }))}
                  className="mt-2 w-full accent-blue-500"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setPlacement({ centerX: 0.5, centerY: 0.42, scale: 0.7, rotation: 0 })}
                  className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-600"
                >
                  Centre chest
                </button>
                <button
                  onClick={() => setPlacement((p) => ({ ...p, centerX: 0.5, centerY: 0.5 }))}
                  className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-600"
                >
                  Centre in print area
                </button>
              </div>
            </Panel>

            <Panel title="Quantity">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="h-9 w-9 rounded-lg border border-neutral-800 text-lg leading-none hover:border-neutral-600"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm">{quantity}</span>
                <button
                  onClick={() => setQuantity((q) => Math.min(500, q + 1))}
                  className="h-9 w-9 rounded-lg border border-neutral-800 text-lg leading-none hover:border-neutral-600"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </Panel>

            {pricing && (
              <Panel title="Price">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold">${pricing.unitPrice.toFixed(2)}</span>
                  <span className="text-xs text-neutral-500">per item · USD</span>
                </div>
                <dl className="mt-3 space-y-1 text-xs text-neutral-400">
                  <Row label="Subtotal" value={`$${pricing.subtotal.toFixed(2)}`} />
                  <Row label="Production cost" value={`$${pricing.unitCost.toFixed(2)}`} />
                  <Row label="Margin" value={`${pricing.marginPct.toFixed(0)}%`} />
                </dl>
              </Panel>
            )}

            {actionError && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {actionError}
              </p>
            )}
            {result && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {result.message}{" "}
                {result.url && (
                  <a className="underline" href={result.url} target="_blank" rel="noreferrer">
                    {result.kind === "cart" ? "Go to checkout" : "Open in Shopify"}
                  </a>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={saveDesign}
                disabled={submitState !== "idle"}
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {submitState === "saving" ? "Saving…" : "Approve & save this design"}
              </button>
              <button
                onClick={addToCart}
                disabled={submitState !== "idle" || !shopifyReady}
                title={shopifyReady ? undefined : "Shopify Storefront API is not configured yet."}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 disabled:opacity-40"
              >
                {submitState === "carting" ? "Creating checkout…" : "Add to cart"}
              </button>
              <button
                onClick={publishDraft}
                disabled={submitState !== "idle"}
                className="rounded-xl border border-neutral-800 px-4 py-2.5 text-xs text-neutral-400 transition hover:border-neutral-600 disabled:opacity-40"
              >
                {submitState === "publishing" ? "Creating draft…" : "Publish as Shopify draft (staff)"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Stepper({ current, onSelect }: { current: StudioStep; onSelect: (s: StudioStep) => void }) {
  return (
    <ol className="flex flex-wrap gap-1 text-xs">
      {STEPS.map((s, i) => (
        <li key={s.id}>
          <button
            onClick={() => onSelect(s.id)}
            className={`rounded-full px-3 py-1.5 transition ${
              s.id === current
                ? "bg-blue-600 text-white"
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {i + 1}. {s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

function UploadPanel({
  onFile,
  progress,
  error,
  persistentStorage,
}: {
  onFile: (file: File) => void;
  progress: number | null;
  error: string | null;
  persistentStorage: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Panel title="Upload your artwork">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-blue-500 bg-blue-500/10" : "border-neutral-800"
        }`}
      >
        <p className="text-sm font-medium">Drag your design here</p>
        <p className="mt-1 text-xs text-neutral-500">
          PNG (transparent background works best), JPG or WebP · up to 30MB
        </p>
        <button
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {progress !== null && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Uploading and analysing your artwork…
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {!persistentStorage && (
        <p className="mt-4 text-xs text-neutral-500">
          Note: persistent artwork storage is not configured, so uploads are kept temporarily on
          this server and cannot be sent to production.
        </p>
      )}
    </Panel>
  );
}

function AnalysisPanel({ analysis }: { analysis: UploadResponse["analysis"] | null }) {
  if (!analysis) return null;
  const { deterministic, ai, aiStatus, aiMessage } = analysis;

  return (
    <Panel title="Artwork check">
      <dl className="grid grid-cols-2 gap-y-1 text-xs text-neutral-400">
        <Row label="Dimensions" value={`${deterministic.width} × ${deterministic.height}px`} />
        <Row label="Orientation" value={deterministic.orientation} />
        <Row label="Transparency" value={deterministic.hasTransparency ? "Yes" : "No"} />
        <Row label="Max clean print" value={`${deterministic.maxWidthIn150Dpi}in wide`} />
        {ai && <Row label="Print score" value={`${ai.printSuitabilityScore}/100`} />}
      </dl>

      {ai?.subject && (
        <p className="mt-3 text-xs text-neutral-400">
          <span className="text-neutral-500">AI read:</span> {ai.subject}
          {ai.style ? ` · ${ai.style}` : ""}
        </p>
      )}

      {[...deterministic.warnings, ...(ai?.productionWarnings ?? [])].map((w) => (
        <p key={w} className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {w}
        </p>
      ))}

      {aiStatus !== "ok" && (
        <p className="mt-2 text-[11px] text-neutral-500">
          AI analysis unavailable — {aiMessage ?? "continuing with measured file analysis."} Your
          artwork is saved and you can carry on.
        </p>
      )}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right text-neutral-300">{value}</dd>
    </>
  );
}

function cryptoRandom(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
