import { readFile } from "fs/promises";
import { join, resolve, sep, extname } from "path";

/** Directory that serves the offline mock provider's sample media (public/mock). */
export function mockAssetDir(cwd: string = process.cwd()): string {
  return resolve(cwd, "public", "mock");
}

/**
 * Read a mock-provider result (".../mock/sample.png") straight from public/mock instead of fetching it
 * over HTTP. Only the URL path is used — the host is ignored, so this never opens a network path to
 * localhost (no SSRF exemption). Returns null for anything outside public/mock (traversal, other paths).
 */
export async function readMockAsset(url: string, cwd?: string): Promise<{ buf: Buffer; ext: string } | null> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith("/mock/")) return null;
  const rel = pathname.slice("/mock/".length);
  if (!rel || rel.includes("\0") || rel.includes("\\")) return null;
  const dir = mockAssetDir(cwd);
  const file = resolve(join(dir, rel));
  if (!file.startsWith(dir + sep)) return null; // ../ traversal
  try {
    const buf = await readFile(file);
    return { buf, ext: extname(file).slice(1).toLowerCase() || "png" };
  } catch {
    return null;
  }
}
