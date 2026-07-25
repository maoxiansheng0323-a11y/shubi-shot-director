---
name: shubi-shot-director
description: Use when staging or revising editable 3D graybox shots from natural language, including actor and prop blocking, camera placement, focal length, composition constraints, explicitly supplied project aliases, history operations, scene persistence, or perspective-reference export.
---

# Shubi Shot Director

Host Codex is the sole semantic authority. Convert user language into generic structured documents in the host, then use the Director only for deterministic validation, mutation, inspection, persistence, and export.

Before changing to this Skill directory, resolve any explicitly supplied relative external profile path against the current working project into a host-only absolute path, then follow [external-profiles.md](references/external-profiles.md). Never pass that path to the runtime.

## Start the session

1. Change to this Skill directory.
2. Run `node scripts/director.mjs doctor`.
3. Require capability contract v2 with `semanticAuthority: "host"`, `inputContract: "structured-only"`, `modelIntegration: "none"`, `credentialPolicy: "forbidden"`, and `networkPolicy: "loopback-only"`.
4. Run `node scripts/director.mjs ensure` only after `doctor` is compatible.
5. Keep the returned loopback `uiUrl`. Open it in the integrated browser; use `open --system` only when necessary or requested.

Portable or native relative `--file` paths are resolved against the directory where the Skill wrapper is invoked before it switches to the runtime working directory. Windows drive-relative paths are rejected; use a portable relative path or a fully absolute path supplied by the user.

## Preserve the authority boundary

- Perform the semantic `compile` in Host Codex: understand user language, resolve an explicitly supplied external profile in host memory, identify ambiguity and unsupported requirements, and author `IntentReport` plus `SceneSpec` or `ScenePatch`.
- Let the runtime perform only a structured compile: strict schema parsing, deterministic normalization, intent-coverage checks, atomic session mutation, revision control, persistence, composition inspection, and export. Never ask it to infer missing meaning.
- Never pass a prompt, raw user wording, profile path, profile content, alias, credential, token, model, provider, or endpoint to the runtime.
- Codex may run in account or KEY mode. Never inspect those host credentials and never pass them to Director commands, files, processes, logs, or artifacts.
- Do not use lexical fallback, local language compilation, or retry-paraphrasing. If the schemas cannot express a required result, report the generic unsupported capability instead of submitting a partial result.

## Create a shot

1. Treat only an explicit new-shot request, or the absence of a usable scene, as permission to author a complete `SceneSpec`.
2. Resolve any explicitly supplied external profile only by following [external-profiles.md](references/external-profiles.md).
3. Read [intent-routing.md](references/intent-routing.md), [intent-report.md](references/intent-report.md), [scene-authoring.md](references/scene-authoring.md), and the generated SceneSpec and scene-submission schemas.
4. In Host Codex, author a generic create `IntentReport` with `allowPartial: false` and a complete generic `SceneSpec` covering every required constraint.
5. Write `{ "intentReport": ..., "scene": ... }` to an ignored generic transient file under `.shubi-shot/submissions/`. Do not include source wording or profile data.
6. Submit it:

   ```text
   node scripts/director.mjs scene submit --file <scene-submission.json>
   ```

7. Run `snapshot`, inspect the editable view, final-camera preview, and composition report, then report the accepted `sceneId` and revision. Remove the transient file after successful verification.

## Modify the current shot

1. Run `snapshot` immediately before interpreting every follow-up. Treat its `sceneId` and revision as authoritative.
2. Resolve any explicitly supplied aliases in host memory only.
3. Read [intent-report.md](references/intent-report.md), [patch-authoring.md](references/patch-authoring.md), and the generated ScenePatch and patch-submission schemas.
4. In Host Codex, author the smallest `ScenePatch` that implements only the requested changes. Use the same `sceneId` and set `baseRevision` to the exact snapshot revision.
5. Keep `allowPartial: false` unless the user explicitly accepts a partial modification. Even then, declare every unapplied item with a structured issue code and provide valid evidence for every applied required constraint.
6. Write `{ "intentReport": ..., "patch": ... }` to an ignored generic transient file and submit it:

   ```text
   node scripts/director.mjs patch submit --file <patch-submission.json>
   ```

7. Run `snapshot` again. Require the same `sceneId`, revision exactly `baseRevision + 1`, and only requested field changes. Inspect the final-camera view and composition report before claiming visual success. Remove the transient file after successful verification.

## Export a perspective reference

1. Keep the returned loopback `uiUrl` open in a browser and wait for the editor viewport and Shot Preview to finish rendering.
2. Require an open connected Shot Preview at the exact current `sceneId` and revision. CLI export must use the browser-rendered final camera and must not substitute a software approximation.
3. Read [visual-qa.md](references/visual-qa.md), run `composition inspect --json`, and visually inspect the final-camera view.
4. Export only after those checks:

   ```text
   node scripts/director.mjs export png --file <output.png> --width 1920 --height 1080
   ```

5. Verify the returned scene ID, revision, dimensions, SHA-256 hash, and warning codes. If the preview is missing, times out, or changes revision during export, correct that state and retry without changing the scene.

## Recover without broadening scope

- On `STALE_REVISION`, discard the old Patch, fetch a fresh snapshot, and re-author the minimal Patch against the new state. Never change only `baseRevision` on an old absolute edit.
- On `INTENT_REPORT_INVALID`, correct the strict structured report.
- On `UNSUPPORTED_DESCRIPTION`, stop unless the user explicitly authorizes a partial modification that the public schemas can represent.
- On `INTENT_COVERAGE_INCOMPLETE`, correct targets or evidence; do not weaken a required constraint.
- On entity, lock, or contact errors, refresh the snapshot and follow [recovery-and-concurrency.md](references/recovery-and-concurrency.md).
- On bridge failure, run `ensure`, then `health`, and retry the unchanged structured submission only after compatibility is restored.

## Keep outputs generic

- Use generic actor slots, IDs, labels, titles, constraint IDs, and patch IDs.
- Keep raw prompts, aliases, profile paths or contents, project names, private assets, and credentials out of SceneSpec, ScenePatch, IntentReport, saved scenes, repository files, logs, screenshots, and exports.
- Treat `SceneSpec` as the only persistent scene authority. Keep selection, editor camera, hover state, panel layout, and drag drafts in UI state only.
- Use only allowlisted domain Patch operations. Never emit arbitrary JSON-path mutation or whole-scene replacement for a follow-up.

## Load details only when needed

- Read [cli-contract.md](references/cli-contract.md) for command, envelope, persistence, history, and export details.
- Read [visual-qa.md](references/visual-qa.md) before a visual or export claim.
- Read [connected-environments.md](references/connected-environments.md) when a request involves multiple rooms, openings, portals, or guaranteed clearance.
