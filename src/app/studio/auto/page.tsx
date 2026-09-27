import Link from "next/link";
import { AutoCreateClient } from "./auto-create-client";

export default function StudioAutoPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/studio" className="text-sm text-slate-500 hover:underline">
        &larr; Back to Studio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Upload once, get every fitting product</h1>
      <p className="mt-2 text-sm text-slate-600">
        Upload one piece of artwork. It gets placed on tee, hoodie, crewneck, tank and cap blanks pulled from
        Printify&apos;s real live catalog, with AI-written titles/descriptions, and a matching Shopify draft product
        for each — nothing published, nothing activated.
      </p>
      <div className="mt-8">
        <AutoCreateClient />
      </div>
    </main>
  );
}
