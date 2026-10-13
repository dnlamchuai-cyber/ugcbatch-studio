// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "dns";
import { allowPrivateBaseUrl, assertSafeBaseUrl, pinnedDispatcher, pinnedLookup } from "@/lib/ssrf-guard";

const run = (host: string, all = false) =>
  new Promise<{ err: Error | null; addr?: unknown }>((resolve) =>
    pinnedLookup(host, { all }, (err, addr) => resolve({ err, addr }))
  );

afterEach(() => vi.restoreAllMocks());

describe("pinnedLookup (DNS-rebinding protection at connect time)", () => {
  it("rejects literal private / loopback / metadata IPs", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "::1"]) {
      expect((await run(ip)).err?.message).toMatch(/Blocked/);
    }
  });

  it("rejects a hostname whose DNS answer is private (rebinding)", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "169.254.169.254", family: 4 }])) as never);
    expect((await run("rebind.attacker.example")).err?.message).toMatch(/Blocked.*169\.254/);
  });

  it("rejects when ANY of several answers is private", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }])) as never);
    expect((await run("mixed.example")).err).toBeTruthy();
  });

  it("returns exactly the vetted public address", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "93.184.216.34", family: 4 }])) as never);
    expect((await run("ok.example")).addr).toBe("93.184.216.34");
    expect((await run("ok.example", true)).addr).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("safeFetch uses a shared pinned dispatcher", () => {
    expect(pinnedDispatcher()).toBe(pinnedDispatcher());
  });
});

describe("assertSafeBaseUrl (llm/test, llm/models, ai/test-provider)", () => {
  it("blocks private, loopback, link-local and metadata by default", async () => {
    for (const u of ["http://127.0.0.1:11434/v1", "http://10.1.2.3/v1", "http://169.254.169.254/latest", "http://[::1]:8080", "http://metadata.google.internal/"]) {
      await expect(assertSafeBaseUrl(u, {})).rejects.toThrow(/Blocked/);
    }
    await expect(assertSafeBaseUrl("file:///etc/passwd", {})).rejects.toThrow(/http/);
  });

  it("ALLOW_PRIVATE_BASEURL=1 allows local Ollama but never cloud metadata", async () => {
    const env = { ALLOW_PRIVATE_BASEURL: "1" };
    expect(allowPrivateBaseUrl(env)).toBe(true);
    await expect(assertSafeBaseUrl("http://127.0.0.1:11434/v1", env)).resolves.toBeUndefined();
    await expect(assertSafeBaseUrl("http://192.168.1.20:1234/v1", env)).resolves.toBeUndefined();
    await expect(assertSafeBaseUrl("http://169.254.169.254/latest/meta-data", env)).rejects.toThrow(/metadata/);
    await expect(assertSafeBaseUrl("http://metadata.google.internal/", env)).rejects.toThrow(/metadata/);
  });

  it("allows public IP literals", async () => {
    await expect(assertSafeBaseUrl("https://1.1.1.1/v1", {})).resolves.toBeUndefined();
  });
});

describe("provider calls go through the pinned dispatcher (rebinding closed)", () => {
  it("a hostname that rebinds to loopback after the check is refused at connect time", async () => {
    const http = await import("http");
    const srv = http.createServer((_q, r) => r.end("secret")).listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as { port: number }).port;
    const { pinnedProviderFetch } = await import("@/lib/ssrf-guard");
    // DNS now answers 127.0.0.1 for a "public" name (the rebinding second answer)
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }])) as never);
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "");
    const err = await pinnedProviderFetch(`http://rebind.example:${port}/v1/models`).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(err?.cause?.message ?? err?.message).toMatch(/Blocked/);
    // with ALLOW_PRIVATE_BASEURL=1 (local Ollama) the same LAN target is reachable…
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const ok = await pinnedProviderFetch(`http://rebind.example:${port}/`);
    expect(await ok.text()).toBe("secret");
    vi.unstubAllEnvs();
    srv.close();
  });

  it("…but cloud metadata stays blocked even with ALLOW_PRIVATE_BASEURL=1", async () => {
    const { metadataBlockingLookup } = await import("@/lib/ssrf-guard");
    const err = await new Promise<Error | null>((res) => metadataBlockingLookup("169.254.169.254", {}, (e) => res(e)));
    expect(err?.message).toMatch(/Blocked/);
    const ok = await new Promise<Error | null>((res) => metadataBlockingLookup("192.168.1.10", {}, (e) => res(e)));
    expect(ok).toBeNull();
  });

  it("llm/test, llm/models and ai/test-provider use pinnedProviderFetch", async () => {
    const fs = await import("fs");
    for (const f of ["src/app/api/llm/test/route.ts", "src/app/api/llm/models/route.ts", "src/app/api/ai/test-provider/route.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).toMatch(/pinnedProviderFetch|trackedProviderFetch/);
      expect(src).not.toMatch(/[^.\w]fetch\(probe\.url/);
    }
  });
});
