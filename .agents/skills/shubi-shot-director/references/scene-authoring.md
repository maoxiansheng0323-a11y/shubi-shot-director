# SceneSpec authoring

Use this reference only for an initial shot or an explicitly requested new shot.

The generated SceneSpec JSON Schema is a structural contract. Its `x-shubi-resolved-stature` and `x-shubi-limb-hierarchy` annotations document cross-snapshot stature and limb-chain semantics, but Ajv cannot enforce them independently. Runtime Zod refinement makes the final acceptance decision; Host Codex must author the resolved values and hierarchy correctly before submission rather than expecting runtime inference or repair.

## Author in Host Codex

1. Read `generated/scene-spec.schema.json`, `generated/intent-report.schema.json`, and `generated/scene-submission.schema.json`.
2. Convert the complete request into generic spatial layout, entities, output state, and either direct structured state or a transient `ShotIntentPlan`. For supported semantic shots, leave final actor/camera solving to `semantic-shot-solving.md`.
3. Use meter units, right-handed coordinates, `+Y` up, and camera forward along `-Z`.
4. Choose exactly one spatial mode: `spatialLayout: null` with a legacy
   environment entity, or a complete connected `spatialLayout` with no
   environment entity. Include generic actors and props plus at least one
   perspective camera.
5. Give every new and unfinished graybox entity `lockMode: "none"`. Do not create a workflow or user lock merely because an entity is present in an initial submission.
6. Select exactly one strict actor branch. A legacy actor has `rig`, `body`, actual stature in `body.heightM`, and a complete twelve-key `body.limbPresence` map. A Blueprint actor has `blueprintInstance` and no legacy `rig` or `body`; its referenced canonical snapshot must already exist in `actorBlueprints`. Set `heightScale: 1` unless the requested resolved stature requires `requestedHeightM / snapshot.body.heightM`, and default `limbPresenceOverrides` to `{}`.
7. Materialize actor transforms and a complete fifteen-key normalized joint map for ordinary explicit actions. Read `references/generated/pose-presets.json` for complete actions. When support, body-site contact, or a relaxed arm requires deterministic solving, read `static-blocking.md` and author a structured transient `blockingPlans` entry instead of guessing the final quaternions. Leave no instruction for runtime semantic inference.
8. On the direct structured route, persist focal length and sensor width, not FOV, and persist the camera quaternion rather than a second look-at state. On the semantic route, the base camera is only a valid placeholder; the accepted candidate persists the solver-authored camera transform and lens.
9. Use 16:9 output; default to 1920 x 1080 unless the user requests another supported resolution.
10. Use generic IDs, slots, labels, title, and constraint IDs. Exclude source wording, aliases, profile data, and private asset paths.
11. Pair the scene with a v6 create `IntentReport`. Require `allowPartial: false`, `canApplySafely: true`, empty unsupported/unresolved arrays, and valid evidence for every required recognized constraint. Use `actor.body.heightM` for legacy `actor-height` evidence and `actor.blueprintInstance.heightScale` for Blueprint `actor-height` evidence. Use `actor.pose` for pose evidence and all twelve exact legacy limb evidence paths when legacy limb presence is required. For required Blueprint limb-presence, instance, or variant evidence, use the actor entity's actual v6 `actor.blueprintInstance` evidence path; never invent a nested override evidence path.
12. Put both objects in one transient scene-submission envelope, add optional `blockingPlans` only when required, and call `scene submit --file`.

Do not use a complete SceneSpec for a follow-up to an existing shot.

## Lock modes and persistence

- `none`: editable, unfinished graybox state. This is the default authoring mode for new entities.
- `workflow`: workflow-checkpoint protection created only by an accepted visual checkpoint or an explicit user-facing save.
- `user`: protection the user explicitly chose. Changing or unlocking it requires explicit confirmation.

Workflow locks never require confirmation or user authorization. A visual acceptance checkpoint may lock only the reviewed and accepted entity subset after the required Overview, required Local previews, and final Shot Preview checks. Unfinished or unaccepted entities remain none.

Later ordinary corrections to workflow-locked entities use `preserveLock: true`; they do not recreate workflow locks and never require confirmation.

An explicit user-facing save locks all remaining none entities before serialization. Both visual-acceptance and explicit-save transitions must use an explicit ScenePatch with `preserveLock: false` to create workflow locks; wait for the accepted revision before serialization. Background and autosave persistence never creates locks; it serializes the authoritative scene as-is.

## Generic spatial layouts

For a multi-region request, read `connected-environments.md`. Host Codex authors
the region count, labels, polygon footprints, boundaries, openings,
connections, memberships, visibility, and camera placement. The runtime has no
room-type vocabulary and must not infer these values.

Use abstract, stable IDs such as `region_alpha`, `boundary_alpha_beta`, and
`opening_alpha_beta`. Labels may reflect the user's description, but they have
no runtime meaning. Assign actors, props, and cameras through `memberships`
without changing their world transforms or parent relationships.

Keep the current MVP on one `floorY`. Do not approximate stairs, multiple
levels, navigation, or streaming through labels or preset parameters.

## Generic actor slots

- Use `actor_male_N` for an explicitly masculine role.
- Use `actor_female_N` for an explicitly feminine role.
- Use `actor_generic_N` when gender is absent or irrelevant.
- Number slots from 1 without gaps where practical.

Actor labels remain generic. External aliases are host-only resolution inputs.

## Canonical stature and pose

- Resolved stature must be 1.0-2.4 meters. Legacy actors store it directly in `body.heightM`. Blueprint actors store `blueprintInstance.heightScale`, with resolved stature `snapshot.body.heightM * heightScale`.
- `entity.transform.scale` is spatial transform scale, not actor stature evidence or a stature-edit substitute.
- The fifteen joint IDs are `pelvis`, `spine`, `neck`, `upper_arm_l`, `forearm_l`, `hand_l`, `upper_arm_r`, `forearm_r`, `hand_r`, `upper_leg_l`, `lower_leg_l`, `foot_l`, `upper_leg_r`, `lower_leg_r`, and `foot_r`.
- `hand_l` and `hand_r` are wrist terminal joints. `foot_l` and `foot_r` are ankle terminal joints.
- Store normalized quaternions only. For an explicit action, write all fifteen keys, using identity `[0, 0, 0, 1]` where the action does not rotate a joint. A sparse map is not a complete action.

For every complete action, read `references/generated/pose-presets.json`. Take `id`, `version`, `joints`, and `contactOffsetHeightRatio` from the generated recipe. Copy the exact immutable `id`, `version`, and fifteen-key `joints` into the pose. Set `contactOffsetM` to `round(resolvedHeightM * contactOffsetHeightRatio, 5)`. Use the ratio only to calculate `contactOffsetM`; do not include `contactOffsetHeightRatio` in the PoseSpec. For a modify, use only this operation shape: `{ op: "actor.pose.set", entityId, value: { preset: { registry: "builtin", id, version, parameters: { contactOffsetM } }, joints } }`; for a create, use that same `value` object as the actor's `pose`. Never author a sparse action, guess quaternions, or invent a preset.

## Canonical actor limb presence

Treat each chain as ordered from parent to descendant:

- `upper_arm_l -> forearm_l -> hand_l`
- `upper_arm_r -> forearm_r -> hand_r`
- `upper_leg_l -> lower_leg_l -> foot_l`
- `upper_leg_r -> lower_leg_r -> foot_r`

An absent parent closes every descendant to absent. A present child restores every required ancestor to present. Reject one explicit parent-absent plus descendant-present request as `LIMB_HIERARCHY_CONFLICT`; rewrite one consistent operation rather than storing an invalid map.

Replacement parts, prostheses, mechanical limbs, sockets, and custom meshes are unsupported. Do not express them as limb presence, props, hidden geometry, zero scale, detached geometry, pose state, preset parameters, or source metadata.

This restriction applies to legacy actor edits and arbitrary imported geometry. A blueprint snapshot may contain only its strict box, sphere, and cylinder modules at the supported mounts. Read `actor-blueprints.md`; do not reinterpret those modules as legacy limb-presence state.

## Blueprint actors

When an external Actor Blueprint is explicitly supplied, validate it at the Host-only `blueprint validate --file` boundary, embed one canonical path-free snapshot in `actorBlueprints`, and reference it from any number of strict `blueprintInstance` actors. Every instance includes `heightScale` and `limbPresenceOverrides`. Reuse the same snapshot for the same SHA-256, keep every actor ID and slot unique, and never retain the source path. The SceneSpec remains independently reloadable after the external file is moved or deleted.

## Built-in graybox registry

- Small interior: `room.small-v1`
- Neutral humanoid: `rig.humanoid-v1`
- Neutral standing: `pose.standing-neutral-v1`
- Kneeling lean: `pose.kneeling-lean-v1`
- Seated: `pose.seated-v1`
- Lying supine: `pose.lying-supine-v1`
- Leaning forward: `pose.leaning-forward-v1`
- Right-arm reach: `pose.reaching-right-v1`
- Walking step: `pose.walking-step-v1`
- Crouching: `pose.crouching-v1`
- Face-to-face recipe: `relationship.face-to-face-v1`
- Over/under lower-face recipe: `relationship.over-under-focus-lower-v1`
- Low support: `prop.platform-low-v1`
- Generic block: `prop.block-v1`

Use immutable preset versions. Materialize pose recipes into `pose.joints` and `contactOffsetM`; materialize relationship recipes into ordinary transforms, poses, and constraints. Static blocking may use the bounded deterministic still-pose solver described in `static-blocking.md`; it must not create animation, timeline, physics, ragdoll, gameplay, or model state.

## Composition handoff

For supported semantic shots, author height, angle, placement, lens, headroom, look room, context, and face-readability as hard/soft plan goals rather than final numeric camera values. The runtime searches and ranks diverse valid camera candidates, then the browser verifies actual visible pixels and screen-space bounds. For unsupported or expert direct work, author the camera numerically and inspect the independent 16:9 final-camera preview and segmented composition report.
