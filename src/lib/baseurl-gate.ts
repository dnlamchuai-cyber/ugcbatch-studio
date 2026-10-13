import { NextResponse } from "next/server";
import { firstUnsafeBaseUrl, isSsrfBlock, ssrfBlockMessage } from "@/lib/ssrf-guard";
import { applyWebModeOverrides } from "@/lib/web-mode";

/** 400 { error, code: "BASEURL_BLOCKED" } for an SSRF-blocked URL. */
export function baseUrlBlockedResponse(err: unknown): NextResponse {
  return NextResponse.json({ error: ssrfBlockMessage(err), code: "BASEURL_BLOCKED" }, { status: 400 });
}

/**
 * Route gate for every body that can carry provider credentials:
 *  1. WEB_MODE=1 → client apiKey / baseUrl are replaced IN PLACE by the system ones from env
 *     (see @/lib/web-mode), so routes must call this before reading those fields;
 *  2. every remaining baseUrl is checked with assertSafeBaseUrl → 400 BASEURL_BLOCKED when blocked.
 */
export async function rejectUnsafeBaseUrls(body: unknown): Promise<NextResponse | null> {
  applyWebModeOverrides(body);
  const err = await firstUnsafeBaseUrl(body);
  return err ? baseUrlBlockedResponse(err) : null;
}

/** For catch blocks: a 400 BASEURL_BLOCKED response when `err` is an SSRF block, else null. */
export function ssrfErrorResponse(err: unknown): NextResponse | null {
  return isSsrfBlock(err) ? baseUrlBlockedResponse(err) : null;
}

/** 403 { error, code: "FORBIDDEN_IN_WEB_MODE" } for endpoints disabled when WEB_MODE=1 (provider/LLM probes). */
export function webModeForbidden(): NextResponse {
  return NextResponse.json(
    { error: "This endpoint is disabled in web mode (WEB_MODE=1).", code: "FORBIDDEN_IN_WEB_MODE" },
    { status: 403 }
  );
}
