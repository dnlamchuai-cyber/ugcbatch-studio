// @vitest-environment node
// WEB_MODE=1: client-sent apiKey / baseUrl are ignored; the system key/base from env are used.
// A REAL trap server on 127.0.0.1 stands in for the client's base and must see zero requests.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "http";
import dns from "dns";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { ESLint } from "eslint";
import { GET as configGET } from "@/app/api/config/route";
import { POST as testProviderPOST } from "@/app/api/ai/test-provider/route";
import { POST as llmTestPOST } from "@/app/api/llm/test/route";
import { POST as llmModelsPOST } from "@/app/api/llm/models/route";
import { POST as ttsPOST } from "@/app/api/tts/route";
import { POST as imagePOST } from "@/app/api/ai/image/route";
import { applyWebModeOverrides } from "@/lib/web-mode";
import { SERVER_LLM_KEY, SERVER_LLM_MODEL, GEMINI_BASE_URL } from "@/lib/llm-server-default";

let trap: http.Server;
let trapUrl = "";
let trapHits = 0;
beforeAll(async () => {
  trap = http.createServer((_q, s) => { trapHits++; s.end("{}"); });
  await new Promise<void>((r) => trap.listen(0, "127.0.0.1", r));
  trapUrl = `http://127.0.0.1:${(trap.address() as AddressInfo).port}`;
});
afterAll(() => trap.close());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const req = (p: string, body: unknown) => new NextRequest(`http://localhost${p}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

/** Public-looking system hosts resolve to a public IP; outgoing requests are captured (and answered) here. */
function captureOutbound(answer: (url: string) => Response) {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const realLookup = dns.promises.lookup.bind(dns.promises);
  vi.spyOn(dns.promises, "lookup").mockImplementation(((h: string, o?: unknown) =>
    h.endsWith(".test") || h === "generativelanguage.googleapis.com" ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : realLookup(h, o as never)) as never);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return answer(url);
  });
  return seen;
}

describe("GET /api/config", () => {
  it("returns exactly { webMode: boolean }", async () => {
    vi.stubEnv("WEB_MODE", "1");
    vi.stubEnv("GEMINI_API_KEY", "secret");
    const r = configGET();
    expect(await r.json()).toStrictEqual({ webMode: true });
    vi.stubEnv("WEB_MODE", "");
    expect(await configGET().json()).toStrictEqual({ webMode: false });
  });
});

describe("applyWebModeOverrides", () => {
  it("replaces every client key/base with env values; no-op outside web mode", () => {
    const body = () => ({
      provider: "atlas-cloud", apiKey: "client-key", baseUrl: trapUrl,
      llmConfig: { baseUrl: trapUrl, apiKey: "client-llm", model: "gpt" },
      ttsConfig: { provider: "openai", baseUrl: trapUrl, apiKey: "client-tts", model: "tts-1", voice: "alloy" },
      providers: [{ name: "fal-ai", apiKey: "client-fal", baseUrl: trapUrl }],
      apiKeys: { pexels: "client-pexels" },
    });
    expect(applyWebModeOverrides(body(), {})).toStrictEqual(body());
    const env = { WEB_MODE: "1", SYSTEM_ATLAS_CLOUD_API_KEY: "sys-atlas", SYSTEM_TTS_API_KEY: "sys-tts", SYSTEM_TTS_BASE_URL: "https://tts.sys.test/v1", SYSTEM_FAL_AI_API_KEY: "sys-fal" };
    const out = applyWebModeOverrides(body(), env) as Record<string, unknown>;
    expect(out).toMatchObject({ apiKey: "sys-atlas", baseUrl: "" });
    expect(out.llmConfig).toStrictEqual({ baseUrl: GEMINI_BASE_URL, apiKey: SERVER_LLM_KEY, model: SERVER_LLM_MODEL });
    expect(out.ttsConfig).toMatchObject({ baseUrl: "https://tts.sys.test/v1", apiKey: "sys-tts", model: "tts-1", voice: "alloy" });
    expect(out.providers).toStrictEqual([{ name: "fal-ai", apiKey: "sys-fal", baseUrl: "" }]);
    expect(out.apiKeys).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/client-|127\.0\.0\.1/);
  });
});

describe("routes ignore client apiKey/baseUrl in web mode (curl-style bodies)", () => {
  it("probe routes (llm/test, llm/models, ai/test-provider) → 403 FORBIDDEN_IN_WEB_MODE with zero outbound requests, even with system keys set", async () => {
    vi.stubEnv("WEB_MODE", "1");
    vi.stubEnv("GEMINI_API_KEY", "sys-gemini");
    vi.stubEnv("SYSTEM_OPENAI_API_KEY", "sys-openai");
    vi.stubEnv("SYSTEM_OPENAI_BASE_URL", "https://openai.sys.test/v1");
    const spy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", spy);
    const lookup = vi.spyOn(dns.promises, "lookup");
    const cases: Array<[(r: NextRequest) => Promise<Response>, string, unknown]> = [
      [llmTestPOST, "/api/llm/test", { baseUrl: trapUrl, apiKey: "client-key", model: "gpt-4o" }],
      [llmModelsPOST, "/api/llm/models", { baseUrl: trapUrl, apiKey: "client-key" }],
      [testProviderPOST, "/api/ai/test-provider", { name: "openai", apiKey: "client-key", baseUrl: trapUrl }],
      [testProviderPOST, "/api/ai/test-provider", { name: "openai" }],
    ];
    for (const [handler, p, body] of cases) {
      const r = await handler(req(p, body));
      expect(r.status, p).toBe(403);
      const j = await r.json();
      expect(j.code).toBe("FORBIDDEN_IN_WEB_MODE");
      expect(JSON.stringify(j)).not.toMatch(/sys-|client-key/);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(trapHits).toBe(0);
  });

  it("tts uses SYSTEM_TTS_* (client key never sent)", async () => {
    vi.stubEnv("WEB_MODE", "1");
    vi.stubEnv("AI_PROVIDER_MOCK", "");
    vi.stubEnv("APP_DATA_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "wm-tts-")));
    vi.stubEnv("SYSTEM_TTS_BASE_URL", "https://tts.sys.test/v1");
    vi.stubEnv("SYSTEM_TTS_API_KEY", "sys-tts");
    const seen = captureOutbound(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const r = await ttsPOST(req("/api/tts", { text: `xin chao ${Math.random()}`, ttsConfig: { provider: "openai", baseUrl: trapUrl, apiKey: "client-key", model: "tts-1", voice: "alloy" } }));
    expect(r.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual(["https://tts.sys.test/v1/audio/speech"]);
    expect(seen[0].auth).toBe("Bearer sys-tts");
    expect(trapHits).toBe(0);
  });

  it("ai/image (live provider) uses SYSTEM_OPENAI_*", async () => {
    vi.stubEnv("WEB_MODE", "1");
    vi.stubEnv("STUDIO_PROVIDER_MODE", "live");
    vi.stubEnv("AI_PROVIDER_MOCK", "");
    vi.stubEnv("SYSTEM_OPENAI_API_KEY", "sys-openai");
    vi.stubEnv("SYSTEM_OPENAI_BASE_URL", "https://openai.sys.test/v1");
    const seen = captureOutbound(() => new Response(JSON.stringify({ created: 1, data: [{ url: "https://cdn.sys.test/a.png" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    await imagePOST(req("/api/ai/image", { provider: "openai", model: "gpt-image-1", prompt: "x", apiKey: "client-key", baseUrl: trapUrl }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].url.startsWith("https://openai.sys.test/v1/")).toBe(true);
    expect(seen[0].auth).toBe("Bearer sys-openai");
    expect(trapHits).toBe(0);
  });
});

describe("ESLint bans raw fetch in server code", () => {
  it("flags fetch / globalThis.fetch in src/lib and src/app/api; allows it in ssrf-guard", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const code = 'export async function f(u: string) { await fetch(u); return globalThis.fetch(u); }\n';
    for (const filePath of ["src/lib/new-module.ts", "src/app/api/x/route.ts"]) {
      const [res] = await eslint.lintText(code, { filePath });
      const ids = res.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
      expect(ids, filePath).toEqual(expect.arrayContaining(["no-restricted-globals", "no-restricted-syntax"]));
    }
    const [guard] = await eslint.lintText(code, { filePath: "src/lib/ssrf-guard.ts" });
    expect(guard.messages.filter((m) => m.ruleId?.startsWith("no-restricted"))).toEqual([]);
  }, 60000);
});

// Last: this one deliberately reaches the trap server.
describe("desktop mode", () => {
  it("desktop (no WEB_MODE): probe routes still work against a real local endpoint", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const before = trapHits;
    const r = await llmModelsPOST(req("/api/llm/models", { baseUrl: `${trapUrl}/v1`, apiKey: "k" }));
    expect(r.status).not.toBe(403);
    expect(trapHits).toBeGreaterThan(before);
  });
});
