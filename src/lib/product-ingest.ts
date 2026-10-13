/**
 * One-click product URL ingest — paste a product page URL and automatically extract
 * title / price / description / product images.
 *
 * This is the standard link-first entry point for an e-commerce workflow.
 * Extraction priority: JSON-LD (schema.org Product) > OpenGraph > Twitter Card > <title>/<meta description>.
 * Pure functions (parsing decoupled from network), unit-testable;
 * downstream hands off to the existing analyzeProduct + script engine for selling-point extraction.
 */

export interface ProductIngest {
  title: string;
  priceText?: string;
  description?: string;
  images: string[]; // absolute URLs, deduplicated
  sourceUrl: string;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", CNY: "¥", RMB: "¥", EUR: "€", GBP: "£", JPY: "¥", HKD: "HK$", TWD: "NT$", KRW: "₩", AUD: "A$", CAD: "C$",
};

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Decode common HTML entities (e.g. &amp; &#39; frequently found in meta content).
 * Single-pass scan, each entity decoded exactly once: chained replace() calls would re-interpret
 * the `&` produced by an earlier replacement as the start of the next entity pattern
 * (e.g. `&amp;#39;` should remain as the literal `&#39;`, but chaining would wrongly decode it to `'`);
 * a single-pass callback prevents this.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCharCode(code) : m;
      }
      return NAMED_ENTITIES[e] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Get the content of a meta tag (by property or name), handling both attribute orderings.
 * content is matched with a backreference to its opening quote: (["'])((?:(?!\1).)*)\1
 * rather than [^"']* — otherwise content="Tom's Mug" would be cut off at the apostrophe.
 * The content value lands in capture group 2.
 */
export function getMeta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const k = escapeRe(key);
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=(["'])((?:(?!\\1).)*)\\1`, "i")) ||
      html.match(new RegExp(`<meta[^>]+content=(["'])((?:(?!\\1).)*)\\1[^>]*(?:property|name)=["']${k}["']`, "i"));
    if (m && m[2].trim()) return decodeEntities(m[2]);
  }
  return undefined;
}

/** Resolve a potentially relative URL to an absolute URL; returns the original value on failure */
export function toAbsolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// ==================== JSON-LD ====================

/* eslint-disable @typescript-eslint/no-explicit-any */
function findProductNode(data: any): any | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray(data)) {
    for (const d of data) {
      const f = findProductNode(d);
      if (f) return f;
    }
    return undefined;
  }
  const type = data["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return data;
  if (data["@graph"]) return findProductNode(data["@graph"]);
  return undefined;
}

/** Find the schema.org Product node inside JSON-LD script blocks */
export function extractJsonLdProduct(html: string): any | undefined {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const node = findProductNode(JSON.parse(m[1].trim()));
      if (node) return node;
    } catch {
      /* skip blocks with invalid JSON */
    }
  }
  return undefined;
}

/**
 * Price formatting: check whether price already contains a currency symbol or alphabetic currency code
 * before prepending one (to avoid double-prefixing like $$19.99);
 * treat 0 / negative / non-numeric values as invalid (to avoid emitting meaningless "$0").
 * Shared by both the JSON-LD and OpenGraph extraction paths.
 */
function formatPrice(price: unknown, currency: string | undefined): string | undefined {
  if (price == null) return undefined;
  const raw = String(price).trim();
  if (!raw) return undefined;
  // pure numeric 0/negative values are immediately invalid; symbol-prefixed strings (e.g. $0) are checked by parsed numeric value
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum <= 0) return undefined;
  const numeric = parseFloat(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  // already contains a currency symbol or an alphabetic currency prefix like "USD " — return as-is without adding another
  if (/[¥$€£₩]/.test(raw) || /^[A-Za-z]{2,3}[\s ]/.test(raw)) return raw;
  const cur = (currency || "").toUpperCase();
  const sym = CURRENCY_SYMBOL[cur] ?? (cur ? `${cur} ` : "");
  return `${sym}${raw}`;
}

function jsonLdPrice(node: any): string | undefined {
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const price = offers?.price ?? offers?.lowPrice ?? offers?.highPrice;
  return formatPrice(price, offers?.priceCurrency || node.priceCurrency);
}

function jsonLdImages(node: any): string[] {
  const img = node.image;
  if (!img) return [];
  const arr = Array.isArray(img) ? img : [img];
  return arr.map((x: any) => (typeof x === "string" ? x : x?.url)).filter((x: any): x is string => typeof x === "string" && x.length > 0);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ==================== Main parsing ====================

/** Parse product info from a product page HTML (JSON-LD first, OG/Twitter/title as fallback) */
export function parseProductFromHtml(html: string, baseUrl: string): ProductIngest {
  const ld = extractJsonLdProduct(html);

  // title
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title =
    (ld?.name && decodeEntities(String(ld.name))) ||
    getMeta(html, ["og:title", "twitter:title"]) ||
    (titleTag && decodeEntities(titleTag)) ||
    "";

  // price
  const ogPrice = getMeta(html, ["product:price:amount", "og:price:amount"]);
  const ogCur = getMeta(html, ["product:price:currency", "og:price:currency"]);
  const priceText = (ld && jsonLdPrice(ld)) || formatPrice(ogPrice, ogCur);

  // description
  const description =
    (ld?.description && decodeEntities(String(ld.description))) ||
    getMeta(html, ["og:description", "twitter:description", "description"]);

  // images: JSON-LD + OG + Twitter, all converted to absolute URLs, deduplicated
  const raw: string[] = [
    ...jsonLdImages(ld ?? {}),
    ...(getMeta(html, ["og:image", "og:image:secure_url"]) ? [getMeta(html, ["og:image", "og:image:secure_url"])!] : []),
    ...(getMeta(html, ["twitter:image", "twitter:image:src"]) ? [getMeta(html, ["twitter:image", "twitter:image:src"])!] : []),
  ];
  const seen = new Set<string>();
  const images: string[] = [];
  for (const u of raw) {
    if (!u) continue;
    const abs = toAbsolute(decodeEntities(u), baseUrl);
    if (!/^https?:\/\//i.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    images.push(abs);
  }

  return { title: title.trim(), priceText, description, images, sourceUrl: baseUrl };
}

// ==================== Marketplace adapters (Shopee / TikTok Shop) ====================

export type Marketplace = "shopee" | "tiktok_shop";

/** Shopee country domains (shopee.vn, shopee.co.id, shopee.com.br, ...) and the shp.ee short-link host. */
const SHOPEE_HOST_RE = /(^|\.)shopee\.(vn|sg|ph|com\.my|co\.th|co\.id|tw|com\.br|com\.mx|com\.co|cl)$/i;
const SHOPEE_SHORT_HOST_RE = /(^|\.)(shp\.ee|s\.shopee\.[a-z.]+)$/i;
const TIKTOK_SHOP_HOST_RE = /(^|\.)(shop\.tiktok\.com|tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Which marketplace adapter (if any) should handle this URL. Generic HTML parsing covers everything else. */
export function detectMarketplace(url: string): Marketplace | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  if (SHOPEE_HOST_RE.test(host) || SHOPEE_SHORT_HOST_RE.test(host)) return "shopee";
  if (TIKTOK_SHOP_HOST_RE.test(host) && (/shop\.tiktok\.com$/i.test(host) || /\/(view\/)?product\//i.test(url))) return "tiktok_shop";
  return undefined;
}

/** True for shp.ee / s.shopee.* short links that must be resolved (redirect-followed) before parsing ids. */
export function isShopeeShortLink(url: string): boolean {
  return SHOPEE_SHORT_HOST_RE.test(hostOf(url));
}

/**
 * Parse shopid/itemid from a Shopee product URL. Supported shapes:
 *   https://shopee.vn/Ten-san-pham-i.123456.7890123
 *   https://shopee.vn/product/123456/7890123
 *   https://shopee.vn/shop-name/123456/7890123
 */
export function parseShopeeIds(url: string): { shopId: string; itemId: string; host: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (!SHOPEE_HOST_RE.test(u.hostname)) return undefined;
  const path = decodeURIComponent(u.pathname);
  const m = path.match(/-i\.(\d+)\.(\d+)(?:$|[/?#])/) || path.match(/^\/(?:product|[^/]+)\/(\d+)\/(\d+)\/?$/);
  if (!m) return undefined;
  return { shopId: m[1], itemId: m[2], host: u.hostname.toLowerCase() };
}

/** Public item-detail endpoint for a Shopee listing (often blocked by anti-bot; caller must fall back). */
export function shopeeItemApiUrl(ids: { shopId: string; itemId: string; host: string }): string {
  return `https://${ids.host}/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`;
}

const SHOPEE_CURRENCY: Record<string, string> = {
  vn: "VND", sg: "SGD", ph: "PHP", my: "MYR", th: "THB", id: "IDR", tw: "TWD", br: "BRL", mx: "MXN", co: "COP", cl: "CLP",
};

function shopeeCountry(host: string): string {
  const m = host.match(/shopee\.(?:com\.|co\.)?([a-z]{2})$/i);
  return (m?.[1] || "vn").toLowerCase();
}

/** Shopee image hash → CDN URL (already-absolute URLs pass through). */
export function shopeeImageUrl(hash: string, host: string): string {
  if (/^https?:\/\//i.test(hash)) return hash;
  return `https://down-${shopeeCountry(host)}.img.susercontent.com/file/${hash}`;
}

function formatShopeePrice(raw: unknown, currency: string): string | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Shopee API prices are scaled by 100000 (e.g. 15000000000 → 150,000 VND).
  const value = n >= 100000 ? n / 100000 : n;
  if (currency === "VND") return `${Math.round(value).toLocaleString("en-US")} ₫`;
  return formatPrice(Number.isInteger(value) ? String(value) : value.toFixed(2), currency);
}

/**
 * Parse the JSON returned by Shopee's item endpoint (v4 `{ data: {...} }` or legacy v2 `{ item: {...} }`).
 * Returns undefined when the payload has no item (anti-bot challenge, error code, removed listing).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseShopeeItemJson(json: unknown, sourceUrl: string): ProductIngest | undefined {
  const j = json as any;
  const item = j?.data?.item ?? j?.data ?? j?.item;
  if (!item || typeof item !== "object" || !item.name) return undefined;
  const host = hostOf(sourceUrl) || "shopee.vn";
  const currency = String(item.currency || SHOPEE_CURRENCY[shopeeCountry(host)] || "").toUpperCase();
  const images: string[] = [];
  const seen = new Set<string>();
  for (const h of [item.image, ...(Array.isArray(item.images) ? item.images : [])]) {
    if (typeof h !== "string" || !h) continue;
    const abs = shopeeImageUrl(h, host);
    if (!seen.has(abs)) {
      seen.add(abs);
      images.push(abs);
    }
  }
  return {
    title: decodeEntities(String(item.name)),
    priceText: formatShopeePrice(item.price ?? item.price_min, currency),
    description: item.description ? String(item.description).trim() : undefined,
    images,
    sourceUrl,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Heuristic: the HTML is an anti-bot / captcha / login wall rather than a product page. */
export function looksLikeBotWall(html: string): boolean {
  return /captcha|verify\/traffic|anti[-_]?bot|security check|robot check|_____tmd_____|\/verify\?|Please log in|Đăng nhập/i.test(
    html.slice(0, 200000)
  );
}

/** User-facing error when a marketplace blocks automated fetching. */
export function marketplaceBlockedMessage(m: Marketplace): string {
  const name = m === "shopee" ? "Shopee" : "TikTok Shop";
  return `${name} blocked automatic import for this link (anti-bot protection). Please upload the product photos and paste the title/description manually.`;
}
