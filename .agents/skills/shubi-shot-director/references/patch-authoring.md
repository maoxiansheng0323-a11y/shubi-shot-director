# ScenePatch authoring

Use this reference for every natural-language edit to an existing shot.

## Required transition

1. Fetch `snapshot` immediately before host interpretation.
2. Read `generated/scene-patch.schema.json`, `generated/intent-report.schema.json`, and `generated/patch-submission.schema.json`.
3. Keep the snapshot's exact `sceneId`.
4. Set `baseRevision` to the snapshot's exact revision.
5. Use `source: "natural-language"` and a generic `patchId`.
6. Set `preserveLock: true` for ordinary natural-language corrections.
7. Emit only operations required by the follow-up.
8. Pair the Patch with a v6 modify `IntentReport` whose evidence covers the applied operations.
9. Submit one envelope with `patch submit --file`.
10. Fetch `snapshot` again. Require the same `sceneId`, revision `baseRevision + 1`, and the requested changes plus only the deterministic companion changes listed below.

Never route a follow-up through scene replacement. On `STALE_REVISION`, discard the old Patch and recompute from a fresh snapshot; never update only `baseRevision` on stale absolute transforms.

The generated Patch JSON Schema is structural. `x-shubi-resolved-stature` and `x-shubi-limb-hierarchy` describe semantics Ajv cannot enforce independently across the current snapshot and limb chains. Runtime Zod refinement decides final acceptance, while Host Codex must author the requested stature and hierarchy correctly instead of relying on runtime inference or repair.

Use a slot, label, or alias only to locate the actor in Host Codex. Copy that snapshot actor's SceneSpec `entity.id` into the operation target. Use `actor.pose.set { op, entityId, value }` as the sole actor-operation target-field exception. `actor.height.set`, `actor.pose.joints.set`, `actor.limb-presence.set`, and `actor.variant.set` use `actorId`; `actor.blocking.solve` carries `actorId` inside its structured `plan`. Never use the actor's `slot`, label, or alias as the operation target.

## Select domain operations

- Relative movement: `entity.transform.translate`
- Absolute transform or gizmo commit: `entity.transform.set`
- Rotation: `entity.transform.rotate`
- Camera aim: `camera.look-at`
- Lens or clip planes: `camera.lens.set`
- Actor stature: `actor.height.set { actorId, heightM }`, with resolved stature from 1.0-2.4 meters
- One or a few actor joints: `actor.pose.joints.set { actorId, updates }`
- Structured static support/contact pose: `actor.blocking.solve { plan }`; follow `static-blocking.md` and do not author its resulting quaternions
- Complete action: `actor.pose.set { entityId, value }`; do not use it for one wrist, ankle, or other local correction
- Actor limb presence on either legacy or Blueprint actors: one minimal `actor.limb-presence.set` operation with a canonical actor ID and one to twelve explicit updates
- Register one canonical Actor Blueprint snapshot: `actor.blueprint.register`
- Select an existing variant on a blueprint actor: `actor.variant.set`
- Add or replace a complete constraint: `constraint.set`
- Remove a constraint: `constraint.remove`
- Add or remove a complete entity: `entity.add` or `entity.remove`
- Visibility or lock state: `entity.flags.set`
- Final camera, output, composition goals, or title: matching `scene.*.set` operation
- Region create/update, visibility, or removal:
  `spatial.region.upsert`, `spatial.region.visibility.set`, or
  `spatial.region.remove`
- Boundary create/update, visibility, or removal:
  `spatial.boundary.upsert`, `spatial.boundary.visibility.set`, or
  `spatial.boundary.remove`
- Opening create/update or removal:
  `spatial.opening.upsert` or `spatial.opening.remove`
- Connection create/update or removal:
  `spatial.connection.upsert` or `spatial.connection.remove`
- Entity region assignment or removal:
  `spatial.membership.set` or `spatial.membership.remove`

Do not use JSON Patch, JSON Pointer, arbitrary property paths, or a root replacement operation.

## Preserve lock provenance

`preserveLock` is required on every canonical v6 Patch.

- Ordinary natural-language corrections use `preserveLock: true`.
- `workflow` means workflow-checkpoint protection. Workflow locks never require confirmation or user authorization. `WORKFLOW_LOCKED` means the Patch was authored with the wrong policy: re-author with `preserveLock: true`, not ask the user.
- User locks require explicit confirmation. `USER_LOCKED` is the stop-and-ask condition.
- When `preserveLock: true`, do not change an existing lock mode, remove a locked entity, or add a new entity with a lock. New unfinished graybox entities use `lockMode: "none"`.

After explicit user confirmation, author one atomic ScenePatch with `preserveLock: false` in this exact operation order:

1. `entity.flags.set` transitions each confirmed target from `user` to `none`.
2. Apply the confirmed mutation operations.
3. If protection remains, `entity.flags.set` transitions each target from `none` back to `user`.

The intermediate none state exists only on the Patch working clone; it is never a separate revision, event, or saved state. If protection is intentionally removed, omit the final relock. A separate temporary unlock Patch is forbidden. `preserveLock: false` without explicit lock-mode transitions is not authorization.

Use `lock-protection` IntentReport constraints only when a lock transition is itself part of the requested result. Evidence may use `entity.lockMode` or the exact `entity.flags.set` patch-operation index.

## Author complete actions

Read `references/generated/pose-presets.json`. Take `id`, `version`, `joints`, and `contactOffsetHeightRatio` from the generated recipe. Copy the exact immutable `id`, `version`, and fifteen-key `joints` into the only valid operation shape: `{ op: "actor.pose.set", entityId, value: { preset: { registry: "builtin", id, version, parameters: { contactOffsetM } }, joints } }`. Set `contactOffsetM` to `round(resolvedHeightM * contactOffsetHeightRatio, 5)`. Use the ratio only to calculate `contactOffsetM`; do not include `contactOffsetHeightRatio` in the PoseSpec. Never author a sparse action, guess quaternions, or invent a preset.

## Author limb-presence updates

Use canonical chain order:

- `upper_arm_l -> forearm_l -> hand_l`
- `upper_arm_r -> forearm_r -> hand_r`
- `upper_leg_l -> lower_leg_l -> foot_l`
- `upper_leg_r -> lower_leg_r -> foot_r`

Author one minimal `actor.limb-presence.set` operation. An absent parent closes all descendants to absent. An explicit present child restores its required ancestors. If one operation explicitly sets a parent absent and a descendant present, return `LIMB_HIERARCHY_CONFLICT` and rewrite that single operation consistently.

Use `preserveLock: true` for an ordinary workflow-locked correction without asking. Stop on `USER_LOCKED` and request explicit confirmation. On `ACTOR_LIMB_TARGET_INVALID`, refresh the snapshot and correct the target to an actor; never fallback to `entity.*`, hidden geometry, zero scale, detached geometry, or a prop.

Report replacement parts, prostheses, mechanical limbs, sockets, and custom meshes as unsupported. Never degrade those requests into `present` or `absent` states.

For Blueprint actors, read `actor-blueprints.md`. Register a path-free snapshot before adding its first instance. If the same SHA-256 is already present, reuse it and omit registration. Reject same-ID/different-hash instead of overwriting, and never remove or garbage-collect snapshots. `actor.limb-presence.set` writes the minimal instance override delta above the selected variant. Variant selection is a minimal `actor.variant.set` and does not clear manual overrides; do not copy body/proportion data or mutate the actor into the legacy branch.

## Author stature and joint updates

- Use `actor.height.set` for actual stature on either actor branch. Never approximate stature with `entity.transform.scale` or raw Blueprint snapshot edits.
- The canonical joints are `pelvis`, `spine`, `neck`, `upper_arm_l`, `forearm_l`, `hand_l`, `upper_arm_r`, `forearm_r`, `hand_r`, `upper_leg_l`, `lower_leg_l`, `foot_l`, `upper_leg_r`, `lower_leg_r`, and `foot_r`. The hand keys are wrist terminal joints; the foot keys are ankle terminal joints.
- `actor.pose.joints.set.updates` contains one to fifteen canonical keys with normalized quaternions. Prefer only the joint or small set named by the follow-up.
- Inspector axes are actor-local right-handed XYZ: X bend, Y twist, Z side-bend. Host Codex resolves phrases such as forward/backward from actor-local orientation and the visible shot. When that context is genuinely insufficient, emit an unresolved relation instead of guessing a joint or sign.
- `ACTOR_HEIGHT_TARGET_INVALID` and `ACTOR_JOINT_TARGET_INVALID` require a fresh snapshot and corrected actor ID. `ACTOR_HEIGHT_RANGE_INVALID` requires 1.0-2.4 meters. `ACTOR_JOINT_ID_INVALID` requires a canonical ID. Do not fall back to transform scale, hidden geometry, a whole-pose replacement, or snapshot mutation.

For multi-contact support, relaxed arms, or a broad still pose that would otherwise require guessed quaternions, use one `actor.blocking.solve` operation instead. Read `static-blocking.md`. The runtime materializes the final complete pose and rejects `POSE_DIAGNOSTICS_FAILED` before visual QA.

Verify the requested changes and only these deterministic companion changes; they are not permission for Host Codex to author additional fields:

- `actor.pose.joints.set` merges the specified joints, changes `pose.preset.id` to `pose.custom-v1`, and preserves all remaining preset data. When contact is active, it may also update contact-owned translation.
- `actor.height.set` changes actual stature. Multiply legacy `shoulderWidthM` by the same height ratio, then clamp it to 0.25-0.8 m. Scale an existing numeric `pose.preset.parameters.contactOffsetM` by the same ratio. When contact is active, it may also update contact-owned translation.
- A complete action, limb-presence edit, or variant edit may deterministically correct contact-owned translation in the same revision when contact is active.

## Apply workflow checkpoints

A visual acceptance checkpoint may lock only the reviewed and accepted entity subset after the required Overview, required Local previews, and final Shot Preview checks. Unfinished or unaccepted entities remain none.

An explicit user-facing save locks all remaining none entities before serialization. Both visual-acceptance and explicit-save transitions must use an explicit ScenePatch with `preserveLock: false` to create workflow locks. Background and autosave persistence never creates locks; it persists the authoritative revision without adding a checkpoint.

## Preserve spatial meaning

- Use `world` for fixed scene axes.
- Use `local` for axes after the target entity's rotation.
- Use `camera` for visible shot-relative directions, with an explicit reference camera when needed.

Interpret conversational directions against the current visible context in Host Codex. Do not ask the runtime to infer whether a direction is world-, local-, or camera-relative.

## Keep changes atomic

Place dependent pose, transform, contact, visibility, relationship, and camera operations in one Patch so one submission advances one revision and one undo reverses the compound edit. Height, limb, joint, complete action, and Blueprint variant edits are contact-affecting whenever authoritative contact or visible bounds change; deterministic contact correction belongs to the same atomic Patch acceptance and the accepted revision must be exactly `baseRevision + 1`.

Place dependent spatial operations in one Patch as well. Create regions before
boundaries, boundaries before openings, openings before connections, and
regions before memberships. Remove in the reverse dependency order. Remove an
entity's membership before removing the entity. The final SceneSpec must
validate atomically; the runtime never repairs or infers missing topology.

Reuse existing constraint IDs when replacing the same semantic constraint. Keep only one enabled ground-contact constraint per actor. Disable or replace contact in the same Patch before a deliberate vertical offset or support-surface change.

When a face or anchor must remain visible, use an enabled `keep-visible` constraint and inspect both the final-camera view and composition report after submission. Approximate occlusion is not a visual verdict.
