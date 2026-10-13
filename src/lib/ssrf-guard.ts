/**
 * SSRF protection — user-controlled URLs (product link ingestion, og:image scraping) must pass through
 * here before being fetched server-side; otherwise an attacker could craft requests to
 * http://169.254.169.254/ (cloud metadata) or http://127.0.0.1:6379/ (internal services), etc.
 * Strategy: validate the scheme + ensure every IP resolved for the host is outside private/loopback/
 * link-local/reserved ranges; manually follow redirects and re-validate each hop.
 */
import dns from "dns";
import net from "net";
import { Agent, type Dispatcher } from "undici";
import { isWebMode } from "@/lib/web-mode-flag";

/** Returns true if an IP falls within a blocked private/loopback/link-local/reserved range (IPv4 + IPv6). Pure function, unit-testable. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    if (p[0] === 0) return true; // 0.0.0.0/8 — current network
    if (p[0] === 10) return true; // 10/8 — private network
    if (p[0] === 127) return true; // 127/8 — loopback
    if (p[0] === 169 && p[1] === 254) return true; // 169.254/16 — link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12 — private network
    if (p[0] === 192 && p[1] === 168) return true; // 192.168/16 — private network
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64/10 — CGNAT
    // Note: 198.18/15 (RFC 2544 benchmarking range) is NOT blocked — Cloudflare WARP and similar services
    // use it as a transparent proxy address for forwarding public traffic; blocking it would break legitimate users.
    if (p[0] >= 224) return true; // 224+ — multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const g = expandIPv6(ip);
    if (!g) return true;
    const embedded = embeddedIPv4(g);
    if (embedded) return isBlockedIp(embedded); // ::ffff:a.b.c.d (any spelling), ::a.b.c.d, 64:ff9b::/96 NAT64
    if (g.every((x) => x === 0)) return true; // :: unspecified
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x2002) return true; // 6to4 can embed any IPv4 — refuse
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo can embed any IPv4 — refuse
    return false;
  }
  return true; // invalid IP — block unconditionally
}

/** Thrown when a URL (or a redirect hop) points at a blocked address. */
export class SsrfBlockedError extends Error {
  readonly code = "BASEURL_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** Expand an IPv6 literal (with optional zone / dotted-quad tail) into 8 16-bit groups; null if malformed. */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return groups.length === 8 && groups.every((n) => !Number.isNaN(n)) ? groups : null;
}

function embeddedIPv4(g: number[]): string | null {
  const v4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  const zero5 = g.slice(0, 5).every((x) => x === 0);
  if (zero5 && g[5] === 0xffff) return v4(); // IPv4-mapped
  if (zero5 && g[5] === 0 && (g[6] !== 0 || g[7] > 1)) return v4(); // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4(); // NAT64
  return null;
}

/** Validates a URL: must use http/https and all IPs resolved for the host must be public; throws otherwise. */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed");
  // Strip brackets from IPv6 literals (URL.hostname keeps brackets for [::1], which causes net.isIP to fail and fall through to DNS)
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const records = await dns.promises.lookup(host, { all: true });
    ips = records.map((r) => r.address);
  }
  if (ips.length === 0) throw new Error("Could not resolve host");
  for (const ip of ips) {
    if (isBlockedIp(ip)) throw new SsrfBlockedError(`Blocked address (private/reserved ${ip})`);
  }
}

/** Default per-hop timeout for safeFetch / pinnedProviderFetch. */
export const HOP_TIMEOUT_MS = 15000;

/** Combine the caller's signal (if any) with a per-hop timeout; whichever fires first aborts. */
export function hopSignal(callerSignal: AbortSignal | null | undefined, timeoutMs: number = HOP_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

/** Throws SsrfBlockedError when a redirect goes from https to http. */
function assertNoDowngrade(prev: URL, next: URL): void {
  if (prev.protocol === "https:" && next.protocol === "http:") throw new SsrfBlockedError("Blocked redirect (https → http downgrade)");
}

/**
 * SSRF-safe fetch: disables automatic redirect following; manually follows each hop and re-validates that
 * every target is a public address. https → http redirects are refused. Each hop gets a timeout
 * (default 15 s, `opts.timeoutMs` for large downloads) combined with any caller signal; the timeout also
 * covers reading the body of the final response.
 */
export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 4, opts: { timeoutMs?: number } = {}): Promise<Response> {
  let current = url;
  let headers = init.headers;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Desktop (ALLOW_PRIVATE_BASEURL=1, not WEB_MODE): local providers may hand back loopback/LAN media
    // URLs, so private targets are allowed but cloud metadata is still refused. Otherwise public only.
    const privateOk = allowPrivateBaseUrl();
    if (privateOk) await assertSafeBaseUrl(current);
    else await assertPublicUrl(current);
    // dispatcher: re-checks the IP at connect time so a DNS answer cannot change between check and connect
    const res = await fetch(current, {
      ...init,
      headers,
      redirect: "manual",
      signal: hopSignal(init.signal, opts.timeoutMs ?? HOP_TIMEOUT_MS),
      dispatcher: privateOk ? providerDispatcher() : pinnedDispatcher(),
    } as RequestInit);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      await res.body?.cancel().catch(() => {});
      const prev = new URL(current);
      const next = new URL(loc, prev); // resolve potentially relative redirect locations
      assertNoDowngrade(prev, next);
      if (next.origin !== prev.origin) headers = stripCredentialHeaders(headers); // never forward an API key to another host
      current = next.href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

// ==================== DNS-rebinding protection ====================

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/**
 * dns.lookup replacement used at socket-connect time: resolves once, rejects if ANY address is
 * private/reserved, and hands exactly those vetted addresses to the socket. The connection therefore
 * goes to the IP that was checked, not to a second (rebinding) DNS answer.
 */
export function pinnedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  return vettedLookup(isBlockedIp, hostname, options, cb);
}

/** Cloud-metadata addresses — blocked even when private base URLs are allowed (Ollama on localhost/LAN). */
export function isMetadataIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const g = expandIPv6(ip);
    if (!g) return true;
    const v4 = embeddedIPv4(g);
    if (v4) return isMetadataIp(v4);
    return g.join(":") === [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254].join(":");
  }
  return /^169\.254\./.test(ip);
}

/** Lookup for ALLOW_PRIVATE_BASEURL=1: private/LAN allowed, metadata still refused at connect time. */
export function metadataBlockingLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  return vettedLookup(isMetadataIp, hostname, options, cb);
}

function vettedLookup(blocked: (ip: string) => boolean, hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  const isBlockedIp = blocked;
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) return cb(Object.assign(new Error(`Blocked address (private/reserved ${host})`), { code: "EBLOCKED" }));
    const family = net.isIP(host);
    return options.all ? cb(null, [{ address: host, family }]) : cb(null, host, family);
  }
  dns.lookup(host, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (!list.length || bad) {
      return cb(Object.assign(new Error(`Blocked address (private/reserved ${bad?.address ?? "none"})`), { code: "EBLOCKED" }));
    }
    if (options.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

let dispatcher: Dispatcher | undefined;
let privateDispatcher: Dispatcher | undefined;

/**
 * fetch for user-supplied provider base URLs (llm/test, llm/models, ai/test-provider): the socket
 * connects only to the IP vetted at connect time, closing the DNS-rebinding window between
 * assertSafeBaseUrl and the request. With ALLOW_PRIVATE_BASEURL=1, LAN/loopback are allowed but
 * cloud metadata is still refused.
 */
export function providerDispatcher(env: Record<string, string | undefined> = process.env): Dispatcher {
  if (!allowPrivateBaseUrl(env)) return pinnedDispatcher();
  if (!privateDispatcher) privateDispatcher = new Agent({ connect: { lookup: metadataBlockingLookup as never } });
  return privateDispatcher;
}

const CREDENTIAL_HEADERS = new Set(["authorization", "x-api-key", "api-key", "proxy-authorization", "cookie", "x-goog-api-key"]);

/** Copy of the headers without credentials (used when a redirect leaves the original origin). */
export function stripCredentialHeaders(h: HeadersInit | undefined): Headers {
  const out = new Headers(h);
  for (const k of [...out.keys()]) if (CREDENTIAL_HEADERS.has(k.toLowerCase())) out.delete(k);
  return out;
}

/** Max redirects pinnedProviderFetch will follow (each hop re-validated and re-pinned). */
export const PROVIDER_MAX_REDIRECTS = 5;

/**
 * fetch for user-supplied provider base URLs. Redirects are followed manually: every Location is
 * resolved against the current URL, re-checked with assertSafeBaseUrl and fetched through the pinned
 * dispatcher again. (undici skips `lookup` for bare-IP hosts, so an automatic 302 to 127.0.0.1 /
 * 169.254.169.254 would otherwise bypass the connect-time check.)
 */
export const pinnedProviderFetch: typeof fetch = (input, init) => pinnedProviderFetchWithTimeout(HOP_TIMEOUT_MS)(input, init);

/**
 * pinnedProviderFetch with a custom per-hop timeout, for provider calls whose response legitimately
 * takes longer than 15 s (synchronous image generation, uploads, long TTS). The caller's own signal is
 * still combined with it, so pass a hop timeout slightly ABOVE the caller's own timeout to keep the
 * caller's timeout error message.
 */
export function pinnedProviderFetchWithTimeout(hopTimeoutMs: number): typeof fetch {
  return (input, init) => pinnedProviderFetchImpl(input, init, hopTimeoutMs);
}

/** True when an error (or its cause) is an SSRF block: SsrfBlockedError or the connect-time EBLOCKED lookup error. */
export function isSsrfBlock(e: unknown): boolean {
  if (e instanceof SsrfBlockedError) return true;
  const cause = (e as { cause?: unknown })?.cause;
  return cause instanceof SsrfBlockedError || (cause as { code?: string })?.code === "EBLOCKED";
}

/** Message of an SSRF block error (the connect-time error keeps its reason on `cause`). */
export function ssrfBlockMessage(e: unknown): string {
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code === "EBLOCKED" && cause.message) return cause.message;
  return e instanceof Error ? e.message : String(e);
}

/** True when `url` has exactly the same origin (scheme + host + port) as `base`. */
export function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

async function pinnedProviderFetchImpl(input: Parameters<typeof fetch>[0], init: RequestInit | undefined, hopTimeoutMs: number): Promise<Response> {
  let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let opts: RequestInit = { ...(init ?? {}) };
  for (let hop = 0; hop <= PROVIDER_MAX_REDIRECTS; hop++) {
    await assertSafeBaseUrl(url);
    const res = await fetch(url, { ...opts, redirect: "manual", signal: hopSignal(opts.signal, hopTimeoutMs), dispatcher: providerDispatcher() } as RequestInit);
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) return res;
    await res.body?.cancel().catch(() => {});
    const prev = new URL(url);
    const next = new URL(loc, prev);
    assertNoDowngrade(prev, next);
    if (next.origin !== prev.origin) opts = { ...opts, headers: stripCredentialHeaders(opts.headers) }; // never send the key to another host
    url = next.href;
    // 301/302/303 turn a POST into a body-less GET (browser semantics); 307/308 resend as-is
    if (res.status !== 307 && res.status !== 308 && opts.method && opts.method.toUpperCase() !== "GET" && opts.method.toUpperCase() !== "HEAD") {
      const { body: _body, ...rest } = opts;
      void _body;
      opts = { ...rest, method: "GET" };
    }
  }
  throw new SsrfBlockedError(`Too many redirects (> ${PROVIDER_MAX_REDIRECTS})`);
}

/**
 * pinnedProviderFetch plus a record of the first SSRF block. Helpers such as probeLLMEndpoint /
 * listModels swallow fetch errors into generic "connection failed" text; routes use `blocked()` to
 * answer 400 BASEURL_BLOCKED instead.
 */
export function trackedProviderFetch(): { fetch: typeof fetch; blocked: () => SsrfBlockedError | undefined } {
  let first: SsrfBlockedError | undefined;
  const f: typeof fetch = async (input, init) => {
    try {
      return await pinnedProviderFetch(input, init);
    } catch (e) {
      const cause = (e as { cause?: unknown })?.cause;
      const b = e instanceof SsrfBlockedError ? e : (cause as { code?: string })?.code === "EBLOCKED" ? new SsrfBlockedError((cause as Error).message) : undefined;
      if (b && !first) first = b;
      throw e;
    }
  };
  return { fetch: f, blocked: () => first };
}
/** Shared undici Agent whose sockets only connect to vetted public IPs. */
export function pinnedDispatcher(): Dispatcher {
  if (!dispatcher) dispatcher = new Agent({ connect: { lookup: pinnedLookup as never } });
  return dispatcher;
}

/** WEB_MODE=1 (public web / VPS deploy): private, loopback and link-local targets are ALWAYS refused. */
export { isWebMode };

/**
 * Local/LAN endpoints (Ollama, LM Studio, local media) are allowed only when ALLOW_PRIVATE_BASEURL=1
 * (desktop app / dev) AND the server is not in WEB_MODE. WEB_MODE=1 always wins, so a web deploy that
 * inherits ALLOW_PRIVATE_BASEURL by mistake still refuses 127.0.0.1 / 10.x / 169.254.x.
 */
export function allowPrivateBaseUrl(env: Record<string, string | undefined> = process.env): boolean {
  if (isWebMode(env)) return false;
  return env.ALLOW_PRIVATE_BASEURL === "1" || env.ALLOW_PRIVATE_BASEURL === "true";
}

/**
 * Validates a user-supplied API base URL (LLM / provider endpoints): http(s) only, and the host must
 * resolve to public addresses unless ALLOW_PRIVATE_BASEURL=1. Cloud metadata (169.254.0.0/16,
 * fd00:ec2::254, metadata.google.internal) is blocked even when private URLs are allowed.
 */
export async function assertSafeBaseUrl(rawUrl: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid base URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed");
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (host === "metadata.google.internal" || host === "metadata") throw new SsrfBlockedError("Blocked address (cloud metadata)");
  if (!allowPrivateBaseUrl(env)) return assertPublicUrl(rawUrl);
  const ips = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  for (const ip of ips) {
    if (isMetadataIp(ip)) throw new SsrfBlockedError(`Blocked address (cloud metadata ${ip})`);
  }
}

/** Every baseUrl a route body can carry: top-level, llmConfig, ttsConfig, visionConfig and providers[]. */
export function collectBaseUrls(body: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  if (!body || typeof body !== "object") return out;
  const b = body as Record<string, unknown>;
  add(b.baseUrl);
  for (const k of ["llmConfig", "ttsConfig", "visionConfig", "config"]) {
    const c = b[k];
    if (c && typeof c === "object") add((c as Record<string, unknown>).baseUrl);
  }
  if (Array.isArray(b.providers)) for (const p of b.providers) if (p && typeof p === "object") add((p as Record<string, unknown>).baseUrl);
  return out;
}

/**
 * Route-level gate: validate every baseUrl in a request body with assertSafeBaseUrl. Returns the
 * SsrfBlockedError for the first blocked one, or null when all are acceptable. Routes map a
 * non-null result to 400 BASEURL_BLOCKED (see baseUrlBlockedResponse in @/lib/baseurl-gate).
 */
export async function firstUnsafeBaseUrl(body: unknown, env: Record<string, string | undefined> = process.env): Promise<Error | null> {
  for (const u of collectBaseUrls(body)) {
    try {
      await assertSafeBaseUrl(u, env);
    } catch (e) {
      // only real SSRF blocks: DNS failures / typos fall through to the normal "cannot reach" errors
      if (isSsrfBlock(e)) return e as Error;
    }
  }
  return null;
}
