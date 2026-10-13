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
