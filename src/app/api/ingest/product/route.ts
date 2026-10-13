import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getUploadsDir } from "@/lib/paths";
import { mkdir, writeFile } from "fs/promises";
import { join, basename } from "path";
import {
  detectMarketplace,
  isShopeeShortLink,
  looksLikeBotWall,
  marketplaceBlockedMessage,
  parseProductFromHtml,
  parseShopeeIds,
  parseShopeeItemJson,
  shopeeItemApiUrl,
  type ProductIngest,
  type ImportFailCode,
  importFailCodeForStatus,
  importPartial,
  isPlaceholderTitle,
} from "@/lib/product-ingest";

const MANUAL_MESSAGE = "We couldn't read this product link automatically. Upload your product photos and type the product name.";

/**
 * Import contract for the UI: failures are HTTP 200 with ok:false + a code + whatever was found,
 * so the page can switch to manual photo upload / name entry and prefill the partial data.
 */
function importFail(req: NextRequest, code: ImportFailCode, message: string, partial?: Partial<ProductIngest>, detail?: string) {
  return NextResponse.json({ ok: false, code, error: errText(req, message, message), partial: importPartial(partial), ...(detail && { detail }) });
}
import { inferExtension, MAX_DOWNLOAD_BYTES } from "@/lib/providers/stock-types";
import { safeFetch } from "@/lib/ssrf-guard";
import { apiError, errText } from "@/lib/api-error";

const UA = "Mozilla/5.0 (compatible; ClipForge/1.0; +https://github.com/xixihhhh/clipforge)";
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 3;

/** Download a single product image to local disk with SSRF protection (safeFetch validates each redirect hop to block og:image pointing to internal addresses). */
async function safeDownloadImage(url: string, destDir: string, base: string): Promise<string> {
  const res = await safeFetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Image download failed ${res.status}`);
  const ct = res.headers.get("content-type");
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_DOWNLOAD_BYTES) throw new Error("Image too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("Image too large");
  const filePath = join(destDir, `${base}.${inferExtension(url, ct, "image")}`);
  await writeFile(filePath, buf);
  return filePath;
}

/**
 * POST /api/ingest/product — one-click product link import.
 * body: { url, createProject? } (createProject defaults to true: create a commerce project + download the first 3 product images)
 * Fetch product page → parse title/price/description/images → (optionally) persist as a project; the frontend/MCP can then use the projectId to go straight to script → video generation.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError(req, "Request body is not valid JSON", "Request body is not valid JSON");
  }

  let url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\/.+/i.test(url)) {
    return importFail(req, "IMPORT_UNSUPPORTED", "Please provide a valid product link (http/https)");
  }
  const createProject = body.createProject !== false;

  const market = detectMarketplace(url);
  let product: ProductIngest | undefined;

  // Shopee: resolve shp.ee short links, then try the public item API (shopid/itemid from the URL).
  // Shopee's anti-bot often rejects server-side requests; every failure here silently falls through
  // to og/meta HTML parsing and finally to a clear "upload photos instead" error.
  if (market === "shopee") {
    if (isShopeeShortLink(url)) {
      try {
        const r = await safeFetch(url, { headers: { "User-Agent": UA } });
        if (r.url) url = r.url;
      } catch {
        /* keep the short link; HTML fallback below */
      }
    }
    const ids = parseShopeeIds(url);
    if (ids) {
      try {
        const r = await safeFetch(shopeeItemApiUrl(ids), {
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
            Referer: url,
          },
        });
        if (r.ok && /json/i.test(r.headers.get("content-type") || "")) {
          product = parseShopeeItemJson(await r.json(), url);
        }
      } catch {
        /* blocked or network error — fall back to HTML meta tags */
      }
    }
  }

  if (!product) {
    // Fetch HTML (descriptive UA + timeout + size cap)
    let html: string;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      // safeFetch: blocks internal/metadata addresses + validates each redirect hop (SSRF prevention)
      const res = await safeFetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        if (market) return importFail(req, "IMPORT_BLOCKED", marketplaceBlockedMessage(market), undefined, `HTTP ${res.status}`);
        return importFail(req, importFailCodeForStatus(res.status), `Failed to fetch product page: HTTP ${res.status}`, undefined, `HTTP ${res.status}`);
      }
      const ct = res.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml/i.test(ct)) {
        return importFail(req, "IMPORT_UNSUPPORTED", "This link is not a web page (not HTML) and cannot be parsed");
      }
      const buf = Buffer.from(await res.arrayBuffer());
      html = buf.subarray(0, MAX_HTML_BYTES).toString("utf8");
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError" ? errText(req, "Fetch timed out", "Fetch timed out") : e instanceof Error ? e.message : String(e);
      return importFail(req, "IMPORT_BLOCKED", `Failed to fetch product page: ${msg}`, undefined, msg);
    }

    product = parseProductFromHtml(html, url);
    // Captcha / bot-wall pages ("Amazon.com", "Security Check", JD homepage…) are not products
    const placeholder = isPlaceholderTitle(product.title) && product.images.length === 0;
    if (placeholder || (market && product.images.length === 0 && (!product.title || looksLikeBotWall(html)))) {
      return importFail(req, "IMPORT_BLOCKED", market ? marketplaceBlockedMessage(market) : MANUAL_MESSAGE, product);
    }
  }
  if (!product.title && product.images.length === 0) {
    return importFail(req, "IMPORT_NOT_FOUND", MANUAL_MESSAGE, product);
  }
  // No images = not a usable import: send the UI to manual photo upload with title/price prefilled
  if (product.images.length === 0) {
    return importFail(req, "IMPORT_PARTIAL", "We found the product name but no photos. Upload your product photos to continue.", product);
  }

  // Library-import mode: no project — download the product images into the product-library
  // storage (uploads/products/<id>/) and return persistent /api/files URLs. The page shows the
  // parsed fields in an editable review card; nothing enters the library until the user confirms.
  const libraryProductId = typeof body.libraryProductId === "string" && /^[a-zA-Z0-9\-]+$/.test(body.libraryProductId) ? body.libraryProductId : undefined;
  if (libraryProductId) {
    const destDir = join(getUploadsDir(), "products", libraryProductId);
    await mkdir(destDir, { recursive: true });
    const savedImages: string[] = [];
    for (const [i, img] of product.images.slice(0, MAX_IMAGES).entries()) {
      try {
        const filePath = await safeDownloadImage(img, destDir, `ingest_${Date.now()}_${i}`);
        savedImages.push(`/api/files/products/${libraryProductId}/${basename(filePath)}`);
      } catch {
        /* Skip images that fail to download or are blocked by SSRF protection */
      }
    }
    return NextResponse.json({ ok: true, product, images: savedImages });
  }

  if (!createProject) return NextResponse.json({ ok: true, product });

  // Create a commerce project + download the first few product images and persist them
  const db = getDb();
  const name = (product.title || "Imported product").slice(0, 60);
  const [proj] = await db
    .insert(projects)
    .values({
      name,
      contentType: "product",
      productName: name,
      productDescription: product.description ?? null,
      productPrice: product.priceText ?? null,
      // Preserve the storefront link so it can flow into publish copy (UTM-tagged) and an end-card QR code
      shopUrl: url,
      productImages: [],
    })
    .returning();

  const destDir = join(getUploadsDir(), proj.id);
  await mkdir(destDir, { recursive: true });
  const saved: string[] = [];
  for (const [i, img] of product.images.slice(0, MAX_IMAGES).entries()) {
    try {
      const filePath = await safeDownloadImage(img, destDir, `ingest_${Date.now()}_${i}`);
      saved.push(`/api/files/${proj.id}/${basename(filePath)}`);
    } catch {
      /* Skip images that fail to download or are blocked by SSRF protection */
    }
  }
  if (saved.length > 0) {
    await db.update(projects).set({ productImages: saved, updatedAt: new Date() }).where(eq(projects.id, proj.id));
  }

  return NextResponse.json({
    ok: true,
    projectId: proj.id,
    product,
    productImages: saved,
  });
}
