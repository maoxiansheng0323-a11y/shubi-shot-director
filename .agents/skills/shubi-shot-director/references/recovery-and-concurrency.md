# Recovery and concurrency

## Patch transition

Snapshot immediately before authoring a Patch. Require the exact `sceneId` and
`revision`.

Submit through `patch submit --file`. After submission, snapshot again and
verify:

- the `sceneId` is unchanged;
- the revision is the base revision plus one;
- only requested fields changed.

Use `scripts/verify-transition.mjs` with captured generic before, after, and
Patch JSON when a deterministic diff is needed.

Keep the matching `IntentReport` and Patch together in one transient envelope.
Do not retry by paraphrasing source language or by switching to scene
replacement.

## Conflicts

- `STALE_REVISION`: discard the unsent Patch, fetch a new snapshot, and
  re-plan. Never force an old Patch.
- `ENTITY_LOCKED`: preserve the lock unless unlocking was explicitly
  requested.
- `CONTACT_CONSTRAINT_ACTIVE`: disable contact and move in the same Patch only
  for an intentional vertical offset.
- browser drag conflict: keep the newer authoritative scene and discard the
  old drag draft.
- `INTENT_REPORT_INVALID`: correct the strict report shape or operation.
- `UNSUPPORTED_DESCRIPTION`: stop unless the user explicitly authorized a
  safely representable partial modification.
- `INTENT_COVERAGE_INCOMPLETE`: correct generic targets or evidence without
  weakening the requested constraint.

## Bridge recovery

Use `doctor` for read-only diagnostics. Use `ensure` only when a running bridge
is required. Confirm with `status`.

Use `stop` for a graceful loopback shutdown. Do not kill a process by guessed
PID or port ownership.
