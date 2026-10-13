import { createHash } from "crypto";
import { safeFetch } from "@/lib/ssrf-guard";
import { parseShopeeIds, type ProductIngest } from "@/lib/product-ingest";
import type { AdapterResult, ImportAdapter, ImportContext } from "./types";

/**
 * Layer 1 for Shopee: the official Shopee Affiliate Open API (GraphQL `productOfferV2`).
 * On only when SHOPEE_AFFILIATE_APP_ID and SHOPEE_AFFILIATE_SECRET are set.
 *   SHOPEE_AFFILIATE_ENDPOINT (optional) default https://open-api.affiliate.shopee.vn/graphql
 *
 * Auth (per Shopee affiliate docs + community SDKs):
 *   Authorization: SHA256 Credential=<appId>, Timestamp=<unix seconds>, Signature=<hex sha256(appId + ts + payload + secret)>
 * where payload is the EXACT JSON body string sent.
 *
 * Returns title, price and the single cover image, plus the offerLink; marked needsMorePhotos so the
 * UI asks for 2–4 more photos. UNVERIFIED against the live API until credentials are provided.
 */
export const SHOPEE_AFFILIATE_DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.vn/graphql";

export function shopeeAffiliateConfigured(env: Record<string, string | undefined>): boolean {
  return !!(env.SHOPEE_AFFILIATE_APP_ID && env.SHOPEE_AFFILIATE_SECRET);
}

export function shopeeAffiliateSignature(appId: string, timestamp: number, payload: string, secret: string): string {
  return createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
}

export function buildProductOfferPayload(shopId: string, itemId: string): string {
  if (!/^\d+$/.test(shopId) || !/^\d+$/.test(itemId)) throw new Error("invalid shopId/itemId");
  const query = `{ productOfferV2(shopId: ${shopId}, itemId: ${itemId}, limit: 1) { nodes { itemId shopId productName imageUrl price priceMin priceMax offerLink productLink shopName } } }`;
  return JSON.stringify({ query });
}

export function buildShopeeAffiliateRequest(shopId: string, itemId: string, env: Record<string, string | undefined>, now = Date.now()) {
  const appId = env.SHOPEE_AFFILIATE_APP_ID || "";
  const ts = Math.floor(now / 1000);
  const body = buildProductOfferPayload(shopId, itemId);
  return {
    endpoint: env.SHOPEE_AFFILIATE_ENDPOINT || SHOPEE_AFFILIATE_DEFAULT_ENDPOINT,
    body,
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${shopeeAffiliateSignature(appId, ts, body, env.SHOPEE_AFFILIATE_SECRET || "")}`,
    },
  };
}

function formatVnd(v: unknown): string | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return `₫${Math.round(n).toLocaleString("vi-VN")}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseProductOfferResponse(json: unknown, sourceUrl: string): { product?: ProductIngest; error?: string } {
  const j = json as any;
  if (Array.isArray(j?.errors) && j.errors.length) return { error: String(j.errors[0]?.message || "affiliate API error") };
  const node = j?.data?.productOfferV2?.nodes?.[0];
  if (!node?.productName) return {};
  const min = formatVnd(node.priceMin ?? node.price);
  const max = formatVnd(node.priceMax);
  return {
    product: {
      title: String(node.productName),
      priceText: min && max && max !== min ? `${min} - ${max}` : min,
      images: typeof node.imageUrl === "string" && node.imageUrl ? [node.imageUrl] : [],
      sourceUrl: typeof node.productLink === "string" && node.productLink ? node.productLink : sourceUrl,
      offerLink: typeof node.offerLink === "string" ? node.offerLink : undefined,
      needsMorePhotos: true,
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const shopeeAffiliateAdapter: ImportAdapter = {
  id: "shopee-affiliate",
  applies: (ctx) => ctx.market === "shopee" && shopeeAffiliateConfigured(ctx.env),
  async run(ctx: ImportContext): Promise<AdapterResult> {
    const ids = parseShopeeIds(ctx.url);
    if (!ids) return { ok: false, adapter: this.id, code: "IMPORT_UNSUPPORTED", detail: "no shopid/itemid in URL" };
    const { endpoint, body, headers } = buildShopeeAffiliateRequest(ids.shopId, ids.itemId, ctx.env);
    try {
      const r = await safeFetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15000) });
      const parsed = parseProductOfferResponse(await r.json().catch(() => ({})), ctx.url);
      if (parsed.product) return { ok: true, adapter: this.id, product: parsed.product };
      if (parsed.error || !r.ok) return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: `affiliate API: ${parsed.error || `HTTP ${r.status}`}` };
      return { ok: false, adapter: this.id, code: "IMPORT_NOT_FOUND", detail: "affiliate API: no offer for this item" };
    } catch (e) {
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: `affiliate API: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
