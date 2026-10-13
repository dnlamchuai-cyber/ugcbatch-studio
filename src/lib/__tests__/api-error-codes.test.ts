// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { aiErrorCode, API_ERROR_CODES } from "@/lib/error-codes";
import { LLMRequestError } from "@/lib/llm-error";
import { SERVER_LLM_KEY } from "@/lib/llm-server-default";
import { POST as scriptPOST } from "@/app/api/llm/script/route";
import { POST as topicPOST } from "@/app/api/topic/script/route";
import { POST as templatePOST } from "@/app/api/ad-template/generate/route";
import { POST as imagePOST } from "@/app/api/ai/image/route";
import { POST as videoPOST } from "@/app/api/ai/video/route";

// These suites drive real local HTTP servers as the LLM endpoint (like a local Ollama), which the
// SSRF guard only allows with ALLOW_PRIVATE_BASEURL=1 (the desktop default).
beforeEach(() => { vi.stubEnv("ALLOW_PRIVATE_BASEURL", "1"); });

const req = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

// A real local OpenAI-compatible endpoint that answers every request with a fixed status.
let server: http.Server;
let base = "";
let status = 401;
beforeAll(async () => {
  server = http.createServer((_q, s) => {
    s.writeHead(status, { "content-type": "application/json" });
    s.end(JSON.stringify({ error: { message: `upstream ${status}` } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());
afterEach(() => vi.unstubAllEnvs());

describe("aiErrorCode", () => {
  it("maps provider statuses and explicit codes", () => {
    expect(aiErrorCode(Object.assign(new Error("x"), { status: 401 }), "SCRIPT_FAILED")).toBe("AI_KEY_INVALID");
    expect(aiErrorCode(Object.assign(new Error("x"), { statusCode: 403 }), "IMAGE_FAILED")).toBe("AI_KEY_INVALID");
    expect(aiErrorCode(Object.assign(new Error("x"), { status: 402 }), "SCRIPT_FAILED")).toBe("AI_QUOTA_EXCEEDED");
    expect(aiErrorCode(Object.assign(new Error("x"), { status: 429 }), "SCRIPT_FAILED")).toBe("AI_RATE_LIMITED");
    expect(aiErrorCode(Object.assign(new Error("x"), { status: 404 }), "SCRIPT_FAILED")).toBe("AI_MODEL_NOT_FOUND");
    expect(aiErrorCode(Object.assign(new Error("x"), { status: 503 }), "SCRIPT_FAILED")).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(aiErrorCode(Object.assign(new Error("x"), { code: "TIMEOUT" }), "VIDEO_FAILED")).toBe("AI_TIMEOUT");
    expect(aiErrorCode(new LLMRequestError("z", "e", 503, { code: "AI_KEY_MISSING" }), "SCRIPT_FAILED")).toBe("AI_KEY_MISSING");
    expect(aiErrorCode(new Error("Incorrect API key provided"), "IMAGE_FAILED")).toBe("AI_KEY_INVALID");
    expect(aiErrorCode(new Error("something odd"), "SCRIPT_FAILED")).toBe("SCRIPT_FAILED");
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });
});

describe("routes return { error (English), code }", () => {
  it("llm/script: bad key at a real endpoint → AI_KEY_INVALID with English text", async () => {
    status = 401;
    const res = await scriptPOST(req("/api/llm/script", { productName: "Cooling towel", llmConfig: { baseUrl: base, apiKey: "bad", model: "m" } }));
    const j = await res.json();
    expect(res.status).toBe(500);
    expect(j.code).toBe("AI_KEY_INVALID");
    expect(j.error).toMatch(/^Script generation failed: Invalid or unauthorized API key/);
  });
  it("llm/script: unclassified failure → SCRIPT_FAILED", async () => {
    status = 200; // 200 with a non-completion body → SDK/parse failure, not a provider status
    const res = await scriptPOST(req("/api/llm/script", { productName: "Cooling towel", llmConfig: { baseUrl: base, apiKey: "k", model: "m" } }));
    const j = await res.json();
    expect(j.code).toBe("SCRIPT_FAILED");
    expect(j.error).toMatch(/^Script generation failed/);
  });
  it("llm/script: server-managed key with no GEMINI_API_KEY → AI_KEY_MISSING", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("AI_PROVIDER_MOCK", "");
    const res = await scriptPOST(req("/api/llm/script", { productName: "Cooling towel", llmConfig: { baseUrl: base, apiKey: SERVER_LLM_KEY, model: "m" } }));
    expect((await res.json()).code).toBe("AI_KEY_MISSING");
  });
  it("llm/script validation codes", async () => {
    expect((await (await scriptPOST(req("/api/llm/script", { llmConfig: { baseUrl: base, apiKey: "k", model: "m" } }))).json()).code).toBe("PRODUCT_NAME_REQUIRED");
    vi.stubEnv("AI_PROVIDER_MOCK", "");
    expect((await (await scriptPOST(req("/api/llm/script", { productName: "x" }))).json()).code).toBe("LLM_NOT_CONFIGURED");
  });
  it("topic/script: TOPIC_REQUIRED", async () => {
    expect((await (await topicPOST(req("/api/topic/script", { topic: " " }))).json()).code).toBe("TOPIC_REQUIRED");
  });
  it("ad-template/generate: AI_KEY_INVALID", async () => {
    status = 401;
    const j = await (await templatePOST(req("/api/ad-template/generate", { productName: "x", llmConfig: { baseUrl: base, apiKey: "bad", model: "m" } }))).json();
    expect(j.code).toBe("AI_KEY_INVALID");
    expect(j.error).toMatch(/^AI template generation failed/);
  });
  it("ai/image and ai/video: AI_KEY_MISSING / MISSING_PARAMS", async () => {
    vi.stubEnv("AI_PROVIDER_MOCK", "");
    const img = await imagePOST(req("/api/ai/image", { provider: "openai", model: "m", prompt: "p" }));
    expect(await img.json()).toEqual({ error: "Missing API Key, please configure the corresponding platform in settings first", code: "AI_KEY_MISSING" });
    expect((await (await videoPOST(req("/api/ai/video", { provider: "x" }))).json()).code).toBe("MISSING_PARAMS");
  });
});
