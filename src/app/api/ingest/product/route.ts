import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getUploadsDir } from "@/lib/paths";
import { mkdir, writeFile } from "fs/promises";
import { join, basename } from "path";
import {
  detectMarketplace,
  marketplaceBlockedMessage,
  type ProductIngest,
  type ImportFailCode,
  importPartial,
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

  let url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\/.+/i.test(url)) {
    return importFail(req, "IMPORT_UNSUPPORTED", "Please provide a valid product link (http/https)");
  }
  const createProject = body.createProject !== false;

  // Provider/adapter chain (src/lib/import-adapters): Shopee data API (if SHOPEE_DATA_API_KEY is set) →
  // Shopee direct API → product-page HTML → desktop window (Electron only). Failures keep partial data.
  const result = await importProduct(url);
  if (!result.ok) {
    const market = detectMarketplace(url);
    const message = result.message || (market ? marketplaceBlockedMessage(market) : MANUAL_MESSAGE);
    return importFail(req, result.code, message, result.partial, result.detail);
  }
  const product: ProductIngest = result.product;
  // No images = not a usable import: manual photo upload with title/price prefilled
  if (product.images.length === 0) {
    return importFail(req, "IMPORT_PARTIAL", "We found the product name but no photos. Upload your product photos to continue.", product);
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
