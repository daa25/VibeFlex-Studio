import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">VibeFlex Product Studio</h1>
      <p className="text-neutral-400">Stage One: internal product creation tool.</p>
      <Link href="/dashboard" className="rounded bg-blue-600 px-4 py-2 text-white">
        Go to Dashboard
      </Link>
    </main>
  );
}
