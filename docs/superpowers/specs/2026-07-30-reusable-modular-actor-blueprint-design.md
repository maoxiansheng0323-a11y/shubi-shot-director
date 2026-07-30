# Reusable Modular Actor Blueprint Design

**Status:** Approved in conversation on 2026-07-30. The implementation-blocking
review corrections for delta variants, validation output, error layering,
contact-owned transforms, narrow Inspector behavior, and same-scene
multi-instance deduplication are incorporated. The user authorized direct
transition to TDD after this revision.

**Release:** Shubi Shot Director v0.6.0.

**Scope:** Add strict external Actor Blueprint documents, self-contained
SceneSpec snapshots, reusable actor instances, delta-only variants, and
bone-mounted graybox modules without adding arbitrary meshes, animation,
physics, IK, skinning, or a general character editor.

## Goal

Allow Host Codex to read one explicitly supplied project-external JSON file,
validate it as a generic humanoid Actor Blueprint, and instantiate that
blueprint in multiple scenes. Each instance remains independently movable,
rotatable, scalable, poseable, lockable, saveable, reloadable, and exportable
through the existing final-camera PNG workflow.

The accepted scene must remain complete after the source blueprint file is
moved or removed. SceneSpec therefore stores a content-addressed blueprint
snapshot and remains the only persistent scene authority.

## Product boundary

This release includes:

- strict Actor Blueprint document schema version 1;
- explicit body dimensions, proportions, controlled humanoid skeleton
  parameters, canonical limb presence, module definitions, and variants;
- project-external, Host-only file import;
- content-addressed blueprint snapshots stored inside SceneSpec;
- reusable actor instances with independent transform, pose, color, locks, and
  selected variant;
- deterministic module attachment at canonical shoulder, elbow, wrist, hip,
  and knee frames;
- module parts composed from box, sphere, and cylinder primitives;
- delta-only variants for limb presence and module visibility;
- one allowlisted blueprint registration operation and one allowlisted variant
  selection operation;
- automatic acceptance of legacy SceneSpec actors and SceneSpec versions 1
  through 4 without a separate migration command;
- one resolved actor projection consumed by every geometry-dependent system;
- generic two-scene, four-PNG browser acceptance;
- v0.6.0 capability, documentation, release-note, and public-audit updates.

This release does not include:

- arbitrary mesh, GLB, glTF, FBX, texture, material, or production-asset
  import;
- IK, skinning, animation, physics, ragdolls, retargeting, or procedural
  motion;
- arbitrary bones, arbitrary mount types, or a general rigging system;
- a blueprint authoring UI, generalized character editor, module editor, or
  Inspector controls beyond the narrow read-only blueprint summary and
  existing-variant selector defined below;
- final image generation, art prompting, project asset management, or
  visual-novel integration;
- private project names, character names, aliases, source paths, source
  metadata, credentials, or unpublished assets.

## Considered architectures

### Selected: external source plus embedded SceneSpec snapshot

The external JSON file is a reusable authoring source. Host Codex reads the
exact user-supplied file, validates and canonicalizes its in-memory content,
then registers a path-free snapshot in SceneSpec. Actor instances refer to the
snapshot by generic blueprint ID and select a variant.

This keeps saved scenes portable, permits deterministic reload after the
external file disappears, deduplicates a blueprint within one SceneSpec, and
preserves SceneSpec as the only persistent state.

### Rejected: persistent live external path

Storing a path in SceneSpec would make rendering, history, and export depend on
machine state. It would also leak path information across runtime boundaries
and violate the existing canonical-scene architecture.

### Rejected: bake modules into ordinary props

Materializing every body or module part as an independent prop would duplicate
state, complicate variants and locks, and detach modules from pose joints. It
would turn the feature into a general modular-entity system instead of a
bounded actor blueprint.

## External Actor Blueprint document v1

The external document is a strict JSON object:

```ts
interface ActorBlueprintDocumentV1 {
  schemaVersion: 1;
  blueprintId: `actor_blueprint_${number}`;
  blueprintVersion: number;
  body: {
    heightM: number;
    shoulderWidthM: number;
    build: "slim" | "average" | "broad";
  };
  proportions: ActorBlueprintProportions;
  skeleton: ActorBlueprintSkeleton;
  limbPresence: ActorLimbPresence;
  modules: ActorBlueprintModule[];
  variants: ActorBlueprintVariant[];
}
```

`blueprintId` is generic, has a maximum length of 48 characters, and matches
`^actor_blueprint_[1-9][0-9]*$`. There are no free-text names, descriptions,
aliases, source references, extension metadata, or arbitrary JSON bags.

`blueprintVersion` is a positive integer owned by the external author. It is
part of the hashed content and is not a SceneSpec schema version.

### Controlled proportions

The proportion object stores the ratios that the current hard-coded humanoid
derivation uses:

```ts
interface ActorBlueprintProportions {
  torsoLengthHeightRatio: number;
  torsoDepthHeightRatio: number;
  pelvisWidthShoulderRatio: number;
  pelvisHeightHeightRatio: number;
  headRadiusHeightRatio: number;
  upperArmLengthHeightRatio: number;
  forearmLengthHeightRatio: number;
  upperLegLengthHeightRatio: number;
  lowerLegLengthHeightRatio: number;
  handSizeHeightRatios: Vec3;
  handOffsetHeightRatios: Vec3;
  footSizeHeightRatios: Vec3;
  footOffsetHeightRatios: Vec3;
  torsoRadiusShoulderRatio: number;
  armRadiusHeightRatio: number;
  legRadiusHeightRatio: number;
}
```

`build` remains a coarse radius/depth modifier and does not replace the
explicit ratios. Exact numeric bounds are defined below.

### Controlled skeleton parameters

The skeleton object tunes only the existing humanoid hierarchy:

```ts
interface ActorBlueprintSkeleton {
  spineOriginHeightRatio: number;
  headOriginAboveTorsoHeightRatio: number;
  shoulderOffsetShoulderRatio: number;
  shoulderOriginTorsoRatio: number;
  hipOffsetPelvisRatio: number;
  hipOriginHeightRatio: number;
}
```

These values position canonical frames in the current pelvis, spine, neck,
left/right arm, and left/right leg chains. The document cannot add, rename,
reparent, or remove bones.

### Executable schema limits

All numeric inputs must be finite JSON numbers. Bounds are inclusive unless a
rule explicitly uses a strict comparison.

Body fields:

| Field | Minimum | Maximum |
| --- | ---: | ---: |
| `heightM` | 1.0 | 2.4 |
| `shoulderWidthM` | 0.25 | 0.8 |
| `blueprintVersion` | 1 | 2,147,483,647 |

Proportion fields:

| Field | Minimum | Maximum |
| --- | ---: | ---: |
| `torsoLengthHeightRatio` | 0.2 | 0.45 |
| `torsoDepthHeightRatio` | 0.06 | 0.2 |
| `pelvisWidthShoulderRatio` | 0.5 | 1.0 |
| `pelvisHeightHeightRatio` | 0.06 | 0.2 |
| `headRadiusHeightRatio` | 0.05 | 0.12 |
| `upperArmLengthHeightRatio` | 0.12 | 0.3 |
| `forearmLengthHeightRatio` | 0.1 | 0.27 |
| `upperLegLengthHeightRatio` | 0.18 | 0.35 |
| `lowerLegLengthHeightRatio` | 0.16 | 0.33 |
| every `handSizeHeightRatios` component | 0.015 | 0.15 |
| every `handOffsetHeightRatios` component | -0.15 | 0.15 |
| every `footSizeHeightRatios` component | 0.02 | 0.25 |
| every `footOffsetHeightRatios` component | -0.2 | 0.2 |
| `torsoRadiusShoulderRatio` | 0.15 | 0.5 |
| `armRadiusHeightRatio` | 0.015 | 0.08 |
| `legRadiusHeightRatio` | 0.02 | 0.1 |

Skeleton fields:

| Field | Minimum | Maximum |
| --- | ---: | ---: |
| `spineOriginHeightRatio` | -0.05 | 0.1 |
| `headOriginAboveTorsoHeightRatio` | 0.01 | 0.12 |
| `shoulderOffsetShoulderRatio` | 0.35 | 0.75 |
| `shoulderOriginTorsoRatio` | 0.5 | 1.0 |
| `hipOffsetPelvisRatio` | 0.15 | 0.5 |
| `hipOriginHeightRatio` | -0.1 | 0.05 |

Collection and identifier rules:

- `modules` contains zero through 64 modules;
- each module contains one through 32 parts;
- `variants` contains one through 32 variants;
- module IDs are unique per blueprint;
- variant IDs are unique per blueprint;
- part IDs are unique within their module;
- module, part, and variant IDs have one through 40 characters and match
  `^[a-z][a-z0-9_-]{0,39}$`;
- a module visibility override may mention only a module declared in the same
  blueprint;
- every collection preserves source order as semantically significant
  canonical order.

Module geometry and local-transform rules:

| Value | Minimum | Maximum |
| --- | ---: | ---: |
| every `positionM` component | -10 | 10 |
| every `scale` component | 0.01 | 100 |
| every box `sizeM` component | 0.001 | 5 |
| sphere/cylinder `radiusM` | 0.001 | 2 |
| cylinder `lengthM` | 0.001 | 5 |

Non-uniform positive scale is allowed for actor instances and module-local
transforms. Quaternion input is never normalized silently: its Euclidean norm
must differ from 1 by strictly less than `0.001`, or validation rejects it.

### Canonical limb presence

The base blueprint contains the existing complete twelve-key presence map:

```text
upper_arm_l -> forearm_l -> hand_l
upper_arm_r -> forearm_r -> hand_r
upper_leg_l -> lower_leg_l -> foot_l
upper_leg_r -> lower_leg_r -> foot_r
```

The existing hierarchy rules continue to apply. An absent parent closes its
descendants. A present child requires all ancestors. Contradictory maps are
rejected.

## Module schema

Modules attach only to this fixed mount allowlist:

```text
shoulder_l  shoulder_r
elbow_l     elbow_r
wrist_l     wrist_r
hip_l       hip_r
knee_l      knee_r
```

Each module has a generic ID, a mount, base visibility, and one or more parts:

```ts
interface ActorBlueprintModule {
  moduleId: string;
  mount: ActorBlueprintMountId;
  visible: boolean;
  parts: ActorBlueprintModulePart[];
}

type ActorBlueprintModulePart =
  | {
      partId: string;
      primitive: "box";
      transform: LocalTransform;
      sizeM: Vec3;
    }
  | {
      partId: string;
      primitive: "sphere";
      transform: LocalTransform;
      radiusM: number;
    }
  | {
      partId: string;
      primitive: "cylinder";
      transform: LocalTransform;
      radiusM: number;
      lengthM: number;
    };
```

Module and part IDs use the exact slug, uniqueness, and count rules above.
Local transforms contain a bounded position, a validated normalized
quaternion, and bounded positive scale. Non-uniform scale is allowed.
Cylinders use local +Y as their length axis.

Modules inherit the actor graybox color in v0.6.0. Per-part materials, textures,
opacity, render layers, meshes, and arbitrary metadata are not supported.

Mount frames exist independently of whether downstream body geometry is
visible. This permits an exposed shoulder interface when an arm is absent and
a sealed knee interface when a lower leg is absent. The resulting module is
explicit blueprint geometry, not a hidden fallback limb.

## Delta-only variants

A variant is strict and may contain only:

```ts
interface ActorBlueprintVariant {
  variantId: string;
  limbPresence: Partial<ActorLimbPresence>;
  moduleVisibility: Partial<Record<ModuleId, boolean>>;
}
```

Variants cannot contain body, proportion, skeleton, module geometry, pose,
transform, color, lock, or source fields. Unknown module IDs and contradictory
limb updates are rejected. Both `limbPresence` and `moduleVisibility` are
required strict objects and may be `{}`; neither field may be omitted or
`null`.

Effective state is always recomputed from:

```text
base blueprint + exactly one selected variant

effective module visibility =
  variant.moduleVisibility[moduleId] ?? module.visible
```

It is never computed from the previously selected variant. Switching from
`damaged` to `repaired` therefore cannot retain stale absence or visibility
state. Variant selection changes only effective limb presence and module
visibility; all proportions and skeleton parameters come from the single base
snapshot.

Effective limb presence uses this fixed algorithm:

1. Start from the complete base `limbPresence` map.
2. Apply only the selected variant's explicit part overrides.
3. For every part explicitly set to `absent`, close every descendant in that
   canonical chain to `absent`.
4. If a part is explicitly set to `present` while any effective ancestor is
   `absent`, reject the variant with `ACTOR_BLUEPRINT_VARIANT_INVALID`.
5. Validate the resulting complete map against the canonical hierarchy.
6. Never read or merge the previously selected variant's effective result.

Thus a damaged variant may set only `upper_arm_r: "absent"` to close its
forearm and hand. A repaired variant can restore that chain because the base
anatomy is complete; it explicitly selects the required present states without
copying any body, proportion, or skeleton field.

## Content hash and snapshot identity

SceneSpec stores an Actor Blueprint snapshot:

```ts
interface ActorBlueprintSnapshotV1 extends ActorBlueprintDocumentV1 {
  schemaVersion: 1;
  contentSha256: string;
}
```

The SHA-256 is lowercase hexadecimal and is computed over canonical JSON of:

```text
schemaVersion
blueprintVersion
body
proportions
skeleton
limbPresence
modules
variants
```

`blueprintId` and `contentSha256` are excluded from the hash input. Excluding
the generic identity allows equivalent content proposed under a different ID
to deduplicate by content.

Canonical bytes are produced by one shared
`canonicalJsonSha256(value)` implementation:

1. Build the exact hash-input object with the fields listed above.
2. Recursively sort every object key by ascending Unicode UTF-16 code-unit
   order; do not sort arrays.
3. Serialize the result with ECMAScript `JSON.stringify` and no replacer,
   indentation, trailing newline, or byte-order mark.
4. Reject non-finite numbers before serialization. ECMAScript number
   serialization is authoritative; `-0` therefore serializes as `0`.
5. Encode the serialized string as UTF-8.
6. Compute SHA-256 and format exactly 64 lowercase hexadecimal characters.

The same function is imported by Host validation, snapshot validation,
SceneSpec validation, Patch application, tests, and public audit. No consumer
may reproduce the algorithm locally. The validator recomputes the hash and
rejects a supplied snapshot whose stored hash does not match.

Within one SceneSpec:

- every `blueprintId` is unique;
- every `contentSha256` is unique;
- no import or Patch may silently replace an existing snapshot;
- duplicate IDs in raw canonical scene input fail schema validation;
- duplicate hashes in raw canonical scene input fail with
  `ACTOR_BLUEPRINT_HASH_DUPLICATE`.

When one incoming snapshot is compared with the existing canonical array:

- same ID plus same hash reuses the existing snapshot;
- different ID plus same hash reuses the existing snapshot and its existing
  generic ID without creating an alias;
- same ID plus different hash fails with
  `ACTOR_BLUEPRINT_ID_CONFLICT`;
- after an ID conflict, Host Codex may explicitly author a new unused generic
  ID and resubmit the incoming snapshot with its same verified content hash.

Deduplication does not create a revision by itself. When a Patch registers a
new snapshot and adds an actor in the same atomic submission, the whole Patch
creates exactly one revision and one undo entry.

## Host-only import and path boundary

The Skill adds a Host-side command:

```text
node scripts/director.mjs blueprint validate --file <external-json>
```

This command is implemented at the Skill wrapper boundary. The wrapper:

1. accepts only the exact path explicitly supplied by Host Codex;
2. resolves a relative path before changing working directories;
3. reads only that exact file and does not search nearby locations;
4. parses and validates the JSON in the Host wrapper;
5. canonicalizes the content and computes its SHA-256;
6. retains the validated canonical document in Host memory only for immediate
   path-free snapshot authoring;
7. never forwards the path through CLI runtime arguments, environment
   variables, bridge requests, SceneSession, or browser state.

The command's machine-readable and human-visible stdout contains only:

```ts
{
  blueprintId: string;
  blueprintVersion: number;
  contentSha256: string;
  moduleCount: number;
  variantCount: number;
  valid: true;
}
```

It does not return the raw JSON or full canonical snapshot. Host Codex already
holds the validated in-memory document from the exact read and combines it
with the returned hash when authoring a structured snapshot. The source path
and in-memory document are discarded after the scene or Patch submission is
authored.

The source path exists only for the duration of the Host-side read. Success,
failure, diagnostics, and logs never echo the path, raw JSON text, or full
canonical snapshot.

File read and document validation can return only:

- `ACTOR_BLUEPRINT_FILE_READ_FAILED`;
- `ACTOR_BLUEPRINT_FILE_INVALID`;
- `ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED`;
- `ACTOR_BLUEPRINT_VARIANT_INVALID`.

Snapshot or SceneSpec validation can additionally return:

- `ACTOR_BLUEPRINT_HASH_MISMATCH`;
- `ACTOR_BLUEPRINT_HASH_DUPLICATE`;
- `ACTOR_BLUEPRINT_REFERENCE_INVALID`.

Registration Patch application can additionally return:

- `ACTOR_BLUEPRINT_ID_CONFLICT`;
- `ACTOR_BLUEPRINT_HASH_DUPLICATE`;
- `ACTOR_BLUEPRINT_REFERENCE_INVALID`.

Error selection is deterministic:

1. File import checks read failure first.
2. Parsed JSON that is not an object or fails strict structural fields returns
   `ACTOR_BLUEPRINT_FILE_INVALID`.
3. An otherwise inspectable object with `schemaVersion !== 1` returns
   `ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED`.
4. Structural validation precedes semantic variant closure; only a
   structurally valid document with an invalid variant returns
   `ACTOR_BLUEPRINT_VARIANT_INVALID`.
5. Snapshot validation checks strict snapshot shape, then hash integrity, then
   duplicate ID/hash constraints, then actor references.
6. Patch validation checks normal Patch schema, scene ID, and revision first;
   then snapshot hash integrity in operation order; then duplicate
   registrations within the Patch; then conflicts with existing scene IDs;
   then actor blueprint/variant references; then existing lock, contact, and
   final-scene rules.

Two registration operations in one Patch that propose different IDs for the
same hash return `ACTOR_BLUEPRINT_HASH_DUPLICATE`. Importing one snapshot whose
hash already exists in the current SceneSpec reuses the existing snapshot and
does not return that error.

The path and source file metadata are forbidden from:

- Actor Blueprint snapshots;
- SceneSpec and ScenePatch;
- IntentReport;
- undo and redo history;
- autosave and explicit save;
- diagnostic, composition, and software-render reports;
- bridge events and logs;
- PNG text chunks, screenshot metadata, and export reports;
- repository examples, fixtures, snapshots, release notes, or audits.

Tests must instrument the wrapper/runtime boundary and prove that the external
path is not forwarded. Public-audit rules also scan serialized artifacts and
PNG metadata for source-path markers.

## SceneSpec v5

`SCENE_SCHEMA_VERSION` becomes `5`.

SceneSpec adds:

```ts
actorBlueprints: ActorBlueprintSnapshotV1[];
```

The array defaults to empty during legacy normalization. Scene validation
enforces unique blueprint IDs, unique content hashes, exact hash integrity,
and valid references from every blueprint instance.

Actor entities become a strict union of:

1. the existing legacy actor shape with `rig` and `body`; and
2. a blueprint actor shape with `blueprintInstance`.

The union is mutually exclusive:

- a blueprint actor must contain `blueprintInstance` and must not contain
  `rig`, `body`, instance-level `limbPresence`, proportions, skeleton, modules,
  or variants;
- a legacy actor must contain `rig` and `body` and must not contain
  `blueprintInstance`;
- JSON Schema exposes a true `oneOf`, or an equivalent strict refinement with
  identical behavior;
- an entity containing fields from both shapes is rejected and is never
  interpreted by choosing one branch.

The blueprint actor shape retains the existing common actor fields and stores:

```ts
blueprintInstance: {
  blueprintId: `actor_blueprint_${number}`;
  variantId: string;
};
```

It does not duplicate `rig`, body dimensions, proportions, skeleton
parameters, limb presence, or module geometry. Those values resolve from the
referenced snapshot. Its transform, pose, color, visibility, lock mode, slot,
label, and parent remain instance-owned.

Existing `actor_female_1`, `actor_male_1`, and `actor_generic_1` slots remain
valid for both actor shapes.

The existing per-scene slot uniqueness rule remains unchanged. Multiple
instances of one snapshot use distinct entity IDs and distinct legal slots,
for example `actor_entity_blueprint_1` with `actor_female_1` and
`actor_entity_blueprint_2` with `actor_female_2`. They may reference the same
`blueprintId` while retaining independent transform, pose, color, visibility,
lock mode, parent, and selected variant. Their SceneSpec still stores exactly
one snapshot in `actorBlueprints`.

## Backward compatibility

SceneSpec versions 1 through 4 remain accepted by every existing load,
submission, persistence, and direct-structured route. Loading an old file
requires no user-run migration command and does not rewrite the source file.

In memory, old scenes normalize to v5 with:

```text
actorBlueprints: []
```

Existing actor entities retain their current `rig`, body, pose, limb presence,
transform, color, and lock semantics. The legacy adapter supplies the exact
v0.5 default proportion and skeleton constants to the unified resolver, so old
scenes preserve their accepted visual geometry.

Compatibility comparison uses stable primitive ID order. For every legacy
actor fixture, the v0.5 baseline and v0.6 unified resolver must have:

- identical primitive ID sequence, primitive kind, and visibility;
- identical declared segment counts;
- numeric size, radius, length, center, frame position, and frame quaternion
  components within absolute tolerance `1e-9`;
- no blueprint snapshot, module primitive, or variant state added to the
  migrated actor.

This is semantic geometric equivalence, not byte-for-byte equality of
independently serialized floating-point JSON.

ScenePatch and IntentReport versions 1 through 4 remain loadable. Their
migration never registers a blueprint, changes an actor kind, selects a
variant, or invents intent evidence.

Normalization alone does not increment revision, add history, acquire locks,
or overwrite a scene file.

## ScenePatch v5

`PATCH_SCHEMA_VERSION` becomes `5`.

### Register a snapshot

```ts
{
  op: "actor.blueprint.register";
  snapshot: ActorBlueprintSnapshotV1;
}
```

The operation validates hash integrity and the identity conflict matrix. An
exact existing snapshot is a deterministic no-op within the Patch working
clone. If the hash already exists under a different ID, the operation reuses
the existing snapshot and does not add the proposed ID as an alias. Any actor
added in the same Patch must therefore reference the existing canonical ID.
A same-ID/different-hash conflict is rejected rather than overwritten.

Host Codex snapshots the current scene before authoring. If the incoming hash
already exists, Host reuses the existing generic ID and omits the registration
operation. A new actor may then be added through the existing `entity.add`
operation using that ID.

### Select a variant

```ts
{
  op: "actor.variant.set";
  actorId: EntityId;
  variantId: string;
}
```

The target must be a blueprint actor and the variant must exist in the
referenced snapshot. The operation obeys existing `none`, `workflow`, and
`user` lock behavior. It changes only the selected variant and any
deterministic contact adjustment caused by the resulting visible projection.

`actor.variant.set` never changes actor pose, rotation, scale, parent, color,
visibility, lock mode, or user-authored horizontal placement. When
deterministic contact enforcement is inactive, the complete transform remains
deep-equal to its pre-Patch value. When contact enforcement is active, only
the contact-owned world-up translation component `positionM[1]` may change;
`positionM[0]` and `positionM[2]` remain exact. That Y adjustment is part of
the same atomic revision and undo/redo restores it exactly.

Blueprint registration, actor addition, variant selection, contact
enforcement, final validation, and history commit remain atomic. Failure
leaves the scene, revision, history, and persisted state unchanged.

## IntentReport v5

`INTENT_REPORT_SCHEMA_VERSION` becomes `5`.

Recognized constraint kinds add:

- `actor-blueprint-registration`;
- `actor-blueprint-instance`;
- `actor-blueprint-variant`.

Evidence refers only to generic snapshot IDs, actor IDs, variant IDs, property
paths, and operation indexes. It never contains external paths, filenames,
source JSON, or project aliases.

Natural-language creation still uses Host-authored structured submissions.
The runtime never infers a blueprint, variant, mount, module, or geometry from
raw wording.

## Narrow Inspector behavior

For a selected blueprint actor, the existing Inspector displays:

- a read-only generic blueprint summary containing `blueprintId`,
  `blueprintVersion`, abbreviated `contentSha256`, module count, and variant
  count;
- one selector containing only variants already present in the referenced
  snapshot.

Changing the selector submits one `actor.variant.set` operation through the
existing Patch route and waits for the authoritative accepted revision. The
selector reflects SceneSpec state and keeps no independent variant draft after
the response.

The Inspector does not import, author, edit, duplicate, rename, refresh, or
delete blueprints, modules, module parts, dimensions, proportions, skeleton
parameters, or variants. Existing workflow and user lock behavior determines
whether selection is enabled.

## One resolved actor projection

The domain exports one authoritative entrypoint:

```ts
resolveActorProjection(scene: SceneSpec, actor: ActorEntity):
  ResolvedActorProjection
```

The resolver:

1. adapts a legacy actor or resolves a blueprint snapshot reference;
2. applies the selected variant to base limb and module visibility;
3. derives all dimensions from one body/proportion/skeleton definition;
4. computes the complete pose hierarchy and canonical mount frames;
5. emits visible body and module primitives with stable generic IDs;
6. returns anchors, frames, primitives, and effective anatomy needed by
   downstream systems.

Supported projected primitives are sphere, capsule, box, and cylinder.
Capsule remains available for the built-in body; external module definitions
are limited to sphere, box, and cylinder.

Every geometry-dependent consumer must call this projection:

- React Three.js browser rendering;
- actor visible bounds and support offset;
- deterministic ground and support contact;
- full-body and partial-body composition framing;
- occlusion and camera-collision proxies;
- Overview and Local previews;
- final Shot Preview and browser PNG export;
- software PNG diagnostics;
- acceptance and snapshot tests.

No consumer may independently parse blueprint snapshots, apply variants,
derive body ratios, calculate mount frames, or reconstruct module geometry.
The current separate actor skeleton in `server/software-png.ts` must be removed
and replaced with projection consumption.

## Pose and mount behavior

Canonical mount frames are calculated even when body primitives are absent.
They follow the same joint hierarchy and quaternions used by body segments.

The module transform chain is:

```text
actor world transform
  -> canonical posed bone chain
  -> mount frame
  -> module-part local transform
```

For example:

- a right shoulder terminal remains attached to `shoulder_r` while the right
  arm chain is absent;
- a knee cap remains attached to `knee_l` or `knee_r` while the corresponding
  lower leg is absent;
- rotating the upper arm moves its elbow and wrist modules;
- rotating, translating, scaling, or lying down the actor moves every module
  consistently.

The resolver does not solve IK, collisions, deformation, skinning, or
mechanical articulation.

## Persistence, history, and export

Autosave and explicit save serialize the complete v5 SceneSpec snapshot.
Loading, restart, scene replacement, undo, redo, and history traversal retain
the exact blueprint hash, definition, selected variant, transform, and pose.

Removing the source external JSON after registration has no effect on an
already accepted scene.

v0.6.0 adds no blueprint removal operation and performs no automatic garbage
collection of unused snapshots. Removing the last referencing actor leaves the
snapshot in SceneSpec so history and undo/redo remain deterministic.

Explicit save retains the existing workflow-lock checkpoint behavior.
Background persistence does not create locks. Variant selection and actor
movement retain current lock provenance rules.

PNG export remains side-effect free and requires a connected browser Shot
Preview at the exact scene ID and revision. Export reports return only generic
scene metadata, dimensions, SHA-256, and warning codes.

## Skill workflow

The updated Skill instructs Host Codex to:

1. accept only an explicitly supplied external Actor Blueprint path;
2. use the Host-only validation boundary and never forward or persist the
   path;
3. snapshot the current scene before import;
4. reuse an existing snapshot when the content hash matches;
5. reject same-ID/different-hash conflicts and never overwrite;
6. author a registration operation only for genuinely new content;
7. author blueprint actors that reference the canonical in-scene ID;
8. use one minimal variant Patch for later state changes;
9. preserve workflow locks and stop for user locks;
10. inspect Overview, affected Local previews, Shot Preview, composition, save
    and reload, and browser PNG output before claiming success;
11. keep all files, identifiers, reports, and examples generic.

The previous rule that mechanical replacement parts were unsupported is
narrowed: arbitrary prostheses and meshes remain unsupported, while schema
validated box/sphere/cylinder modules attached through this blueprint system
are supported.

## Verification strategy

Implementation follows test-driven development. Every production behavior is
preceded by a focused failing test that demonstrates the missing capability.

### Schema, hash, and identity tests

- accept a strict generic Actor Blueprint document v1;
- reject extra fields, private/free-text metadata, invalid generic IDs, unknown
  mounts, unsupported primitives, and invalid dimensions;
- canonicalize content deterministically and produce a stable SHA-256;
- reject a snapshot whose stored hash is wrong;
- enforce unique blueprint IDs and hashes inside SceneSpec;
- reuse same-ID/same-hash and different-ID/same-hash imports;
- reject same-ID/different-hash without mutation;
- validate that variants contain no body, proportion, skeleton, pose, or
  transform fields;
- require present-but-empty `limbPresence` and `moduleVisibility` objects and
  reject omitted or `null` objects;
- verify `moduleVisibility` inherits `module.visible` for absent overrides and
  changes only explicitly named modules;
- reject variants that reference unknown module IDs or violate limb hierarchy.

### Host path-boundary tests

- read only the exact explicitly supplied file;
- reject drive-relative and malformed paths according to existing wrapper
  rules;
- prove the runtime process never receives the path through arguments,
  environment, stdin envelopes, or bridge requests;
- prove success and failure output never echoes the path;
- scan SceneSpec, Patch, IntentReport, history events, persistence, reports,
  logs, and PNG metadata for a unique path marker and require zero findings.

### Compatibility tests

- load representative SceneSpec v1, v2, v3, and v4 files without a user-run
  migration step;
- preserve existing actor slots and exact v0.5 resolved primitives;
- keep direct structured create/Patch routes working;
- migrate old Patch and IntentReport documents without invented blueprint
  state;
- keep lock, workspace, camera, save, and export behavior unchanged;
- compare legacy primitive ID order, kinds, visibility, counts, and all numeric
  fields using the specified `1e-9` tolerance.

### Projection and geometry tests

- resolve legacy and blueprint actors through the same entrypoint;
- expose deterministic shoulder, elbow, wrist, hip, and knee frames;
- project box, sphere, and cylinder module parts;
- make module world transforms follow actor transform and pose joints;
- preserve explicit shoulder interfaces when arms are absent;
- preserve explicit knee interfaces when lower legs are absent;
- remove hidden downstream body geometry without removing explicit modules;
- prove browser rendering, visible bounds, support contact, composition,
  occlusion, and software diagnostics consume the same primitive IDs and
  transforms;
- source-audit the repository for prohibited secondary blueprint parsing and
  software skeleton derivation.

### Persistence, Patch, and history tests

- atomically register a snapshot and add an actor;
- reuse an existing snapshot without duplicating it;
- add two actors with distinct legal entity IDs and slots that reference one
  snapshot; require `actorBlueprints.length === 1` while transform, pose,
  color, lock state, and selected variant remain independent;
- switch damaged/repaired variants in one revision;
- with contact disabled, preserve the complete actor transform and pose across
  variant changes;
- with contact enabled, preserve pose, rotation, scale, parent, X/Z placement,
  and allow only the contact-owned Y translation to change;
- undo and redo exact snapshot, instance, variant, and contact state;
- save, restart, and reload after the source file is removed;
- reject wrong-kind actors, missing blueprints, unknown variants, stale
  revisions, workflow-lock misuse, and user-locked edits without mutation.

### Narrow Inspector tests

- render the read-only blueprint ID, version, abbreviated hash, module count,
  and variant count for a blueprint actor;
- list only variants from the referenced snapshot;
- selecting a variant submits exactly one `actor.variant.set` Patch and then
  reflects the accepted SceneSpec revision;
- disable selection according to existing workflow/user lock rules;
- expose no import, authoring, rename, duplicate, delete, geometry, proportion,
  skeleton, or module editing controls.

### Generic black-box acceptance

Create a temporary project-external Actor Blueprint whose base anatomy is
complete and contains:

- a 1.62 m slim female-slot humanoid machine;
- mirrored circular shoulder sockets;
- a left arm connected through its shoulder socket;
- three short cylinder terminals exposed at the right shoulder;
- sealed box/sphere/cylinder interface geometry at both knees;
- damaged and repaired variants that contain no body, proportion, skeleton, or
  module geometry.

The effective variant states are fixed:

```text
damaged
- right upper arm, forearm, and hand are absent;
- both lower legs and both feet are absent;
- right-shoulder exposed terminals are visible;
- both sealed knee interfaces are visible.

repaired
- right upper arm, forearm, and hand are present;
- right-shoulder exposed terminals are hidden;
- both lower legs and both feet remain absent;
- both sealed knee interfaces remain visible.
```

Register the same snapshot in two different SceneSpec scenes:

1. Scene A uses the damaged standing variant and exports front, three-quarter,
   and side views.
2. Scene B uses the repaired variant, applies a lying-supine pose, and exports
   the lying view.

Execute the black-box acceptance in this fixed order:

1. Validate and register the external blueprint once and record its generic
   content SHA-256.
2. Create and save Scene A and Scene B, requiring each saved snapshot hash to
   match.
3. Remove or relocate the external source exactly once.
4. Restart the owning workspaces and load both saved scenes, proving neither
   load reads the external file.
5. In Scene A, inspect Overview, affected Local previews, segmented
   composition, and Shot Preview, then export `front.png`.
6. Reframe only the Scene A camera, repeat composition and Shot Preview
   inspection, and export `three-quarter.png`.
7. Reframe only the Scene A camera again, repeat inspection, and export
   `side.png`.
8. In Scene B, verify the repaired state and lying-supine pose, inspect
   Overview, affected Local previews, segmented composition, and Shot Preview,
   then export `supine.png`.
9. For each of the four distinct files, record scene ID, exact revision,
   1920-by-1080 dimensions, PNG SHA-256, warning codes, and human visual
   inspection result.
10. Compare damaged and repaired resolved definitions and require body,
    proportion, skeleton, and base module definitions to be deeply equal.
11. Verify no source paths or private/project data in scenes, reports, logs,
    screenshots, PNG metadata, acceptance artifacts, or tracked files.

### Release verification

Run the complete v0.6.0 release gate:

```text
pnpm verify
```

It must cover schema generation, type checking, the full test suite, lint,
production build, Skill validation, and public/generic audit. Add a focused
fresh-agent Skill application test for external blueprint import, deduplication,
variant selection, persistence, and export routing.

## Acceptance criteria

v0.6.0 is complete only when:

- external strict JSON can define and validate the required reusable actor;
- SceneSpec carries a versioned, hash-verified, path-free blueprint snapshot;
- blueprint IDs and content hashes are unique within one SceneSpec;
- same-content imports reuse a snapshot and conflicting content never silently
  overwrites one;
- the same snapshot can instantiate independently in two scenes;
- two actors in one SceneSpec can reference one stored snapshot while
  retaining independent legal slots and instance state;
- instances retain independent transform, pose, locks, color, and variant;
- module parts use only box, sphere, and cylinder and follow their posed mount
  frames;
- damaged/repaired variants share one exact body, proportion, skeleton, and
  module definition;
- legacy actors and old scenes load and render without user action or visual
  regression;
- save, reload, restart, undo, redo, contact, composition, and export preserve
  blueprint structure;
- browser rendering, bounds, contact, composition, and software diagnostics
  consume one resolved projection;
- the narrow Inspector summary and existing-variant selector work only through
  the authoritative Patch route;
- no snapshot deletion or automatic garbage collection occurs;
- the four required browser PNGs pass metadata checks and human visual
  inspection;
- documentation, v0.6.0 release notes, capabilities, generated schemas, Skill
  guidance, and public audit are current;
- no private identifiers, source paths, project data, arbitrary meshes, UI
  expansion beyond the specified summary/selector, IK, animation, physics,
  skinning, or general character-editor capability has been introduced.

After these criteria and the full release gate pass, work stops. No adjacent
feature is added in this release.

## Stable implementation checkpoints

1. Actor Blueprint schema, canonical hashing, Host-only import boundary, and
   identity conflict rules.
2. SceneSpec v5, legacy normalization, snapshot references, generated schemas,
   and capability negotiation.
3. Blueprint registration and variant Patch operations with atomic history,
   locks, intent coverage, and persistence.
4. Unified resolved actor projection with controlled proportions, skeleton
   frames, modules, bounds, contact, composition, browser rendering, and
   software diagnostics.
5. Generic two-scene/four-export acceptance, Skill and documentation updates,
   v0.6.0 release notes, full verification, and clean public audit.
