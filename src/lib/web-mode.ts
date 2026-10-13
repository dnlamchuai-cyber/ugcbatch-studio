/**
 * WEB_MODE=1 (public web / VPS deploy): the server never uses an apiKey or baseUrl sent by the client.
 * Every credential comes from the server's environment:
 *   - LLM (llmConfig / visionConfig): the server-managed Gemini path (GEMINI_API_KEY, GEMINI_MODEL…)
 *   - media providers (top-level / providers[]): SYSTEM_<PROVIDER>_API_KEY, SYSTEM_<PROVIDER>_BASE_URL
 *     (<PROVIDER> = provider name upper-cased, non-alphanumerics → "_", e.g. SYSTEM_ATLAS_CLOUD_API_KEY);
 *     an unset base URL means the provider's built-in default endpoint
 *   - TTS (ttsConfig): SYSTEM_TTS_PROVIDER, SYSTEM_TTS_BASE_URL, SYSTEM_TTS_API_KEY
 *   - stock sources: client apiKeys are dropped; the per-source env keys (PEXELS_API_KEY…) apply
 * Pure module (no Node built-ins) so it can be imported anywhere; it only reads process.env.
 */
import { isWebMode } from "@/lib/web-mode-flag";
import { SERVER_LLM_KEY, SERVER_LLM_MODEL, GEMINI_BASE_URL } from "@/lib/llm-server-default";

export { isWebMode };

type Env = Record<string, string | undefined>;
type Obj = Record<string, unknown>;

const envName = (provider: string) => provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** System credentials for a media provider in web mode (empty strings when not configured). */
export function systemProviderCredentials(provider: unknown, env: Env = process.env): { apiKey: string; baseUrl: string } {
  const n = typeof provider === "string" && provider ? envName(provider) : "";
  return { apiKey: (n && env[`SYSTEM_${n}_API_KEY`]) || "", baseUrl: (n && env[`SYSTEM_${n}_BASE_URL`]) || "" };
}

/** Server-managed LLM config (sentinels resolved by createLLMClient against GEMINI_API_KEY / GEMINI_MODEL). */
export function systemLlmConfig<T extends object>(cfg: T | undefined): T {
  return { ...(cfg ?? {}), baseUrl: GEMINI_BASE_URL, apiKey: SERVER_LLM_KEY, model: SERVER_LLM_MODEL } as unknown as T;
}

/**
 * In web mode, rewrite a parsed request body IN PLACE so every apiKey / baseUrl comes from env.
 * No-op outside web mode. Returns the same object for convenience.
 */
export function applyWebModeOverrides<T>(body: T, env: Env = process.env): T {
  if (!isWebMode(env) || !body || typeof body !== "object") return body;
  const b = body as Obj;
  if ("apiKey" in b || "baseUrl" in b || typeof b.provider === "string" || typeof b.name === "string") {
    const sys = systemProviderCredentials(b.provider ?? b.name, env);
    b.apiKey = sys.apiKey;
    b.baseUrl = sys.baseUrl;
  }
  for (const k of ["llmConfig", "visionConfig"]) {
    if (b[k] && typeof b[k] === "object") b[k] = systemLlmConfig(b[k] as Obj);
  }
  if (b.ttsConfig && typeof b.ttsConfig === "object") {
    const t = b.ttsConfig as Obj;
    b.ttsConfig = {
      ...t,
      ...(env.SYSTEM_TTS_PROVIDER && { provider: env.SYSTEM_TTS_PROVIDER }),
      baseUrl: env.SYSTEM_TTS_BASE_URL || "",
      apiKey: env.SYSTEM_TTS_API_KEY || "",
    };
  }
  if (Array.isArray(b.providers)) {
    b.providers = b.providers.map((p) => {
      if (!p || typeof p !== "object") return p;
      const sys = systemProviderCredentials((p as Obj).name, env);
      return { ...(p as Obj), apiKey: sys.apiKey, baseUrl: sys.baseUrl };
    });
  }
  if ("apiKeys" in b) delete b.apiKeys;
  return body;
}
