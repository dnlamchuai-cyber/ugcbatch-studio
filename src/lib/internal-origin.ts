/**
 * Origin this server uses to call its OWN API (pipeline stage self-fetches). Fixed from env and never
 * derived from the incoming request's Host header, which a client can spoof to redirect those calls.
 * INTERNAL_BASE_URL wins; otherwise http://127.0.0.1:$PORT (default 3000).
 */
export function internalBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.INTERNAL_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = /^\d+$/.test(env.PORT ?? "") ? env.PORT : "3000";
  return `http://127.0.0.1:${port}`;
}
