import Link from "next/link";
import { VIBEFLEX_ORIGINALS } from "@/lib/originals";

export const metadata = {
  title: "VibeFlex Originals — Production Studio",
  description: "Approved physical prototypes translated into repeatable VibeFlex production blueprints.",
};

export default function OriginalsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            VibeFlex Studio · Internal Production
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">VibeFlex Originals</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Physical prototypes translated into repeatable production blueprints. These are the
            approved designs we can now rebuild, source, publish, and fulfill without guessing.
          </p>
        </div>
        <Link
          href="/studio"
          className="self-start rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 transition hover:border-neutral-600 hover:text-white"
        >
          Back to Design Studio
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {VIBEFLEX_ORIGINALS.map((product) => (
          <article
            key={product.id}
            className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60"
          >
            <div className="border-b border-neutral-800 bg-gradient-to-br from-blue-500/10 via-neutral-950 to-neutral-950 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
                    {product.collection}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{product.name}</h2>
                  <p className="mt-1 text-sm text-neutral-400">{product.garmentColor}</p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                    product.status === "PROTOTYPE_APPROVED"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {product.status === "PROTOTYPE_APPROVED" ? "Prototype approved" : "1 asset pending"}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-neutral-300">{product.prototypeNotes}</p>
            </div>

            <div className="p-5">
              <div className="mb-5 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <span className="block text-neutral-500">Studio garment</span>
                  <span className="mt-1 block font-medium text-neutral-200">{product.productId}</span>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <span className="block text-neutral-500">Color ID</span>
                  <span className="mt-1 block font-medium text-neutral-200">{product.colorId}</span>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-white">Production placements</h3>
              <div className="mt-3 space-y-3">
                {product.placements.map((placement) => (
                  <div key={placement.areaId} className="rounded-xl border border-neutral-800 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-neutral-100">{placement.label}</p>
                        <p className="mt-1 font-mono text-xs text-blue-300">{placement.artworkFile}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
                          placement.status === "READY"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {placement.status === "READY" ? "Ready" : "Pending"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-neutral-400">{placement.notes}</p>
                    <p className="mt-2 text-xs text-neutral-500">
                      {placement.targetWidthIn ? `Target width: ${placement.targetWidthIn} in` : ""}
                      {placement.targetWidthIn && placement.targetHeightIn ? " · " : ""}
                      {placement.targetHeightIn ? `Target height: ${placement.targetHeightIn} in` : ""}
                    </p>
                  </div>
                ))}
              </div>

              <h3 className="mt-5 text-sm font-semibold text-white">Production rules</h3>
              <ul className="mt-2 space-y-2 text-sm text-neutral-400">
                {product.productionNotes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
        <h2 className="text-lg font-semibold">Production-pack rule</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-300">
          The printable masters stay separate from prototype photography. Studio uses the blueprint
          above as the source of truth for garment, color, placement, sizing, and artwork filename.
          Prototype photos are reference/QA evidence only and must never be treated as print files.
        </p>
      </section>
    </main>
  );
}
