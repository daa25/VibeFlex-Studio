import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { studioDesigns } from "@/db/schema/studio";
import { env, serviceStatuses } from "@/lib/env";

// Reads live from Postgres on every request; never prerendered at build time.
export const dynamic = "force-dynamic";

type DesignRow = typeof studioDesigns.$inferSelect;

async function loadDesigns(): Promise<{ rows: DesignRow[]; error?: string }> {
  if (!env.databaseUrl()) {
    return { rows: [], error: "DATABASE_URL is not set, so no designs are being stored yet." };
  }
  try {
    const rows = await db
      .select()
      .from(studioDesigns)
      .orderBy(desc(studioDesigns.createdAt))
      .limit(25);
    return { rows };
  } catch (err) {
    return {
      rows: [],
      error: `Could not read from the database: ${
        err instanceof Error ? err.message : "unknown error"
      }. Have the migrations been run (npm run db:migrate)?`,
    };
  }
}

export default async function DashboardPage() {
  const [{ rows, error }, services] = await Promise.all([loadDesigns(), serviceStatuses()]);
  const adminUnprotected = !env.adminPassword();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Studio dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Saved customer designs and the live configuration state of the platform.
          </p>
        </div>
        <Link
          href="/studio"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Open the studio
        </Link>
      </div>

      {adminUnprotected && (
        <p className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <strong className="font-semibold">This page is unprotected.</strong> Set
          STUDIO_ADMIN_PASSWORD (and optionally STUDIO_ADMIN_USER) to require a login for
          /dashboard and Shopify draft publishing.
        </p>
      )}

      <section className="mb-10 grid gap-3 sm:grid-cols-2">
        {services.map((service) => (
          <div
            key={service.key}
            className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{service.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  service.configured
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {service.configured ? "configured" : "not configured"}
              </span>
            </div>
            <p className="mt-2 text-xs text-neutral-500">{service.note}</p>
            {service.missing.length > 0 && (
              <p className="mt-2 font-mono text-[11px] text-neutral-400">
                missing: {service.missing.join(", ")}
              </p>
            )}
          </div>
        ))}
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
        Recent designs
      </h2>

      {error ? (
        <p className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
          No designs saved yet. Create one in the studio and it will appear here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-neutral-900/60 text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Shopify</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono text-xs">{row.reference}</td>
                  <td className="px-4 py-3">
                    {row.productId} · {row.colorId} · {row.sizeId}
                  </td>
                  <td className="px-4 py-3">${row.unitPrice ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{row.status}</td>
                  <td className="px-4 py-3">
                    {row.shopifyAdminUrl ? (
                      <a
                        className="text-blue-400 underline"
                        href={row.shopifyAdminUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        draft
                      </a>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
