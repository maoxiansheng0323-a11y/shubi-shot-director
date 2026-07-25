# ScenePatch authoring

Use this reference for every natural-language edit to an existing shot.

## Required transition

1. Fetch `snapshot` immediately before host interpretation.
2. Read `generated/scene-patch.schema.json`, `generated/intent-report.schema.json`, and `generated/patch-submission.schema.json`.
3. Keep the snapshot's exact `sceneId`.
4. Set `baseRevision` to the snapshot's exact revision.
5. Use `source: "natural-language"` and a generic `patchId`.
6. Emit only operations required by the follow-up.
7. Pair the Patch with a modify `IntentReport` whose evidence covers the applied operations.
8. Submit one envelope with `patch submit --file`.
9. Fetch `snapshot` again. Require the same `sceneId`, revision `baseRevision + 1`, and only requested changes.

Never route a follow-up through scene replacement. On `STALE_REVISION`, discard the old Patch and recompute from a fresh snapshot; never update only `baseRevision` on stale absolute transforms.

## Select domain operations

- Relative movement: `entity.transform.translate`
- Absolute transform or gizmo commit: `entity.transform.set`
- Rotation: `entity.transform.rotate`
- Camera aim: `camera.look-at`
- Lens or clip planes: `camera.lens.set`
- Actor pose: `actor.pose.set`
- Add or replace a complete constraint: `constraint.set`
- Remove a constraint: `constraint.remove`
- Add or remove a complete entity: `entity.add` or `entity.remove`
- Visibility or lock state: `entity.flags.set`
- Final camera, output, composition goals, or title: matching `scene.*.set` operation

Do not use JSON Patch, JSON Pointer, arbitrary property paths, or a root replacement operation.

## Preserve spatial meaning

- Use `world` for fixed scene axes.
- Use `local` for axes after the target entity's rotation.
- Use `camera` for visible shot-relative directions, with an explicit reference camera when needed.

Interpret conversational directions against the current visible context in Host Codex. Do not ask the runtime to infer whether a direction is world-, local-, or camera-relative.

## Keep changes atomic

Place dependent pose, transform, contact, visibility, relationship, and camera operations in one Patch so one submission advances one revision and one undo reverses the compound edit.

Reuse existing constraint IDs when replacing the same semantic constraint. Keep only one enabled ground-contact constraint per actor. Disable or replace contact in the same Patch before a deliberate vertical offset or support-surface change.

When a face or anchor must remain visible, use an enabled `keep-visible` constraint and inspect both the final-camera view and composition report after submission. Approximate occlusion is not a visual verdict.
