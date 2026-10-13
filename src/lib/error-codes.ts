/**
 * Machine-readable error codes for API error responses (`{ error, code }`).
 * `error` stays English and is the fallback text; the frontend maps `code` to its own VI/EN copy.
 * Keep this list append-only — the frontend keys translations off these strings.
 */
export const API_ERROR_CODES = [
  // AI provider causes (most specific code wins when a step fails because of the provider)
  "AI_KEY_MISSING",
  "AI_KEY_INVALID",
  "AI_QUOTA_EXCEEDED",
  "AI_RATE_LIMITED",
  "AI_MODEL_NOT_FOUND",
  "AI_REQUEST_REJECTED",
  "AI_OUTPUT_TOO_LONG",
  "AI_MODEL_TOO_WEAK",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_NETWORK",
  "AI_TIMEOUT",
  "LLM_NOT_CONFIGURED",
  // request validation
  "INVALID_JSON",
  "MISSING_PARAMS",
  "PRODUCT_NAME_REQUIRED",
  "TOPIC_REQUIRED",
  // project state
  "PROJECT_NOT_FOUND",
  "PROJECT_TYPE_CONFLICT",
  "DB_SAVE_FAILED",
  "NO_SCRIPT",
  "NO_ASSETS",
  // step failures (used when the cause is not a recognised provider error)
  "SCRIPT_FAILED",
  "TEMPLATE_FAILED",
  "TEMPLATE_INVALID_OUTPUT",
  "IMAGE_FAILED",
  "VIDEO_FAILED",
  "VIDEO_NO_RESULT",
  "VIDEO_TASK_PENDING",
  "REFERENCE_MEDIA_UNAVAILABLE",
  "COMPOSE_FAILED",
  "COMPOSITIONS_FETCH_FAILED",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const s = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
  return s !== undefined && s >= 100 && s < 600 ? s : undefined;
}

/**
 * Classify a provider/LLM error into an AI_* code, or return `fallback` (the failed step's code)
 * when the cause is not recognisable. Pure; reads only the error object.
 */
export function aiErrorCode(err: unknown, fallback: ApiErrorCode): ApiErrorCode {
  const explicit = (err as { code?: unknown } | null)?.code;
  if (typeof explicit === "string" && (API_ERROR_CODES as readonly string[]).includes(explicit)) return explicit as ApiErrorCode;
  if (explicit === "TIMEOUT") return "AI_TIMEOUT";
  if (explicit === "NETWORK_ERROR") return "AI_NETWORK";
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "APIConnectionTimeoutError") return "AI_TIMEOUT";
  if (name === "APIConnectionError") return "AI_NETWORK";
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const status = statusOf(err);
  if (status === 401 || status === 403) return "AI_KEY_INVALID";
  if (status === 402) return "AI_QUOTA_EXCEEDED";
  if (status === 429) return "AI_RATE_LIMITED";
  if (status === 404) return "AI_MODEL_NOT_FOUND";
  if (status === 413) return "AI_REQUEST_REJECTED";
  if (status === 400 || status === 422) return /output budget|max_tokens|token cap/i.test(msg) ? "AI_OUTPUT_TOO_LONG" : "AI_REQUEST_REJECTED";
  if (status !== undefined && status >= 500) return "AI_PROVIDER_UNAVAILABLE";
  // providers that only put the status in the message text
  if (/\b(401|403)\b|unauthori[sz]ed|invalid.{0,20}(api[ _-]?)?key|incorrect api key/i.test(msg)) return "AI_KEY_INVALID";
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return "AI_RATE_LIMITED";
  if (/timed? ?out|etimedout/i.test(msg)) return "AI_TIMEOUT";
  if (/fetch failed|econnrefused|enotfound|network/i.test(msg)) return "AI_NETWORK";
  return fallback;
}
