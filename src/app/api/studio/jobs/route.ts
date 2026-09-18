// Headless job control plane.
//
// This route exists so the pipeline is drivable by a machine — a cron, a
// webhook, a queue worker — and not only by a person clicking through the
// studio wizard. The UI is for visibility, overrides and approvals; this is
// how the autonomous engine advances work.
//
// GET  /api/studio/jobs              -> list jobs (optionally ?state=)
// GET  /api/studio/jobs?view=queue   -> jobs parked for a human
// POST /api/studio/jobs {action}     -> create | claim | complete | fail | approve
//
// Protected by the same admin gate as publishing (src/middleware.ts).

import { NextRequest, NextResponse } from "next/server";
import {
  approveJob,
  claimNextJob,
  completeStage,
  createJob,
  failStage,
  listExceptions,
  listJobs,
} from "@/lib/job-queue";
import { ALL_STATES, type JobState, type ProgressState } from "@/lib/job-states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view");
  const state = req.nextUrl.searchParams.get("state") as JobState | null;

  const result = view === "queue" ? await listExceptions() : await listJobs({ state: state ?? undefined });

  if (!result.available) {
    return NextResponse.json({ error: result.reason, autonomyAvailable: false }, { status: 503 });
  }
  return NextResponse.json({ jobs: result.value, count: result.value.length, autonomyAvailable: true });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const action = String(body.action ?? "");

  switch (action) {
    case "create": {
      const result = await createJob({
        designReference: str(body.designReference),
        artworkAssetId: str(body.artworkAssetId),
        shopifyProductId: str(body.shopifyProductId),
        trigger: str(body.trigger) ?? "manual",
        evidence: (body.evidence as Record<string, unknown>) ?? {},
      });
      return respond(result);
    }

    case "claim": {
      const workerId = str(body.workerId);
      if (!workerId) return NextResponse.json({ error: "workerId is required." }, { status: 400 });
      const result = await claimNextJob(workerId);
      if (!result.available) {
        return NextResponse.json({ error: result.reason, autonomyAvailable: false }, { status: 503 });
      }
      return NextResponse.json({ job: result.value, idle: result.value === null });
    }

    case "complete": {
      const jobId = str(body.jobId);
      const from = str(body.from) as JobState | undefined;
      if (!jobId || !from || !ALL_STATES.includes(from)) {
        return NextResponse.json({ error: "jobId and a valid `from` state are required." }, { status: 400 });
      }
      const result = await completeStage({
        jobId,
        from,
        evidence: body.evidence as Record<string, unknown> | undefined,
        shopifyProductId: str(body.shopifyProductId),
      });
      return respond(result);
    }

    case "fail": {
      const jobId = str(body.jobId);
      const currentState = str(body.currentState) as ProgressState | undefined;
      const suggestedState = (str(body.suggestedState) ?? "MANUAL_REVIEW") as JobState;
      const disposition = (str(body.disposition) ?? "retry") as "repair" | "retry" | "escalate";
      if (!jobId || !currentState) {
        return NextResponse.json({ error: "jobId and currentState are required." }, { status: 400 });
      }
      const result = await failStage({
        jobId,
        currentState,
        disposition,
        suggestedState,
        attempts: Number(body.attempts ?? 0),
        reason: str(body.reason) ?? "Unspecified stage failure.",
        evidence: body.evidence as Record<string, unknown> | undefined,
      });
      return respond(result);
    }

    case "approve": {
      const jobKey = str(body.jobKey);
      if (!jobKey) return NextResponse.json({ error: "jobKey is required." }, { status: 400 });
      const result = await approveJob(jobKey);
      return respond(result);
    }

    default:
      return NextResponse.json(
        { error: `Unknown action "${action}". Expected create, claim, complete, fail or approve.` },
        { status: 400 }
      );
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function respond(result: { available: boolean; value?: unknown; reason?: string }) {
  if (!result.available) {
    return NextResponse.json({ error: result.reason, autonomyAvailable: false }, { status: 503 });
  }
  return NextResponse.json({ job: result.value });
}
