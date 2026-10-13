// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { isAiMock, mockChatContent, mockLlmFetch, mockSpeechWords } from "@/lib/mock-ai";
import { mockSpeechAudio } from "@/lib/mock-ai-server";
import { createLLMClient } from "@/lib/llm-error";
import { generateSpeechFreeDetailed } from "@/lib/edge-tts";
import { createProvider } from "@/lib/providers";
import { OUTPUT_LANGUAGE_RULE } from "@/lib/script-engine/prompts";

const prev = process.env.AI_PROVIDER_MOCK;
afterEach(() => {
  if (prev === undefined) delete process.env.AI_PROVIDER_MOCK;
  else process.env.AI_PROVIDER_MOCK = prev;
});

describe("AI_PROVIDER_MOCK zero-cost QA mode", () => {
  it("env flag parsing", () => {
    expect(isAiMock({ AI_PROVIDER_MOCK: "1" })).toBe(true);
    expect(isAiMock({ AI_PROVIDER_MOCK: "true" })).toBe(true);
    expect(isAiMock({})).toBe(false);
    expect(isAiMock({ AI_PROVIDER_MOCK: "0" })).toBe(false);
  });

  it("script requests get a schema-valid script in en or vi", () => {
    const en = JSON.parse(mockChatContent({ messages: [{ role: "user", content: `"shots" ${OUTPUT_LANGUAGE_RULE("product info", "夏季冰丝防晒衣")}` }] }));
    expect(en.shots.length).toBeGreaterThan(0);
    expect(en.shots[0].type).toBe("hook");
    expect(en.shots.reduce((s: number, x: { duration: number }) => s + x.duration, 0)).toBe(en.totalDuration);
    expect(JSON.stringify(en)).not.toMatch(/[\u4e00-\u9fff]/);
    const vi = JSON.parse(mockChatContent({ messages: [{ role: "user", content: `"shots" ${OUTPUT_LANGUAGE_RULE("product info", "Áo chống nắng nữ")}` }] }));
    expect(vi.shots[0].voiceover).toMatch(/[ăâđêôơư]/i);
  });

  it("LLM client answers locally without network", async () => {
    process.env.AI_PROVIDER_MOCK = "1";
    const client = createLLMClient({ baseUrl: "https://api.example.com/v1", apiKey: "x", model: "m" } as Parameters<typeof createLLMClient>[0]);
    const r = await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hello" }] });
    expect(() => JSON.parse(r.choices[0].message.content || "")).not.toThrow();
    const models = await mockLlmFetch("https://mock.invalid/v1/models");
    expect((await models.json()).data[0].id).toBe("mock-llm");
  });

  it("TTS returns the bundled mp3 with word timings", async () => {
    process.env.AI_PROVIDER_MOCK = "1";
    const { audio, words } = await generateSpeechFreeDetailed("Xin chào các bạn");
    expect(audio.equals(mockSpeechAudio())).toBe(true);
    expect(words.map((w) => w.text)).toEqual(["Xin", "chào", "các", "bạn"]);
    expect(mockSpeechWords("")).toEqual([]);
  });

  it("image/video provider returns bundled fixtures instantly", async () => {
    process.env.AI_PROVIDER_MOCK = "1";
    const p = createProvider({ name: "atlas-cloud", apiKey: "x" } as Parameters<typeof createProvider>[0]);
    const img = await p.generateImage({ prompt: "a", modelId: "" } as Parameters<typeof p.generateImage>[0]);
    expect(img.imageUrls[0]).toMatch(/\/mock\/sample\.png$/);
    const vid = await p.generateVideo({ prompt: "a", modelId: "" } as Parameters<typeof p.generateVideo>[0]);
    expect(vid.videoUrls[0]).toMatch(/\/mock\/sample\.mp4$/);
  });
});

describe("mock script mentions the product", () => {
  it("uses the product name from the prompt; Chinese names fall back to a neutral phrase", async () => {
    const { mockChatContent } = await import("@/lib/mock-ai");
    const ask = (name: string, vi = false) =>
      JSON.parse(mockChatContent({ messages: [{ role: "user", content: `- 商品名称：${name}\n"shots"\n${vi ? "is in VIETNAMESE" : ""}` }] }));
    const en = ask("Pet Hair Remover Roller");
    expect(en.title).toContain("Pet Hair Remover Roller");
    expect(en.shots.some((s: { voiceover: string }) => s.voiceover.includes("Pet Hair Remover Roller"))).toBe(true);
    expect(ask("Quạt mini cầm tay", true).title).toContain("Quạt mini cầm tay");
    expect(JSON.stringify(ask("夏季冰丝防晒衣"))).not.toMatch(/\p{Script=Han}/u);
  });
});
