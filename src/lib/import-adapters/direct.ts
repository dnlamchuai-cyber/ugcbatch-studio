import { safeFetch } from "@/lib/ssrf-guard";
import {
  extractTikTokShopPrice,
  importFailCodeForStatus,
  isPlaceholderTitle,
  isShopeeShortLink,
  looksLikeBotWall,
  parseProductFromHtml,
  parseShopeeIds,
  parseShopeeItemJson,
  shopeeItemApiUrl,
} from "@/lib/product-ingest";
import type { AdapterResult, ImportAdapter, ImportContext } from "./types";

export const IMPORT_UA = "Mozilla/5.0 (compatible; UGCBatchStudio/1.0; +https://github.com/dnlamchuai-cyber/ugcbatch-studio)";
const MAX_HTML_BYTES = 3 * 1024 * 1024;

/** Shopee direct: resolve shp.ee short links, then the public item API (usually anti-bot blocked from servers). */
export const shopeeDirectAdapter: ImportAdapter = {
  id: "shopee-direct",
  applies: (ctx) => ctx.market === "shopee",
  async run(ctx: ImportContext): Promise<AdapterResult> {
    if (isShopeeShortLink(ctx.url)) {
      try {
        const r = await safeFetch(ctx.url, { headers: { "User-Agent": IMPORT_UA } });
        if (r.url) ctx.url = r.url; // later adapters use the resolved product URL
      } catch {
        /* keep the short link */
      }
    }
    const ids = parseShopeeIds(ctx.url);
    if (!ids) return { ok: false, adapter: this.id, code: "IMPORT_UNSUPPORTED", detail: "no shopid/itemid in URL" };
    try {
      const r = await safeFetch(shopeeItemApiUrl(ids), {
        headers: { "User-Agent": IMPORT_UA, Accept: "application/json", Referer: ctx.url },
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok && /json/i.test(r.headers.get("content-type") || "")) {
        const product = parseShopeeItemJson(await r.json(), ctx.url);
        if (product) return { ok: true, adapter: this.id, product };
      }
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: `item API HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** Any platform: fetch the product page and read og/meta/ld+json (plus TikTok Shop's embedded price). */
export const htmlPageAdapter: ImportAdapter = {
  id: "html-page",
  applies: () => true,
  async run(ctx: ImportContext): Promise<AdapterResult> {
    let html: string;
    try {
      const res = await safeFetch(ctx.url, {
        headers: { "User-Agent": IMPORT_UA, Accept: "text/html,application/xhtml+xml,*/*" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return { ok: false, adapter: this.id, code: ctx.market ? "IMPORT_BLOCKED" : importFailCodeForStatus(res.status), detail: `HTTP ${res.status}` };
      }
      if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") || "")) {
        return { ok: false, adapter: this.id, code: "IMPORT_UNSUPPORTED", message: "This link is not a web page (not HTML) and cannot be parsed" };
      }
      html = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_HTML_BYTES).toString("utf8");
    } catch (e) {
      const msg = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError") ? "Fetch timed out" : e instanceof Error ? e.message : String(e);
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: msg };
    }
    const product = parseProductFromHtml(html, ctx.url);
    if (ctx.market === "tiktok_shop" && !product.priceText) product.priceText = extractTikTokShopPrice(html);
    // Captcha / bot-wall pages ("Amazon.com", "Security Check", JD homepage…) are not products
    const placeholder = isPlaceholderTitle(product.title) && product.images.length === 0;
    if (placeholder || (ctx.market && product.images.length === 0 && (!product.title || looksLikeBotWall(html)))) {
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", partial: product, detail: placeholder ? `placeholder title "${product.title}"` : "bot wall" };
    }
    if (!product.title && product.images.length === 0) return { ok: false, adapter: this.id, code: "IMPORT_NOT_FOUND", partial: product };
    return { ok: true, adapter: this.id, product };
  },
};
