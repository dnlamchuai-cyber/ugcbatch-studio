// @vitest-environment node
// SSRF follow-ups: per-hop timeout in pinnedProviderFetch, https→http downgrade in safeFetch, and the
// external-download helper used by the media download call sites. Uses REAL local HTTP servers.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import dns from "dns";
import http from "http";
import fs from "fs";
import type { AddressInfo } from "net";
import { pinnedProviderFetch, safeFetch, SsrfBlockedError, HOP_TIMEOUT_MS } from "@/lib/ssrf-guard";
import { downloadExternal, DownloadTooLargeError, isOwnMockAssetUrl } from "@/lib/external-download";

let server: http.Server;
let port = 0;
const sockets = new Set<import("net").Socket>();
beforeAll(async () => {
  server = http.createServer((q, s) => {
    const u = q.url || "";
    if (u === "/hang") return; // never answers
    if (u.startsWith("/redir?to=")) {
      s.writeHead(302, { location: decodeURIComponent(u.slice("/redir?to=".length)) });
      return s.end();
    }
    if (u === "/big") {
      // no Content-Length: chunked 3 × 1 KB
      s.writeHead(200, { "content-type": "application/octet-stream" });
      s.write(Buffer.alloc(1024));
      s.write(Buffer.alloc(1024));
      return s.end(Buffer.alloc(1024));
    }
    s.writeHead(200, { "content-type": "text/plain" });
    s.end("ok:" + u);
  });
  server.on("connection", (c) => { sockets.add(c); c.on("close", () => sockets.delete(c)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { for (const c of sockets) c.destroy(); server.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/**
 * safeFetch refuses loopback by design, so to exercise it against the real local server we make the
 * public-looking host "public.test" resolve to a public IP at check time and route the actual request
 * to 127.0.0.1:<port> (both http and https URLs are served by the plain-http test server).
 */
function routePublicHostToLocal() {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit & { dispatcher?: unknown }) => {
    const url = String(input);
    seen.push(url);
    const local = url.replace(/^https?:\/\/public\.test/, `http://127.0.0.1:${port}`);
    const { dispatcher: _d, ...rest } = init ?? {};
    void _d;
    return realFetch(local, rest);
  });
  return seen;
}

describe("pinnedProviderFetch per-hop timeout (real server)", () => {
  it(`aborts a hop that never answers after ${HOP_TIMEOUT_MS} ms`, async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const t0 = Date.now();
    const err = await pinnedProviderFetch(`http://127.0.0.1:${port}/hang`).then(() => null, (e: Error) => e);
    const elapsed = Date.now() - t0;
    expect(err?.name).toMatch(/TimeoutError|AbortError/);
    expect(elapsed).toBeGreaterThanOrEqual(HOP_TIMEOUT_MS - 200);
    expect(elapsed).toBeLessThan(HOP_TIMEOUT_MS + 5000);
  }, HOP_TIMEOUT_MS + 10000);

  it("a caller signal still aborts early (combined with the timeout, not replaced by it)", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = Date.now();
    const err = await pinnedProviderFetch(`http://127.0.0.1:${port}/hang`, { signal: ac.signal }).then(() => null, (e: Error) => e);
    expect(err?.name).toBe("AbortError");
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("normal responses are unaffected", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const r = await pinnedProviderFetch(`http://127.0.0.1:${port}/x`);
    expect(await r.text()).toBe("ok:/x");
  });
});

describe("safeFetch (real server)", () => {
  it("blocks an https → http downgrade on redirect", async () => {
    const seen = routePublicHostToLocal();
    const to = encodeURIComponent("http://public.test/plain");
    const err = await safeFetch(`https://public.test/redir?to=${to}`).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err?.message).toMatch(/https → http downgrade/);
    expect(seen).toEqual([`https://public.test/redir?to=${to}`]); // the http hop was never requested
  });

  it("still follows https → https and http → http redirects", async () => {
    routePublicHostToLocal();
    const a = await safeFetch(`https://public.test/redir?to=${encodeURIComponent("https://public.test/a")}`);
    expect(await a.text()).toBe("ok:/a");
    const b = await safeFetch(`http://public.test/redir?to=${encodeURIComponent("http://public.test/b")}`);
    expect(await b.text()).toBe("ok:/b");
  });

  it("times out a hop (custom timeoutMs) and combines it with a caller signal", async () => {
    routePublicHostToLocal();
    const t0 = Date.now();
    const err = await safeFetch("http://public.test/hang", {}, 4, { timeoutMs: 300 }).then(() => null, (e: Error) => e);
    expect(err?.name).toBe("TimeoutError");
    expect(Date.now() - t0).toBeLessThan(3000);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const err2 = await safeFetch("http://public.test/hang", { signal: ac.signal }, 4, { timeoutMs: 60_000 }).then(() => null, (e: Error) => e);
    expect(err2?.name).toBe("AbortError");
  });

  it("DNS rebinding (simulated answers, real socket): public at check time, loopback at connect time → refused", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }])) as never);
    const err = await safeFetch(`http://rebind.invalid:${port}/secret`).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(err?.cause?.message ?? err?.message).toMatch(/Blocked/);
  });
});

describe("downloadExternal", () => {
  it("reads this app's mock-provider assets from public/mock without any network call", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const url = "http://localhost:3000/mock/sample.png";
    expect(isOwnMockAssetUrl(url)).toBe(true);
    const { buf, contentType } = await downloadExternal(url, { maxBytes: 10 * 1024 * 1024, timeoutMs: 1000 });
    expect(buf.equals(fs.readFileSync("public/mock/sample.png"))).toBe(true);
    expect(contentType).toBe("image/png");
    expect(f).not.toHaveBeenCalled();
  });

  it("does not exempt other localhost URLs (SSRF guard still applies)", async () => {
    expect(isOwnMockAssetUrl(`http://127.0.0.1:${port}/mock/sample.png`)).toBe(false);
    await expect(downloadExternal(`http://127.0.0.1:${port}/x`, { maxBytes: 1024, timeoutMs: 1000 })).rejects.toThrow(/Blocked/);
    await expect(downloadExternal("http://localhost:3000/api/files/x.png", { maxBytes: 1024, timeoutMs: 1000 })).rejects.toThrow(/Blocked/);
  });

  it("streams the body and stops at maxBytes even without Content-Length", async () => {
    routePublicHostToLocal();
    await expect(downloadExternal("https://public.test/big", { maxBytes: 2000, timeoutMs: 5000 })).rejects.toBeInstanceOf(DownloadTooLargeError);
    const ok = await downloadExternal("https://public.test/big", { maxBytes: 4096, timeoutMs: 5000 });
    expect(ok.buf.byteLength).toBe(3072);
  });
});

describe("media download call sites use the SSRF-checked helper", () => {
  const sites = [
    "src/app/api/project/[id]/replicate/save/route.ts",
    "src/app/api/project/[id]/storyboard-grid/route.ts",
    "src/app/api/project/[id]/storyboard-film/route.ts",
    "src/lib/asset-persistence.ts",
    "src/lib/providers/openai.ts",
    "src/lib/tts.ts",
  ];
  for (const f of sites) {
    it(f, () => {
      const src = fs.readFileSync(f, "utf8");
      expect(src).toMatch(/downloadExternal\(/);
      expect(src).not.toMatch(/await fetch\((videoUrl|sourceUrl|ref|s, )/);
    });
  }
});
