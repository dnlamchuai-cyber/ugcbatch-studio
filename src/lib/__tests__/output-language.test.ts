import { describe, it, expect } from "vitest";
import { buildUserPrompt, detectScriptLanguage, OUTPUT_LANGUAGE_RULE } from "@/lib/script-engine/prompts";

describe("output language override (en/vi only, Chinese input still accepted)", () => {
  it("Chinese product input (e.g. 1688/Taobao titles) → English output", () => {
    expect(detectScriptLanguage("夏季冰丝防晒衣 UPF50+ 女款 1688源头工厂")).toBe("en");
    const rule = OUTPUT_LANGUAGE_RULE("product info", "夏季冰丝防晒衣 UPF50+ 女款");
    expect(rule).toContain("American English");
    expect(rule).toContain("NEVER output Chinese characters");
  });

  it("Vietnamese input → Vietnamese output", () => {
    expect(detectScriptLanguage("Áo chống nắng nữ làm mát")).toBe("vi");
    expect(OUTPUT_LANGUAGE_RULE("product info", "Áo chống nắng nữ làm mát")).toContain("VIETNAMESE");
  });

  it("English input → English output", () => {
    expect(detectScriptLanguage("Cooling UPF 50+ sun hoodie")).toBe("en");
  });

  it("buildUserPrompt with Chinese product info keeps the input and ends with the en override", () => {
    const prompt = buildUserPrompt({ productName: "夏季冰丝防晒衣", productDescription: "凉感面料，UPF50+" } as Parameters<typeof buildUserPrompt>[0]);
    expect(prompt).toContain("夏季冰丝防晒衣");
    expect(prompt).toContain("OUTPUT LANGUAGE");
    expect(prompt.lastIndexOf("American English")).toBeGreaterThan(prompt.indexOf("夏季冰丝防晒衣"));
  });
});
