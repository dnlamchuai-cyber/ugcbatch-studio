/** Smallest plausible clip (headers + a frame); anything smaller is an error body, not a video. */
export const MIN_VIDEO_BYTES = 1024;

/** Why a downloaded body is not a video (null when it looks like MP4/MOV/WebM). */
export function videoDownloadProblem(buf: Buffer, contentType: string): string | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && !ct.startsWith("video/") && ct !== "application/octet-stream" && ct !== "binary/octet-stream") return `content-type ${ct}`;
  if (buf.length < MIN_VIDEO_BYTES) return `only ${buf.length} bytes`;
  const isMp4OrMov = buf.subarray(4, 8).toString("latin1") === "ftyp";
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  if (!isMp4OrMov && !isWebm) return "not MP4/MOV/WebM data";
  return null;
}
