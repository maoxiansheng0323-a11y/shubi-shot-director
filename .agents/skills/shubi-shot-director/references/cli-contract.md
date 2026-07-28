# Director CLI contract

Run commands through `node scripts/director.mjs ...` from this Skill directory. Standard output is one JSON envelope. Diagnostics use stable generic codes and never echo submission source paths or private inputs.

Portable or native relative `--file` values are resolved against the directory where this wrapper command is invoked before the wrapper changes to the runtime working directory. Absolute paths remain absolute. Windows drive-relative paths are rejected; use a portable relative path or a fully absolute path supplied by the user. This applies only to the allowlisted scene, Patch, persistence, and PNG file actions below; it does not create a general path-bearing argument surface.

## Authority and input contract

Host Codex performs the semantic `compile` from user language and an optional explicit external profile into generic `IntentReport` plus `SceneSpec` or `ScenePatch`.

The Director performs only a deterministic structured compile: schema validation, normalization, declared-intent coverage validation, atomic session mutation, revision management, persistence, composition inspection, and export. It accepts no prompt, raw text, profile, alias, credential, token, model, provider, model endpoint, or non-loopback network route.

## Commands

```text
doctor
ensure
status
stop
health
snapshot
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

`ensure` reuses a healthy compatible loopback bridge or starts one. `snapshot` returns the authoritative SceneSpec plus undo/redo availability.

## Host-authored submissions

`scene submit --file` reads a strict `{ intentReport, scene }` envelope. Validation and coverage checks finish before a full-scene mutation.

`patch submit --file` reads a strict `{ intentReport, patch }` envelope. The Patch applies atomically only when the scene ID, base revision, references, policy, and evidence are all valid. Success preserves `sceneId` and advances revision exactly once.

Every canonical v4 Patch includes `preserveLock`. Ordinary natural-language corrections use `preserveLock: true`. Workflow locks never require user authorization: `WORKFLOW_LOCKED` means re-author with `preserveLock: true`, not ask the user. User locks require explicit confirmation, so `USER_LOCKED` is the stop-and-ask condition. After explicit user confirmation, use `preserveLock: false` with explicit lock-mode transition operations in the same atomic Patch as the protected change; there is no temporary separate unlock.

`actor.limb-presence.set` targets a canonical actor ID and accepts one to twelve canonical part updates. `LIMB_HIERARCHY_CONFLICT` requires one consistent rewritten operation. `ACTOR_LIMB_TARGET_INVALID` requires a refreshed snapshot and corrected actor target; never fallback to another entity type. Replacement parts, prostheses, mechanical limbs, sockets, and custom meshes remain unsupported host semantics and never become runtime fields.

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

## Persistence, history, and export

- Background persistence never creates locks; it writes the authoritative scene as-is.
- An explicit user-facing save applies workflow locks to every `none` entity before serialization. `scene save` performs and validates that checkpoint, then writes the accepted revision.
- `scene save` and `export png` refuse overwrite unless `--force` is explicit.
- `scene load` validates before replacing the authoritative scene.
- `undo` and `redo` create new authoritative revisions; never assume an old revision number returns.
- `composition inspect --json` returns deterministic segmented checks.
- `export png` requires an open connected Shot Preview at the current scene revision. It requests the browser-rendered final camera and never falls back to a separately rendered approximation.
- Export success requires returned scene ID, revision, dimensions, SHA-256, and generic warning codes.

Prefer the integrated browser for the loopback `uiUrl`. Use `open --system` only when no integrated browser is available or the user explicitly asks for it.
