// Impact.com REST client — SERVER ONLY.
//
// Impact.com authenticates with HTTP Basic Auth: AccountSID as the username,
// AuthToken as the password. There are two separate credential pairs in this
// codebase because Impact.com's own architecture is two-sided — see
// env.impactPublisherAccountSid/impactAdvertiserAccountSid. This client is
// generic over which pair it's given; callers pick the right account.
//
// This module makes real outbound calls to api.impact.com. It cannot be
// exercised from a sandbox without internet access — it only runs correctly
// once deployed (Vercel functions have full outbound access).

const IMPACT_API_BASE = "https://api.impact.com";

export type ImpactCredentials = { accountSid: string; authToken: string };

export class ImpactNotConfiguredError extends Error {
  constructor(side: "publisher" | "advertiser") {
    super(
      `Impact.com ${side} credentials are not configured. Set IMPACT_${side.toUpperCase()}_ACCOUNT_SID and IMPACT_${side.toUpperCase()}_AUTH_TOKEN.`
    );
    this.name = "ImpactNotConfiguredError";
  }
}

function authHeader(creds: ImpactCredentials): string {
  return "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
}

async function impactRequest<T>(
  creds: ImpactCredentials,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${IMPACT_API_BASE}/Mediapartners/${creds.accountSid}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Impact.com rejected the credentials (${res.status}). Confirm the AccountSID and AuthToken belong to the same account and haven't been rotated.`
    );
  }
  if (!res.ok) {
    throw new Error(`Impact.com API error (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

export type ImpactReportRow = {
  campaignId?: string;
  campaignName?: string;
  clicks?: number;
  actions?: number;
  payout?: number;
  epc?: number;
};

/**
 * Side A — pulls click/conversion/commission performance for the publisher
 * account's partner campaigns. Impact's Reports API returns report-specific
 * shapes; this returns the raw rows so the caller (performance-sync route)
 * maps them into Airtable fields rather than this client guessing a fixed
 * schema for every report type.
 */
export async function getPublisherPerformanceReport(
  creds: ImpactCredentials,
  reportId = "mp_performance_by_campaign"
): Promise<ImpactReportRow[]> {
  const data = await impactRequest<{ Records?: ImpactReportRow[] }>(
    creds,
    `/Reports/${reportId}.json`
  );
  return data.Records ?? [];
}

/**
 * Side A — generates a tracked deep link for a given destination URL under
 * a specific campaign (program). Returns the trackable URL Impact.com
 * issues; never fabricate this value locally.
 */
export async function generateDeepLink(
  creds: ImpactCredentials,
  params: { campaignId: string; destinationUrl: string }
): Promise<string> {
  const data = await impactRequest<{ TrackingURL?: string }>(creds, `/Ads/${params.campaignId}/Links`, {
    method: "POST",
    body: JSON.stringify({ Url: params.destinationUrl }),
  });
  if (!data.TrackingURL) {
    throw new Error("Impact.com link-generation response had no TrackingURL.");
  }
  return data.TrackingURL;
}
