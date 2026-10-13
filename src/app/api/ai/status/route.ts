import { NextRequest, NextResponse } from "next/server";
import { withMockApiKey } from "@/lib/mock-ai";
import { createProvider } from "@/lib/providers";
import { apiError, errText } from "@/lib/api-error";
import { rejectUnsafeBaseUrls } from "@/lib/baseurl-gate";

// Query AI task status (image/video generation is asynchronous)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  { const blocked = await rejectUnsafeBaseUrls(body); if (blocked) return blocked; } // SSRF: private/metadata baseUrl → 400 BASEURL_BLOCKED
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(req, "Request body must be a JSON object", "Request body must be a JSON object", 400);
  }
  const { provider: providerName, taskId, apiKey, baseUrl } = body;

  if (!providerName || !taskId) {
    return apiError(req, "Missing required parameters", "Missing required parameters");
  }

  if (!withMockApiKey(apiKey)) {
    return apiError(req, "Missing API Key, please configure the corresponding platform in settings first", "Missing API Key, please configure the corresponding platform in settings first");
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });
    const status = await provider.getTaskStatus(taskId);
    return NextResponse.json(status);
  } catch (error) {
    console.error("Failed to query task status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "Query failed", "Query failed") },
      { status: 500 }
    );
  }
}
