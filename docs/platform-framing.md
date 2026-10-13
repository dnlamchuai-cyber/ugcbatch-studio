# Controllable framing and multi-platform export

The same finished video can be exported as 9:16 versions for Douyin, Kuaishou, WeChat Channels, TikTok Shop, Reels and Shorts, and as a 3:4 version for Xiaohongshu. Everything runs locally, no model or API key is needed, and the original video is kept.

## Web usage

1. Open the project's "Export" page and pick a video version under "Multi-platform export". The preview and every platform output in this batch use that version.
2. Pick a framing mode: **Blurred background** keeps the full frame and fills the background; **Letterbox** keeps the original frame intact; **Fill crop** fills the target aspect ratio with adjustable horizontal and vertical position.
3. Play the original to the point you want to check and click "Use playback position", or enter seconds; choose a preview platform and click "Preview framing". The preview is a real single frame rendered by the export engine and shows the actual sampled time.
4. Tick the target platforms and click "Export selected". Platforms are processed one by one and can be downloaded as soon as they succeed; failures can be retried individually.

The crop position is the offset of the part that overflows the frame: 0 is left/top, 0.5 is center, 1 is right/bottom. Directions that do not overflow the target frame do not move. The crop position is fixed for the whole video and does not follow people; burned-in subtitles and overlays may also be cropped, so check several points in time or choose a mode that keeps the full frame.

Processing can be cancelled; completed files remain downloadable. A failure or cancellation never publishes a partial file. After changing the version or framing, the old preview and old download links are cleared so results from old parameters are not mistaken for current ones; completed files on disk are kept.

## CLI

```bash
# Fixed version, preview a right-side crop at second 3; preview in the JSON is a JPEG data URL
node bin/clipforge.mjs export --project PROJECT_ID --composition COMPOSITION_ID \
  --platform douyin --framing crop --position-x 1 --position-y 0.5 \
  --preview --time 3 --json

# Export the full video with the same version and framing
node bin/clipforge.mjs export --project PROJECT_ID --composition COMPOSITION_ID \
  --platform douyin --framing crop --position-x 1 --position-y 0.5 --json
```

`--framing` supports `blur` (default), `fit` and `crop`. Coordinates range from 0 to 1. When `--composition` is omitted, the backend picks the latest successful video and returns the actual `compositionId`; automation exporting several platforms in a row should reuse that ID.

## MCP / API

`clipforge_export_platform` and `POST /api/project/:id/export-platform` share the same parameters:

```json
{
  "platform": "xiaohongshu",
  "compositionId": "COMPOSITION_ID",
  "framing": { "mode": "crop", "positionX": 0.5, "positionY": 0.3 },
  "preview": true,
  "previewTime": 3
}
```

MCP additionally takes `projectId` and returns the preview as native image content. The API preview returns `preview` (JPEG data URL), `previewTime`, `duration`, `size`, `compositionId` and the normalized `framing`; no image file is written. A preview time beyond the video length is clamped to near the end.

Omitting `preview` or setting it to `false` exports the full video and returns the download `url`, framing, source version and a measured bitrate `report`. `report.withinCap` only means the current encoding budget is met; it cannot guarantee the platform will not re-encode. Legacy calls without framing parameters still use the blurred background.

Exports share the concurrency limit with other local composition tasks, use separate temporary files, and only expose the full file after the output dimensions and duration are verified. Audio tracks are mapped optionally from the source, and source metadata is preserved in the output.
