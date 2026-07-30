# Actor Blueprint authoring

Use this reference only for reusable graybox actors defined by an explicitly supplied external JSON document. The Host owns file access and semantic choices. The runtime validates structured data and never receives a source path.

## Import boundary

1. Resolve the user-supplied path in Host Codex.
2. Run `node scripts/director.mjs blueprint validate --file <actor-blueprint.json>`.
3. Require the generic summary fields `blueprintId`, `blueprintVersion`, `contentSha256`, `moduleCount`, `variantCount`, and `valid: true`.
4. Retain the validated document in Host memory only long enough to author a canonical snapshot and structured submission.

The `--file` value and resolved source path are Host-only. They never enter SceneSpec, ScenePatch, IntentReport, undo/redo history, diagnostics, logs, screenshots, screenshot metadata, or exported PNG metadata. Human-readable stdout and failure envelopes never expose the source path, raw JSON, or full canonical snapshot.

File/document validation uses this priority:

1. `ACTOR_BLUEPRINT_FILE_READ_FAILED`
2. `ACTOR_BLUEPRINT_FILE_INVALID`
3. `ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED`
4. `ACTOR_BLUEPRINT_VARIANT_INVALID`

Snapshot and SceneSpec validation then use `ACTOR_BLUEPRINT_HASH_MISMATCH`, `ACTOR_BLUEPRINT_HASH_DUPLICATE`, and `ACTOR_BLUEPRINT_REFERENCE_INVALID`. A registration Patch additionally uses `ACTOR_BLUEPRINT_ID_CONFLICT`, then hash duplicate, then reference invalid. File validation has no SceneSpec context and must not emit scene-level conflict or reference codes.

## Canonical document and hash

Actor Blueprint document schema version 1 is strict. It requires:

- `blueprintId`: `^actor_blueprint_[1-9][0-9]*$`, maximum 48 characters.
- `blueprintVersion`: integer 1 through 2147483647.
- `body.heightM`: 1 through 2.4; `shoulderWidthM`: 0.25 through 0.8; `build`: `slim`, `average`, or `broad`.
- proportion ratios: torso length 0.2-0.45, torso depth 0.06-0.2, pelvis/shoulder 0.5-1, pelvis height 0.06-0.2, head radius 0.05-0.12, upper arm 0.12-0.3, forearm 0.1-0.27, upper leg 0.18-0.35, lower leg 0.16-0.33, torso radius/shoulder 0.15-0.5, arm radius 0.015-0.08, and leg radius 0.02-0.1.
- hand size ratios 0.015-0.15, hand offsets -0.15-0.15, foot size ratios 0.02-0.25, and foot offsets -0.2-0.2, each as three finite values.
- skeleton ratios: spine origin -0.05-0.1, head origin 0.01-0.12, shoulder offset 0.35-0.75, shoulder origin 0.5-1, hip offset 0.15-0.5, and hip origin -0.1-0.05.
- a complete twelve-part base `limbPresence` map.
- at most 64 modules, at most 32 non-empty parts per module, and 1-32 variants with unique IDs.

Module, part, and variant IDs use `^[a-z][a-z0-9_-]{0,39}$`. Modules mount only at `shoulder_l`, `shoulder_r`, `elbow_l`, `elbow_r`, `wrist_l`, `wrist_r`, `hip_l`, `hip_r`, `knee_l`, or `knee_r`. Parts are only `box`, `sphere`, or `cylinder`. Local positions are -10 through 10 meters; scale is three positive values from 0.01 through 100 and may be non-uniform. Quaternions must already be unit length within a strict norm tolerance below 0.001; they are rejected, not normalized. Box dimensions are 0.001-5 meters, sphere/cylinder radii 0.001-2 meters, and cylinder lengths 0.001-5 meters.

The snapshot adds `contentSha256`. Hash input excludes `blueprintId` and `contentSha256`, and includes schema version, blueprint version, body, proportions, skeleton, base limb map, modules, and variants. Canonical JSON recursively sorts object keys, preserves array order, rejects non-finite or non-JSON values, uses ECMAScript `JSON.stringify` number serialization, encodes with `TextEncoder` UTF-8, then computes lowercase SHA-256.

## Variants are deltas

Every variant must contain both `limbPresence` and `moduleVisibility`; either may be `{}`, but neither may be omitted or `null`. Both are partial delta objects and variants cannot copy body, proportions, skeleton, module geometry, pose, transform, color, lock, or source fields.

Effective module visibility is:

```text
variant.moduleVisibility[moduleId] ?? module.visible
```

Effective limb presence uses exactly this algorithm:

1. Start from the complete base map.
2. Apply only the selected variant's explicit overrides.
3. An explicitly absent parent closes every descendant in its chain.
4. Reject an explicitly present child whose effective ancestor is absent.
5. Validate the resulting complete map.
6. Never merge from the previously selected variant.

Thus `upper_arm_r: "absent"` is enough to close the right forearm and hand. A repaired variant restores the right-arm chain from the complete base without duplicating body proportions. Unknown module IDs and duplicate variant IDs are invalid.

## Register, instance, and switch

`SceneSpec.actorBlueprints` contains canonical snapshots. Within one SceneSpec:

- `blueprintId` is unique.
- The same SHA-256 must reuse the existing snapshot.
- The same blueprintId with a different SHA-256 is rejected as `ACTOR_BLUEPRINT_ID_CONFLICT`; a new generic ID must be explicit.
- The same SHA-256 under another ID is rejected as `ACTOR_BLUEPRINT_HASH_DUPLICATE`.
- There is no automatic garbage collection and v0.6 has no blueprint removal operation.

Register one snapshot with `actor.blueprint.register`, then add any number of instances through `entity.add`. Each instance needs a distinct legal actor `id` and a distinct existing generic slot such as `actor_female_1` and `actor_female_2`. Multiple instances reference the same snapshot through:

```json
{
  "blueprintInstance": {
    "blueprintId": "actor_blueprint_1",
    "variantId": "damaged"
  }
}
```

The actor union is mutually exclusive. A blueprint actor has `blueprintInstance`, pose, transform, color, and lock state, but no `rig`, `body`, instance-level `limbPresence`, proportions, skeleton, modules, or variants. A legacy actor has `rig` and `body` and no `blueprintInstance`. Mixed branches are rejected by strict equivalent one-of validation.

Switch only among variants already in the referenced snapshot using one `actor.variant.set` operation. It never changes pose, rotation, scale, parent, color, lock, or user-authored horizontal placement. With contact enforcement inactive, the complete transform stays byte-for-byte unchanged. With contact enforcement active, only the contact-owned translation component may change; the same atomic revision owns that adjustment, and undo/redo restores it exactly.

## Projection, Inspector, and verification

All consumers use one resolved actor projection for both legacy and blueprint actors. Rendering, bounds, contact, composition, and software diagnostics must not parse or resolve a blueprint independently.

For a blueprint actor, the existing Inspector shows a read-only blueprint ID/version/hash summary and a selector containing only variants already in the snapshot. Selection submits `actor.variant.set` through the existing Patch route. The Inspector does not import, author, edit, duplicate, rename, or delete blueprints, modules, proportions, or variants.

After create, registration, instance addition, reload, or variant change, inspect Overview, each affected Local preview, Shot Preview, and the composition report. A PNG acceptance claim requires the browser-rendered final camera, returned scene ID and revision, exact dimensions, file SHA-256, warning codes, and human inspection of the intended modules and limb state.
