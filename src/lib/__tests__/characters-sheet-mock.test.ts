// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";
import { readMockAsset } from "@/lib/mock-asset";

afterEach(() => vi.unstubAllEnvs());

describe("readMockAsset (mock media read from public/mock, never fetched)", () => {
  it("maps /mock/<file> to public/mock regardless of host", async () => {
    const a = await readMockAsset("http://localhost:3000/mock/sample.png");
    expect(a?.ext).toBe("png");
    expect(a?.buf.equals(readFileSync(join(process.cwd(), "public/mock/sample.png")))).toBe(true);
  });
  it("refuses traversal and non-mock paths", async () => {
    for (const u of [
      "http://localhost:3000/mock/../../package.json",
      "http://localhost:3000/mock/%2e%2e/%2e%2e/package.json",
      "http://localhost:3000/mock/..%2f..%2fpackage.json",
      "http://localhost:3000/mock/..%5c..%5cpackage.json",
      "http://localhost:3000/mock/",
      "http://localhost:3000/fonts/subtitle.ttf",
      "http://localhost:3000/mock/missing.png",
      "not a url",
    ]) {
      expect([u, await readMockAsset(u)]).toEqual([u, null]);
    }
  });
});

describe("POST /api/characters/sheet in mock mode", () => {
  it("returns 200 and stores the sheet (no fetch to localhost)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-"));
    vi.stubEnv("AI_PROVIDER_MOCK", "1");
    vi.stubEnv("APP_DATA_DIR", dir);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("@/app/api/characters/sheet/route");
    const res = await POST(new NextRequest("http://localhost/api/characters/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appearance: "woman, 30s, short black hair", provider: "mock", model: "mock/image-ugc" }),
    }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.url).toMatch(/^\/api\/files\/characters\/sheet-\d+\.png$/);
    expect(existsSync(join(dir, "uploads", "characters", j.url.split("/").pop()))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
