/**
 * Browser build of @/lib/ssrf-guard (wired via turbopack.resolveAlias in next.config.ts).
 * Some shared modules (llm-error, atlas-catalog, stock-types…) are also pulled into client bundles,
 * where Node's dns/net don't exist. SSRF is a server-side concern — a browser can only reach what the
 * user's own browser can — so in the browser these helpers simply delegate to the global fetch.
 * The real guard (src/lib/ssrf-guard.ts) is what every server route and API handler runs.
 */
export class SsrfBlockedError extends Error {
  readonly code = "BASEURL_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}
export const HOP_TIMEOUT_MS = 15000;
export const PROVIDER_MAX_REDIRECTS = 5;
export const pinnedProviderFetch: typeof fetch = (input, init) => fetch(input, init);
export function pinnedProviderFetchWithTimeout(_hopTimeoutMs: number): typeof fetch {
  void _hopTimeoutMs;
  return (input, init) => fetch(input, init);
}
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, init);
}
export function isSsrfBlock(e: unknown): boolean {
  return e instanceof SsrfBlockedError || (e as { code?: unknown })?.code === "BASEURL_BLOCKED";
}
export function ssrfBlockMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
export function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
