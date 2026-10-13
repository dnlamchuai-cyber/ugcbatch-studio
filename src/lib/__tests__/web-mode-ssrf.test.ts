// @vitest-environment node
// WEB_MODE=1 hard-blocks private / loopback / link-local base URLs (even with ALLOW_PRIVATE_BASEURL=1),
// proven against a REAL trap server on 127.0.0.1 that must receive zero requests.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => [{ id: "p1" }] }) }) }),
}));

import { POST as gridPOST } from "@/app/api/project/[id]/storyboard-grid/route";
import { POST as filmPOST } from "@/app/api/project/[id]/storyboard-film/route";
import { POST as ttsPOST } from "@/app/api/tts/route";
import { POST as llmTestPOST } from "@/app/api/llm/test/route";
import { POST as replicateSavePOST } from "@/app/api/project/[id]/replicate/save/route";
import { POST as assetsPOST } from "@/app/api/project/[id]/assets/route";
import { fetchAtlasCatalog } from "@/lib/providers/atlas-catalog";
import { allowPrivateBaseUrl, assertSafeBaseUrl, isWebMode, safeFetch } from "@/lib/ssrf-guard";

let trap: http.Server;
let trapUrl = "";
let trapHits = 0;
beforeAll(async () => {
  trap = http.createServer((_q, s) => { trapHits++; s.end(JSON.stringify({ data: [], ok: true })); });
  await new Promise<void>((r) => trap.listen(0, "127.0.0.1", r));
  trapUrl = `http://127.0.0.1:${(trap.address() as AddressInfo).port}`;
});
afterAll(() => trap.close());
afterEach(() => vi.unstubAllEnvs());

const req = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = { params: Promise.resolve({ id: "p1" }) };
const webMode = () => { vi.stubEnv("WEB_MODE", "1"); vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1"); };

describe("WEB_MODE=1 + ALLOW_PRIVATE_BASEURL=1: private/metadata bases never reached; the trap sees nothing", () => {
  const bases = () => [`${trapUrl}/v1`, "http://169.254.169.254/latest", "http://10.0.0.7/v1", "http://[::1]:8080/v1"];

  // In web mode the client's baseUrl is ignored (system base from env). Two angles per route:
  //  (1) the client sends the trap / metadata base → it is never contacted;
  //  (2) the operator's SYSTEM_* base is itself private (misconfig) → 400 BASEURL_BLOCKED, still no request.
  it("storyboard-grid", async () => {
    webMode();
    for (const baseUrl of bases()) {
      await gridPOST(req("/api/project/p1/storyboard-grid", { scriptId: 1, provider: "atlas-cloud", model: "m", apiKey: "k", baseUrl }), params).catch(() => undefined);
      vi.stubEnv("SYSTEM_ATLAS_CLOUD_BASE_URL", baseUrl);
      const r = await gridPOST(req("/api/project/p1/storyboard-grid", { scriptId: 1, provider: "atlas-cloud", model: "m", apiKey: "k" }), params);
      expect(r.status, baseUrl).toBe(400);
      expect((await r.json()).code).toBe("BASEURL_BLOCKED");
      vi.stubEnv("SYSTEM_ATLAS_CLOUD_BASE_URL", "");
    }
    expect(trapHits).toBe(0);
  });

  it("storyboard-film (route gate, incl. the dryRun price/catalog path)", async () => {
    webMode();
    for (const baseUrl of bases()) {
      await filmPOST(req("/api/project/p1/storyboard-film", { scriptId: 1, provider: "atlas-cloud", model: "m", apiKey: "k", baseUrl, dryRun: true }), params).catch(() => undefined);
      vi.stubEnv("SYSTEM_ATLAS_CLOUD_BASE_URL", baseUrl);
      const r = await filmPOST(req("/api/project/p1/storyboard-film", { scriptId: 1, provider: "atlas-cloud", model: "m", apiKey: "k", dryRun: true }), params);
      expect(r.status, baseUrl).toBe(400);
      expect((await r.json()).code).toBe("BASEURL_BLOCKED");
      vi.stubEnv("SYSTEM_ATLAS_CLOUD_BASE_URL", "");
    }
    expect(trapHits).toBe(0);
  });

  it("the film's Atlas catalog call itself (fetchAtlasCatalog) is pinned: refused before connecting", async () => {
    webMode();
    for (const base of [`${trapUrl}/api/v1`, "http://169.254.169.254/api/v1"]) {
      await fetchAtlasCatalog(base, { ttlMs: 0 }).catch(() => undefined);
    }
    expect(trapHits).toBe(0);
  });

  it("tts", async () => {
    webMode();
    for (const baseUrl of bases()) {
      const cfg = { provider: "openai", baseUrl, apiKey: "k", model: "tts-1", voice: "alloy" };
      const r1 = await ttsPOST(req("/api/tts", { text: "xin chao", ttsConfig: cfg }));
      expect(r1.status, baseUrl).toBe(400); // client base ignored; no system TTS configured → "configure TTS"
      vi.stubEnv("SYSTEM_TTS_BASE_URL", baseUrl);
      vi.stubEnv("SYSTEM_TTS_API_KEY", "sys");
      const r2 = await ttsPOST(req("/api/tts", { text: "xin chao", ttsConfig: cfg }));
      expect(r2.status, baseUrl).toBe(400);
      expect((await r2.json()).code).toBe("BASEURL_BLOCKED");
      vi.stubEnv("SYSTEM_TTS_BASE_URL", "");
    }
    expect(trapHits).toBe(0);
  });

  it("llm/test", async () => {
    webMode();
    vi.stubEnv("GEMINI_API_KEY", "");
    for (const baseUrl of bases()) {
      const r = await llmTestPOST(req("/api/llm/test", { baseUrl, apiKey: "k", model: "m" }));
      expect(r.status, baseUrl).toBe(403); // probe routes are disabled in web mode
      expect((await r.json()).code).toBe("FORBIDDEN_IN_WEB_MODE");
    }
    expect(trapHits).toBe(0);
  });
});

describe("blocked media URLs map to 400 BASEURL_BLOCKED (not 500)", () => {
  for (const videoUrl of ["http://169.254.169.254/latest/meta-data/x.mp4", "http://127.0.0.1:9/x.mp4", "http://10.0.0.1/x.mp4"]) {
    it(`replicate/save ${videoUrl}`, async () => {
      const r = await replicateSavePOST(req("/api/project/p1/replicate/save", { videoUrl }), params);
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("BASEURL_BLOCKED");
    });
    it(`assets ${videoUrl}`, async () => {
      const r = await assetsPOST(req("/api/project/p1/assets", { shotId: 1, sourceUrl: videoUrl }), params);
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("BASEURL_BLOCKED");
    });
  }
});

describe("ALLOW_PRIVATE_BASEURL: desktop vs web", () => {
  it("flags", () => {
    expect(allowPrivateBaseUrl({ ALLOW_PRIVATE_BASEURL: "1" })).toBe(true);
    expect(allowPrivateBaseUrl({ ALLOW_PRIVATE_BASEURL: "1", WEB_MODE: "1" })).toBe(false);
    expect(isWebMode({ WEB_MODE: "true" })).toBe(true);
  });

  it("base URLs: desktop allows LAN/loopback (never metadata); web refuses all three", async () => {
    await expect(assertSafeBaseUrl("http://127.0.0.1:11434/v1", { ALLOW_PRIVATE_BASEURL: "1" })).resolves.toBeUndefined();
    await expect(assertSafeBaseUrl("http://192.168.1.5/v1", { ALLOW_PRIVATE_BASEURL: "1" })).resolves.toBeUndefined();
    await expect(assertSafeBaseUrl("http://169.254.169.254/", { ALLOW_PRIVATE_BASEURL: "1" })).rejects.toThrow(/metadata/);
    for (const u of ["http://127.0.0.1:11434/v1", "http://192.168.1.5/v1", "http://169.254.169.254/"]) {
      await expect(assertSafeBaseUrl(u, { ALLOW_PRIVATE_BASEURL: "1", WEB_MODE: "1" })).rejects.toThrow(/Blocked/);
    }
  });

  it("safeFetch media: desktop may read a local provider's loopback URL (real server); web mode keeps it blocked", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const before = trapHits;
    const ok = await safeFetch(`${trapUrl}/media.png`);
    expect(ok.status).toBe(200);
    expect(trapHits).toBe(before + 1);
    await expect(safeFetch("http://169.254.169.254/latest/")).rejects.toThrow(/metadata/);

    vi.stubEnv("WEB_MODE", "1");
    await expect(safeFetch(`${trapUrl}/media.png`)).rejects.toThrow(/Blocked/);
    expect(trapHits).toBe(before + 1);

    vi.stubEnv("WEB_MODE", "");
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "");
    await expect(safeFetch(`${trapUrl}/media.png`)).rejects.toThrow(/Blocked/); // default (no flags) = web-safe
    expect(trapHits).toBe(before + 1);
  });
});
