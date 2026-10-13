import { safeFetch } from "@/lib/ssrf-guard";
import { readMockAsset } from "@/lib/mock-asset";
import { mockPublicBaseUrl } from "@/lib/providers/mock";

/** Thrown when a download is larger than the caller's limit (declared Content-Length or streamed bytes). */
export class DownloadTooLargeError extends Error {
  readonly code = "DOWNLOAD_TOO_LARGE";
  constructor(readonly size: number, readonly maxBytes: number) {
    super(`Download size ${size} exceeds the limit ${maxBytes}`);
    this.name = "DownloadTooLargeError";
  }
}

/** Thrown when the remote server answers with a non-2xx status. */
export class DownloadHttpError extends Error {
  constructor(readonly status: number) {
    super(`Download failed: HTTP ${status}`);
    this.name = "DownloadHttpError";
  }
}

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav" };

/**
 * True when `url` is a mock-provider asset served by this app (same origin as the mock provider's
 * base URL and a /mock/ path). Those are read from public/mock on disk, never fetched over HTTP, so no
 * localhost exemption is needed in the SSRF guard.
 */
export function isOwnMockAssetUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === new URL(mockPublicBaseUrl()).origin && u.pathname.startsWith("/mock/");
  } catch {
    return false;
  }
}

/**
 * Download an external http(s) URL through safeFetch (public IPs only, IP-pinned, redirects re-validated,
 * no https→http downgrade). The body is streamed and aborted as soon as it exceeds `maxBytes`.
 * `timeoutMs` covers each hop including reading the body, so large videos need a generous value.
 */
export async function downloadExternal(
  url: string,
  opts: { maxBytes: number; timeoutMs: number; signal?: AbortSignal }
): Promise<{ buf: Buffer; contentType: string }> {
  if (isOwnMockAssetUrl(url)) {
    const local = await readMockAsset(url);
    if (!local) throw new Error("Mock asset not found");
    if (local.buf.byteLength > opts.maxBytes) throw new DownloadTooLargeError(local.buf.byteLength, opts.maxBytes);
    return { buf: local.buf, contentType: MIME_BY_EXT[local.ext] ?? "application/octet-stream" };
  }
  const res = await safeFetch(url, { signal: opts.signal }, 4, { timeoutMs: opts.timeoutMs });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new DownloadHttpError(res.status);
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new DownloadTooLargeError(declared, opts.maxBytes);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!res.body) return { buf: Buffer.alloc(0), contentType };
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > opts.maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DownloadTooLargeError(total, opts.maxBytes);
    }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks), contentType };
}
