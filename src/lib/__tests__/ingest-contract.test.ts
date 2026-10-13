// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const fetchMock = vi.fn();
vi.mock("@/lib/ssrf-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/ssrf-guard")>()),
  safeFetch: (...a: unknown[]) => fetchMock(...a),
}));

import { POST } from "@/app/api/ingest/product/route";

const call = async (url: string) => {
  const res = await POST(new NextRequest("http://x/api/ingest/product", { method: "POST", body: JSON.stringify({ url, createProject: false }) }));
  return { status: res.status, body: await res.json() };
};
const html = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/html" } });

describe("product import API contract (HTTP 200 + ok flag)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("success → { ok: true, product }", async () => {
    fetchMock.mockResolvedValue(html('<meta property="og:title" content="Cooling Towel"><meta property="og:image" content="https://cdn.x/a.jpg">'));
    const r = await call("https://store.myshopify.com/products/towel");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.product.title).toBe("Cooling Towel");
  });

  it("Shopee anti-bot → IMPORT_BLOCKED with partial", async () => {
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    const r = await call("https://shopee.vn/product/1/2");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, code: "IMPORT_BLOCKED", partial: {} });
  });

  it("captcha placeholder title (Amazon.com) → IMPORT_BLOCKED, placeholder not kept", async () => {
    fetchMock.mockResolvedValue(html("<title>Amazon.com</title>"));
    const r = await call("https://www.amazon.com/dp/B000");
    expect(r.body).toMatchObject({ ok: false, code: "IMPORT_BLOCKED" });
    expect(r.body.partial.title).toBeUndefined();
  });

  it("404 → IMPORT_NOT_FOUND; empty page → IMPORT_NOT_FOUND", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect((await call("https://example.com/p/1")).body.code).toBe("IMPORT_NOT_FOUND");
    fetchMock.mockResolvedValue(html("<html></html>"));
    expect((await call("https://example.com/p/2")).body.code).toBe("IMPORT_NOT_FOUND");
  });

  it("non-HTML or invalid link → IMPORT_UNSUPPORTED", async () => {
    fetchMock.mockResolvedValue(new Response("%PDF", { headers: { "content-type": "application/pdf" } }));
    expect((await call("https://example.com/a.pdf")).body.code).toBe("IMPORT_UNSUPPORTED");
    expect((await call("ftp://nope")).body).toMatchObject({ ok: false, code: "IMPORT_UNSUPPORTED" });
  });
});

describe("no images is not success", () => {
  it("title + price but no images → ok:false IMPORT_PARTIAL with title/price prefilled", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(html('<title>MISSION Original Cooling Towel</title><meta property="product:price:amount" content="14.99"><meta property="product:price:currency" content="USD">'));
    const r = await call("https://store.example/products/towel");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, code: "IMPORT_PARTIAL", partial: { title: "MISSION Original Cooling Towel" } });
    expect(r.body.partial.price).toMatch(/14\.99/);
    expect(r.body.partial.images).toBeUndefined();
    expect(r.body.product).toBeUndefined();
  });
});
