import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-400">
        VibeFlex Sports
      </p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Product Studio</h1>
      <p className="max-w-lg text-neutral-400">
        Upload a design, put it on real VibeFlex gear, see the print exactly as it will be produced,
        and send it straight to checkout.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/studio"
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Start designing
        </Link>
        <Link
          href="/store"
          className="rounded-xl border border-neutral-700 px-5 py-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500"
        >
          Shop the store
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl px-4 py-3 text-sm text-neutral-500 transition hover:text-neutral-300"
        >
          Staff dashboard
        </Link>
      </div>
    </main>
  );
}
