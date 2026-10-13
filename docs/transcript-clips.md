# Clip workbench

Turn a long transcribed recording into short clips you can preview and edit. Clip search runs locally on the existing word-level transcript; no new model or API key is needed.

## Web usage

1. Open the project's "Materials → Edit video by text", import the source video and finish local transcription.
2. In the "Clip workbench", enter keywords from what was said, or leave it empty to see suggestions; choose a target length of 15 / 30 / 60 / 90 seconds.
3. Review the actual spoken text, the source time range and the sentence-end/pause rationale, then click "Preview source" to listen. Preview pauses automatically at the end of the clip.
4. Click "Keep only this part", or expand "Set time range manually" and enter start/end seconds. Existing word deletions inside the range are kept, and you can still remove silences, undo, redo or clear the range limit.
5. Click "Preview edit", check the duration, subtitles and deletion summary, then generate a new edit version. The source video and older versions are kept.

The target length may shift to nearby sentence boundaries. Keywords are matched literally against the spoken text, with normalization for Chinese/English, case and full-width characters; suggestions come from word timings, sentence ends and pause rules and are meant for locating first, then listening manually. If nothing matches, shorten the keyword or set the range manually.

## CLI

```sh
node bin/clipforge.mjs clips --project PROJECT_ID --media MEDIA_ID --query "doesn't leak" --seconds 30 --limit 6
```

Returns `latestRevision` and `candidates`. Each candidate contains `text`, `sourceRange`, `duration`, `firstWordId`, `lastWordId`, `reasons` and `plan`. `speechRatio` is the share covered by word timings. Candidate queries are read-only: nothing is rendered and no version is created.

Save the chosen candidate's `plan` and the `latestRevision` from the query as an edit plan file:

```json
{
  "baseRevision": 0,
  "plan": {
    "version": 1,
    "removedWordIds": [],
    "removeSilence": false,
    "silencePaddingMs": 120,
    "wordPaddingMs": 25,
    "burnSubtitles": true,
    "sourceRange": { "start": 12.5, "end": 39.2 }
  }
}
```

Replace the example seconds with the candidate's actual range and `baseRevision` with the query result.

```sh
# Dry run: check the returned diff and the actual estimated duration
node bin/clipforge.mjs transcript-edit --project PROJECT_ID --media MEDIA_ID --plan clip.json --operation clip-edit-001
# Once accepted, submit the new version with the same plan and operation
node bin/clipforge.mjs transcript-edit --project PROJECT_ID --media MEDIA_ID --plan clip.json --operation clip-edit-001 --apply
```

## MCP / API

`clipforge_find_clips` accepts `projectId`, `mediaId` and optional `query`, `targetSeconds` and `limit`. Pass the chosen `plan` to `clipforge_transcript_edit` for a dry run; use `latestRevision` as `baseRevision`. To keep the current draft's word deletions, inspect first to get the full plan and replace only its `sourceRange`.

HTTP query: `GET /api/project/{projectId}/media/{mediaId}/clips?query=...&targetSeconds=30&limit=6`. Keywords up to 160 characters, target length 5–120 seconds, count 1–12; an unfinished transcription returns 409 and invalid parameters return 400.

`sourceRange` uses source-video seconds: the overall range is limited first, then word deletions and silence removal are applied. Older plans without this field keep using the full source. Invalid, reversed, non-finite or out-of-range ranges return 422. A stale revision still returns 409, and repeated operations keep the existing idempotent handling.

Instant web preview, new version rendering, SRT / VTT subtitles and OTIO / EDL / CSV timelines all share the kept range. Subtitles are recalculated from the output start time, while timelines still point to the real positions in the source.

For multi-select batch output, subtitle phrase correction, task cancellation and recovery, see [Queue and correction notes](transcript-reliability.md).
