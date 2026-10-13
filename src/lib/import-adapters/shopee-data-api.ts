import { safeFetch } from "@/lib/ssrf-guard";
import type { ProductIngest } from "@/lib/product-ingest";
import type { AdapterResult, ImportAdapter, ImportContext } from "./types";

/**
 * Third-party Shopee data API adapter. Switched on purely by env:
 *   SHOPEE_DATA_API_KEY        (required) API key
 *   SHOPEE_DATA_API_BASE_URL   (required) e.g. https://api.vendor.example/v1
 *   SHOPEE_DATA_API_PATH       (optional) request path template, default "/product?url={url}"
 *                              placeholders: {url} {shopId} {itemId} (URL-encoded)
 *   SHOPEE_DATA_API_KEY_HEADER (optional) header name, default "Authorization" (sent as "Bearer <key>");
 *                              any other name sends the raw key (e.g. "x-api-key")
 * The response is mapped by `normalizeShopeeDataApiResponse`, which accepts the common field
 * names (title/name, price/price_text, images/image_urls…) so most vendors need no code change.
 */
export function shopeeDataApiConfigured(env: Record<string, string | undefined>): boolean {
  return !!(env.SHOPEE_DATA_API_KEY && env.SHOPEE_DATA_API_BASE_URL);
}

export function buildShopeeDataApiRequest(url: string, env: Record<string, string | undefined>) {
  const ids = url.match(/(?:\/product\/(\d+)\/(\d+))|(?:-i\.(\d+)\.(\d+))/);
  const shopId = ids?.[1] ?? ids?.[3] ?? "";
  const itemId = ids?.[2] ?? ids?.[4] ?? "";
  const path = (env.SHOPEE_DATA_API_PATH || "/product?url={url}")
    .replace("{url}", encodeURIComponent(url))
    .replace("{shopId}", encodeURIComponent(shopId))
    .replace("{itemId}", encodeURIComponent(itemId));
  const header = env.SHOPEE_DATA_API_KEY_HEADER || "Authorization";
  const key = env.SHOPEE_DATA_API_KEY || "";
  return {
    endpoint: `${(env.SHOPEE_DATA_API_BASE_URL || "").replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
    headers: { Accept: "application/json", [header]: header.toLowerCase() === "authorization" ? `Bearer ${key}` : key },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeShopeeDataApiResponse(json: unknown, sourceUrl: string): ProductIngest | undefined {
  const j = json as any;
  const d = j?.data?.item ?? j?.data?.product ?? j?.data ?? j?.product ?? j?.item ?? j;
  if (!d || typeof d !== "object") return undefined;
  const title = d.title ?? d.name ?? d.product_name;
  const rawImages: unknown[] = d.images ?? d.image_urls ?? d.imageUrls ?? d.photos ?? (d.image ? [d.image] : []);
  const images = (Array.isArray(rawImages) ? rawImages : [])
    .map((x: any) => (typeof x === "string" ? x : x?.url ?? x?.src))
    .filter((x: unknown): x is string => typeof x === "string" && /^https?:\/\//.test(x));
  const price = d.price_text ?? d.priceText ?? d.price_display ?? d.price ?? d.price_min;
  const currency = d.currency ? ` ${d.currency}` : "";
  if (!title && images.length === 0) return undefined;
  return {
    title: title ? String(title) : "",
    priceText: price !== undefined && price !== null && price !== "" ? `${price}${typeof price === "number" ? currency : ""}` : undefined,
    description: d.description ? String(d.description) : undefined,
    images: Array.from(new Set(images)),
    sourceUrl,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const shopeeDataApiAdapter: ImportAdapter = {
  id: "shopee-data-api",
  applies: (ctx) => ctx.market === "shopee" && shopeeDataApiConfigured(ctx.env),
  async run(ctx: ImportContext): Promise<AdapterResult> {
    const { endpoint, headers } = buildShopeeDataApiRequest(ctx.url, ctx.env);
    try {
      const r = await safeFetch(endpoint, { headers, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return { ok: false, adapter: this.id, code: r.status === 404 ? "IMPORT_NOT_FOUND" : "IMPORT_BLOCKED", detail: `data API HTTP ${r.status}` };
      const product = normalizeShopeeDataApiResponse(await r.json(), ctx.url);
      if (!product) return { ok: false, adapter: this.id, code: "IMPORT_NOT_FOUND", detail: "data API returned no product" };
      return { ok: true, adapter: this.id, product };
    } catch (e) {
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: `data API: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
