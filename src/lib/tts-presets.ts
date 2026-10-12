/**
 * Paid TTS platform presets (pure data, shared between client and server, no server-only dependencies).
 *
 * Unified "platform" dropdown: OpenAI-compatible / Atlas Cloud / MiniMax / fal.ai.
 * Atlas and fal reuse the API key already entered under the same provider in the "AI Platform" tab;
 * MiniMax has its own separate key (plus an optional GroupId).
 * Each platform provides default baseUrl/model/voice so the UI can conditionally render fields
 * and offer voice suggestions accordingly.
 */

export type TTSProvider = "openai" | "atlas" | "minimax" | "falai";

export interface TTSVoiceOption {
  value: string;
  label: string;
}

export interface TTSProviderMeta {
  value: TTSProvider;
  label: string;
  /** Default baseUrl for this platform's TTS endpoint */
  baseUrl: string;
  /** Default model id */
  defaultModel: string;
  /** Available models (empty means free-form input, e.g. OpenAI-compatible) */
  models: TTSVoiceOption[];
  /** Default voice id */
  defaultVoice: string;
  /** Suggested voice list */
  voices: TTSVoiceOption[];
  /**
   * Key source:
   * - "tts": use the apiKey stored in the TTS config itself (OpenAI-compatible / MiniMax)
   * - others: reuse the apiKey of the matching provider in the "AI Platform" store (atlas-cloud / fal-ai)
   */
  keySource: "tts" | "atlas-cloud" | "fal-ai";
  /** Whether a GroupId is required (needed for the MiniMax domestic endpoint api.minimax.chat) */
  needsGroupId?: boolean;
  /** Whether to expose a baseUrl input field (OpenAI-compatible and MiniMax support switching regional endpoints) */
  editableBaseUrl?: boolean;
  /** Configuration hint shown in the UI */
  hint?: string;
}

/** OpenAI-compatible quick presets (one click populates baseUrl + model + voice) */
export const OPENAI_TTS_PRESETS = [
  { label: "SiliconFlow CosyVoice", baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/CosyVoice2-0.5B", voice: "FunAudioLLM/CosyVoice2-0.5B:alex" },
  { label: "OpenAI tts-1", baseUrl: "https://api.openai.com/v1", model: "tts-1", voice: "alloy" },
  { label: "Volcano Engine Ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-tts", voice: "zh_female_cancan" },
];

export const TTS_PROVIDERS: TTSProviderMeta[] = [
  {
    value: "openai",
    label: "OpenAI Compatible (/audio/speech)",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "FunAudioLLM/CosyVoice2-0.5B",
    models: [],
    defaultVoice: "FunAudioLLM/CosyVoice2-0.5B:alex",
    voices: [],
    keySource: "tts",
    editableBaseUrl: true,
    hint: "Compatible with all /audio/speech endpoints including OpenAI tts-1, SiliconFlow CosyVoice, and Volcano Engine Ark.",
  },
  {
    value: "atlas",
    label: "Atlas Cloud (xAI TTS)",
    baseUrl: "https://api.atlascloud.ai/api/v1",
    defaultModel: "xai/tts-v1",
    models: [{ value: "xai/tts-v1", label: "xAI TTS v1 (Multilingual High Fidelity)" }],
    defaultVoice: "eve",
    voices: [
      { value: "eve", label: "Eve · Multilingual Female (Default)" },
      { value: "leo", label: "Leo · Multilingual Male" },
      { value: "rex", label: "Rex · Multilingual Male" },
      { value: "ara", label: "Ara · Multilingual Female" },
      { value: "sal", label: "Sal · Multilingual Male" },
    ],
    keySource: "atlas-cloud",
    hint: "Reuse the Atlas Cloud key from 'AI Platform' (same as Image/Video Generation).",
  },
  {
    value: "minimax",
    label: "MiniMax Hailuo (T2A v2)",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "speech-2.6-hd",
    models: [
      { value: "speech-2.6-hd", label: "speech-2.6-hd (High Fidelity)" },
      { value: "speech-2.6-turbo", label: "speech-2.6-turbo (Fast)" },
      { value: "speech-2.5-hd", label: "speech-2.5-hd" },
    ],
    defaultVoice: "female-tianmei",
    voices: [
      { value: "female-tianmei", label: "Sweet Female (Default)" },
      { value: "female-shaonv", label: "Young Girl" },
      { value: "female-yujie", label: "Mature Female" },
      { value: "female-chengshu", label: "Mature Female" },
      { value: "presenter_female", label: "Female Host" },
      { value: "presenter_male", label: "Male Host" },
      { value: "male-qn-qingse", label: "Youthful Male" },
      { value: "male-qn-jingying", label: "Elite Young Male" },
      { value: "audiobook_female_1", label: "Audiobook Female" },
    ],
    keySource: "tts",
    needsGroupId: true,
    editableBaseUrl: true,
    hint: "MiniMax Open Platform API Key and GroupId. For the international version, set baseUrl to https://api.minimax.io/v1 (GroupId is optional).",
  },
  {
    value: "falai",
    label: "fal.ai (MiniMax Speech-02)",
    baseUrl: "https://queue.fal.run",
    defaultModel: "fal-ai/minimax/speech-02-hd",
    models: [
      { value: "fal-ai/minimax/speech-02-hd", label: "MiniMax Speech-02 HD" },
      { value: "fal-ai/minimax/speech-02-turbo", label: "MiniMax Speech-02 Turbo" },
    ],
    defaultVoice: "Wise_Woman",
    voices: [
      { value: "Wise_Woman", label: "Wise Female (Default)" },
      { value: "Calm_Woman", label: "Steady Female" },
      { value: "Lively_Girl", label: "Energetic Female" },
      { value: "Sweet_Girl_2", label: "Sweet Female" },
      { value: "Friendly_Person", label: "Affable" },
      { value: "Deep_Voice_Man", label: "Deep Male" },
      { value: "Casual_Guy", label: "Casual Male" },
      { value: "Patient_Man", label: "Steady Male" },
    ],
    keySource: "fal-ai",
    hint: "Reuse the fal.ai key from 'AI Platform' (FAL_KEY).",
  },
];

export const DEFAULT_TTS_PROVIDER: TTSProvider = "openai";

/** Get platform metadata (with fallback: unknown/legacy config falls back to openai) */
export function getTTSProviderMeta(provider?: string | null): TTSProviderMeta {
  return TTS_PROVIDERS.find((p) => p.value === provider) ?? TTS_PROVIDERS[0];
}

/** Minimal input shape required when resolving TTS config (avoids circular dependency with store types) */
interface TTSSettingLike {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  speed?: number;
  groupId?: string;
}
type ProvidersLike = Record<string, { apiKey?: string; baseUrl?: string } | undefined>;

/** Fully resolved TTS config used for actual requests / preview playback */
export interface ResolvedTTSConfig {
  provider: TTSProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed?: number;
  groupId?: string;
}

/**
 * Resolves the "platform selection + reused AI platform key" into a complete TTS config
 * ready to send to the backend.
 * Atlas/fal keys are taken from the providers store; OpenAI-compatible/MiniMax use the TTS's own key.
 */
export function resolveTTSConfig(tts: TTSSettingLike | undefined, providers: ProvidersLike): ResolvedTTSConfig {
  const meta = getTTSProviderMeta(tts?.provider);
  // baseUrl: for editable platforms use the user-provided value (fall back to default if blank); otherwise force the platform default
  const baseUrl = meta.editableBaseUrl ? (tts?.baseUrl || meta.baseUrl) : meta.baseUrl;
  // apiKey: reuse the AI platform key or use the TTS-specific key
  const apiKey = meta.keySource === "tts" ? (tts?.apiKey || "") : (providers?.[meta.keySource]?.apiKey || "");
  return {
    provider: meta.value,
    baseUrl,
    apiKey,
    model: tts?.model || meta.defaultModel,
    voice: tts?.voice || meta.defaultVoice,
    ...(tts?.speed != null && { speed: tts.speed }),
    ...(meta.value === "minimax" && tts?.groupId ? { groupId: tts.groupId } : {}),
  };
}

/** Whether paid TTS is ready (switch enabled + resolved key/model/voice all present) */
export function isPaidTTSReady(tts: TTSSettingLike | undefined, providers: ProvidersLike): boolean {
  if (!tts?.enabled) return false;
  const c = resolveTTSConfig(tts, providers);
  return Boolean(c.apiKey && c.baseUrl && c.model && c.voice);
}
