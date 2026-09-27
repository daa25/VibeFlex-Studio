// GET /api/impact/performance-sync — Impact.com Side A daily sync.
//
// Pulls click/conversion/commission performance for the publisher account's
// campaigns and appends a row per campaign into Airtable's Affiliate_Links
// table, so the daily check is "look at Airtable" rather than "log into
// Impact.com" (per Impact-Affiliate-Architecture section 3, automation #1).
//
// Triggered by Vercel Cron (see vercel.json). Guarded by CRON_SECRET so this
// isn't a publicly-triggerable endpoint that spends Airtable/Impact API
// quota for anyone who finds the URL.

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getPublisherPerformanceReport, ImpactNotConfiguredError } from "@/integrations/impact/client";
import { createAirtableRecords } from "@/integrations/airtable/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const accountSid = env.impactPublisherAccountSid();
  const authToken = env.impactPublisherAuthToken();
  if (!accountSid || !authToken) {
    return NextResponse.json(
      {
        error: "Impact.com publisher (Side A) credentials not configured.",
        missing: [
          ...(accountSid ? [] : ["IMPACT_PUBLISHER_ACCOUNT_SID"]),
          ...(authToken ? [] : ["IMPACT_PUBLISHER_AUTH_TOKEN"]),
        ],
      },
      { status: 503 }
    );
  }

  try {
    const rows = await getPublisherPerformanceReport({ accountSid, authToken });

    const created = await createAirtableRecords(
      "Affiliate_Links",
      rows.map((row) => ({
        fields: {
          "Product/Content": row.campaignName ?? row.campaignId ?? "Unknown campaign",
          Clicks: row.clicks ?? 0,
          Conversions: row.actions ?? 0,
          "Commission Earned": row.payout ?? 0,
          "Last Synced": new Date().toISOString(),
        },
      }))
    );

    return NextResponse.json({ synced: created.length, at: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ImpactNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Performance sync failed." },
      { status: 502 }
    );
  }
}
