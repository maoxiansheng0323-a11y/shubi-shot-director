---
name: shubi-shot-director
description: Use when staging or revising editable 3D graybox shots from natural language, including generic actor stature, joint pose, limb presence, connected regions, blocking, camera composition, persistence, or perspective-reference export.
---

# Shubi Shot Director

Host Codex is the sole semantic authority. Convert user language into generic structured documents in the host, then use the Director only for deterministic validation, mutation, inspection, persistence, and export.

Before changing to this Skill directory, resolve any explicitly supplied relative external profile path against the current working project into a host-only absolute path, then follow [external-profiles.md](references/external-profiles.md). Never pass that path to the runtime.

## Start the session

1. Change to this Skill directory.
2. Run `node scripts/director.mjs doctor`.
3. Require capability contract v2 with workspace routing version 1, `bridge.thread-workspaces`, `actor.height`, `actor.pose-joints`, `actor.static-blocking`, `actor.body-contact-sites`, `actor.pose-diagnostics`, `actor.blueprint-instance-limb-overrides`, canonical SceneSpec, ScenePatch, and IntentReport schema version 6, plus `semanticAuthority: "host"`, `inputContract: "structured-only"`, `modelIntegration: "none"`, `credentialPolicy: "forbidden"`, and `networkPolicy: "loopback-only"`. Treat application semver as diagnostic metadata, not a compatibility gate.
4. Run `node scripts/director.mjs workspace current`. Retain the returned opaque workspace ID in host context.
5. Run `node scripts/director.mjs ensure` only after `doctor` is compatible. Retain its loopback `uiUrl` with the workspace ID and open it in the integrated browser; use `open --system` only when necessary or requested.
6. Route every later command in this Codex conversation automatically to that same workspace. Separate Codex conversations receive separate workspaces by default, so independent scenes can progress in parallel.

The wrapper hashes the raw thread ID only to derive an opaque workspace ID. The raw thread ID is never passed to runtime processes, scene files, logs, screenshots, or exports. Each workspace owns its bridge, SceneSession, revision history, runtime directory, port, and Shot Preview. Users do not choose those ports or directories.

Portable or native relative `--file` paths are resolved against the directory where the Skill wrapper is invoked before it switches to the runtime working directory. Windows drive-relative paths are rejected; use a portable relative path or a fully absolute path supplied by the user.

## Preserve the authority boundary

- Perform the semantic `compile` in Host Codex: understand user language, resolve an explicitly supplied external profile in host memory, identify ambiguity and unsupported requirements, and author `IntentReport` plus `SceneSpec` or `ScenePatch`.
- Let the runtime perform only a structured compile: strict schema parsing, deterministic normalization, intent-coverage checks, atomic session mutation, revision control, persistence, composition inspection, and export. Never ask it to infer missing meaning.
- Treat generated JSON Schema as the structural contract. Vendor annotations `x-shubi-resolved-stature` and `x-shubi-limb-hierarchy` describe semantics that Ajv/JSON Schema cannot independently enforce across snapshot-resolved stature or the limb hierarchy. Final acceptance comes from the runtime Zod refinement. Host Codex must author these semantics correctly and must never rely on the runtime to infer or repair them.
- Never pass a prompt, raw user wording, profile path, profile content, alias, credential, token, model, provider, or endpoint to the runtime.
- Codex may run in account or KEY mode. Never inspect those host credentials and never pass them to Director commands, files, processes, logs, or artifacts.
- Do not use lexical fallback, local language compilation, or retry-paraphrasing. If the schemas cannot express a required result, report the generic unsupported capability instead of submitting a partial result.

## Create a shot

1. Treat only an explicit new-shot request, or the absence of a usable scene, as permission to author a complete `SceneSpec`.
2. Resolve any explicitly supplied external profile only by following [external-profiles.md](references/external-profiles.md).
3. Read [intent-routing.md](references/intent-routing.md), [intent-report.md](references/intent-report.md), [scene-authoring.md](references/scene-authoring.md), the generated SceneSpec and scene-submission schemas, and `references/generated/pose-presets.json` when the shot requires an explicit action. Read [static-blocking.md](references/static-blocking.md) when a pose requires body-site support/contact or a relaxed arm. Read [actor-blueprints.md](references/actor-blueprints.md) when an explicitly supplied external Actor Blueprint or an existing blueprint actor is involved. For multiple continuous regions, boundaries, or openings, also read [connected-environments.md](references/connected-environments.md).
4. In Host Codex, author a generic v6 create `IntentReport` with `allowPartial: false` and a complete generic v6 `SceneSpec` covering every required constraint. A legacy actor stores actual stature in `body.heightM`; a Blueprint actor stores actual stature through `blueprintInstance.heightScale` relative to the immutable snapshot body height. Blueprint instances default to `heightScale: 1` and `limbPresenceOverrides: {}`. Both branches carry a complete normalized fifteen-joint `pose.joints` map for an explicit action. New and unfinished graybox entities use `lockMode: "none"`.
5. Write `{ "intentReport": ..., "scene": ... }` to an ignored generic transient file under `.shubi-shot/submissions/`. When static solving is required, include `"blockingPlans": [...]` in that transient envelope. Do not include source wording or profile data.
6. Submit it:

   ```text
   node scripts/director.mjs scene submit --file <scene-submission.json>
   ```

7. Run `snapshot`, inspect Overview, any required Local region previews, Shot Preview, and the composition report, then report the accepted `sceneId` and revision. Remove the transient file after successful verification.

## Modify the current shot

1. Run `snapshot` immediately before interpreting every follow-up. Treat its `sceneId` and revision as authoritative.
2. Resolve any explicitly supplied aliases in host memory only.
   Use a slot, label, or alias only in Host Codex to locate the snapshot actor. Once selected, copy that actor's SceneSpec `entity.id` into every IntentReport `targets` entry and operation target. Use `actor.pose.set { op, entityId, value }` as the sole actor-operation target-field exception. `actor.height.set`, `actor.pose.joints.set`, `actor.limb-presence.set`, and `actor.variant.set` use `actorId`. Never substitute the actor's `slot`, label, or alias.
3. Read [intent-report.md](references/intent-report.md), [patch-authoring.md](references/patch-authoring.md), and the generated ScenePatch and patch-submission schemas. Also read [static-blocking.md](references/static-blocking.md) for body-site contact, support, relaxed-limb, or anatomical solving.
4. In Host Codex, author the smallest v6 `ScenePatch` that implements only the requested changes. Use the same `sceneId`, set `baseRevision` to the exact snapshot revision, and set `preserveLock: true` for ordinary natural-language corrections. Use `actor.height.set` for stature, `actor.pose.joints.set` for one or a few joint corrections, `actor.blocking.solve` for structured support/contact/relaxed-limb materialization, and `actor.limb-presence.set` for either actor branch. For a complete action without extra blocking constraints, read `references/generated/pose-presets.json`. Take `id`, `version`, `joints`, and `contactOffsetHeightRatio` from the generated recipe. Copy the exact immutable `id`, `version`, and fifteen-key `joints` into the only valid operation shape: `{ op: "actor.pose.set", entityId, value: { preset: { registry: "builtin", id, version, parameters: { contactOffsetM } }, joints } }`. Set `contactOffsetM` to `round(resolvedHeightM * contactOffsetHeightRatio, 5)`. Use the ratio only to calculate `contactOffsetM`; do not include `contactOffsetHeightRatio` in the PoseSpec. Never author a sparse action, guess quaternions, or invent a preset. For Blueprint actors, follow the immutable snapshot and instance-override layering in [actor-blueprints.md](references/actor-blueprints.md).
5. Keep `allowPartial: false` unless the user explicitly accepts a partial modification. Even then, declare every unapplied item with a structured issue code and provide valid evidence for every applied required constraint.
6. Write `{ "intentReport": ..., "patch": ... }` to an ignored generic transient file and submit it:

   ```text
   node scripts/director.mjs patch submit --file <patch-submission.json>
   ```

7. Run `snapshot` again. Require the same `sceneId`, revision exactly `baseRevision + 1`, and the requested changes plus only the deterministic companion changes listed below. For spatial edits, inspect Overview and affected Local previews; always inspect Shot Preview and the composition report before claiming visual success. Remove the transient file after successful verification.

## Author actor limb presence

- Read [scene-authoring.md](references/scene-authoring.md), [patch-authoring.md](references/patch-authoring.md), and [intent-report.md](references/intent-report.md) before authoring limb presence.
- Store all twelve canonical keys with only `present` or `absent`. Preserve chain order such as `upper_arm_r -> forearm_r -> hand_r`.
- On create, author the complete legacy map or Blueprint `limbPresenceOverrides` in Host Codex. On modify, author one minimal `actor.limb-presence.set` operation for either branch and map it to `actor-limb-presence` intent evidence.
- Close an absent parent over all descendants as absent. Restore all required ancestors when an explicit child becomes present.
- If one operation explicitly sets a parent absent and its descendant present, treat it as `LIMB_HIERARCHY_CONFLICT`; rewrite the single operation instead of splitting or retrying it.
- Legacy actors do not gain replacement parts, prostheses, mechanical limbs, or sockets through limb-presence edits. Do not translate those requests into presence states, props, hidden geometry, zero scale, detached geometry, pose changes, or preset parameters. Blueprint actors may use only their already embedded box, sphere, and cylinder modules; arbitrary custom meshes remain unsupported.
- On `ACTOR_LIMB_TARGET_INVALID`, refresh the snapshot and correct the target to a canonical actor ID. Never fallback to a generic entity operation.

## Author adjustable actor puppets

- Read [scene-authoring.md](references/scene-authoring.md), [patch-authoring.md](references/patch-authoring.md), and [intent-report.md](references/intent-report.md). Resolved stature is exactly 1.0-2.4 meters; never substitute `entity.transform.scale`.
- The canonical joints are `pelvis`, `spine`, `neck`, left/right `upper_arm`, `forearm`, `hand`, `upper_leg`, `lower_leg`, and `foot`. `hand_*` is the wrist terminal joint; `foot_*` is the ankle terminal joint.
- Host Codex must author every new v6 pose with exactly those fifteen canonical keys. Only v1-v5 migration may translate the known historical pose-joint aliases: `root -> pelvis`, `chest -> spine`, `head -> neck`, `shoulder_l/r -> upper_arm_l/r`, `elbow_l/r -> forearm_l/r`, `wrist_l/r -> hand_l/r`, `hip_l/r -> upper_leg_l/r`, `knee_l/r -> lower_leg_l/r`, and `ankle_l/r -> foot_l/r`.
- When a legacy canonical key and its alias coexist, preserve the canonical value. Fill each missing canonical joint with identity `[0, 0, 0, 1]` and discard every other unknown pose key. This is pose-joint migration only: never reinterpret `root` or `chest` as actor anchors, or any alias as a Blueprint module mount.
- Every stored joint quaternion is normalized. Inspector semantics are local right-handed XYZ: X bend, Y twist, Z side-bend. Host Codex resolves natural-language direction from actor-local and visible shot context. If direction is genuinely ambiguous, report it unresolved; never guess an arbitrary joint ID.
- For a local correction, prefer `actor.pose.joints.set { actorId, updates }` for only the named joint or small set. Follow the complete-action contract in the create or modify workflow above.
- Use `actor.pose.set { op, entityId, value }` as the sole actor-operation target-field exception. `actor.height.set`, `actor.pose.joints.set`, `actor.limb-presence.set`, and `actor.variant.set` use `actorId`.
- Verify only the requested changes plus these deterministic companion changes. Do not treat them as permission for Host Codex to author additional fields.
- `actor.pose.joints.set` merges the specified joints, changes `pose.preset.id` to `pose.custom-v1`, and preserves all remaining preset data. When contact is active, it may update contact-owned translation.
- `actor.height.set` changes actual stature; multiply legacy `shoulderWidthM` by the same height ratio, then clamp it to 0.25-0.8 m. Scale an existing numeric `pose.preset.parameters.contactOffsetM` by the same ratio. When contact is active, it may update contact-owned translation.
- A complete action, limb-presence edit, or variant edit may deterministically correct contact-owned translation in the same revision when contact is active.
- Never degrade stature into transform scale, limb absence into hidden/zero-scale geometry, a joint correction into a whole-pose replacement, or a Blueprint instance edit into snapshot mutation.

## Solve static blocking

- Read [static-blocking.md](references/static-blocking.md) before authoring `blockingPlans` or `actor.blocking.solve`.
- Host Codex authors only generic structured semantics: actor ID, available body sites, surface IDs/faces, support/contact roles, relaxed arm, optional preset seed, broad trunk goal, and bent-resting leg goal. It does not guess the materialized fifteen-joint quaternion set.
- The runtime deterministically materializes actor translation and canonical pose, persists ordinary body-contact/relaxed-limb constraints in SceneSpec, and rejects joint reversal, unresolved contact, surface penetration, missing support, or an unavailable limb.
- Keep built-in pose presets as the fast path for ordinary actions. Keep direct joint manipulation as final manual refinement or recovery; do not require it for solver acceptance.
- Run `pose inspect --json` before composition inspection. A diagnostic `fail` blocks a new static-blocking result and export; a `check` remains explicit and never becomes an automatic visual pass. Historical schema-valid scenes load without pose normalization, but their diagnostics are not retroactively accepted.

## Use reusable Actor Blueprints

- Read [actor-blueprints.md](references/actor-blueprints.md) before validating, registering, instancing, or switching a blueprint actor.
- Keep the external `--file` source path at the Host-only import boundary. Only the canonical, path-free snapshot may enter SceneSpec, Patch submissions, history, diagnostics, logs, screenshots, or exports.
- Reuse an existing scene snapshot for the same SHA-256. Reject the same `blueprintId` with a different SHA-256 as `ACTOR_BLUEPRINT_ID_CONFLICT`; never overwrite it.
- Register a new snapshot with `actor.blueprint.register`, add each actor as a strict `blueprintInstance` with `heightScale` and `limbPresenceOverrides`, and switch only to an existing snapshot variant with `actor.variant.set`.
- Resolve limb presence in the fixed order base snapshot -> selected variant -> instance `limbPresenceOverrides`. A variant change never clears manual overrides. Snapshot content, SHA-256, modules, proportions, and skeleton remain immutable.
- Use the existing Inspector only to read the blueprint summary and select an existing variant. Do not import, author, edit, duplicate, rename, or delete blueprints, modules, proportions, or variants in the UI.
- Rendering, bounds, contact, composition, and diagnostics must consume the one resolved actor projection. Do not reinterpret blueprint data in any consumer.

## Use the refined white mannequin

- The browser automatically renders legacy and Blueprint actors with the built-in segmented CC0 white mannequin. This is a renderer projection only; never add an asset path, mesh node, material, or renderer option to SceneSpec, ScenePatch, IntentReport, or a Blueprint.
- The sixteen refined sections follow the existing pelvis, torso, neck, head, arm, hand, leg, and foot primitives. The fifteen canonical joints, resolved stature, limb presence, contact, bounds, composition, save/load, and PNG export contracts remain authoritative.
- Fingers and toes are visible terminal shape detail but are not independent pose controls. Keep face direction markers, joint indicators, and Blueprint box/sphere/cylinder modules in their existing analytical roles.
- If the built-in GLB is loading, missing, or invalid, the browser uses the complete procedural mannequin. Treat `REFINED_MANNEQUIN_FALLBACK` as a visual-QA warning, not permission to alter scene data or import another asset.
- Inspect the real final-camera view before export. Do not claim final-character quality, skinning, facial performance, clothing, hair, arbitrary GLB import, animation, physics, or production asset management.

## Respect lock provenance

- `lockMode: "none"` means editable graybox work; use it for new and unfinished entities.
- `lockMode: "workflow"` means workflow-checkpoint protection. Workflow locks never require confirmation or user authorization. Ordinary natural-language corrections re-author the Patch with `preserveLock: true` so the workflow lock remains in place; never ask the user for a workflow-lock correction.
- `lockMode: "user"` records an explicit user protection decision. User locks require explicit confirmation: `USER_LOCKED` is a stop-and-ask condition before any unlock or protected change.
- `WORKFLOW_LOCKED` means re-author with `preserveLock: true`, not ask the user.
- A visual acceptance checkpoint may lock only the reviewed and accepted entity subset after the required Overview, required Local previews, and final Shot Preview checks. Unfinished or unaccepted entities remain none.
- An explicit user-facing save locks all remaining none entities before serialization. Both visual-acceptance and explicit-save transitions must use an explicit ScenePatch with `preserveLock: false` to create workflow locks.
- Background and autosave persistence never creates locks; it serializes the authoritative revision as-is.

After explicit user confirmation, author one atomic ScenePatch with `preserveLock: false` in this exact operation order:

1. `entity.flags.set` transitions each confirmed target from `user` to `none`.
2. Apply the confirmed mutation operations.
3. If protection remains, `entity.flags.set` transitions each target from `none` back to `user`.

The intermediate none state exists only on the Patch working clone; it is never a separate revision, event, or saved state. If protection is intentionally removed, omit the final relock. A separate temporary unlock Patch is forbidden. `preserveLock: false` without explicit lock-mode transitions is not authorization.

## Manage the studio directly

1. Treat the main browser viewport as one graybox studio. The editor camera is
   UI-only and never becomes a scene camera, `activeCameraId`, saved field,
   Patch operation, or export camera. Overview and Local are editor filters;
   the compact preview independently shows the current active shot camera.
2. On empty studio space, left-drag pans the editor view, right-drag orbits
   around its current observation center, and the wheel zooms. Direct
   left-drag on an editable entity takes priority over view panning. A short
   right-click that stays within the 5 px studio drag threshold clears
   transient selection; a longer right-drag orbits without clearing it. These
   editor-view gestures never write `SceneSpec` or alter a shot camera.
3. Click an actor, prop, or camera once for ordinary selection. Double-click to
   frame it at a deterministic editing scale and enter red entity focus.
   A short right-click or `Escape` clears transient focus. Double-clicking a
   shot camera also activates it for the compact preview; selecting a camera in
   the compact selector does not change studio selection or focus.
4. Drag a focused actor's torso or pelvis, or a focused prop, to move the whole
   entity. Left-drag a focused camera proxy to rotate it in place; an unfocused
   camera proxy retains direct whole-entity movement, and the existing gizmos
   remain available for precise transforms. Arrow keys move a focused entity
   relative to the editor view; `PageUp` and `PageDown` move along world Y.
   Workflow locks use `preserveLock: true`; user locks remain inspectable but
   cannot create mutation drafts until explicitly unlocked.
5. Press and drag an actor's head or a supported limb in one gesture, even when
   the actor was not already focused. Pointer-down immediately focuses both the
   actor and the green actor part, and the same drag authors one existing
   `actor.pose.joints.set` operation for one canonical joint. Head, face, and
   neck geometry all target `neck`. The drag is view-relative and does not
   infer IK or edit multiple joints.
6. Treat each completed entity gesture, held-key sequence, or joint gesture as
   one Patch, one revision, and one undo step. Editor camera, selection, focus,
   selected joint, preview expansion, and live drafts remain UI state. Cancel a
   stale or conflicting draft and re-author from the newest snapshot; never
   retry an old absolute draft against a newer revision.

## Adjust the final camera directly

1. Open the compact preview or its explicit expand control when the active shot
   camera needs refinement. Expanded Shot Preview is the authoritative camera
   navigation and export surface; no activation toggle is required.
2. Use left drag for image plane camera translation while preserving camera
   direction. Right drag rotates freely in place by default. Select an explicit
   visible actor or prop target only when target orbit is wanted; the runtime
   must never invent a target from composition constraints. Use the wheel to
   change focal length in millimeters without changing camera position.
3. Use the six-button movement pad or `ArrowUp` and `ArrowDown` for forward and
   backward movement, `ArrowLeft` and `ArrowRight` for camera-relative lateral
   movement, and `PageUp` and `PageDown` for world-Y movement. Hold `Shift` for
   fast keyboard steps or `Alt` for precision steps. Use `Escape` to cancel the
   current draft.
4. Treat each completed drag, held-key sequence, or wheel sequence as one Patch,
   one revision, and one undo step. Draft transforms and focal lengths remain
   UI state and must block export until committed. Cancel a stale draft if the
   scene changes externally; never retry it against a newer revision.
5. For a workflow-locked camera, commit the gesture with `preserveLock: true`
   and require it to remain `workflow`; do not ask for authorization. User locks
   remain a stop-and-ask condition: disable direct camera controls until the
   user explicitly confirms the protected change.

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

- Run `workspace current` to recover this conversation's automatic route. Run `workspace list` to inspect generic workspace IDs and health. Use `workspace attach --id <workspace-id>` only after host-side selection of an existing generic workspace ID; attachment never copies or mutates a scene.
- `stop` stops only the current workspace. It must not stop another conversation's bridge.
- On `STALE_REVISION`, discard the old Patch, fetch a fresh snapshot, and re-author the minimal Patch against the new state. Never change only `baseRevision` on an old absolute edit.
- On `INTENT_REPORT_INVALID`, correct the strict structured report.
- On `UNSUPPORTED_DESCRIPTION`, stop unless the user explicitly authorizes a partial modification that the public schemas can represent.
- On `INTENT_COVERAGE_INCOMPLETE`, correct targets or evidence; do not weaken a required constraint.
- On `LIMB_HIERARCHY_CONFLICT`, rewrite one consistent `actor.limb-presence.set` operation. On `ACTOR_LIMB_TARGET_INVALID`, refresh and retarget the actor; never fallback to another entity type.
- On `ACTOR_HEIGHT_TARGET_INVALID` or `ACTOR_JOINT_TARGET_INVALID`, refresh and retarget a canonical actor ID. On `ACTOR_HEIGHT_RANGE_INVALID`, use 1.0-2.4 meters. On `ACTOR_JOINT_ID_INVALID`, select one of the fifteen canonical joint IDs. Never retry by transform scale, whole-pose replacement, hidden geometry, or snapshot mutation.
- On `ACTOR_BLUEPRINT_HASH_MISMATCH`, `ACTOR_BLUEPRINT_HASH_DUPLICATE`, or `ACTOR_BLUEPRINT_REFERENCE_INVALID`, correct the canonical SceneSpec or Patch before retrying. On `ACTOR_BLUEPRINT_ID_CONFLICT`, either reuse the existing identical snapshot or explicitly author a new generic ID; never overwrite.
- On `USER_LOCKED`, stop and ask for explicit confirmation. On `WORKFLOW_LOCKED`, re-author the ordinary correction with `preserveLock: true` without asking the user. For other entity, lock, or contact errors, refresh the snapshot and follow [recovery-and-concurrency.md](references/recovery-and-concurrency.md).
- On bridge failure, confirm `workspace current`, run `ensure`, then `health`, and retry the unchanged structured submission only after compatibility is restored.

## Keep outputs generic

- Use generic actor slots, IDs, labels, titles, constraint IDs, and patch IDs.
- Keep raw prompts, aliases, profile paths or contents, project names, private assets, and credentials out of SceneSpec, ScenePatch, IntentReport, saved scenes, repository files, logs, screenshots, and exports.
- Treat `SceneSpec` as the only persistent scene authority. Keep selection, editor camera, hover state, panel layout, and drag drafts in UI state only.
- Use only allowlisted domain Patch operations. Never emit arbitrary JSON-path mutation or whole-scene replacement for a follow-up.

## Load details only when needed

- Read [cli-contract.md](references/cli-contract.md) for command, envelope, persistence, history, and export details.
- Read [actor-blueprints.md](references/actor-blueprints.md) for external blueprint validation, canonical snapshots, variants, modules, and blueprint-instance rules.
- Read [visual-qa.md](references/visual-qa.md) before a visual or export claim.
- Read [connected-environments.md](references/connected-environments.md) when a request involves multiple rooms, openings, portals, or guaranteed clearance.
