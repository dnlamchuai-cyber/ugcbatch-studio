// Regression tests for QA's mock-flow export (103.5 s instead of ~30 s, overlapping captions,
// letterboxed / black-intro stock clips).
import { describe, it, expect } from "vitest";
import { buildComposeCommand, enableWindow, fitFilter, type ComposeConfig } from "@/lib/video-composer/composer";
import { chooseStartOffset, parseBlackIntro, stockClipPolicy } from "@/lib/video-composer/black-intro";

const cfg = (clips: ComposeConfig["clips"], texts: { text: string; startTime: number; endTime: number }[] = []): ComposeConfig => ({
  projectId: "t",
  clips,
  output: { resolution: "720p", aspectRatio: "9:16" },
  ...(texts.length && { subtitle: { texts } }),
});

describe("captions never overlap at a cue boundary", () => {
  it("enable window is half-open [start, end)", () => {
    expect(enableWindow(15.957, 20)).toBe("enable='gte(t,15.957)*lt(t,20)'");
  });
  it("back-to-back cues use half-open windows in the ffmpeg graph (no inclusive between())", () => {
    const cmd = buildComposeCommand(
      cfg([{ type: "image", filePath: "/tmp/a.jpg", duration: 40, transition: "direct_concat", motion: "static" }], [
        { text: "không?", startTime: 15.957, endTime: 20 },
        { text: "Áo khoác thường vừa bí vừa nóng.", startTime: 20, endTime: 40 },
      ])
    );
    expect(cmd).toContain("lt(t,20)");
    expect(cmd).toContain("gte(t,20)");
    expect(cmd).not.toMatch(/between\(t,15\.957,20\)/);
  });
});

describe("stock B-roll handling", () => {
  it("stock footage is never treated as native narration and is cropped to fill", () => {
    expect(stockClipPolicy("stock_footage")).toEqual({ mayHaveNativeVoice: false, fit: "cover" });
    expect(stockClipPolicy("ai_generated")).toEqual({ mayHaveNativeVoice: true, fit: "contain" });
  });

  it("cover crops instead of letterboxing; default keeps contain", () => {
    expect(fitFilter("cover", 720, 1280)).toBe("scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280");
    expect(fitFilter(undefined, 720, 1280)).toContain("pad=720:1280");
    const cmd = buildComposeCommand(
      cfg([{ type: "video", filePath: "/tmp/stock.webm", duration: 3.5, transition: "direct_concat", fit: "cover", startOffset: 0.648, sourceDuration: 60 }])
    );
    expect(cmd).toContain("crop=720:1280");
    expect(cmd).not.toContain("pad=720:1280");
    expect(cmd).toMatch(/-ss 0\.648 -i "\/tmp\/stock\.webm"/);
  });

  it("parses a black fade-in at the clip start (real blackdetect output from QA's Wikimedia clip)", () => {
    const stderr = "[blackdetect @ 0x5] black_start:0.014 black_end:0.548 black_duration:0.534\n[blackdetect @ 0x5] black_start:9.1 black_end:9.6";
    expect(parseBlackIntro(stderr)).toBe(0.548);
    expect(parseBlackIntro("[blackdetect] black_start:3 black_end:4")).toBe(0);
    expect(chooseStartOffset(0.548, 60, 3.5)).toBeCloseTo(0.648);
    expect(chooseStartOffset(0.548, 2.5, 3.5)).toBe(0); // not enough footage left → keep start
    expect(chooseStartOffset(0, 60, 3.5)).toBe(0);
  });
});
