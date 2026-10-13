import { NextRequest, NextResponse } from "next/server";
import { assertSafeBaseUrl, SsrfBlockedError, trackedProviderFetch } from "@/lib/ssrf-guard";
import { errText } from "@/lib/api-error";
import { probeLLMEndpoint } from "@/lib/llm-probe";
import { isWebMode } from "@/lib/web-mode-flag";
import { webModeForbidden } from "@/lib/baseurl-gate";

/**
 * Server-side LLM connection test.
 * Must run server-side: direct browser requests to provider APIs are blocked by CORS, causing a false
 * "connection failed" error even when the API key is valid.
 *
 * All branching lives in lib/llm-probe (unit-tested against fake providers); this route only handles
 * transport and locale.
 */
export async function POST(req: NextRequest) {
  // WEB_MODE: endpoint probes are a desktop/settings feature — refuse outright (no client OR system credentials used)
  if (isWebMode()) return webModeForbidden();
  try {
    const { baseUrl, apiKey, model } = await req.json();
    if (!baseUrl || !apiKey) {
      return NextResponse.json({ ok: false, error: errText(req, "Missing baseUrl or apiKey", "Missing baseUrl or apiKey") }, { status: 400 });
    }

    try {
      await assertSafeBaseUrl(String(baseUrl));
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Blocked base URL", code: "BASEURL_BLOCKED" }, { status: 400 });
    }
    const tracked = trackedProviderFetch();
    const outcome = await probeLLMEndpoint({ baseUrl: String(baseUrl), apiKey: String(apiKey), model: model ? String(model) : undefined, fetchImpl: tracked.fetch });
    const blocked = tracked.blocked();
    if (blocked) return NextResponse.json({ ok: false, error: blocked.message, code: "BASEURL_BLOCKED" }, { status: 400 });
    return NextResponse.json({
      ok: outcome.ok,
      ...(outcome.status ? { status: outcome.status } : {}),
      ...(outcome.error ? { error: errText(req, outcome.error.zh, outcome.error.en) } : {}),
      ...(outcome.warning ? { warning: errText(req, outcome.warning.zh, outcome.warning.en) } : {}),
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) return NextResponse.json({ ok: false, error: error.message, code: "BASEURL_BLOCKED" }, { status: 400 });
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : errText(req, "Connection failed", "Connection failed"),
    });
  }
}
