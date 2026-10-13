import { NextRequest, NextResponse } from "next/server";
import { withMockApiKey } from "@/lib/mock-ai";
import { createProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/base";
import { apiError, errText } from "@/lib/api-error";
import { updateAiTaskByProviderTaskId, type AiTaskStatus } from "@/lib/ai-tasks";
import type { TaskStatusEnum } from "@/lib/providers/types";
import { rejectUnsafeBaseUrls } from "@/lib/baseurl-gate";

// Query / resume a previously submitted video task by its provider task ID (issue #16).
// POST because the request carries the API key — keys must never appear in URLs.
// body: { provider, apiKey, baseUrl?, taskId, wait? }
//   wait=false (default): single status check
//   wait=true: block until the task reaches a terminal state (resume flow)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  { const blocked = await rejectUnsafeBaseUrls(body); if (blocked) return blocked; } // SSRF: private/metadata baseUrl → 400 BASEURL_BLOCKED
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(req, "Request body must be a JSON object", "Request body must be a JSON object", 400);
  }
  const { provider: providerName, apiKey, baseUrl, taskId, wait } = body;

  if (!providerName || !taskId) {
    return apiError(req, "Missing required parameters (provider / taskId)", "Missing required parameters (provider / taskId)");
  }
  if (!withMockApiKey(apiKey)) {
    return apiError(req, "Missing API Key, please configure the corresponding platform in settings first", "Missing API Key, please configure the corresponding platform in settings first");
  }

  // map the provider's task status to the persisted ai_tasks status
  const toRowStatus = (s: TaskStatusEnum): AiTaskStatus =>
    s === "completed" ? "completed" : s === "failed" || s === "cancelled" ? "failed" : "processing";

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });

    try {
      const status = wait && provider.waitForTask
        ? await provider.waitForTask(taskId, { interval: 5000 })
        : await provider.getTaskStatus(taskId);

      const result = status.result;
      const videoUrls = result && "videoUrls" in result ? result.videoUrls : undefined;

      await updateAiTaskByProviderTaskId(providerName, taskId, {
        status: toRowStatus(status.status),
        ...(videoUrls && { resultUrls: videoUrls }),
        error: status.error ?? null,
      });

      return NextResponse.json({
        taskId,
        status: status.status,
        videoUrls,
        error: status.error,
      });
    } catch (error) {
      // definitive failure vs. lost contact — a paid task must never be downgraded to
      // "failed" just because we couldn't reach the status endpoint
      const failed = error instanceof ProviderError && error.code === "TASK_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await updateAiTaskByProviderTaskId(providerName, taskId, {
        status: failed ? "failed" : "unknown",
        error: message,
      });
      return NextResponse.json(
        { error: message, taskId, recoverable: !failed },
        { status: failed ? 500 : 504 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "Task query failed", "Task query failed") },
      { status: 500 }
    );
  }
}
