import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getUploadsDir } from "@/lib/paths";
import { mkdir, writeFile } from "fs/promises";
import { join, basename } from "path";
import {
  detectMarketplace,
  type ProductIngest,
  type ImportFailCode,
  importPartial,
} from "@/lib/product-ingest";

type ImportLocale = "vi" | "en";

/** Localized import messages (the `error` text); `code` stays the machine-readable contract. */
const IMPORT_MESSAGES = {
  manual: {
    en: "We couldn't read this product link automatically. Upload your product photos and type the product name.",
    vi: "Không thể tự động đọc liên kết sản phẩm này. Hãy tải ảnh sản phẩm lên và nhập tên sản phẩm.",
  },
  blocked: {
    en: "{name} blocked automatic import for this link (anti-bot protection). Please upload the product photos and paste the title/description manually.",
    vi: "{name} đã chặn nhập tự động cho liên kết này (chống bot). Hãy tải ảnh sản phẩm lên và dán tiêu đề/mô tả thủ công.",
  },
  partial: {
    en: "We found the product name but no photos. Upload your product photos to continue.",
    vi: "Đã tìm thấy tên sản phẩm nhưng không có ảnh. Hãy tải ảnh sản phẩm lên để tiếp tục.",
  },
  invalidUrl: {
    en: "Please provide a valid product link (http/https)",
    vi: "Vui lòng nhập liên kết sản phẩm hợp lệ (http/https)",
  },
  notHtml: {
    en: "This link is not a web page (not HTML) and cannot be parsed",
    vi: "Liên kết này không phải trang web (không phải HTML) nên không thể đọc được",
  },
} as const;

/** Locale for import messages: body/query `locale` wins, then Accept-Language; default English. */
function importLocale(req: NextRequest, bodyLocale?: unknown): ImportLocale {
  const explicit = (typeof bodyLocale === "string" ? bodyLocale : new URL(req.url).searchParams.get("locale") || "").trim().toLowerCase();
  if (explicit) return explicit.startsWith("vi") ? "vi" : "en";
  return (req.headers.get("accept-language") || "").trim().toLowerCase().startsWith("vi") ? "vi" : "en";
}

function importText(locale: ImportLocale, key: keyof typeof IMPORT_MESSAGES, vars: Record<string, string> = {}): string {
  return IMPORT_MESSAGES[key][locale].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/**
 * Import contract for the UI: failures are HTTP 200 with ok:false + a code + whatever was found,
 * so the page can switch to manual photo upload / name entry and prefill the partial data.
 */
function importFail(code: ImportFailCode, message: string, partial?: Partial<ProductIngest>, detail?: string) {
  return NextResponse.json({ ok: false, code, error: message, partial: importPartial(partial), ...(detail && { detail }) });
}
import { inferExtension, MAX_DOWNLOAD_BYTES } from "@/lib/providers/stock-types";
import { safeFetch } from "@/lib/ssrf-guard";
import { apiError } from "@/lib/api-error";
import { importProduct } from "@/lib/import-adapters";

const UA = "Mozilla/5.0 (compatible; ClipForge/1.0; +https://github.com/xixihhhh/clipforge)";
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

  const locale = importLocale(req, body.locale);
  let url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\/.+/i.test(url)) {
    return importFail("IMPORT_UNSUPPORTED", importText(locale, "invalidUrl"));
  }
  const createProject = body.createProject !== false;

  // Provider/adapter chain (src/lib/import-adapters): Shopee data API (if SHOPEE_DATA_API_KEY is set) →
  // Shopee direct API → product-page HTML → desktop window (Electron only). Failures keep partial data.
  const result = await importProduct(url);
  if (!result.ok) {
    const market = detectMarketplace(url);
    const message = result.messageKey
      ? importText(locale, result.messageKey)
      : result.code === "IMPORT_PARTIAL"
        ? importText(locale, "partial")
        : result.message ?? (market ? importText(locale, "blocked", { name: market === "shopee" ? "Shopee" : "TikTok Shop" }) : importText(locale, "manual"));
    return importFail(result.code, message, result.partial, result.detail);
  }
  const product: ProductIngest = result.product;
  // No images = not a usable import: manual photo upload with title/price prefilled
  if (product.images.length === 0) {
    return importFail("IMPORT_PARTIAL", importText(locale, "partial"), product);
  }
  url = product.sourceUrl || url;

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
    return NextResponse.json({ ok: true,
    ...(product.needsMorePhotos && { partial: true, needsPhotos: { min: 2, max: 4 } }), product, images: savedImages });
  }

  if (!createProject) return NextResponse.json({ ok: true, ...(product.needsMorePhotos && { partial: true, needsPhotos: { min: 2, max: 4 } }), product });

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
