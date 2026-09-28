import { env } from "./env";

/** Resolves a possibly-relative storage URL (local-disk fallback) to an absolute https URL. */
export function resolvePublicUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${env.publicBaseUrl() ?? ""}${url}`;
}
