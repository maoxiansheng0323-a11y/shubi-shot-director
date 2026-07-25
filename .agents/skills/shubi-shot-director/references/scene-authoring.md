# SceneSpec authoring

Use this reference only for an initial shot or an explicitly requested new shot.

## Author in Host Codex

1. Read `generated/scene-spec.schema.json`, `generated/intent-report.schema.json`, and `generated/scene-submission.schema.json`.
2. Convert the complete request into generic entities, constraints, camera state, output state, and composition goals.
3. Use meter units, right-handed coordinates, `+Y` up, and camera forward along `-Z`.
4. Include the requested environment, generic actors and props, and at least one perspective camera.
5. Materialize actor transforms, poses, contact, relationship blocking, camera rotation, and composition constraints. Leave no instruction for runtime semantic inference.
6. Persist focal length and sensor width, not FOV. Persist the camera quaternion, not a second look-at state.
7. Use 16:9 output; default to 1920 x 1080 unless the user requests another supported resolution.
8. Use generic IDs, slots, labels, title, and constraint IDs. Exclude source wording, aliases, profile data, and private asset paths.
9. Pair the scene with a create `IntentReport`. Require `allowPartial: false`, `canApplySafely: true`, empty unsupported/unresolved arrays, and valid evidence for every required recognized constraint.
10. Put both objects in one transient scene-submission envelope and call `scene submit --file`.

Do not use a complete SceneSpec for a follow-up to an existing shot.

## Generic actor slots

- Use `actor_male_N` for an explicitly masculine role.
- Use `actor_female_N` for an explicitly feminine role.
- Use `actor_generic_N` when gender is absent or irrelevant.
- Number slots from 1 without gaps where practical.

Actor labels remain generic. External aliases are host-only resolution inputs.

## Built-in graybox registry

- Small interior: `room.small-v1`
- Neutral humanoid: `rig.humanoid-v1`
- Neutral standing: `pose.standing-neutral-v1`
- Kneeling lean: `pose.kneeling-lean-v1`
- Seated: `pose.seated-v1`
- Lying supine: `pose.lying-supine-v1`
- Leaning forward: `pose.leaning-forward-v1`
- Face-to-face recipe: `relationship.face-to-face-v1`
- Over/under lower-face recipe: `relationship.over-under-focus-lower-v1`
- Low support: `prop.platform-low-v1`
- Generic block: `prop.block-v1`

Use immutable preset versions. Materialize pose recipes into `pose.joints` and `contactOffsetM`; materialize relationship recipes into ordinary transforms, poses, and constraints. Do not create hidden bindings, IK, physics, or animation state.

## Composition handoff

Select camera height, placement, rotation, and focal length to express the requested shot. Then inspect the independent 16:9 final-camera preview and segmented composition report. Treat approximate occlusion as a warning requiring visual confirmation, not a pixel-accurate result.
