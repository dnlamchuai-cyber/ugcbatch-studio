import { NextRequest, NextResponse } from "next/server";
import { withMockApiKey } from "@/lib/mock-ai";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { getDb } from "@/lib/db";
import { scripts, assets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createProvider } from "@/lib/providers";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { buildStoryboardGridPrompt, computeGridCells, GRID_MAX_SHOTS } from "@/lib/storyboard-grid";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { probeMedia } from "@/lib/media-probe";
import { apiError, errText } from "@/lib/api-error";
import { downloadExternal } from "@/lib/external-download";
import { rejectUnsafeBaseUrls } from "@/lib/baseurl-gate";

const execFileAsync = promisify(execFile);
/** Generated grid images are a few MB; 50 MB is generous headroom. */
const GRID_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

/** Download or decode the generated grid image into the project uploads dir; returns the physical path + public path. */
async function persistGridImage(projectId: string, sourceUrl: string): Promise<{ absPath: string; publicPath: string }> {
  const dir = join(getDataDir(), "uploads", projectId);
  await mkdir(dir, { recursive: true });
  let buf: Buffer;
  let ext = "png";
  if (sourceUrl.startsWith("data:")) {
    const comma = sourceUrl.indexOf(",");
    if (comma === -1) throw new Error("Could not parse data URI image");
    const meta = sourceUrl.slice(5, comma);
    buf = /;base64/i.test(meta)
      ? Buffer.from(sourceUrl.slice(comma + 1), "base64")
      : Buffer.from(decodeURIComponent(sourceUrl.slice(comma + 1)), "utf-8");
    if (meta.includes("webp")) ext = "webp";
    else if (meta.includes("jpeg") || meta.includes("jpg")) ext = "jpg";
  } else if (/^https?:\/\//.test(sourceUrl)) {
    // SSRF-checked; mock-provider URLs are read from public/mock instead of over HTTP
    const dl = await downloadExternal(sourceUrl, { maxBytes: GRID_IMAGE_MAX_BYTES, timeoutMs: 60_000 }).catch((e: unknown) => {
      throw new Error(`Failed to download storyboard grid image: ${e instanceof Error ? e.message : String(e)}`);
    });
    buf = dl.buf;
    const ct = dl.contentType;
    if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
  } else {
    throw new Error("Unsupported image source");
  }
  const fileName = `storyboard-grid-${Date.now()}.${ext}`;
  const absPath = join(dir, fileName);
  await writeFile(absPath, buf);
  return { absPath, publicPath: `/api/files/${projectId}/${fileName}` };
}

/**
 * POST /api/project/[id]/storyboard-grid — one-image consistency anchoring.
 *
 * Renders ALL shots of a script as a single 3x3 storyboard grid (same person /
 * outfit / room / light physically guaranteed by being one generation), then
 * crops each cell into that shot's keyframe asset. The existing per-shot i2v
 * pass ("animate") picks the keyframes up from there. Scripts with more than 9
 * shots are rejected honestly instead of silently truncated.
 *
 * body: { scriptId, provider, model, apiKey, baseUrl?, options? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return apiError(req, "Invalid project id", "Invalid project id", 400);
    }
    const body = await req.json();
    { const blocked = await rejectUnsafeBaseUrls(body); if (blocked) return blocked; } // SSRF: private/metadata baseUrl → 400 BASEURL_BLOCKED
    const { scriptId, provider: providerName, model, apiKey, baseUrl, options, characterSheetUrl, productImageUrl } = body as {
      scriptId?: string;
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      options?: Record<string, unknown>;
      /** Presenter's multi-view sheet — locks the person's identity across all nine cells */
      characterSheetUrl?: string;
      /** Product photo — locks the product's appearance across all nine cells */
      productImageUrl?: string;
    };
    if (!scriptId || !providerName || !model) {
      return apiError(req, "Missing scriptId / provider / model", "Missing scriptId / provider / model", 400);
    }
    const effectiveApiKey = withMockApiKey(apiKey);
    if (!effectiveApiKey) {
      return apiError(req, "Missing API key — configure an image provider in settings first", "Missing API key — configure an image provider in settings first", 400);
    }

    const db = getDb();
    const [script] = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, id)));
    if (!script) return apiError(req, "Script not found", "Script not found", 404);
    const shots = Array.isArray(script.shots) ? script.shots : [];
    if (shots.length < 2) {
      return apiError(req, "Too few shots — the grid needs at least 2", "Too few shots — the grid needs at least 2", 400);
    }
    if (shots.length > GRID_MAX_SHOTS) {
      return apiError(
        req,
        `The grid holds at most ${GRID_MAX_SHOTS} shots (this script has ${shots.length}) — use per-shot generation with keyframe chaining for longer scripts`,
        `The grid holds at most ${GRID_MAX_SHOTS} shots (this script has ${shots.length}) — use per-shot generation with keyframe chaining for longer scripts`,
        400
      );
    }

    // reference images (order matters — the prompt cites them by position):
    // [character sheet?, product photo?]; local /api/files paths travel as Base64
    const refInputs = [characterSheetUrl, productImageUrl].filter((u): u is string => !!u);
    const referenceImageUrls = (await Promise.all(refInputs.map(toRemoteUsableImage))).filter(
      (u): u is string => !!u
    );

    // 1) one generation renders every shot — consistency is physical, not prompted;
    // with references attached the sheet pins the person and the photo pins the product
    const prompt = buildStoryboardGridPrompt(shots, script.characters, {
      characterSheet: !!characterSheetUrl,
      productImage: !!productImageUrl,
    });
    const provider = createProvider({ name: providerName, apiKey: effectiveApiKey, baseUrl: baseUrl ?? "" });
    const result = await provider.generateImage({
      ...(options ?? {}),
      modelId: model,
      mode: referenceImageUrls.length > 0 ? "image-to-image" : "text-to-image",
      ...(referenceImageUrls.length > 0 && { referenceImageUrls }),
      prompt,
    });
    const gridUrl = result.imageUrls?.[0];
    if (!gridUrl) throw new Error("Image generation returned no image");

    // 2) persist the grid, then crop each cell into that shot's keyframe
    const { absPath, publicPath } = await persistGridImage(id, gridUrl);
    const probe = await probeMedia(absPath);
    if (!probe.width || !probe.height) throw new Error("Could not read storyboard grid image dimensions");
    const cells = computeGridCells(probe.width, probe.height);

    const dir = join(getDataDir(), "uploads", id);
    const saved: { shotId: number; filePath: string }[] = [];
    for (let i = 0; i < shots.length; i++) {
      const cell = cells[i];
      const fileName = `asset-${shots[i].shotId}-${Date.now()}-grid.png`;
      const outPath = join(dir, fileName);
      await execFileAsync(ffmpegBin(), [
        "-y",
        "-i", absPath,
        "-vf", `crop=${cell.w}:${cell.h}:${cell.x}:${cell.y}`,
        "-frames:v", "1",
        outPath,
      ]);
      const filePath = `/api/files/${id}/${fileName}`;
      // Keep older takes for review/rollback while making this fresh grid cell active.
      await db.update(assets).set({ selected: false }).where(and(eq(assets.projectId, id), eq(assets.shotId, shots[i].shotId)));
      await db.insert(assets).values({
        projectId: id,
        shotId: shots[i].shotId,
        type: "ai_generated",
        filePath,
        provider: providerName,
        model,
        prompt: `[storyboard-grid 第${i + 1}格] ${shots[i].description ?? ""}`.trim(),
        selected: true,
        status: "done",
      });
      saved.push({ shotId: shots[i].shotId, filePath });
    }

    return NextResponse.json({ gridPath: publicPath, cells: saved, count: saved.length });
  } catch (error) {
    console.error("Storyboard grid generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "Storyboard grid failed", "Storyboard grid failed") },
      { status: 500 }
    );
  }
}
