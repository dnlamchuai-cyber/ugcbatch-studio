import { NextRequest, NextResponse } from "next/server";
import { assertSafeBaseUrl, SsrfBlockedError, trackedProviderFetch } from "@/lib/ssrf-guard";
import { errText } from "@/lib/api-error";
import { listModels } from "@/lib/llm-models";

/**
 * List the models an OpenAI-compatible endpoint exposes, so Settings can offer them instead of making
 * the user type a name from memory.
 *
 * Local Ollama is the case that forced this: `ollama pull qwen2.5:7b-instruct` installs a model whose
 * id carries a tag, while the preset ships the bare `qwen2.5`, and the only feedback was a 404
 * (issue #19 follow-up). Runs server-side because provider APIs block browser CORS.
 */
export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey } = await req.json();
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: errText(req, "Missing baseUrl", "Missing baseUrl") }, { status: 400 });
    }
    try {
      await assertSafeBaseUrl(String(baseUrl));
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Blocked base URL", code: "BASEURL_BLOCKED" }, { status: 400 });
    }
    const tracked = trackedProviderFetch();
    const models = await listModels(String(baseUrl), String(apiKey || ""), tracked.fetch);
    const blocked = tracked.blocked();
    if (blocked) return NextResponse.json({ ok: false, error: blocked.message, code: "BASEURL_BLOCKED" }, { status: 400 });
    if (models.length === 0) {
      return NextResponse.json({
        ok: false,
        models: [],
        error: errText(
          req,
          "Could not read the model list: check the endpoint/key — a local Ollama needs `ollama serve` plus at least one `ollama pull`",
          "Could not read the model list: check the endpoint/key — a local Ollama needs `ollama serve` plus at least one `ollama pull`",
        ),
      });
    }
    return NextResponse.json({ ok: true, models });
  } catch (error) {
    if (error instanceof SsrfBlockedError) return NextResponse.json({ ok: false, error: error.message, code: "BASEURL_BLOCKED" }, { status: 400 });
    return NextResponse.json({
      ok: false,
      models: [],
      error: error instanceof Error ? error.message : errText(req, "Request failed", "Request failed"),
    });
  }
}
