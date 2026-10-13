/**
 * Ad-law compliance check for e-commerce scripts — scans already-generated script copy for terms
 * that may violate US (FTC) or Vietnamese advertising rules. The script engine prompt only asks the LLM to avoid
 * them, but the LLM still misses some; this provides a safety-net check on the actual output
 * before rendering. Hits surface a warning + revision suggestion (not a hard block — user decides).
 * Pure function, unit-testable, zero external keys, decoupled from the compose pipeline.
 */

export type AdViolationCategory =
  | "Absolute claim"
  | "Medical/false efficacy"
  | "Certification required"
  | "False urgency";

export interface AdViolation {
  term: string;
  category: AdViolationCategory;
  severity: "high" | "med";
  suggestion: string;
}

interface Rule {
  terms: string[];
  category: AdViolationCategory;
  severity: "high" | "med";
  suggestion: string;
}

// Conservative term selection for the target markets (US: FTC Act §5 / substantiation doctrine and
// TikTok Shop / Amazon policies; Vietnam: Law on Advertising 2012 + Decree 38/2021 and TikTok Shop /
// Shopee policies). Only include terms that are almost always risky in e-commerce copy to keep false
// positives low — this is a warning tool, not a hard block. Terms are matched case-insensitively;
// ASCII terms match on word boundaries, Vietnamese terms match as substrings.
const RULES: Rule[] = [
  {
    // Unsubstantiated absolute / superlative claims (FTC: objective claims need substantiation;
    // VN Decree 38/2021: "nhất", "duy nhất", "tốt nhất" require proof).
    // Longest-match dedup below collapses e.g. "lowest price ever" → one hit instead of overlapping ones.
    terms: [
      // English (US)
      "best ever", "#1", "number one", "no. 1", "world's best", "the best", "best in the world",
      "100%", "guaranteed", "guarantee", "unbeatable", "perfect", "miracle", "flawless",
      "lowest price", "lowest price ever", "cheapest", "cheapest anywhere", "best seller in the world",
      "best-selling", "top-rated", "industry leading", "only one", "one of a kind",
      // Vietnamese (VN)
      "tốt nhất", "số 1", "số một", "duy nhất", "hàng đầu", "rẻ nhất", "giá rẻ nhất",
      "hoàn hảo", "100% hiệu quả", "đảm bảo 100%", "bán chạy nhất", "đỉnh nhất",
    ],
    category: "Absolute claim",
    severity: "high",
    suggestion:
      "Absolute or superlative claims need hard substantiation (FTC; VN Decree 38/2021) — use relative wording like \"one of\", \"more\", \"loved by many\"",
  },
  {
    // Ordinary goods must not claim medical, therapeutic or disease-treatment effects (FTC health-claims
    // guidance / FDA drug-claim line; VN Law on Advertising Art. 8 for non-drug products).
    terms: [
      // English (US)
      "cure", "cures", "heals", "treats", "prevents disease", "clinically proven", "doctor recommended",
      "fda approved", "anti-cancer", "anti-inflammatory", "kills 99.9%", "permanent results",
      "instant results", "results in 3 days", "miracle cure", "medical grade", "prescription strength",
      "lose weight fast", "burn fat",
      // Vietnamese (VN)
      "chữa khỏi", "điều trị", "đặc trị", "trị dứt điểm", "khỏi hẳn", "chống ung thư", "kháng viêm",
      "hiệu quả tức thì", "giảm cân cấp tốc", "thần dược", "bác sĩ khuyên dùng",
    ],
    category: "Medical/false efficacy",
    severity: "high",
    suggestion:
      "Ordinary products must not claim to cure, treat or prevent disease — remove it or describe a real personal experience instead",
  },
  {
    // "All natural / organic / chemical-free" claims require certification or test evidence
    // (USDA Organic, FTC Green Guides; VN requires certification for "hữu cơ").
    terms: [
      "all natural", "100% natural", "organic", "chemical-free", "chemical free", "non-toxic", "eco-friendly",
      "thiên nhiên 100%", "100% thiên nhiên", "hữu cơ", "không hóa chất", "không chất bảo quản",
    ],
    category: "Certification required",
    severity: "med",
    suggestion:
      "\"Natural / organic / chemical-free\" claims need certification or test evidence — remove them if unsupported",
  },
  {
    // False urgency: TikTok Shop / Shopee policies and the FTC treat fake limited-time or limited-stock claims
    // as deceptive. Legal only when the promotion is real and provable, so this stays med severity.
    terms: [
      "last day", "today only", "last chance", "price goes up tomorrow", "only a few left", "selling out fast",
      "ngày cuối cùng", "chỉ hôm nay", "cơ hội cuối", "sắp hết hàng", "mai tăng giá",
    ],
    category: "False urgency",
    severity: "med",
    suggestion:
      "Fake limited-time or limited-stock claims violate platform rules (throttling + penalties); delete unless the promotion is real and provable, and keep proof for real ones",
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(haystack: string, term: string): boolean {
  const t = term.toLowerCase();
  // ASCII words: match on word boundaries so "cure" doesn't hit "secure" and "perfect" doesn't hit "perfectly".
  if (/^[\x20-\x7e]+$/.test(t) && /^[a-z0-9]/.test(t) && /[a-z0-9]$/.test(t)) {
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(t)}(?![a-z0-9])`, "i").test(haystack);
  }
  return haystack.includes(t);
}

/** Scans a text string and returns matched ad-law risk terms (deduplicated by term, high-severity first). */
export function checkAdCompliance(text: string): AdViolation[] {
  const clean = String(text || "").normalize("NFC").toLowerCase();
  if (!clean) return [];
  const seen = new Set<string>();
  const out: AdViolation[] = [];
  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (!seen.has(term) && containsTerm(clean, term)) {
        seen.add(term);
        out.push({ term, category: rule.category, severity: rule.severity, suggestion: rule.suggestion });
      }
    }
  }
  // Remove shorter terms that are substrings of a longer matched term (e.g. "lowest price" subsumed by "lowest price ever") to avoid duplicate or contradictory hints for the same text span
  const terms = out.map((v) => v.term.toLowerCase());
  const deduped = out.filter((v) => !terms.some((t) => t !== v.term.toLowerCase() && t.includes(v.term.toLowerCase())));
  return deduped.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

/** Scans all shots in a script (voiceover + text overlays) and returns deduplicated risk terms. */
export function checkScriptCompliance(shots: Array<{ voiceover?: string; textOverlay?: { text?: string } | null }>): AdViolation[] {
  const text = (shots || [])
    .flatMap((s) => [s.voiceover || "", s.textOverlay?.text || ""])
    .join(" \n ");
  return checkAdCompliance(text);
}
