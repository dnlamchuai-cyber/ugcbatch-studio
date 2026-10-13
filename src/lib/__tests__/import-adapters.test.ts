// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/lib/ssrf-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/ssrf-guard")>()),
  safeFetch: (...a: unknown[]) => fetchMock(...a),
}));

import { importProduct, IMPORT_ADAPTERS } from "@/lib/import-adapters";
import { buildShopeeDataApiRequest, normalizeShopeeDataApiResponse, shopeeDataApiConfigured } from "@/lib/import-adapters/shopee-data-api";
import { extractTikTokShopPrice, parseShopeeItemJson } from "@/lib/product-ingest";
import { isDesktopBridgeAvailable, productFromBridgeResult } from "@/lib/desktop-bridge";

const SHOPEE = "https://shopee.vn/product/27395533/21891290157";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ENV = { SHOPEE_DATA_API_KEY: "k123", SHOPEE_DATA_API_BASE_URL: "https://data.example/v1/" };

describe("Shopee third-party data API adapter (env switch)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("is off without both env vars, on with them", () => {
    expect(shopeeDataApiConfigured({})).toBe(false);
    expect(shopeeDataApiConfigured({ SHOPEE_DATA_API_KEY: "k" })).toBe(false);
    expect(shopeeDataApiConfigured(ENV)).toBe(true);
  });

  it("builds the request from the template and key header", () => {
    const a = buildShopeeDataApiRequest(SHOPEE, ENV);
    expect(a.endpoint).toBe(`https://data.example/v1/product?url=${encodeURIComponent(SHOPEE)}`);
    expect(a.headers.Authorization).toBe("Bearer k123");
    const b = buildShopeeDataApiRequest(SHOPEE, { ...ENV, SHOPEE_DATA_API_PATH: "/items/{shopId}/{itemId}", SHOPEE_DATA_API_KEY_HEADER: "x-api-key" });
    expect(b.endpoint).toBe("https://data.example/v1/items/27395533/21891290157");
    expect((b.headers as Record<string, string>)["x-api-key"]).toBe("k123");
  });

  it("normalizes common vendor shapes", () => {
    const p = normalizeShopeeDataApiResponse({ data: { name: "Quạt mini", price: 159000, currency: "VND", image_urls: ["https://cf.shopee.vn/file/a", { url: "https://cf.shopee.vn/file/b" }] } }, SHOPEE)!;
    expect(p).toMatchObject({ title: "Quạt mini", priceText: "159000 VND", images: ["https://cf.shopee.vn/file/a", "https://cf.shopee.vn/file/b"] });
    expect(normalizeShopeeDataApiResponse({ data: {} }, SHOPEE)).toBeUndefined();
  });

  it("when configured, the chain uses it first and skips the direct paths", async () => {
    fetchMock.mockResolvedValueOnce(json({ title: "Quạt mini", price_text: "₫159.000", images: ["https://cf.shopee.vn/file/a"] }));
    const r = await importProduct(SHOPEE, ENV);
    expect(r.ok).toBe(true);
    expect(r.adapter).toBe("shopee-data-api");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to direct + HTML when the data API fails, keeping BLOCKED", async () => {
    fetchMock.mockResolvedValue(json({ error: 90309999 }, 403));
    const r = await importProduct(SHOPEE, ENV);
    expect(r).toMatchObject({ ok: false, code: "IMPORT_BLOCKED" });
    expect(r.tried).toEqual(["shopee-data-api", "shopee-direct", "html-page"]);
  });

  it("without env the data API adapter is not tried", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    const r = await importProduct(SHOPEE, {});
    expect(r.tried).toEqual(["shopee-direct", "html-page"]);
  });

  it("adapter order is affiliate API → data API → direct → HTML → desktop", () => {
    expect(IMPORT_ADAPTERS.map((a) => a.id)).toEqual(["shopee-affiliate", "shopee-data-api", "shopee-direct", "html-page", "desktop-window"]);
  });
});

describe("parsers used by the adapters", () => {
  it("TikTok Shop price from hydration JSON (shape seen on live PDPs)", () => {
    expect(extractTikTokShopPrice('{"real_price":"$58.47","original_price":"$74.10"}')).toBe("$58.47");
    expect(extractTikTokShopPrice("<html></html>")).toBeUndefined();
  });

  it("Shopee pdp/get_pc shape (title + product_images + product_price)", () => {
    const p = parseShopeeItemJson(
      { data: { item: { title: "Quạt mini", currency: "VND" }, product_images: { images: ["vn-1", "vn-2"] }, product_price: { price: { single_value: 15900000000 } } } },
      SHOPEE
    )!;
    expect(p.title).toBe("Quạt mini");
    expect(p.images).toHaveLength(2);
    expect(p.priceText).toMatch(/159/);
  });

  it("desktop bridge: unavailable on the web; parses rendered HTML + DOM images", () => {
    expect(isDesktopBridgeAvailable()).toBe(false);
    const p = productFromBridgeResult(
      { html: '<meta property="og:title" content="Pet Hair Remover">', domImages: ["https://c/a.jpg", "https://c/a.jpg", "https://c/b.jpg"] },
      "https://shop.tiktok.com/view/product/1"
    )!;
    expect(p.title).toBe("Pet Hair Remover");
    expect(p.images).toEqual(["https://c/a.jpg", "https://c/b.jpg"]);
  });
});
