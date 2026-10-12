/**
 * Server-managed default LLM (UGCBatch Studio): Gemini via its OpenAI-compatible endpoint.
 *
 * The browser never sees the key. Client settings default to SERVER_LLM_KEY / SERVER_LLM_MODEL
 * sentinels; createLLMClient swaps in GEMINI_API_KEY and LLM_MODEL (default gemini-3-flash-preview)
 * on the server. Users can still paste their own endpoint/key in Settings like upstream ClipForge.
 */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
export const SERVER_LLM_KEY = "__server_managed__";
export const SERVER_LLM_MODEL = "__server_default__";
export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

export function serverLlmModel(env: Record<string, string | undefined> = process.env): string {
  return (env.LLM_MODEL || "").trim() || DEFAULT_GEMINI_MODEL;
}

export function isServerManaged(apiKey?: string, model?: string): boolean {
  return apiKey === SERVER_LLM_KEY || model === SERVER_LLM_MODEL;
}

/** Rewrites the sentinel model name in JSON request bodies to the env-configured model. */
export function serverModelFetch(base: typeof fetch): typeof fetch {
  return (url, init) => {
    if (init && typeof init.body === "string" && init.body.includes(SERVER_LLM_MODEL)) {
      try {
        const parsed = JSON.parse(init.body);
        if (parsed && parsed.model === SERVER_LLM_MODEL) {
          parsed.model = serverLlmModel();
          init = { ...init, body: JSON.stringify(parsed) };
        }
      } catch {
        /* not JSON — leave untouched */
      }
    }
    return base(url as never, init);
  };
}
