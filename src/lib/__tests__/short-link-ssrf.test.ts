// @vitest-environment node
// resolveShortLink goes through the REAL safeFetch (SSRF check + pinned dispatcher on every hop).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import dns from "dns";
import { resolveShortLink } from "@/lib/import-adapters";
import { shopeeDirectAdapter } from "@/lib/import-adapters/direct";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  // deterministic check-time DNS: short-link + shop hosts are public
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Shopee short links via safeFetch", () => {
  it("follows exactly one redirect; every hop is manual + pinned", async () => {
    const target = "https://shopee.vn/Quat-i.27395533.21891290157";
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }))
      .mockResolvedValueOnce(Object.defineProperty(new Response("ok"), "url", { value: target }));
    vi.stubGlobal("fetch", f);
    expect(await resolveShortLink("https://shp.ee/abc123")).toBe(target);
    expect(f).toHaveBeenCalledTimes(2);
    for (const [, init] of f.mock.calls) {
      expect((init as { redirect?: string }).redirect).toBe("manual");
      expect((init as { dispatcher?: unknown }).dispatcher).toBeTruthy();
    }
  });

  it("a short link redirecting to an internal address is not followed", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    vi.stubGlobal("fetch", f);
    expect(await resolveShortLink("https://shp.ee/evil")).toBe("https://shp.ee/evil");
    expect(f).toHaveBeenCalledTimes(1); // metadata hop rejected before any connection
  });

  it("non-short links are returned untouched without any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await resolveShortLink("https://shopee.vn/product/1/2")).toBe("https://shopee.vn/product/1/2");
    expect(f).not.toHaveBeenCalled();
  });

  it("shopee-direct fallback also stops after ONE redirect (2-hop chain is not followed)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://s.shopee.vn/hop1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://shopee.vn/Quat-i.27395533.21891290157" } }))
      .mockResolvedValue(new Response("should not be reached", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const ctx = { url: "https://shp.ee/two-hops", market: "shopee" as const, env: {} };
    const r = await shopeeDirectAdapter.run(ctx);
    expect(f).toHaveBeenCalledTimes(2); // short link + first hop; the second Location is refused
    expect(String(f.mock.calls[1][0])).toBe("https://s.shopee.vn/hop1");
    expect(ctx.url).toBe("https://shp.ee/two-hops"); // not resolved → no ids
    expect(r).toMatchObject({ ok: false, code: "IMPORT_UNSUPPORTED" });
  });
});
