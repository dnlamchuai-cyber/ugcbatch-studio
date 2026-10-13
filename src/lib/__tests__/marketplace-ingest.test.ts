import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  detectMarketplace,
  isShopeeShortLink,
  looksLikeBotWall,
  marketplaceBlockedMessage,
  parseProductFromHtml,
  parseShopeeIds,
  parseShopeeItemJson,
  shopeeImageUrl,
  shopeeItemApiUrl,
} from "@/lib/product-ingest";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("detectMarketplace", () => {
  it("recognizes Shopee country domains and short links", () => {
    expect(detectMarketplace("https://shopee.vn/Ao-chong-nang-i.123456.7890123")).toBe("shopee");
    expect(detectMarketplace("https://shopee.co.id/product/1/2")).toBe("shopee");
    expect(detectMarketplace("https://shopee.com.br/x-i.1.2")).toBe("shopee");
    expect(detectMarketplace("https://shp.ee/abc123")).toBe("shopee");
    expect(isShopeeShortLink("https://shp.ee/abc123")).toBe(true);
    expect(isShopeeShortLink("https://shopee.vn/x-i.1.2")).toBe(false);
  });

  it("recognizes TikTok Shop product links", () => {
    expect(detectMarketplace("https://shop.tiktok.com/view/product/1729384756")).toBe("tiktok_shop");
    expect(detectMarketplace("https://www.tiktok.com/view/product/1729384756")).toBe("tiktok_shop");
    expect(detectMarketplace("https://www.tiktok.com/@someone/video/1")).toBeUndefined();
  });

  it("leaves other stores (Taobao/JD/Amazon/Shopify/generic) to generic parsing", () => {
    for (const u of [
      "https://item.taobao.com/item.htm?id=1",
      "https://item.jd.com/1.html",
      "https://www.amazon.com/dp/B000",
      "https://store.myshopify.com/products/x",
      "https://example.com/p",
    ]) {
      expect(detectMarketplace(u)).toBeUndefined();
    }
  });
});

describe("parseShopeeIds", () => {
  it("parses -i.shopid.itemid slugs (including Vietnamese slugs)", () => {
    expect(parseShopeeIds("https://shopee.vn/%C3%81o-ch%E1%BB%91ng-n%E1%BA%AFng-i.123456.7890123?sp_atk=x")).toEqual({
      shopId: "123456",
      itemId: "7890123",
      host: "shopee.vn",
    });
  });

  it("parses /product/shopid/itemid and /shop-name/shopid/itemid", () => {
    expect(parseShopeeIds("https://shopee.vn/product/11/22")).toMatchObject({ shopId: "11", itemId: "22" });
    expect(parseShopeeIds("https://shopee.sg/myshop/33/44")).toMatchObject({ shopId: "33", itemId: "44" });
  });

  it("returns undefined for non-product or non-Shopee URLs", () => {
    expect(parseShopeeIds("https://shopee.vn/")).toBeUndefined();
    expect(parseShopeeIds("https://example.com/x-i.1.2")).toBeUndefined();
    expect(parseShopeeIds("not a url")).toBeUndefined();
  });

  it("builds the public item API URL", () => {
    expect(shopeeItemApiUrl({ shopId: "1", itemId: "2", host: "shopee.vn" })).toBe("https://shopee.vn/api/v4/item/get?itemid=2&shopid=1");
  });
});

describe("parseShopeeItemJson (fixture)", () => {
  it("extracts title, VND price, description and CDN images", () => {
    const p = parseShopeeItemJson(JSON.parse(fx("shopee-item-v4.json")), "https://shopee.vn/x-i.123456.7890123")!;
    expect(p.title).toBe("Áo chống nắng nữ UPF50+ làm mát");
    expect(p.priceText).toBe("159,000 ₫");
    expect(p.description).toContain("Vải làm mát");
    expect(p.images).toEqual([
      "https://down-vn.img.susercontent.com/file/vn-11134207-abc123",
      "https://down-vn.img.susercontent.com/file/vn-11134207-def456",
    ]);
  });

  it("supports the legacy v2 { item } shape and non-VND markets", () => {
    const p = parseShopeeItemJson({ item: { name: "Fan", price: 1990000, currency: "SGD", images: ["h1"] } }, "https://shopee.sg/x-i.1.2")!;
    expect(p.priceText).toBe("SGD 19.90");
    expect(p.images[0]).toBe("https://down-sg.img.susercontent.com/file/h1");
  });

  it("returns undefined for anti-bot / error payloads", () => {
    expect(parseShopeeItemJson({ error: 90309999, data: null }, "https://shopee.vn/x-i.1.2")).toBeUndefined();
    expect(parseShopeeItemJson(null, "https://shopee.vn/x-i.1.2")).toBeUndefined();
  });

  it("passes absolute image URLs through", () => {
    expect(shopeeImageUrl("https://cf.shopee.vn/file/a", "shopee.vn")).toBe("https://cf.shopee.vn/file/a");
  });
});

describe("HTML fallbacks (fixtures)", () => {
  it("Shopee og/meta fallback yields title + image", () => {
    const p = parseProductFromHtml(fx("shopee-page.html"), "https://shopee.vn/x-i.1.2");
    expect(p.title).toContain("Áo chống nắng");
    expect(p.images).toHaveLength(1);
  });

  it("TikTok Shop JSON-LD yields title, price and image", () => {
    const p = parseProductFromHtml(fx("tiktok-shop-page.html"), "https://shop.tiktok.com/view/product/1");
    expect(p.title).toBe("Cooling UPF 50+ Sun Hoodie");
    expect(p.priceText).toBe("$24.99");
    expect(p.images).toEqual(["https://p16-oec-va.ibyteimg.com/a.jpg"]);
  });

  it("detects anti-bot walls and produces a clear upload-photos message", () => {
    expect(looksLikeBotWall("<html><body>Please complete the captcha</body></html>")).toBe(true);
    expect(looksLikeBotWall(fx("tiktok-shop-page.html"))).toBe(false);
    expect(marketplaceBlockedMessage("shopee")).toMatch(/Shopee.*upload the product photos/);
    expect(marketplaceBlockedMessage("tiktok_shop")).toMatch(/TikTok Shop/);
  });

  it("Chinese marketplace HTML (1688/Taobao) still parses unchanged", () => {
    const html = `<meta property="og:title" content="夏季冰丝防晒衣 女"><meta property="og:image" content="https://img.alicdn.com/a.jpg">`;
    const p = parseProductFromHtml(html, "https://detail.1688.com/offer/1.html");
    expect(p.title).toBe("夏季冰丝防晒衣 女");
    expect(p.images).toEqual(["https://img.alicdn.com/a.jpg"]);
  });
});
