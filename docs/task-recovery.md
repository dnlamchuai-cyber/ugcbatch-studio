# Task status and model selection

The task center aggregates auto video runs, video compositions, cloud generations and active batches across all projects. Click a task to open the matching project page.

- While tasks are running or pending it refreshes every 15 seconds; with no tasks it keeps checking for new ones every 30 seconds.
- Polling pauses while the page is hidden, and updates immediately when you return to the page, the network recovers or the task panel is expanded.
- A failed request does not clear the task list and does not show "No tasks"; the panel says it is showing the last known state and offers a retry.
- Interruptions caused by a failed auto run or a service restart stay visible; once a new run takes over, the old notice disappears automatically. The latest checkpoint is identified even for retries within the same second.
- Cloud tasks with an unknown status go to project verification and recovery. Reading status in the task center never resubmits a generation request; an unknown status also does not mean the charge has been completed.

"Fetch available models" in Settings applies only to the current service URL and key. Changing either one clears the old list and cancels the old query; a failed query can be retried directly, and entering a model name manually still works.

## Local verification

`pnpm exec vitest run src/lib/__tests__/task-feed-route.test.ts src/lib/__tests__/use-task-feed.test.ts src/lib/__tests__/model-picker.test.ts`

Covers persistence of interrupted state in real SQLite, same-second retry ordering, progress for all batches, and late responses during idle discovery, offline retry, background pause, request timeout and model catalog switching.
