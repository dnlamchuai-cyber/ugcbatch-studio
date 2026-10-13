// @vitest-environment node
// User-supplied provider base URLs: shared provider request path, OpenAI multipart, Atlas upload and
// TTS all go through pinnedProviderFetch. REAL local HTTP servers throughout.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import type { AddressInfo } from "net";
import { OpenAIProvider } from "@/lib/providers/openai";
import { AtlasCloudProvider } from "@/lib/providers/atlas-cloud";
import { ProviderError } from "@/lib/providers/base";
import { generateSpeech } from "@/lib/tts";

type Hit = { url: string; auth?: string };
function startServer(handler: (q: http.IncomingMessage, s: http.ServerResponse, origin: string) => void) {
  const hits: Hit[] = [];
  const srv = http.createServer((q, s) => {
    hits.push({ url: q.url || "", auth: q.headers.authorization });
    q.resume();
    q.on("end", () => handler(q, s, `http://127.0.0.1:${(srv.address() as AddressInfo).port}`));
  });
  return new Promise<{ srv: http.Server; origin: string; hits: Hit[] }>((r) =>
    srv.listen(0, "127.0.0.1", () => r({ srv, origin: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, hits }))
  );
}

const SILENT_MP3 = "data:audio/mpeg;base64," + Buffer.from("ID3fake-audio").toString("base64");
let main: Awaited<ReturnType<typeof startServer>>;
let other: Awaited<ReturnType<typeof startServer>>;
let otherRedirectTarget = "";

beforeAll(async () => {
  vi.stubEnv("AI_PROVIDER_MOCK", "");
  vi.stubEnv("APP_DATA_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "pin-test-")));
  other = await startServer((_q, s) => s.end(JSON.stringify({ status: "COMPLETED", audio: { url: SILENT_MP3 } })));
  main = await startServer((q, s, origin) => {
    const u = q.url || "";
    if (u.startsWith("/to-metadata")) { s.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); return s.end(); }
    if (u.startsWith("/to-private")) { s.writeHead(307, { location: "http://10.0.0.5/v1/images/generations" }); return s.end(); }
    if (u === "/fal-cross/fal-ai/minimax/speech-02-hd") {
      return s.end(JSON.stringify({ request_id: "r1", status_url: `${otherRedirectTarget}/status`, response_url: `${otherRedirectTarget}/result` }));
    }
    if (u === "/fal-same/fal-ai/minimax/speech-02-hd") {
      return s.end(JSON.stringify({ request_id: "r2", status_url: `${origin}/fal-same/status/r2`, response_url: `${origin}/fal-same/result/r2` }));
    }
    if (u === "/fal-same/status/r2") return s.end(JSON.stringify({ status: "COMPLETED" }));
    if (u === "/fal-same/result/r2") return s.end(JSON.stringify({ audio: { url: SILENT_MP3 } }));
    s.writeHead(404);
    s.end("{}");
  });
  otherRedirectTarget = other.origin;
});
afterAll(() => { main.srv.close(); other.srv.close(); vi.unstubAllEnvs(); });
afterEach(() => { vi.stubEnv("ALLOW_PRIVATE_BASEURL", ""); });

const imageReq = (baseUrl: string) =>
  new OpenAIProvider({ name: "openai", apiKey: "sk-secret", baseUrl, timeout: 5000 }).generateImage({ prompt: "x", modelId: "gpt-image-1" } as never);

describe("shared provider request path (providers/base.ts)", () => {
  for (const baseUrl of ["http://169.254.169.254/v1", "http://10.0.0.5/v1", "http://192.168.1.20/v1", "http://127.0.0.1:9/v1", "http://[::1]:9/v1"]) {
    it(`blocks base ${baseUrl} without sending anything`, async () => {
      const err = await imageReq(baseUrl).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("BASEURL_BLOCKED");
      expect((err as Error).message).toMatch(/Blocked/);
    });
  }

  it("cloud metadata stays blocked even with ALLOW_PRIVATE_BASEURL=1", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const err = await imageReq("http://169.254.169.254/v1").then(() => null, (e: unknown) => e);
    expect((err as ProviderError).code).toBe("BASEURL_BLOCKED");
  });

  it("a real local endpoint's 302 to cloud metadata is refused (ALLOW_PRIVATE_BASEURL=1)", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const err = await imageReq(`${main.origin}/to-metadata`).then(() => null, (e: unknown) => e);
    expect((err as ProviderError).code).toBe("BASEURL_BLOCKED");
    expect((err as Error).message).toMatch(/cloud metadata|Blocked/);
  });

  it("a real local endpoint's 307 to a private IP is refused when private bases are not allowed", async () => {
    // flag off: the local base itself is refused before any request (no hit recorded)
    const before = main.hits.length;
    const err = await imageReq(`${main.origin}/to-private`).then(() => null, (e: unknown) => e);
    expect((err as ProviderError).code).toBe("BASEURL_BLOCKED");
    expect(main.hits.length).toBe(before);
  });

  it("normal API errors keep their message format (API 请求失败: 404 …)", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const err = await imageReq(`${main.origin}/nope`).then(() => null, (e: unknown) => e);
    expect((err as ProviderError).code).toBe("API_ERROR");
    expect((err as Error).message).toMatch(/^API 请求失败: 404/);
  });
});

describe("Atlas media upload", () => {
  it("blocks a private base", async () => {
    const f = path.join(os.tmpdir(), `pin-upload-${Date.now()}.bin`);
    fs.writeFileSync(f, "x");
    const p = new AtlasCloudProvider({ name: "atlascloud", apiKey: "k", baseUrl: "http://10.1.2.3/api/v1" });
    const err = await p.uploadLocalMedia(f).then(() => null, (e: unknown) => e);
    expect((err as ProviderError).code).toBe("BASEURL_BLOCKED");
  });
});

describe("TTS (fal queue) status_url / response_url", () => {
  const fal = (base: string) => generateSpeech(`hello ${Math.random()}`, { provider: "falai", baseUrl: base, apiKey: "fal-secret", model: "", voice: "" } as never);

  it("rejects a cross-origin status_url and never sends the key there", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const before = other.hits.length;
    const err = await fal(`${main.origin}/fal-cross`).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/跨域|status_url/);
    expect(other.hits.length).toBe(before); // the other origin was never contacted (so no key leaked)
  });

  it("follows a same-origin status_url / response_url (key sent only to the provider origin)", async () => {
    vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1");
    const buf = await fal(`${main.origin}/fal-same`);
    expect(buf.toString()).toBe("ID3fake-audio");
    const polled = main.hits.filter((h) => h.url.startsWith("/fal-same/"));
    expect(polled.map((h) => h.url)).toEqual(expect.arrayContaining(["/fal-same/status/r2", "/fal-same/result/r2"]));
    for (const h of polled) expect(h.auth).toBe("Key fal-secret");
  }, 20000);

  it("blocks a metadata / private TTS base (OpenAI-compatible speech)", async () => {
    for (const baseUrl of ["http://169.254.169.254/v1", "http://172.16.0.9/v1"]) {
      const err = await generateSpeech(`hi ${Math.random()}`, { provider: "openai", baseUrl, apiKey: "k", model: "tts-1", voice: "alloy" } as never).then(() => null, (e: Error) => e);
      expect(err?.message ?? "").toMatch(/Blocked/);
    }
  });
});
