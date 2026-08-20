import { db } from "@/db/client";
import { productProjects } from "@/db/schema";

// Reads live from Postgres on every request; never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // NOTE: this queries live once DATABASE_URL is set and migrations have run.
  const projects = await db.select().from(productProjects).limit(20);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-xl font-semibold">Product Studio Dashboard</h1>

      {projects.length === 0 ? (
        <p className="text-neutral-400">
          No product projects yet. Upload artwork to start your first product.
        </p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="rounded border border-neutral-800 p-3">
              <span className="font-medium">{p.name}</span>{" "}
              <span className="text-sm text-neutral-500">— {p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
