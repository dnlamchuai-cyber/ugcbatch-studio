import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegBin } from "@/lib/ffmpeg-path";

const run = promisify(execFile);
const SCAN_SECONDS = 15;

/** Parse ffmpeg blackdetect output → end of a black run that starts at the very beginning (0 if none). Pure. */
export function parseBlackIntro(stderr: string): number {
  for (const m of stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (start <= 0.1 && end > start) return end;
  }
  return 0;
}

/**
 * Seconds to skip so a stock clip doesn't open on its black fade-in / title-card intro.
 * Only applied when enough footage remains to fill the slot; otherwise 0 (keep the original start).
 */
export function chooseStartOffset(blackEnd: number, sourceDuration: number | undefined, slot: number): number {
  if (blackEnd <= 0) return 0;
  const offset = Number((blackEnd + 0.1).toFixed(3));
  if (sourceDuration && sourceDuration - offset < slot * 0.7) return 0;
  return offset;
}

export async function blackIntroEnd(file: string, sourceDuration: number | undefined, slot: number): Promise<number> {
  try {
    const { stderr } = await run(
      ffmpegBin(),
      ["-hide_banner", "-t", String(SCAN_SECONDS), "-i", file, "-an", "-vf", "blackdetect=d=0.2:pix_th=0.12:pic_th=0.95", "-f", "null", "-"],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }
    );
    return chooseStartOffset(parseBlackIntro(stderr), sourceDuration, slot);
  } catch {
    return 0;
  }
}

/**
 * Stock library footage is B-roll: never native narration (its soundtrack is ambient/music), so it
 * gets TTS and a script-timed slot, and is cropped to fill the frame. Pure.
 */
export function stockClipPolicy(assetType: string | undefined): { mayHaveNativeVoice: boolean; fit: "contain" | "cover" } {
  const stock = assetType === "stock_footage";
  return { mayHaveNativeVoice: !stock, fit: stock ? "cover" : "contain" };
}
