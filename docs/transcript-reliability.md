# Text-based editing: queue, correction and batch output

## Full workflow

1. In the clip workbench, select several candidates and rename each one. Up to 12, using the current draft's word deletion, silence removal and subtitle settings, each keeping its own selected source range.
2. Click "Preview batch output", check each item's version number and actual duration, then confirm. All versions are added to the local queue at once.
3. Version cards show queued, rendering progress, done, failed or cancelled. Each task can be cancelled independently, and failed/cancelled versions can be retried from the saved plan.
4. Refreshing or leaving the page does not affect the server-side queue. After a service restart, tasks that lost their heartbeat are recognized as interrupted on the next read (within about 45 seconds) and can be retried from the version card. The task center can also take you to the matching material.

Each retry keeps the original version number, plan, kept range and transcript snapshot, and uses a separate output file. Historical subtitles are never silently replaced with re-transcribed text, and an old task cannot overwrite the result of a newer attempt. Cancelling stops the local FFmpeg and cleans up that attempt's temporary output. Older versions without a transcript snapshot can be loaded as a draft and previewed again before output.

Range reads of source and output videos support browser request aborts, and switching videos releases the file stream to avoid duplicate-close errors.

Editing starts decoding near the target range, so a short clip from late in the video does not require decoding everything before it. Video, audio and subtitles are still reordered against the same source time ranges. A local regression compared frame similarity, audio difference and duration between decoding from the start and seeking.

## Long transcripts and subtitle correction

The text timeline shows up to 160 words per section, and full-text search locates up to 1000 matches; you can page back and forth, jump to search results or locate the current playback position. Paging and search do not change the edit plan.

Expand "Subtitle correction", enter the original wording and the correct spelling, review the matches and replacement preview, then apply. Contiguous phrases across word IDs, repeated text within one word, and multiple fixes of the same wording are supported. Up to 200 entries, each with up to 100 contiguous word IDs and 240 characters, with no overlaps. Corrections go into undo/redo and the version plan; the original transcript is unchanged.

"Remove silence" shows every detected pause by default; you can listen to each one, tick the ranges to cut and adjust the milliseconds kept on both sides of a pause. Older plans without explicitly saved ranges still mean "cut all detected pauses"; new plans save `removedSilenceRanges` and `silencePaddingMs`, so preview, dry run, rendering, retries and professional timeline exports use the same pause ranges.

SRT, VTT, burned-in subtitles and professional timeline clip notes use the corrected text. When a phrase is cut through or partly deleted, the whole correction for that phrase is skipped so missing words are not put back into the subtitles. The timestamp granularity from the model determines which text units can be edited independently; character-level timings are not averaged artificially.

## API

- `POST /api/project/{projectId}/media/{mediaId}/batch`: `action` is `preview` or `apply`, with `batchId` (8–64 letters, digits or hyphens), `baseRevision` and `items: [{ label, plan }]`. Preview returns a `proposal` per item; submit with the same `batchId`, and repeated requests return the existing tasks. Batches are created atomically; a revision conflict returns 409, and an invalid plan or one shorter than 0.5 seconds returns 422.
- `POST .../edit`: `{ action: "cancel" | "retry", editId }`. Only versions of the current project/material can be operated on. Successful versions cannot be retried directly; re-output creates a new version.
- `GET .../edit` returns the latest progress, status and errors; without `limit` it returns up to 500 words.
- `GET /api/project/{projectId}/media` returns version status, progress, batch ID and result links, without resending internal transcript snapshots.

Optional plan field:

```json
{
  "captionReplacements": [
    { "wordIds": ["w1", "w2"], "text": "travel mug" }
  ]
}
```

A plan with selective silence removal can also carry `removedSilenceRanges`, each range using source time (seconds) from the transcript document:

```json
{
  "removeSilence": true,
  "removedSilenceRanges": [{ "start": 12.4, "end": 13.8 }]
}
```

Use the real contiguous IDs returned by inspect. Corrections change only the subtitles, not source timing, word deletions or audio.

## Model catalog

The Settings and Materials pages show, per platform, image/video catalog status, check time, model count and a refresh action. Failed catalog requests, empty catalogs and fallback catalogs are shown separately; a partial failure never automatically replaces the selected default model. After changing the key or service URL, old requests cannot overwrite results for the new configuration.

A successful catalog only means the catalog is readable; it does not verify key permissions, balance or generation service availability. Refreshing the catalog never triggers generation or calls paid models. Error responses use fixed error codes and never echo upstream URLs, keys or raw errors.
