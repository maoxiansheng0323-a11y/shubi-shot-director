# Recovery and concurrency

## Conversation workspaces

Separate Codex conversations receive separate workspaces by default. Each workspace has its own loopback bridge, SceneSession, revision history, runtime directory, port, and Shot Preview. The user does not choose ports or directories, and this local isolation is not remote collaborative multi-user editing.

Use `workspace current` to recover the current conversation's opaque route and `workspace list` to inspect generic workspace state. Use `workspace attach --id <workspace-id>` only after the host selects an existing generic workspace ID. Attachment changes only the current thread binding: it never copies a SceneSpec, mutates a scene, or creates a revision.

The wrapper hashes the raw thread ID. The raw thread ID is never passed to runtime processes, scene files, logs, screenshots, or exports. Workspace operations never create SceneSpec revisions.

Revision conflicts are workspace-specific. Refresh `snapshot` from the same workspace and never rebase a Patch onto another workspace's scene ID or revision. A connected Shot Preview belongs to exactly one workspace and cannot satisfy another workspace's export.

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

## Lock routing

There are three canonical lock modes:

- `none`: editable, unfinished graybox work;
- `workflow`: workflow-checkpoint protection;
- `user`: explicit user protection.

Ordinary natural-language corrections use `preserveLock: true`. Workflow locks never require confirmation or user authorization. `WORKFLOW_LOCKED` means re-author the Patch with `preserveLock: true`, not ask the user.

User locks require explicit confirmation. `USER_LOCKED` is the stop-and-ask condition: do not infer permission from the requested edit. After explicit user confirmation, use `preserveLock: false` and include explicit lock-mode transition operations in the same atomic Patch as the protected changes. There is no temporary separate unlock.

For workflow lifecycle changes, a visual acceptance checkpoint may lock only the reviewed and accepted entity subset after the required Overview, required Local previews, and final Shot Preview checks. Unfinished or unaccepted entities remain none. An explicit user-facing save locks all remaining none entities before serialization. Both visual-acceptance and explicit-save transitions must use an explicit ScenePatch with `preserveLock: false` to create workflow locks. Background and autosave persistence never creates locks.

## Conflicts

- `STALE_REVISION`: discard the unsent Patch, fetch a new snapshot, and
  re-plan. Never force an old Patch.
- `USER_LOCKED`: stop and ask for explicit confirmation before changing or
  unlocking the protected entity.
- `WORKFLOW_LOCKED`: preserve the lock and re-author the ordinary correction
  with `preserveLock: true`; do not ask the user.
- `LOCK_PRESERVATION_CONFLICT`: correct the Patch so all prior lock modes are
  preserved, or use the explicitly confirmed same-Patch transition described
  above.
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

Use `stop` for a graceful shutdown of only the current workspace. Do not stop
another conversation's workspace, and do not kill a process by guessed PID or
port ownership.
