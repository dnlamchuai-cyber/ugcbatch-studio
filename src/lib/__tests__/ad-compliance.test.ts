import { describe, it, expect } from "vitest";
import { checkAdCompliance, checkScriptCompliance } from "@/lib/ad-compliance";

describe("checkAdCompliance (ad-law risk term scan, US + VN)", () => {
  it("flags absolute claims (EN)", () => {
    const v = checkAdCompliance("The best product, #1 on TikTok, 100% loved");
    const terms = v.map((x) => x.term);
    expect(terms).toEqual(expect.arrayContaining(["the best", "#1", "100%"]));
    expect(v.every((x) => x.category === "Absolute claim" && x.severity === "high")).toBe(true);
  });

  it("flags absolute claims (VI)", () => {
    const terms = checkAdCompliance("Sản phẩm tốt nhất, giá rẻ nhất thị trường").map((x) => x.term);
    expect(terms).toEqual(expect.arrayContaining(["tốt nhất", "giá rẻ nhất"]));
    expect(terms).not.toContain("rẻ nhất"); // subsumed by the longer hit
  });

  it("flags medical / false efficacy claims", () => {
    const v = checkAdCompliance("Clinically proven to cure acne. Đặc trị mụn, chữa khỏi hoàn toàn");
    expect(v.map((x) => x.term)).toEqual(expect.arrayContaining(["clinically proven", "cure", "đặc trị", "chữa khỏi"]));
    expect(v.find((x) => x.term === "cure")?.category).toBe("Medical/false efficacy");
  });

  it("is case-insensitive and respects word boundaries", () => {
    expect(checkAdCompliance("GUARANTEED results").map((x) => x.term)).toContain("guaranteed");
    expect(checkAdCompliance("A secure, perfectly sized case")).toEqual([]);
  });

  it("flags certification claims at med severity", () => {
    const v = checkAdCompliance("All natural, organic formula");
    expect(v.map((x) => x.term)).toEqual(expect.arrayContaining(["all natural", "organic"]));
    expect(v.find((x) => x.term === "organic")?.severity).toBe("med");
  });

  it("dedupes and sorts high severity first", () => {
    const v = checkAdCompliance("organic, the best, the best");
    expect(v.filter((x) => x.term === "the best").length).toBe(1);
    expect(v[0].severity).toBe("high");
  });

  it("reports only the longest overlapping term", () => {
    const hits = checkAdCompliance("Lowest price ever, go!");
    expect(hits.map((x) => x.term)).toEqual(["lowest price ever"]);
    const nat = checkAdCompliance("100% natural ingredients").map((x) => x.term);
    expect(nat).toContain("100% natural");
    expect(nat).not.toContain("100%");
  });

  it("flags false urgency as med with a provability hint", () => {
    const urgency = checkAdCompliance("Last day! Today only. Chỉ hôm nay").filter((x) => x.category === "False urgency");
    expect(urgency.map((x) => x.term)).toEqual(expect.arrayContaining(["last day", "today only", "chỉ hôm nay"]));
    for (const u of urgency) {
      expect(u.severity).toBe("med");
      expect(u.suggestion).toMatch(/provable/);
    }
  });

  it("no false positives on compliant copy", () => {
    expect(checkAdCompliance("Soft, gentle tissues — great value, lots of repeat buyers. Sale ends Sunday.")).toEqual([]);
    expect(checkAdCompliance("Khăn giấy mềm mại, giá hợp lý, nhiều người mua lại")).toEqual([]);
  });

  it("handles empty / null text", () => {
    expect(checkAdCompliance("")).toEqual([]);
    expect(checkAdCompliance(null as unknown as string)).toEqual([]);
  });

  it("every hit carries a suggestion", () => {
    for (const v of checkAdCompliance("the best cure organic")) expect(v.suggestion.length).toBeGreaterThan(0);
  });
});

describe("checkScriptCompliance (whole-script scan)", () => {
  it("scans voiceover + overlays and dedupes", () => {
    const shots = [
      { voiceover: "The #1 pick online", textOverlay: { text: "100% loved" } },
      { voiceover: "Cures acne", textOverlay: null },
    ];
    const terms = checkScriptCompliance(shots).map((x) => x.term);
    expect(terms).toEqual(expect.arrayContaining(["#1", "100%", "cures"]));
  });

  it("empty script has no hits", () => {
    expect(checkScriptCompliance([])).toEqual([]);
  });
});
