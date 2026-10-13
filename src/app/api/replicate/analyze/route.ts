import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";
import { detectSceneTimes } from "@/lib/video-composer/contact-sheet";
import { shotPlanFromCuts, replicateReferenceStructure, REPLICATE_MAX_REF_SEC } from "@/lib/replicate-plan";
import { apiError, errText } from "@/lib/api-error";

/** Single-file limit (matches the materials route; the model tier's own cap is 50MB/15s, reported per-mode) */
const MAX_FILE_SIZE = 80 * 1024 * 1024;
const ALLOWED_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const EXT_BY_MIME: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/**
 * POST /api/replicate/analyze — REAL reference-video analysis for the viral-replication
 * flow (replaces the clone page's old fake 600ms "analysis" that returned a hardcoded
 * 6-card structure). multipart: file=<video>.
 *
 * Saves the video under uploads/replicate/ (servable via /api/files/replicate/...),
 * detects scene cuts with ffmpeg (same detector as the contact sheet), and returns the
 * shot-duration skeleton plus the ready-to-use referenceStructure prompt block.
 */
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(req, "Invalid form data", "Invalid form data", 400);
  }
  const file = formData.get("file") as File | null;
  if (!file) return apiError(req, "Please upload a reference video file", "Please upload a reference video file", 400);
  if (file.size > MAX_FILE_SIZE) {
    return apiError(req, "Reference video exceeds the 80MB size limit", "Reference video exceeds the 80MB size limit", 400);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return apiError(req, "Only mp4/webm/mov videos are supported", "Only mp4/webm/mov videos are supported", 400);
  }

  try {
    const dir = join(getDataDir(), "uploads", "replicate");
    await mkdir(dir, { recursive: true });
    // renamed on save (original filename never reused — same policy as the materials route)
    const name = `ref-${Date.now()}.${EXT_BY_MIME[file.type] ?? "mp4"}`;
    const filePath = join(dir, name);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const probe = await probeMedia(filePath);
    if (!probe.duration) {
      return apiError(req, "Could not read the video duration — the file may be corrupt", "Could not read the video duration — the file may be corrupt", 400);
    }
    const cuts = await detectSceneTimes(filePath);
    const shots = shotPlanFromCuts(cuts, probe.duration);

    return NextResponse.json({
      path: `/api/files/replicate/${name}`,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      shots,
      referenceStructure: replicateReferenceStructure(shots, probe.duration),
      // model-tier eligibility (Seedance reference_videos: ≤15s) decided server-side once
      modelTierEligible: probe.duration <= REPLICATE_MAX_REF_SEC,
      maxRefSec: REPLICATE_MAX_REF_SEC,
    });
  } catch (error) {
    console.error("Reference video analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "Reference video analysis failed", "Reference video analysis failed") },
      { status: 500 }
    );
  }
}
