import { existsSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";
import { recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import { getDb } from "@/lib/db";
import { assets, generationReviews } from "@/lib/db/schema";
import { probeMedia } from "@/lib/media-probe";
import { createProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/base";
import { resolveUploadFilePath, toRemoteUsableImage } from "@/lib/remote-image";
import {
  buildVideoRepairPreview,
  sanitizeTimedKeyframes,
  sanitizeVideoRepairSummary,
  type RepairScope,
  type RepairWindow,
  type VideoRepairPreview,
} from "@/lib/video-repair-plan";
import { finalizeVideoRepair } from "@/lib/video-repair-finalize";
import { extractFrameAtTime } from "@/lib/video-composer/frame-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

interface RepairRequest {
  action?: "preview" | "execute" | "finalize";
  assetId?: string;
  reviewId?: string;
  provider?: string;
  model?: string;
  supportsAudio?: boolean;
  pricePerCall?: number;
  window?: Partial<RepairWindow>;
  scope?: RepairScope;
  region?: unknown;
  keyframes?: unknown;
  operationId?: string;
  planHash?: string;
  confirmed?: boolean;
  apiKey?: string;
  baseUrl?: string;
  resultUrl?: string;
  plan?: unknown;
}

async function loadRepairContext(projectId: string, assetId: string, reviewId: string) {
  const db = getDb();
  const [[asset], [review], projectAssets] = await Promise.all([
    db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId))).limit(1),
    db.select().from(generationReviews).where(and(eq(generationReviews.id, reviewId), eq(generationReviews.projectId, projectId))).limit(1),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
  ]);
  if (!asset?.filePath || asset.status !== "done" || !VIDEO_EXT.test(asset.filePath)) throw new Error("Please select a completed video candidate");
  if (!review || review.assetId !== asset.id) throw new Error("Review does not match the candidate; refresh and try again");
  const sourcePath = resolveUploadFilePath(asset.filePath);
  if (!sourcePath || !existsSync(sourcePath)) throw new Error("Original shot file not found");
  const metadata = await probeMedia(sourcePath);
  if (metadata.duration <= 0) throw new Error("Could not read the original shot duration");
  return { asset, review, projectAssets, sourcePath, metadata };
}

async function compilePreview(projectId: string, body: RepairRequest, forceOperationId?: string): Promise<{
  preview: VideoRepairPreview;
  context: Awaited<ReturnType<typeof loadRepairContext>>;
}> {
  const assetId = typeof body.assetId === "string" && SAFE_ID.test(body.assetId) ? body.assetId : "";
  const reviewId = typeof body.reviewId === "string" && SAFE_ID.test(body.reviewId) ? body.reviewId : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!assetId || !reviewId || !provider || !model) throw new Error("Missing candidate, review, provider or model");
  const context = await loadRepairContext(projectId, assetId, reviewId);
  const requestedKeyframes = sanitizeTimedKeyframes(body.keyframes, context.metadata.duration);
  const allowedIds = new Set(context.projectAssets.filter((row) => row.filePath && !VIDEO_EXT.test(row.filePath)).map((row) => row.id));
  if (requestedKeyframes.some((keyframe) => !allowedIds.has(keyframe.assetId))) throw new Error("Time anchors must use image assets from the current project");
  const operationId = forceOperationId
    ?? (typeof body.operationId === "string" && SAFE_ID.test(body.operationId) ? body.operationId : crypto.randomUUID());
  const preview = buildVideoRepairPreview({
    operationId,
    sourceAssetId: context.asset.id,
    reviewId: context.review.id,
    shotId: context.asset.shotId,
    provider,
    model,
    supportsAudio: body.supportsAudio === true,
    sourceDuration: context.metadata.duration,
    report: context.review.report,
    contract: context.review.contract,
    requestedWindow: body.window,
    requestedScope: body.scope,
    requestedRegion: body.region,
    keyframes: requestedKeyframes,
    sourceUploadAvailable: provider === "atlas-cloud",
    pricePerCall: body.pricePerCall,
  });
  return { preview, context };
}

function imageDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function executeRepair(projectId: string, body: RepairRequest) {
  if (body.confirmed !== true) throw new Error("Please confirm the repair plan and estimated cost first");
  if (!body.apiKey?.trim()) throw new Error("Missing API key; configure the provider in Settings first");
  if (!body.operationId || !SAFE_ID.test(body.operationId)) throw new Error("Invalid repair plan ID; run the preview again");
  const { preview, context } = await compilePreview(projectId, body, body.operationId);
  if (preview.summary.planHash !== body.planHash) throw new Error("Repair parameters changed; run the preview again and confirm the cost");
  if (!preview.executable) throw new Error("The current provider or model cannot safely run this repair plan");
  const provider = createProvider({ name: preview.summary.provider, apiKey: body.apiKey.trim(), baseUrl: body.baseUrl || "" });
  if (!provider.uploadLocalMedia || !provider.submitVideoTask || !provider.waitForTask) {
    throw new Error("The current provider cannot run recoverable reference-video tasks; nothing was submitted or charged");
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "clipforge-repair-"));
  try {
    const startFrame = join(workingDirectory, "start.jpg");
    const endFrame = join(workingDirectory, "end.jpg");
    const endTime = Math.min(Math.max(0, context.metadata.duration - 0.05), preview.summary.window.end);
    const [startResult, endResult, sourceVideoUrl] = await Promise.all([
      extractFrameAtTime(context.sourcePath, preview.summary.window.start, startFrame),
      extractFrameAtTime(context.sourcePath, endTime, endFrame),
      provider.uploadLocalMedia(context.sourcePath),
    ]);
    if (!startResult || !endResult) throw new Error("Failed to extract repair boundary frames; no paid task was submitted");
    const extraImages: string[] = [];
    for (const keyframe of preview.summary.keyframes) {
      const asset = context.projectAssets.find((row) => row.id === keyframe.assetId);
      const usable = asset?.filePath ? await toRemoteUsableImage(asset.filePath) : undefined;
      if (!usable) throw new Error(`Time anchor ${keyframe.assetId} cannot be safely sent to the model; no paid task was submitted`);
      extraImages.push(usable);
    }
    const referenceImageUrls = [
      imageDataUrl(await readFile(startResult)),
      imageDataUrl(await readFile(endResult)),
      ...extraImages,
    ];
    const { taskId, modelId } = await provider.submitVideoTask({
      modelId: preview.summary.model,
      mode: "video-to-video",
      prompt: preview.prompt,
      duration: preview.summary.generatedDuration,
      width: context.metadata.width,
      height: context.metadata.height,
      referenceVideoUrls: [sourceVideoUrl],
      referenceImageUrls,
      audioEnabled: false,
    });
    const rowId = await recordAiTask({
      projectId,
      shotId: preview.summary.shotId,
      provider: preview.summary.provider,
      model: modelId,
      mediaType: "video",
      mode: "video-to-video",
      prompt: preview.prompt,
      taskId,
      controlPlan: preview.summary,
    });
    try {
      const status = await provider.waitForTask(taskId, { interval: 5000 });
      const result = status.result;
      const videoUrls = result && "videoUrls" in result ? result.videoUrls : undefined;
      if (!videoUrls?.length) {
        await updateAiTask(rowId, { status: "unknown", error: "Task completed but returned no replacement video URL" });
        return { error: "Task completed but returned no replacement video URL", taskId, recoverable: true, status: 502 };
      }
      try {
        const asset = await finalizeVideoRepair({
          projectId,
          summary: preview.summary,
          resultUrl: videoUrls[0],
          prompt: preview.prompt,
          thumbnailPath: context.asset.thumbnailPath,
        });
        await updateAiTask(rowId, { status: "completed", resultUrls: videoUrls, error: null });
        return { asset, taskId, plan: preview.summary, status: 200 };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateAiTask(rowId, { status: "unknown", resultUrls: videoUrls, error: `Remote task completed, local stitching pending recovery: ${message}` });
        return { error: `${message}. Remote result saved; local stitching can be recovered from the assets page`, taskId, recoverable: true, plan: preview.summary, status: 500 };
      }
    } catch (error) {
      const failed = error instanceof ProviderError && error.code === "TASK_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await updateAiTask(rowId, { status: failed ? "failed" : "unknown", error: message });
      return {
        error: failed ? message : `${message}. Task ID ${taskId} has been saved and can be recovered from the assets page — do not resubmit`,
        taskId,
        recoverable: !failed,
        plan: preview.summary,
        status: failed ? 500 : 504,
      };
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "Invalid project ID", "Invalid project ID", 400);
  let body: RepairRequest;
  try {
    body = await req.json();
  } catch {
    return apiError(req, "Invalid repair payload", "Invalid repair payload", 400);
  }
  try {
    if (body.action === "finalize") {
      const summary = sanitizeVideoRepairSummary(body.plan);
      if (!summary || !body.resultUrl) return apiError(req, "Invalid repair result or plan", "Invalid repair result or plan", 400);
      const { preview, context } = await compilePreview(id, {
        ...body,
        assetId: summary.sourceAssetId,
        reviewId: summary.reviewId,
        provider: summary.provider,
        model: summary.model,
        pricePerCall: summary.estimatedCostUsd,
        window: summary.window,
        scope: summary.requestedScope,
        region: summary.region,
        keyframes: summary.keyframes,
      }, summary.operationId);
      if (preview.summary.planHash !== summary.planHash) return apiError(req, "The repair plan changed; preview it again", "The repair plan changed; preview it again", 409);
      const asset = await finalizeVideoRepair({ projectId: id, summary, resultUrl: body.resultUrl, prompt: preview.prompt, thumbnailPath: context.asset.thumbnailPath });
      return NextResponse.json({ asset, plan: summary });
    }
    if (body.action === "execute") {
      const result = await executeRepair(id, body);
      const { status, ...payload } = result;
      return NextResponse.json(payload, { status });
    }
    const { preview } = await compilePreview(id, body);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("Video repair failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "Video repair failed", "Video repair failed") }, { status: 400 });
  }
}
