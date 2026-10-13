import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDb } from "@/lib/db";
import { compositions, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDataDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";
import { apiError, errText } from "@/lib/api-error";
import { downloadExternal, DownloadHttpError, DownloadTooLargeError } from "@/lib/external-download";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;
/** Generated clips are short (≤15s); 200MB leaves headroom for 1080p high-bitrate output */
const MAX_DOWNLOAD_SIZE = 200 * 1024 * 1024;

/**
 * POST /api/project/[id]/replicate/save — persist a model-tier replicated clip
 * (Seedance reference-to-video output) as a finished composition, so it shows up
 * on the export page next to pipeline-composed videos. body: { videoUrl }.
 * The clip is downloaded into data/output/{id}/ (provider URLs expire).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "Invalid project ID", "Invalid project ID", 400);

  const body = await req.json().catch(() => ({}));
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
  if (!videoUrl.startsWith("http")) {
    return apiError(req, "Missing a valid video URL", "Missing a valid video URL", 400);
  }

  try {
    const db = getDb();
    const proj = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
    if (proj.length === 0) return apiError(req, "Project not found", "Project not found", 404);

    let buf: Buffer;
    try {
      // SSRF-checked (public IPs only, redirects re-validated); mock-provider URLs are read from public/mock
      ({ buf } = await downloadExternal(videoUrl, { maxBytes: MAX_DOWNLOAD_SIZE, timeoutMs: 5 * 60_000 }));
    } catch (e) {
      if (e instanceof DownloadHttpError) {
        return apiError(req, `Video download failed (${e.status})`, `Video download failed (${e.status})`, 502);
      }
      if (e instanceof DownloadTooLargeError) {
        return apiError(req, "Video content is empty or exceeds the size limit", "Video content is empty or exceeds the size limit", 502);
      }
      throw e;
    }
    if (buf.length === 0 || buf.length > MAX_DOWNLOAD_SIZE) {
      return apiError(req, "Video content is empty or exceeds the size limit", "Video content is empty or exceeds the size limit", 502);
    }

    const dir = join(getDataDir(), "output", id);
    await mkdir(dir, { recursive: true });
    const fileName = `replicate_${Date.now()}.mp4`;
    const outputPath = join(dir, fileName);
    await writeFile(outputPath, buf);

    // best-effort metadata (a failed probe must not lose the already-downloaded clip)
    let durationMs: number | undefined;
    let portrait = true;
    try {
      const probe = await probeMedia(outputPath);
      durationMs = Math.round(probe.duration * 1000) || undefined;
      portrait = probe.height >= probe.width;
    } catch {
      /* keep defaults */
    }

    const [row] = await db
      .insert(compositions)
      .values({
        projectId: id,
        outputPath,
        status: "done",
        aspectRatio: portrait ? "9:16" : "16:9",
        ...(durationMs && { duration: durationMs }),
        // model output carries no burned-in badge — the release gate reports this honestly
        aigcBadge: false,
      })
      .returning();

    return NextResponse.json({
      compositionId: row.id,
      url: `/api/output/${id}/${fileName}`,
      fileName,
    });
  } catch (error) {
    console.error("Failed to save replicated clip:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "Failed to save the replicated clip", "Failed to save the replicated clip") },
      { status: 500 }
    );
  }
}
