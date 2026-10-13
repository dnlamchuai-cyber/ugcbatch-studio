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

describe("import messages follow the request locale (code unchanged)", () => {
  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}, q = "") =>
    POST(new NextRequest(`http://x/api/ingest/product${q}`, { method: "POST", headers, body: JSON.stringify({ createProject: false, ...body }) })).then((r) => r.json());

  it("Accept-Language vi → Vietnamese text; en/none → English", async () => {
    fetchMock.mockReset().mockResolvedValue(html("<html></html>"));
    const vi_ = await post({ url: "https://example.com/p/1" }, { "accept-language": "vi-VN,vi;q=0.9,en;q=0.8" });
    expect(vi_).toMatchObject({ ok: false, code: "IMPORT_NOT_FOUND" });
    expect(vi_.error).toBe("Không thể tự động đọc liên kết sản phẩm này. Hãy tải ảnh sản phẩm lên và nhập tên sản phẩm.");
    const en = await post({ url: "https://example.com/p/1" });
    expect(en.error).toMatch(/^We couldn't read this product link automatically/);
    for (const k of ["ok", "code", "error", "partial"]) expect(k in vi_ && k in en).toBe(true); // same { ok, code, error, partial } contract
  });

  it("body/query locale wins over the header; blocked, partial, invalid and not-HTML are localized", async () => {
    fetchMock.mockReset().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const blocked = await post({ url: "https://shopee.vn/product/1/2", locale: "vi" }, { "accept-language": "en-US" });
    expect(blocked.code).toBe("IMPORT_BLOCKED");
    expect(blocked.error).toMatch(/^Shopee đã chặn nhập tự động/);
    expect((await post({ url: "https://shopee.vn/product/1/2" }, { "accept-language": "vi" }, "?locale=en")).error).toMatch(/^Shopee blocked automatic import/);
    fetchMock.mockReset().mockResolvedValue(html('<meta property="og:title" content="Quạt mini"><meta property="product:price:amount" content="99000">'));
    const partial = await post({ url: "https://example.com/p/3", locale: "vi" });
    expect(partial.code).toBe("IMPORT_PARTIAL");
    expect(partial.error).toMatch(/^Đã tìm thấy tên sản phẩm/);
    expect((await post({ url: "ftp://nope", locale: "vi" })).error).toMatch(/^Vui lòng nhập liên kết sản phẩm hợp lệ/);
    fetchMock.mockReset().mockResolvedValue(new Response("%PDF", { headers: { "content-type": "application/pdf" } }));
    const pdf = await post({ url: "https://example.com/a.pdf", locale: "vi" });
    expect(pdf).toMatchObject({ code: "IMPORT_UNSUPPORTED", error: "Liên kết này không phải trang web (không phải HTML) nên không thể đọc được" });
  });
});
