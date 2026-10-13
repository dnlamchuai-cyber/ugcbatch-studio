/**
 * SSRF protection — user-controlled URLs (product link ingestion, og:image scraping) must pass through
 * here before being fetched server-side; otherwise an attacker could craft requests to
 * http://169.254.169.254/ (cloud metadata) or http://127.0.0.1:6379/ (internal services), etc.
 * Strategy: validate the scheme + ensure every IP resolved for the host is outside private/loopback/
 * link-local/reserved ranges; manually follow redirects and re-validate each hop.
 */
import { lookup } from "dns/promises";
import dns from "dns";
import net from "net";
import { Agent, type Dispatcher } from "undici";

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
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // loopback / unspecified
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7 ULA
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // invalid IP — block unconditionally
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
    const records = await lookup(host, { all: true });
    ips = records.map((r) => r.address);
  }
  if (ips.length === 0) throw new Error("Could not resolve host");
  for (const ip of ips) {
    if (isBlockedIp(ip)) throw new Error(`Blocked address (private/reserved ${ip})`);
  }
}

/** SSRF-safe fetch: disables automatic redirect following; manually follows each hop and re-validates that every target is a public address. */
export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 4): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    // Apply a 15 s timeout per hop (unless the caller already provides a signal) to prevent slow or malicious servers from stalling the request indefinitely
    // dispatcher: re-checks the IP at connect time so a DNS answer cannot change between check and connect
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(15000),
      dispatcher: pinnedDispatcher(),
    } as RequestInit);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).href; // resolve potentially relative redirect locations
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
  const v4 = ip.replace(/^::ffff:/i, "");
  return /^169\.254\./.test(v4) || ip.toLowerCase() === "fd00:ec2::254";
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

export const pinnedProviderFetch: typeof fetch = (input, init) =>
  fetch(input, { ...(init ?? {}), dispatcher: providerDispatcher() } as RequestInit);
/** Shared undici Agent whose sockets only connect to vetted public IPs. */
export function pinnedDispatcher(): Dispatcher {
  if (!dispatcher) dispatcher = new Agent({ connect: { lookup: pinnedLookup as never } });
  return dispatcher;
}

/** Local/LAN endpoints (Ollama, LM Studio) are allowed only when ALLOW_PRIVATE_BASEURL=1 (desktop app / dev). */
export function allowPrivateBaseUrl(env: Record<string, string | undefined> = process.env): boolean {
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
  if (host === "metadata.google.internal" || host === "metadata") throw new Error("Blocked address (cloud metadata)");
  if (!allowPrivateBaseUrl(env)) return assertPublicUrl(rawUrl);
  const ips = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  for (const ip of ips) {
    const v4 = ip.replace(/^::ffff:/i, "");
    if (/^169\.254\./.test(v4) || ip.toLowerCase() === "fd00:ec2::254") throw new Error(`Blocked address (cloud metadata ${ip})`);
  }
}
