import "server-only";
import { desktopFetchProduct, isDesktopBridgeAvailable } from "@/lib/desktop-bridge";
import { detectMarketplace, type ProductIngest } from "@/lib/product-ingest";
import { htmlPageAdapter, shopeeDirectAdapter } from "./direct";
import { shopeeDataApiAdapter } from "./shopee-data-api";
import { shopeeAffiliateAdapter } from "./shopee-affiliate";
import { assertPublicUrl } from "@/lib/ssrf-guard";
import { isShopeeShortLink } from "@/lib/product-ingest";
import type { AdapterResult, ImportAdapter, ImportContext } from "./types";

export type { AdapterResult, ImportAdapter, ImportContext } from "./types";

/** Desktop app only: read the page in a real browser window with the customer's own IP/session. */
export const desktopWindowAdapter: ImportAdapter = {
  id: "desktop-window",
  applies: () => isDesktopBridgeAvailable(),
  async run(ctx) {
    try {
      const p = await desktopFetchProduct(ctx.url);
      if (p && (p.title || p.images.length)) return { ok: true, adapter: this.id, product: p };
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", partial: p, detail: "desktop window found no product" };
    } catch (e) {
      return { ok: false, adapter: this.id, code: "IMPORT_BLOCKED", detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

/**
 * Order matters: Shopee Affiliate Open API (layer 1) → third-party data API (layer 2) → free direct
 * paths → desktop window. Layers 1–2 only run when their env keys are set.
 */
export const IMPORT_ADAPTERS: ImportAdapter[] = [shopeeAffiliateAdapter, shopeeDataApiAdapter, shopeeDirectAdapter, htmlPageAdapter, desktopWindowAdapter];

function mergePartial(a: Partial<ProductIngest> | undefined, b: Partial<ProductIngest> | undefined): Partial<ProductIngest> | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    title: a.title || b.title,
    priceText: a.priceText || b.priceText,
    description: a.description || b.description,
    images: a.images?.length ? a.images : b.images,
  };
}

/**
 * Run the adapter chain. The first success wins; otherwise return the most specific failure
 * (UNSUPPORTED > BLOCKED > NOT_FOUND) with everything any adapter found as `partial`.
 */
export async function importProduct(
  url: string,
  env: Record<string, string | undefined> = process.env,
  adapters: ImportAdapter[] = IMPORT_ADAPTERS
): Promise<AdapterResult & { tried: string[] }> {
  const ctx: ImportContext = { url: await resolveShortLink(url), market: detectMarketplace(url), env };
  const tried: string[] = [];
  let partial: Partial<ProductIngest> | undefined;
  let lastFail: Extract<AdapterResult, { ok: false }> | undefined;
  for (const a of adapters) {
    if (!a.applies(ctx)) continue;
    tried.push(a.id);
    const r = await a.run(ctx);
    if (r.ok) return { ...r, tried };
    partial = mergePartial(partial, r.partial);
    if (r.code === "IMPORT_UNSUPPORTED" && a.id === "html-page") return { ...r, partial, tried };
    // most useful failure for the UI: PARTIAL (has title/price) > BLOCKED > NOT_FOUND
    const rank = (c: string) => (c === "IMPORT_PARTIAL" ? 3 : c === "IMPORT_BLOCKED" ? 2 : 1);
    if (!lastFail || rank(r.code) >= rank(lastFail.code)) lastFail = r;
  }
  const fail = lastFail ?? { ok: false as const, adapter: "none", code: "IMPORT_NOT_FOUND" as const };
  return { ...fail, partial, tried };
}

/** shp.ee / s.shopee.* short links: follow exactly one redirect (SSRF-checked) to get shopId/itemId. */
export async function resolveShortLink(url: string): Promise<string> {
  if (!isShopeeShortLink(url)) return url;
  try {
    await assertPublicUrl(url);
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0" } });
    const loc = r.headers.get("location");
    return r.status >= 300 && r.status < 400 && loc ? new URL(loc, url).href : url;
  } catch {
    return url;
  }
}
