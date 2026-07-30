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
8. Pair the Patch with a v5 modify `IntentReport` whose evidence covers the applied operations.
9. Submit one envelope with `patch submit --file`.
10. Fetch `snapshot` again. Require the same `sceneId`, revision `baseRevision + 1`, and only requested changes.

Never route a follow-up through scene replacement. On `STALE_REVISION`, discard the old Patch and recompute from a fresh snapshot; never update only `baseRevision` on stale absolute transforms.

## Select domain operations

- Relative movement: `entity.transform.translate`
- Absolute transform or gizmo commit: `entity.transform.set`
- Rotation: `entity.transform.rotate`
- Camera aim: `camera.look-at`
- Lens or clip planes: `camera.lens.set`
- Actor pose: `actor.pose.set`
- Actor limb presence: one minimal `actor.limb-presence.set` operation with a canonical actor ID and one to twelve explicit updates
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

`preserveLock` is required on every canonical v5 Patch.

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

## Author limb-presence updates

Use canonical chain order:

- `upper_arm_l -> forearm_l -> hand_l`
- `upper_arm_r -> forearm_r -> hand_r`
- `upper_leg_l -> lower_leg_l -> foot_l`
- `upper_leg_r -> lower_leg_r -> foot_r`

Author one minimal `actor.limb-presence.set` operation. An absent parent closes all descendants to absent. An explicit present child restores its required ancestors. If one operation explicitly sets a parent absent and a descendant present, return `LIMB_HIERARCHY_CONFLICT` and rewrite that single operation consistently.

Use `preserveLock: true` for an ordinary workflow-locked correction without asking. Stop on `USER_LOCKED` and request explicit confirmation. On `ACTOR_LIMB_TARGET_INVALID`, refresh the snapshot and correct the target to an actor; never fallback to `entity.*`, hidden geometry, zero scale, detached geometry, or a prop.

Report replacement parts, prostheses, mechanical limbs, sockets, and custom meshes as unsupported. Never degrade those requests into `present` or `absent` states.

For blueprint actors, read `actor-blueprints.md`. Register a path-free snapshot before adding its first instance. If the same SHA-256 is already present, reuse it and omit registration. Reject same-ID/different-hash instead of overwriting, and never remove or garbage-collect snapshots. Variant selection is a minimal `actor.variant.set`; do not copy body/proportion data or mutate the actor into the legacy branch.

## Apply workflow checkpoints

A visual acceptance checkpoint may lock only the reviewed and accepted entity subset after the required Overview, required Local previews, and final Shot Preview checks. Unfinished or unaccepted entities remain none.

An explicit user-facing save locks all remaining none entities before serialization. Both visual-acceptance and explicit-save transitions must use an explicit ScenePatch with `preserveLock: false` to create workflow locks. Background and autosave persistence never creates locks; it persists the authoritative revision without adding a checkpoint.

## Preserve spatial meaning

- Use `world` for fixed scene axes.
- Use `local` for axes after the target entity's rotation.
- Use `camera` for visible shot-relative directions, with an explicit reference camera when needed.

Interpret conversational directions against the current visible context in Host Codex. Do not ask the runtime to infer whether a direction is world-, local-, or camera-relative.

## Keep changes atomic

Place dependent pose, transform, contact, visibility, relationship, and camera operations in one Patch so one submission advances one revision and one undo reverses the compound edit.

Place dependent spatial operations in one Patch as well. Create regions before
boundaries, boundaries before openings, openings before connections, and
regions before memberships. Remove in the reverse dependency order. Remove an
entity's membership before removing the entity. The final SceneSpec must
validate atomically; the runtime never repairs or infers missing topology.

Reuse existing constraint IDs when replacing the same semantic constraint. Keep only one enabled ground-contact constraint per actor. Disable or replace contact in the same Patch before a deliberate vertical offset or support-surface change.

When a face or anchor must remain visible, use an enabled `keep-visible` constraint and inspect both the final-camera view and composition report after submission. Approximate occlusion is not a visual verdict.
