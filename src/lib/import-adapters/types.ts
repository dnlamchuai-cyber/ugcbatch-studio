import type { ImportFailCode, Marketplace, ProductIngest } from "@/lib/product-ingest";

/** Outcome of one adapter. `partial` keeps whatever was found so a later adapter / the UI can use it. */
export type AdapterResult =
  | { ok: true; product: ProductIngest; adapter: string }
  | { ok: false; code: ImportFailCode; message?: string; partial?: Partial<ProductIngest>; detail?: string; adapter: string };

export interface ImportContext {
  url: string;
  market: Marketplace | undefined;
  env: Record<string, string | undefined>;
}

/**
 * A product-data source. Adapters are tried in order; the first `ok` wins. New sources (e.g. a
 * paid Shopee data API) plug in here without touching the route or the UI flow.
 */
export interface ImportAdapter {
  id: string;
  /** Whether this adapter applies to the link (platform) and is configured (env keys present). */
  applies(ctx: ImportContext): boolean;
  run(ctx: ImportContext): Promise<AdapterResult>;
}
