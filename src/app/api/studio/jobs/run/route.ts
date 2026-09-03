// Worker tick.
//
// POST /api/studio/jobs/run
//
// Claims runnable jobs and advances each by one stage, then returns. Bounded on
// purpose: a cron (Vercel Cron, GitHub Actions, any scheduler) calls this on an
// interval rather than the process holding a loop open inside a request.
//
// This is the endpoint that makes "upload once, Studio does the rest" real —
// no browser session is involved anywhere in the path.

import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/job-runner";
import { DEFAULT_POLICY } from "@/lib/policy-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { workerId?: string; max?: number } = {};
  try {
    body = (await req.json()) as { workerId?: string; max?: number };
  } catch {
    // An empty body is fine — a cron has nothing to say.
  }

  const workerId =
    body.workerId?.trim() ||
    `worker-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await runWorker({
    workerId,
    max: Math.min(Math.max(1, Number(body.max ?? 10)), 50),
    policy: DEFAULT_POLICY,
  });

  if (!result.autonomyAvailable) {
    return NextResponse.json(
      { autonomyAvailable: false, reason: result.reason, results: result.results },
      { status: 503 }
    );
  }

  return NextResponse.json({
    autonomyAvailable: true,
    workerId,
    processed: result.processed,
    results: result.results,
    autoPublishEnabled: DEFAULT_POLICY.autoPublishEnabled,
  });
}
