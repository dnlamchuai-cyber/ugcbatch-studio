// @vitest-environment node
// QA fixes for PR #15: ai/image blocked imageUrl → 400, replicate/save rejects non-video bodies,
// pipeline self-calls use a fixed internal origin (spoofed Host has no effect).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "http";
import dns from "dns";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";

const started: Array<{ origin: string }> = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => [{ id: "p1" }] }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 7 }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));
vi.mock("@/lib/pipeline-runner", () => ({
  startPipelineRun: async (input: { origin: string }) => { started.push(input); return "run-1"; },
  isPipelineRunActive: () => false,
}));
vi.mock("@/lib/pipeline-history", () => ({ getLatestPipelineRun: () => undefined }));

import { POST as imagePOST } from "@/app/api/ai/image/route";
import { POST as replicateSavePOST } from "@/app/api/project/[id]/replicate/save/route";
import { POST as pipelinePOST } from "@/app/api/project/[id]/pipeline/route";
import { videoDownloadProblem } from "@/lib/video-sniff";
import { internalBaseUrl } from "@/lib/internal-origin";

let srv: http.Server;
let port = 0;
beforeAll(async () => {
  srv = http.createServer((q, s) => {
    if (q.url === "/tiny.json") { s.writeHead(200, { "content-type": "application/json" }); return s.end("{}"); }
    if (q.url === "/page.html") { s.writeHead(200, { "content-type": "text/html" }); return s.end("<html>" + "x".repeat(5000) + "</html>"); }
    if (q.url === "/fake.mp4") { s.writeHead(200, { "content-type": "video/mp4" }); return s.end(Buffer.alloc(4096, 0x41)); }
    s.writeHead(404); s.end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  port = (srv.address() as AddressInfo).port;
});
afterAll(() => srv.close());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const req = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${p}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const params = { params: Promise.resolve({ id: "p1" }) };

/** "media.test" resolves public at check time; requests are served by the real local server. */
function routeMediaHostToLocal() {
  const realFetch = globalThis.fetch;
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit & { dispatcher?: unknown }) => {
    const { dispatcher: _d, ...rest } = init ?? {};
    void _d;
    return realFetch(String(input).replace(/^https?:\/\/media\.test/, `http://127.0.0.1:${port}`), rest);
  });
}

describe("ai/image: blocked reference imageUrl → 400 BASEURL_BLOCKED (was 500 IMAGE_FAILED)", () => {
  for (const imageUrl of ["http://169.254.169.254/latest/meta-data/x.png", "http://10.0.0.8/a.png", `http://127.0.0.1:${9}/a.png`]) {
    it(imageUrl, async () => {
      vi.stubEnv("STUDIO_PROVIDER_MODE", "live");
      vi.stubEnv("AI_PROVIDER_MOCK", "");
      const f = vi.fn();
      vi.stubGlobal("fetch", f);
      const r = await imagePOST(req("/api/ai/image", { provider: "openai", model: "gpt-image-1", prompt: "x", mode: "image-to-image", imageUrl, apiKey: "k", baseUrl: "https://api.openai.com/v1" }));
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("BASEURL_BLOCKED");
      expect(f).not.toHaveBeenCalled(); // neither the reference nor the provider API was contacted
    });
  }
});

describe("replicate/save rejects non-video bodies with 400", () => {
  beforeAll(() => { process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rs-")); });
  for (const [file, why] of [["tiny.json", /content-type application\/json/], ["page.html", /content-type text\/html/], ["fake.mp4", /not MP4\/MOV\/WebM/]] as const) {
    it(`${file} → 400`, async () => {
      routeMediaHostToLocal();
      const r = await replicateSavePOST(req("/api/project/p1/replicate/save", { videoUrl: `https://media.test/${file}` }), params);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(why);
    });
  }
  it("a real MP4 (mock sample, read from disk) is still saved", async () => {
    const r = await replicateSavePOST(req("/api/project/p1/replicate/save", { videoUrl: "http://localhost:3000/mock/sample.mp4" }), params);
    expect(r.status).toBe(200);
    expect((await r.json()).compositionId).toBe(7);
  });
  it("videoDownloadProblem unit cases", () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(2000)]);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000)]);
    expect(videoDownloadProblem(mp4, "video/mp4")).toBeNull();
    expect(videoDownloadProblem(mp4, "application/octet-stream")).toBeNull();
    expect(videoDownloadProblem(webm, "")).toBeNull();
    expect(videoDownloadProblem(Buffer.from("{}"), "video/mp4")).toMatch(/2 bytes/);
    expect(videoDownloadProblem(mp4, "image/png")).toMatch(/content-type/);
  });
});

describe("pipeline: self-call origin is fixed, a spoofed Host changes nothing", () => {
  it("defaults to http://127.0.0.1:$PORT and honours INTERNAL_BASE_URL", async () => {
    vi.stubEnv("PORT", "4567");
    vi.stubEnv("INTERNAL_BASE_URL", "");
    started.length = 0;
    for (const host of ["evil.example", "169.254.169.254", "attacker.test:8080"]) {
      const r = await pipelinePOST(req("/api/project/p1/pipeline", {}, { host, "x-forwarded-host": host }), params);
      expect(r.status).toBe(202);
    }
    expect(started.map((s) => s.origin)).toEqual(["http://127.0.0.1:4567", "http://127.0.0.1:4567", "http://127.0.0.1:4567"]);
    vi.stubEnv("INTERNAL_BASE_URL", "http://app:3000/");
    expect(internalBaseUrl()).toBe("http://app:3000");
    vi.stubEnv("INTERNAL_BASE_URL", "");
    vi.stubEnv("PORT", "");
    expect(internalBaseUrl()).toBe("http://127.0.0.1:3000");
  });
});
