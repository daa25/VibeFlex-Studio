import Link from "next/link";
import { getStudioCatalog } from "@/integrations/pod/catalog-service";
import { serviceStatuses } from "@/lib/env";
import { storageIsPersistent } from "@/lib/storage";
import { StudioClient } from "./studio-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Design Studio — VibeFlex Sports",
  description: "Upload your artwork, put it on VibeFlex gear, and see it before you buy.",
};

export default async function StudioPage() {
  const catalog = await getStudioCatalog();
  const shopifyReady = serviceStatuses().find((s) => s.key === "shopify_storefront")?.configured ?? false;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            VibeFlex Sports
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Design Studio</h1>
          <p className="mt-2 max-w-xl text-sm text-neutral-400">
            Upload your artwork, drop it on real VibeFlex gear, and see exactly what gets printed.
          </p>
        </div>
        <Link
          href="/store"
          className="self-start rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 transition hover:border-neutral-600 hover:text-white"
        >
          Browse the store
        </Link>
      </header>

      {catalog.mode === "mock" && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong className="font-semibold">Demo catalog.</strong> {catalog.warning}
        </div>
      )}

      <StudioClient
        products={catalog.products}
        catalogMode={catalog.mode}
        persistentStorage={storageIsPersistent()}
        shopifyReady={shopifyReady}
      />
    </main>
  );
}
