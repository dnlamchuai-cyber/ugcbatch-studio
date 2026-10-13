// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildUserPrompt, buildTopicBatchPrompt, OUTPUT_LANGUAGE_RULE, parseOutputLanguage, resolveOutputLanguage } from "@/lib/script-engine/prompts";
import { generateScript } from "@/lib/script-engine/generator";
import { voiceForOutputLanguage } from "@/lib/output-language";
import { checkScriptCompliance } from "@/lib/ad-compliance";

const HAN = /\p{Script=Han}/u;
const CN_TITLE = "夏季冰丝防晒衣 UPF50+ 女款 1688源头工厂";
const llmConfig = { baseUrl: "https://example.invalid/v1", apiKey: "k", model: "m" };

beforeAll(() => vi.stubEnv("AI_PROVIDER_MOCK", "1"));
afterAll(() => vi.unstubAllEnvs());

describe("outputLanguage request field (whole batch: script, voice, subtitles)", () => {
  it("validates the field", () => {
    expect(parseOutputLanguage("vi")).toBe("vi");
    expect(parseOutputLanguage(" EN ")).toBe("en");
    expect(parseOutputLanguage("zh")).toBeUndefined();
    expect(parseOutputLanguage(undefined)).toBeUndefined();
  });

  it("Chinese title + vi → Vietnamese prompt rule and Vietnamese script", async () => {
    const prompt = buildUserPrompt({ productName: CN_TITLE, outputLanguage: "vi" } as Parameters<typeof buildUserPrompt>[0]);
    expect(prompt).toContain("selected VIETNAMESE output");
    const [script] = await generateScript({ productName: CN_TITLE, outputLanguage: "vi", llmConfig } as Parameters<typeof generateScript>[0]);
    const text = [script.title, ...script.shots.map((s) => s.voiceover || "")].join(" ");
    expect(text).toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữự]/i);
    expect(text).not.toMatch(HAN);
    expect(voiceForOutputLanguage("vi", "zh-CN-XiaoxiaoNeural")).toMatch(/^vi-VN-/);
  });

  it("Chinese title + en → English with no Chinese characters", async () => {
    const prompt = buildUserPrompt({ productName: CN_TITLE, outputLanguage: "en" } as Parameters<typeof buildUserPrompt>[0]);
    expect(prompt).toContain("selected ENGLISH output");
    const [script] = await generateScript({ productName: CN_TITLE, outputLanguage: "en", llmConfig } as Parameters<typeof generateScript>[0]);
    const text = [script.title, ...script.shots.map((s) => s.voiceover || "")].join(" ");
    expect(text).not.toMatch(HAN);
    expect(text).toMatch(/[a-z]{3,}/i);
    expect(voiceForOutputLanguage("en", "zh-CN-XiaoxiaoNeural")).toMatch(/^en-US-/);
    expect(voiceForOutputLanguage("en", "en-US-GuyNeural")).toBe("en-US-GuyNeural");
  });

  it("explicit field beats detection (Vietnamese text + en → English)", () => {
    expect(resolveOutputLanguage("en", "Áo chống nắng nữ")).toBe("en");
    expect(OUTPUT_LANGUAGE_RULE("product info", "Áo chống nắng nữ", "en")).toContain("selected ENGLISH output");
    expect(buildTopicBatchPrompt({ topic: "Mẹo dọn nhà", outputLanguage: "en" } as Parameters<typeof buildTopicBatchPrompt>[0])).toContain("selected ENGLISH output");
  });

  it("missing field falls back to text detection", async () => {
    expect(resolveOutputLanguage(undefined, "Áo chống nắng nữ làm mát")).toBe("vi");
    expect(resolveOutputLanguage(undefined, CN_TITLE)).toBe("en");
    expect(resolveOutputLanguage("fr", "Áo chống nắng")).toBe("vi");
    const [vi] = await generateScript({ productName: "Áo chống nắng nữ làm mát", llmConfig } as Parameters<typeof generateScript>[0]);
    expect(vi.title).toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữự]/i);
  });
});

describe("US (FTC) and VN banned-term lists both apply to every video", () => {
  it("an English script is still scanned for Vietnamese terms and vice versa", () => {
    const terms = checkScriptCompliance([{ voiceover: "The best hoodie, 100% guaranteed" }, { voiceover: "Sản phẩm tốt nhất" }]).map((v) => v.term);
    expect(terms).toEqual(expect.arrayContaining(["the best", "100%", "tốt nhất"]));
  });
});
