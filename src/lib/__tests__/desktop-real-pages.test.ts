// @vitest-environment node
// Fixtures trimmed from real pages captured by the Electron desktop window under xvfb (2026-10-13).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseProductFromHtml, isPlaceholderTitle } from "@/lib/product-ingest";
import { productFromBridgeResult } from "@/lib/desktop-bridge";

const amazon = fs.readFileSync(path.join(__dirname, "fixtures/amazon-desktop-page.html"), "utf8");

describe("Amazon page (no og/ld+json)", () => {
  it("reads title without the Amazon.com prefix / category suffix, buy-box price, hiRes gallery", () => {
    const p = parseProductFromHtml(amazon, "https://www.amazon.com/dp/B0DP4CYN9Z");
    expect(p.title).toBe('Amazon Basics Cooling Towels for Neck and Face, Sports, Workout Recovery, 40" x 12", Black/Gray/Aqua/Navy, 4-Pack');
    expect(p.priceText).toBe("VND195,824"); // buy box, not the carousel's VND49,021
    expect(p.images).toHaveLength(3);
    expect(p.images[0]).toMatch(/_AC_SL1500_\.jpg$/);
  });
  it("no buy-box price → no price (never a carousel price)", () => {
    const html = amazon.replace(/<div id="corePrice[\s\S]*?<\/div>/, "");
    expect(parseProductFromHtml(html, "https://www.amazon.com/dp/X").priceText).toBeUndefined();
  });
});

describe("desktop window ending on a wall is not a product", () => {
  it("Taobao login redirect (real: login.taobao.com/havanaone, title 登录)", () => {
    const r = productFromBridgeResult(
      { html: "<title>登录</title><img src='https://img.alicdn.com/a.png'>", domImages: ["https://img.alicdn.com/a.png"], finalUrl: "https://login.taobao.com/havanaone/login/login.htm?bizName=taobao" },
      "https://item.taobao.com/item.htm?id=576023488778"
    );
    expect(r).toBeUndefined();
  });
  it("1688 403 page", () => {
    expect(isPlaceholderTitle("403 Forbidden")).toBe(true);
    expect(productFromBridgeResult({ html: "<title>403 Forbidden</title>", finalUrl: "https://detail.1688.com/offer/1.html" }, "https://detail.1688.com/offer/1.html")).toBeUndefined();
  });
  it("DOM image fallback drops pixels, SVG badges and 40px thumbs", () => {
    const p = productFromBridgeResult(
      {
        html: '<meta property="og:title" content="Towel">',
        domImages: ["https://fls-na.amazon.com/1/batch/1/OP/x", "https://m.media-amazon.com/images/S/sash//a.svg", "https://m.media-amazon.com/images/I/41j9._AC_US40_.jpg", "https://m.media-amazon.com/images/I/91y._AC_SX522_.jpg"],
      },
      "https://shop.example/p"
    )!;
    expect(p.images).toEqual(["https://m.media-amazon.com/images/I/91y._AC_SX522_.jpg"]);
  });
});
