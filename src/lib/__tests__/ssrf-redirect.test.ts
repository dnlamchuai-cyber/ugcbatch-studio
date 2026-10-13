// @vitest-environment node
// Redirect-based SSRF against the three provider-probe routes, using a REAL local HTTP server that
// answers every request with a 302 to an internal address.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import dns from "dns";
import http from "http";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { POST as llmTest } from "@/app/api/llm/test/route";
import { POST as llmModels } from "@/app/api/llm/models/route";
import { POST as testProvider } from "@/app/api/ai/test-provider/route";
import { assertSafeBaseUrl, isBlockedIp, isMetadataIp, pinnedProviderFetch, PROVIDER_MAX_REDIRECTS } from "@/lib/ssrf-guard";

// public-looking hostname for the "flag off" path: the check-time DNS answer is public
const realLookup = dns.promises.lookup.bind(dns.promises);
beforeEach(() => {
  vi.spyOn(dns.promises, "lookup").mockImplementation(((host: string, opts?: unknown) =>
    host === "public-provider.test" ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : realLookup(host, opts as never)) as never);
});

let target = "http://127.0.0.1:1/";
const hits: string[] = [];
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((q, s) => {
    hits.push(q.url || "");
    const chain = q.url?.match(/^\/chain\/(\d+)$/);
    if (chain) {
      const n = Number(chain[1]);
      if (n === 0) s.end("end");
      else { s.writeHead(302, { location: `/chain/${n - 1}` }); s.end(); }
      return;
    }
    if (q.url === "/same-origin") { s.writeHead(302, { location: "/echo" }); s.end(); return; }
    if (q.url === "/echo") { s.setHeader("content-type", "application/json"); s.end(JSON.stringify(q.headers)); return; }
    if (q.url?.startsWith("/loop")) {
      s.writeHead(302, { location: `/loop${hits.length}` }); // relative, never ends
    } else {
      s.writeHead(302, { location: target });
    }
    s.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const callAll = async (baseUrl: string) => {
  const r1 = await llmTest(post({ baseUrl, apiKey: "k", model: "m" }));
  const r2 = await llmModels(post({ baseUrl, apiKey: "k" }));
  const r3 = await testProvider(post({ name: "custom", apiKey: "k", baseUrl }));
  return Promise.all([r1, r2, r3].map(async (r) => ({ status: r.status, json: await r.json() })));
};

describe("bare IP literals are rejected directly (all spellings)", () => {
  it("v4, v6, IPv4-mapped / compatible / NAT64", () => {
    for (const ip of ["127.0.0.1", "169.254.169.254", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:A9FE:A9FE", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "fe80::1%eth0", "fd00:ec2::254", "ff02::1", "2002:7f00:1::"]) {
      expect([ip, isBlockedIp(ip)]).toEqual([ip, true]);
    }
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("2606:4700::1111")).toBe(false);
    expect(isMetadataIp("::ffff:a9fe:a9fe")).toBe(true);
    expect(isMetadataIp("127.0.0.1")).toBe(false);
  });
});

describe("302 to an internal address is blocked on every route", () => {
  it("ALLOW_PRIVATE_BASEURL=1 (desktop): local endpoint allowed, but its 302 to cloud metadata is refused", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    for (const t of ["http://169.254.169.254/latest/meta-data/", "http://[::ffff:169.254.169.254]/"]) {
      target = t;
      const before = hits.length;
      const res = await callAll(`${base}/v1`);
      expect(hits.length).toBeGreaterThan(before); // really reached the local server and got its 302
      for (const r of res) {
        expect(r.status).toBe(400);
        expect(r.json.code).toBe("BASEURL_BLOCKED");
        expect(JSON.stringify(r.json)).toMatch(/Blocked address \(cloud metadata/);
      }
    }
  });

  it("ALLOW_PRIVATE_BASEURL unset: a public endpoint's 302 to 127.0.0.1 (the local server) is refused before connecting", async () => {
    // hop 0 is answered by the real local server's 302 (hostname resolved as public); hop 1 targets 127.0.0.1
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      if (u.hostname === "public-provider.test") {
        expect(init?.redirect).toBe("manual");
        target = `${base}/internal`;
        return realFetch(`${base}${u.pathname}`, { method: "GET", redirect: "manual" }); // the real 302 from the local server
      }
      return realFetch(url, init);
    });
    const before = hits.filter((h) => h === "/internal").length;
    const resAll = await callAll("http://public-provider.test/v1");
    for (const r of resAll) {
      expect(r.status).toBe(400);
      expect(r.json.code).toBe("BASEURL_BLOCKED");
      expect(JSON.stringify(r.json)).toMatch(/Blocked address \(private\/reserved 127\.0\.0\.1\)/);
    }
    expect(hits.filter((h) => h === "/internal").length).toBe(before); // never connected to the internal target
  });

  it("caps the redirect chain", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const before = hits.length;
    await expect(pinnedProviderFetch(`${base}/loop`)).rejects.toThrow(/Too many redirects/);
    expect(hits.length - before).toBe(PROVIDER_MAX_REDIRECTS + 1);
  });

  it("POST becomes GET on 302 (body dropped), like browsers", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    target = `${base}/loop-end`;
    // /loop-end itself starts with /loop → keeps redirecting; just check the 2nd request arrived as GET
    const seen: string[] = [];
    const s2 = http.createServer((q, s) => { seen.push(q.method || ""); if (seen.length === 1) { s.writeHead(302, { location: "/b" }); s.end(); } else { s.end("ok"); } });
    await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
    const res = await pinnedProviderFetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/a`, { method: "POST", body: "{}" });
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["POST", "GET"]);
    s2.close();
  });

  it("(d) follows 5 hops, blocks a 6-hop chain", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    expect(PROVIDER_MAX_REDIRECTS).toBe(5);
    expect(await (await pinnedProviderFetch(`${base}/chain/5`)).text()).toBe("end");
    await expect(pinnedProviderFetch(`${base}/chain/6`)).rejects.toThrow(/Too many redirects/);
    const r = await llmModels(post({ baseUrl: `${base}/chain/6#`, apiKey: "k" }));
    expect(r.status === 400 || (await r.clone().json()).ok === false).toBe(true);
  });

  it("(a) cross-origin redirect drops Authorization / x-api-key / api-key; same-origin keeps them", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    let seen: http.IncomingHttpHeaders = {};
    const other = http.createServer((q, s) => { seen = q.headers; s.end("{}"); });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/landing`;
    const headers = { Authorization: "Bearer sk-secret", "x-api-key": "sk-secret", "api-key": "sk-secret", "x-trace": "keep" };
    await pinnedProviderFetch(`${base}/to-other`, { headers });
    expect(seen.authorization).toBeUndefined();
    expect(seen["x-api-key"]).toBeUndefined();
    expect(seen["api-key"]).toBeUndefined();
    expect(seen["x-trace"]).toBe("keep");
    const same = await (await pinnedProviderFetch(`${base}/same-origin`, { headers })).json();
    expect(same.authorization).toBe("Bearer sk-secret");
    expect(same["x-api-key"]).toBe("sk-secret");
    other.close();
  });

  const viaPublicHost = (scheme: "http" | "https") => {
    const realFetch = globalThis.fetch;
    const dispatchers: unknown[] = [];
    vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit & { dispatcher?: unknown }) => {
      dispatchers.push(init?.dispatcher);
      const u = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      if (u.hostname === "public-provider.test") return realFetch(`${base}/redirect`, { redirect: "manual" });
      return realFetch(url, init);
    });
    return { url: `${scheme}://public-provider.test/v1`, dispatchers };
  };

  it("(b) unusual IP spellings in Location are normalised and blocked (flag off)", async () => {
    const port = (server.address() as AddressInfo).port;
    for (const loc of [`http://[::1]:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`, `http://2130706433:${port}/`, `http://0x7f.1:${port}/`, `http://0.0.0.0:${port}/`, `http://017700000001:${port}/`]) {
      target = loc;
      const before = hits.length;
      const { url, dispatchers } = viaPublicHost("http");
      for (const r of await callAll(url)) {
        expect([loc, r.status, r.json.code]).toEqual([loc, 400, "BASEURL_BLOCKED"]);
      }
      expect(hits.length - before).toBe(3); // only hop 0 reached the server, once per route
      expect(dispatchers.every(Boolean)).toBe(true); // every hop went through the pinned dispatcher
      vi.unstubAllGlobals();
    }
    for (const raw of ["http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://2130706433/", "http://0x7f.1/", "http://0.0.0.0/", "http://2852039166/"]) {
      await expect(assertSafeBaseUrl(raw, {})).rejects.toThrow(/Blocked address/);
    }
    await expect(assertSafeBaseUrl("http://2852039166/", { ALLOW_PRIVATE_BASEURL: "1" })).rejects.toThrow(/cloud metadata/); // 169.254.169.254
  });

  it("(c) https → http downgrade is blocked", async () => {
    target = "http://public-provider.test/v1/models";
    const { url } = viaPublicHost("https");
    for (const r of await callAll(url)) {
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.json)).toMatch(/https → http downgrade/);
    }
  });
});
