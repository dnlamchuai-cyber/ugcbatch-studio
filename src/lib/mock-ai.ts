/**
 * Zero-cost QA mode. With AI_PROVIDER_MOCK=1 every paid/remote AI call (LLM, image, video, TTS)
 * is answered instantly from bundled fixtures under public/mock/ (≈220 KB total), so QA can run the
 * full flow — link import → script → assets → compose with en/vi subtitles — without any API key.
 * Product-link import still fetches the real page (it is free); everything after it is mocked.
 *
 * Client-safe (no Node built-ins): llm-error / providers are reachable from client bundles.
 * The fs-backed audio fixture lives in mock-ai-server.ts.
 */

export function isAiMock(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.AI_PROVIDER_MOCK || "");
}

export const MOCK_IMAGE_PATH = "/mock/sample.png";
export const MOCK_VIDEO_PATH = "/mock/sample.mp4";
export const MOCK_AUDIO_SECONDS = 3;

/** Evenly spaced word timings over the fixture audio so karaoke/subtitle timing code paths still run. */
export function mockSpeechWords(text: string): Array<{ text: string; startSec: number; endSec: number }> {
  const words = (text || "").replace(/\[pause\]/gi, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = MOCK_AUDIO_SECONDS / words.length;
  return words.map((w, i) => ({ text: w, startSec: +(i * step).toFixed(3), endSec: +((i + 1) * step).toFixed(3) }));
}

const SHOTS = {
  en: [
    ["hook", "Still sweating through your shirt by noon?"],
    ["pain_point", "Regular hoodies trap heat and feel sticky."],
    ["product_reveal", "This cooling sun hoodie feels light the second you put it on."],
    ["demo", "Breathable fabric, a full hood, and thumb loops for your commute."],
    ["social_proof", "Thousands of buyers reorder it every summer."],
    ["cta", "Tap the link below and grab your color today."],
  ],
  vi: [
    ["hook", "Trưa nào cũng ướt đẫm mồ hôi đúng không?"],
    ["pain_point", "Áo khoác thường vừa bí vừa nóng."],
    ["product_reveal", "Áo chống nắng làm mát này mặc vào là thấy nhẹ ngay."],
    ["demo", "Vải thoáng khí, có mũ rộng và xỏ ngón tay khi đi làm."],
    ["social_proof", "Hàng nghìn người mua lại mỗi mùa hè."],
    ["cta", "Bấm vào giỏ hàng bên dưới để chọn màu nhé."],
  ],
} as const;

/** Deterministic script JSON matching the script-engine output schema, in the requested language. */
export function mockScriptJson(lang: "en" | "vi"): string {
  const shots = SHOTS[lang].map(([type, voiceover], i) => ({
    shotId: i + 1,
    type,
    duration: 5,
    description: "Close-up of the product on a clean bright table, soft daylight",
    camera: "Slow push-in on the subject",
    visualSource: i === 2 ? "product_image" : "ai_generate",
    transition: "direct_concat",
    voiceover,
    prompt: "product close-up on a bright clean table, soft daylight, vertical 9:16, photorealistic",
    searchTerms: ["product closeup", "summer outdoor"],
  }));
  return JSON.stringify({
    title: lang === "vi" ? "Áo chống nắng mát lạnh" : "The Cooling Sun Hoodie",
    totalDuration: shots.length * 5,
    characters: [],
    shots,
    seo: {
      title: lang === "vi" ? "Áo chống nắng làm mát cho mùa hè" : "Cooling sun hoodie for summer",
      hashtags: lang === "vi" ? ["#aochongnang", "#tiktokshop", "#muahe"] : ["#sunhoodie", "#tiktokshop", "#summer"],
      coverText: lang === "vi" ? "Mát cả ngày" : "Cool all day",
      interactionGuide: lang === "vi" ? "Bạn thích màu nào? Bình luận nhé!" : "Which color would you pick? Comment below!",
      description: lang === "vi" ? "Áo chống nắng nhẹ, thoáng, làm mát." : "Light, breathable cooling sun hoodie.",
    },
  });
}

/** Generic JSON for non-script LLM calls (publish copy, judges, template generation, translation…). */
function mockGenericJson(lang: "en" | "vi"): string {
  const vi = lang === "vi";
  return JSON.stringify({
    title: vi ? "Bản nháp thử nghiệm" : "Mock draft",
    caption: vi ? "Nội dung mẫu cho QA." : "Sample content for QA.",
    description: vi ? "Nội dung mẫu cho QA." : "Sample content for QA.",
    hashtags: ["#mock", "#qa"],
    score: 7,
    verdict: "pass",
    issues: [],
    suggestions: [],
    items: [],
  });
}

/** Pick the response for a chat request body (OpenAI chat-completions shape). */
export function mockChatContent(body: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = Array.isArray((body as any)?.messages) ? (body as any).messages : [];
  const text = messages
    .map((m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "")))
    .join("\n");
  const lang: "en" | "vi" = /is in VIETNAMESE|selected VIETNAMESE output|tiếng Việt/.test(text) ? "vi" : "en";
  return /"shots"/.test(text) ? mockScriptJson(lang) : mockGenericJson(lang);
}

/** A fetch implementation that answers any OpenAI chat/models request locally. */
export const mockLlmFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\/models\/?$/.test(url)) {
    return new Response(JSON.stringify({ object: "list", data: [{ id: "mock-llm", object: "model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  let body: unknown = {};
  try {
    body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  } catch {
    /* ignore */
  }
  const content = mockChatContent(body);
  return new Response(
    JSON.stringify({
      id: "mock-chat",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-llm",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
