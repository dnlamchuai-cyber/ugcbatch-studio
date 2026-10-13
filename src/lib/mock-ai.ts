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
    ["hook", "Wait until you see what {name} can do."],
    ["pain_point", "Most options out there just don't hold up."],
    ["product_reveal", "Meet {name}: it works the second you take it out of the box."],
    ["demo", "Here's how I use it every single day."],
    ["social_proof", "Buyers keep coming back for more."],
    ["cta", "Tap the link below and grab {name} today."],
  ],
  vi: [
    ["hook", "Xem thử {name} làm được gì nè."],
    ["pain_point", "Mấy món khác dùng hoài vẫn không ưng."],
    ["product_reveal", "Đây là {name}, mở hộp ra là dùng được ngay."],
    ["demo", "Mình dùng nó mỗi ngày như thế này."],
    ["social_proof", "Nhiều người mua xong còn quay lại mua thêm."],
    ["cta", "Bấm vào giỏ hàng bên dưới để lấy {name} nhé."],
  ],
} as const;

const HAN_RE = /\p{Script=Han}/u;

/**
 * Product name / topic pulled from the prompt so mock scripts mention the real product.
 * Names containing Chinese characters fall back to a neutral phrase (outputs are en/vi only).
 */
export function mockSubjectFromPrompt(text: string, lang: "en" | "vi"): string {
  const m = text.match(/商品名称：([^\n]+)/) || text.match(/【主题】\n([^\n]+)/);
  const name = (m?.[1] || "").trim().slice(0, 60);
  if (!name || HAN_RE.test(name)) return lang === "vi" ? "sản phẩm này" : "this product";
  return name;
}

/** Deterministic script JSON matching the script-engine output schema, in the requested language. */
export function mockScriptJson(lang: "en" | "vi", subject?: string): string {
  const name = subject || (lang === "vi" ? "sản phẩm này" : "this product");
  const shots = SHOTS[lang].map(([type, voiceover], i) => ({
    shotId: i + 1,
    type,
    duration: 5,
    description: "Close-up of the product on a clean bright table, soft daylight",
    camera: "Slow push-in on the subject",
    visualSource: i === 2 ? "product_image" : "ai_generate",
    transition: "direct_concat",
    voiceover: voiceover.replace(/\{name\}/g, name),
    prompt: "product close-up on a bright clean table, soft daylight, vertical 9:16, photorealistic",
    searchTerms: ["product closeup", "lifestyle"],
  }));
  const vi = lang === "vi";
  return JSON.stringify({
    title: vi ? `Review ${name}` : `${name}: honest review`,
    totalDuration: shots.length * 5,
    characters: [],
    shots,
    seo: {
      title: vi ? `${name} - dùng thử và cảm nhận` : `${name} - tried it so you don't have to`,
      hashtags: vi ? ["#review", "#tiktokshop", "#shopee"] : ["#review", "#tiktokshop", "#amazonfinds"],
      coverText: vi ? "Dùng thử thật" : "Honest review",
      interactionGuide: vi ? "Bạn muốn xem thêm gì? Bình luận nhé!" : "What should I test next? Comment below!",
      description: vi ? `Dùng thử ${name}.` : `Trying out ${name}.`,
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
  return /"shots"/.test(text) ? mockScriptJson(lang, mockSubjectFromPrompt(text, lang)) : mockGenericJson(lang);
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

/**
 * Mock mode needs no keys from start to export: route-level "missing key / missing LLM config"
 * checks call these so QA can run with an empty Settings page and no GEMINI_API_KEY.
 */
export function withMockLlmConfig<T extends { baseUrl?: string; apiKey?: string; model?: string } | undefined>(cfg: T): T {
  if (!isAiMock()) return cfg;
  return { ...(cfg ?? {}), baseUrl: cfg?.baseUrl || "https://mock.invalid/v1", apiKey: cfg?.apiKey || "mock", model: cfg?.model || "mock-llm" } as T;
}

export function withMockApiKey(apiKey: string | undefined): string | undefined {
  return apiKey || (isAiMock() ? "mock" : apiKey);
}
