import "server-only";
import { parseProductFromHtml, parseShopeeItemJson, type ProductIngest } from "@/lib/product-ingest";

/**
 * Bridge to the Electron shell (electron/marketplace-window.cjs). Only exists when the Next server
 * was forked by the desktop app (UGC_DESKTOP_BRIDGE=1 + an IPC channel). On the web there is no
 * bridge and callers fall back to the manual-upload path.
 */
export function isDesktopBridgeAvailable(): boolean {
  return process.env.UGC_DESKTOP_BRIDGE === "1" && typeof process.send === "function";
}

type BridgeResult = { apiJson?: unknown; html?: string; domImages?: string[]; finalUrl?: string };

let seq = 0;
function requestWindowRead(url: string, timeoutMs: number): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const id = `mf-${Date.now()}-${++seq}`;
    const onMsg = (msg: unknown) => {
      const m = msg as { type?: string; id?: string; ok?: boolean; result?: BridgeResult; error?: string };
      if (m?.type !== "marketplace-fetch-result" || m.id !== id) return;
      cleanup();
      if (m.ok && m.result) resolve(m.result);
      else reject(new Error(m.error || "desktop read failed"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("desktop read timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      process.off("message", onMsg);
    };
    process.on("message", onMsg);
    process.send!({ type: "marketplace-fetch", id, url });
  });
}

/** Turn what the desktop window captured into a ProductIngest (API JSON first, then rendered HTML). */
export function productFromBridgeResult(r: BridgeResult, url: string): ProductIngest | undefined {
  const fromApi = r.apiJson ? parseShopeeItemJson(r.apiJson, url) : undefined;
  if (fromApi && (fromApi.title || fromApi.images.length)) return fromApi;
  if (!r.html) return undefined;
  const p = parseProductFromHtml(r.html, r.finalUrl || url);
  if (p.images.length === 0 && r.domImages?.length) p.images = Array.from(new Set(r.domImages)).slice(0, 12);
  return p;
}

export async function desktopFetchProduct(url: string, timeoutMs = 200000): Promise<ProductIngest | undefined> {
  if (!isDesktopBridgeAvailable()) return undefined;
  return productFromBridgeResult(await requestWindowRead(url, timeoutMs), url);
}
