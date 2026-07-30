# Director CLI contract

Run commands through `node scripts/director.mjs ...` from this Skill directory. Standard output is one JSON envelope. Diagnostics use stable generic codes and never echo submission source paths or private inputs.

Portable or native relative `--file` values are resolved against the directory where this wrapper command is invoked before the wrapper changes to the runtime working directory. Absolute paths remain absolute. Windows drive-relative paths are rejected; use a portable relative path or a fully absolute path supplied by the user. This applies only to the allowlisted scene, Patch, persistence, and PNG file actions below; it does not create a general path-bearing argument surface.

## Authority and input contract

Host Codex performs the semantic `compile` from user language and an optional explicit external profile into generic `IntentReport` plus `SceneSpec` or `ScenePatch`.

The Director performs only a deterministic structured compile: schema validation, normalization, declared-intent coverage validation, atomic session mutation, revision management, persistence, composition inspection, and export. It accepts no prompt, raw text, profile, alias, credential, token, model, provider, model endpoint, or non-loopback network route.

## Commands

```text
doctor
workspace current
workspace list
workspace attach --id <workspace-id>
ensure
status
stop
health
snapshot
blueprint validate --file <actor-blueprint.json>
scene submit --file <scene-submission.json>
patch submit --file <patch-submission.json>
scene save --file <scene.json> [--force]
scene load --file <scene.json>
composition inspect --json
export png --file <output.png> --width <px> --height <px> [--force]
undo
redo
open --system
```

`workspace current` returns the current opaque workspace ID, route source, port, status, legacy flag, and loopback `uiUrl`. `workspace list` returns generic workspace state without thread identifiers or runtime-directory paths. `workspace attach --id` changes only the current conversation's binding to an existing canonical workspace ID. It never copies or mutates a scene.

With a valid Codex thread, `ensure` reuses or starts only that thread's compatible loopback bridge. Every later live command automatically receives the same workspace port and runtime directory. Separate Codex conversations receive separate workspaces by default, and each workspace owns its SceneSession, revision history, and connected Shot Preview. Users never choose ports or directories.

The wrapper hashes the raw thread ID and never passes the raw thread ID to runtime processes, scene files, logs, screenshots, or exports. Without a valid thread ID, commands preserve the legacy single-workspace environment behavior.

Workspace operations never create SceneSpec revisions. `snapshot` returns the authoritative SceneSpec plus undo/redo availability for the current workspace.

Stable workspace errors are:

- `WORKSPACE_ID_INVALID`
- `WORKSPACE_NOT_FOUND`
- `WORKSPACE_STATE_INVALID`
- `WORKSPACE_LOCK_UNAVAILABLE`
- `WORKSPACE_PORT_UNAVAILABLE`
- `WORKSPACE_THREAD_ID_UNAVAILABLE`

## Host-authored submissions

`scene submit --file` reads a strict `{ intentReport, scene }` envelope. Validation and coverage checks finish before a full-scene mutation.

`patch submit --file` reads a strict `{ intentReport, patch }` envelope. The Patch applies atomically only when the scene ID, base revision, references, policy, and evidence are all valid. Success preserves `sceneId` and advances revision exactly once.

Every canonical v5 Patch includes `preserveLock`. Ordinary natural-language corrections use `preserveLock: true`. Workflow locks never require user authorization: `WORKFLOW_LOCKED` means re-author with `preserveLock: true`, not ask the user. User locks require explicit confirmation, so `USER_LOCKED` is the stop-and-ask condition. After explicit user confirmation, use `preserveLock: false` with explicit lock-mode transition operations in the same atomic Patch as the protected change; there is no temporary separate unlock.

`actor.limb-presence.set` targets a canonical actor ID and accepts one to twelve canonical part updates. `LIMB_HIERARCHY_CONFLICT` requires one consistent rewritten operation. `ACTOR_LIMB_TARGET_INVALID` requires a refreshed snapshot and corrected actor target; never fallback to another entity type. Replacement parts, prostheses, mechanical limbs, sockets, and custom meshes remain unsupported host semantics and never become runtime fields.

`blueprint validate --file` is the only Actor Blueprint file-import boundary. The Host wrapper reads at most 1 MiB, sends canonicalized JSON through runtime stdin, and returns only a generic ID/version/SHA-256/count summary. The file path, raw JSON, and full snapshot never appear in stdout, errors, persisted scene state, history, diagnostics, logs, screenshots, or PNG metadata. Read `actor-blueprints.md` for error-layer priority and registration rules.

Create generic transient files under the ignored `.shubi-shot/submissions/` directory. Remove them after successful snapshot verification. Do not store source wording, profile data, or credentials in them.

## Direct structured automation

```text
scene create --file <scene.json>
patch apply --file <patch.json>
```

These commands are for already-structured automation only. They preserve structured callers that already possess valid SceneSpec or ScenePatch data, but they carry no host semantic-completeness claim. Do not use them as the natural-language route.

## JSON envelope

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Generic diagnostic"
  }
}
```

## Revision and error routing

- After `scene submit`, `patch submit`, `scene load`, `undo`, or `redo`, run `snapshot` before reporting completion.
- `STALE_REVISION`: discard and re-author the Patch from a fresh snapshot.
- `INTENT_REPORT_INVALID`: correct the strict report or operation mismatch.
- `UNSUPPORTED_DESCRIPTION`: do not mutate unless an explicitly authorized partial modification can be represented safely.
- `INTENT_COVERAGE_INCOMPLETE`: correct generic targets or evidence.
- `USER_LOCKED`: stop and ask for explicit confirmation.
- `WORKFLOW_LOCKED`: re-author the Patch with `preserveLock: true` without asking the user.
- Other entity, lock, contact, or schema error: refresh state and correct only the structured input.
- Bridge unavailable or incompatible: run `doctor`, then `ensure` and `health`; do not bypass compatibility.
- Workspace routing failure: inspect `workspace current` and `workspace list`; never guess or reuse another workspace's port.

## Persistence, history, and export

- Background persistence never creates locks; it writes the authoritative scene as-is.
- An explicit user-facing save applies workflow locks to every `none` entity before serialization. `scene save` performs and validates that checkpoint, then writes the accepted revision.
- `scene save` and `export png` refuse overwrite unless `--force` is explicit.
- `scene load` validates before replacing the authoritative scene.
- Actor Blueprint snapshots are embedded in SceneSpec. Saving, loading, undo, and redo never depend on the external source file, and no operation removes or automatically garbage-collects a snapshot in v0.6.
- `undo` and `redo` create new authoritative revisions; never assume an old revision number returns.
- `stop` stops only the current workspace. It preserves other conversations and their bridges.
- `composition inspect --json` returns deterministic segmented checks.
- `export png` requires an open connected Shot Preview at the current scene revision. It requests the browser-rendered final camera and never falls back to a separately rendered approximation.
- Export success requires returned scene ID, revision, dimensions, SHA-256, and generic warning codes.

Prefer the integrated browser for the loopback `uiUrl`. Use `open --system` only when no integrated browser is available or the user explicitly asks for it.
