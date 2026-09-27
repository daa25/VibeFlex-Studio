// Airtable REST client — SERVER ONLY.
//
// Minimal wrapper for writing sync results into the VibeOS command-center
// base (Publisher_Partners, Affiliate_Links, etc.). Read-modify-write of
// existing records is intentionally not implemented here — the performance
// sync only appends fresh rows per run, which is the whole point: check
// Airtable's history, don't need to reconcile against it.

import { env } from "@/lib/env";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

export class AirtableNotConfiguredError extends Error {
  constructor() {
    super("Airtable is not configured. Set AIRTABLE_API_KEY.");
    this.name = "AirtableNotConfiguredError";
  }
}

export async function createAirtableRecords(
  tableName: string,
  records: Array<{ fields: Record<string, unknown> }>
): Promise<{ id: string }[]> {
  const apiKey = env.airtableApiKey();
  if (!apiKey) throw new AirtableNotConfiguredError();

  const res = await fetch(
    `${AIRTABLE_API_BASE}/${env.airtableBaseId()}/${encodeURIComponent(tableName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records, typecast: true }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(`Airtable API error (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }

  const json = (await res.json()) as { records?: { id: string }[] };
  return json.records ?? [];
}
