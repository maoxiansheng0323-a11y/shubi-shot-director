# Adjustable Actor Puppet Design

**Status:** Approved in conversation on 2026-07-31. The user delegated the
technical and interaction choices, asked for the recommended implementation to
proceed without further blocking questions, and will test the resulting
version after returning.

**Release:** Shubi Shot Director v0.7.0.

**Scope:** Turn every generic humanoid actor into a practical director's
mannequin with explicit stature, limb-presence, joint-pose, and simple-action
controls while preserving SceneSpec authority, minimal ScenePatch mutation,
Actor Blueprint immutability, lock provenance, deterministic projection, and
the graybox-only product boundary.

## Goal

Allow a non-specialist director to select an actor and quickly:

- set its standing stature in meters;
- decide whether each canonical arm and leg segment exists;
- rotate every supported humanoid joint with readable degree controls;
- apply a small set of reusable actions and then refine individual joints;
- undo, redo, save, reload, inspect, and export the result through the current
  authoritative scene workflow.

The three supplied mannequin images are capability references only. They
establish the need for visible segmented anatomy, wrist and ankle articulation,
and useful standing, leaning, and kneeling poses. The repository will not copy
their product appearance, branding, text, or proprietary geometry.

## Product boundary

This release includes:

- SceneSpec, ScenePatch, and IntentReport schema version 6;
- one actual-stature abstraction shared by legacy and Blueprint actors;
- Blueprint instance height scaling without changing the embedded Blueprint
  snapshot;
- Blueprint instance limb-presence overrides layered above the selected
  variant;
- direct allowlisted operations for stature and partial joint updates;
- direct limb-presence edits for both legacy and Blueprint actors;
- fifteen canonical adjustable humanoid joints;
- wrist and ankle rotation in the resolved actor projection;
- one unified Inspector puppet section for both actor branches;
- height number/range controls, grouped limb controls, action presets, a joint
  selector, three degree controls, and joint reset;
- action presets for neutral standing, kneeling, sitting, lying, leaning,
  reaching, walking step, and crouching;
- automatic ground-contact enforcement after stature, limb, joint, variant,
  and action changes;
- v1-v5 SceneSpec, ScenePatch, and IntentReport migration into canonical v6;
- Skill instructions, generated schemas, examples, capability contract,
  release notes, browser acceptance, and public audit updates.

This release does not include:

- inverse kinematics, viewport bone dragging, skeleton gizmos, keyframes,
  animation timelines, motion playback, physics, ragdolls, or retargeting;
- skinning, deforming meshes, fingers, toes, facial rigs, arbitrary bones, or
  arbitrary joint names;
- Blueprint geometry, module, proportion, skeleton, or variant authoring in
  the Inspector;
- final image generation, art prompting, production asset management, or any
  private project profile data.

## Considered approaches

### Selected: schema-backed director's mannequin

Add narrow actor-domain operations and a unified Inspector that edit only
canonical SceneSpec state. Legacy actors retain their body data. Blueprint
actors gain only instance-level height and limb overrides, so the reusable
snapshot and its content hash remain immutable. Both branches share pose data,
joint controls, action presets, contact enforcement, rendering, bounds,
composition, persistence, and export.

This approach gives the user the requested controls without introducing a
second scene authority or a general rigging engine.

### Rejected: transform-only quick controls

Using `entity.transform.scale` for stature and hiding limbs through geometry or
zero scale would avoid a schema change, but it would blur body height with
object scaling, bypass limb hierarchy semantics, make Blueprint instances and
legacy actors behave differently, and provide no trustworthy natural-language
or IntentReport contract.

### Deferred: DCC-style viewport rig and IK

Clickable joints, rotation gizmos, and IK targets would feel familiar to 3D
artists, but they add picking state, drag drafts, solver rules, joint limits,
stale-revision handling, and significant visual QA. They are a separate future
iteration after the Inspector-first controls prove which direct manipulations
are most useful.

## Canonical puppet joints

The v6 canonical humanoid rig exposes exactly these fifteen joint IDs:

```ts
type CanonicalPuppetJointId =
  | "pelvis"
  | "spine"
  | "neck"
  | "upper_arm_l"
  | "forearm_l"
  | "hand_l"
  | "upper_arm_r"
  | "forearm_r"
  | "hand_r"
  | "upper_leg_l"
  | "lower_leg_l"
  | "foot_l"
  | "upper_leg_r"
  | "lower_leg_r"
  | "foot_r";
```

`neck` rotates the head, `hand_l` and `hand_r` rotate at the wrists, and
`foot_l` and `foot_r` rotate at the ankles. Each stored value is a normalized
quaternion. The Inspector presents the same value as XYZ Euler degrees for
human editing and converts it back to a normalized quaternion before creating
a Patch.

Missing joint keys in migrated scenes continue to mean identity rotation. All
built-in action materialization writes the complete fifteen-key map so newly
accepted scenes are explicit.

## SceneSpec v6 actor state

Legacy actor shape remains structurally the same:

```ts
interface LegacyActorV6 {
  rig: PresetRef;
  body: {
    heightM: number;
    shoulderWidthM: number;
    build: "slim" | "average" | "broad";
    limbPresence: ActorLimbPresence;
  };
  pose: PoseSpec;
}
```

Blueprint actors extend only their path-free instance reference:

```ts
interface BlueprintActorInstanceV6 {
  blueprintId: string;
  variantId: string;
  heightScale: number;
  limbPresenceOverrides: Partial<ActorLimbPresence>;
}
```

`heightScale` is finite, positive, and constrained so the resolved stature is
within 1.0-2.4 meters. New and migrated Blueprint instances default to `1`.
The resolved stature is:

```text
snapshot.body.heightM * blueprintInstance.heightScale
```

`limbPresenceOverrides` is strict and contains only the twelve canonical limb
keys. New and migrated instances default to `{}`.

## Stature operation

The allowlisted operation is:

```ts
{
  op: "actor.height.set";
  actorId: string;
  heightM: number;
}
```

It accepts 1.0-2.4 meters and targets any actor.

For a legacy actor it sets `body.heightM` and scales `body.shoulderWidthM` by
the same ratio, clamped to the existing 0.25-0.8 meter schema range. For a
Blueprint actor it sets `blueprintInstance.heightScale` relative to the
immutable snapshot base height. It never changes `entity.transform.scale`.

If `pose.preset.parameters.contactOffsetM` is numeric, the operation scales it
by the same stature ratio as compatibility metadata. Authoritative contact
placement still comes from the resolved visible actor bounds. The operation is
contact-affecting, so enabled ground contact is enforced in the same atomic
revision.

## Limb-presence operation for both actor branches

The existing `actor.limb-presence.set` shape remains unchanged and becomes
valid for any actor.

Legacy actors continue to update the complete `body.limbPresence` map through
the existing hierarchy resolver.

Blueprint actors resolve limb state in this order:

1. start from the snapshot base map;
2. apply the selected variant delta;
3. apply `blueprintInstance.limbPresenceOverrides` through the same hierarchy
   resolver used by legacy actors.

When applying a Blueprint limb operation, the runtime computes the requested
complete effective state, then stores the minimal difference between that
state and the selected variant's effective base. Explicitly restoring a child
also restores required ancestors; hiding a parent closes descendants. Manual
instance overrides remain in force when the selected variant changes.

The snapshot, hash, modules, variants, and external import contract are never
mutated.

## Partial joint operation

The new allowlisted operation is:

```ts
{
  op: "actor.pose.joints.set";
  actorId: string;
  updates: Partial<Record<CanonicalPuppetJointId, QuaternionTuple>>;
}
```

The update object is strict, contains one to fifteen entries, accepts only the
canonical IDs, and requires already normalized quaternions. It targets either
actor branch and merges only the supplied joints.

After a direct joint edit, the actor pose preset reference becomes
`pose.custom-v1`. Existing preset parameters are retained so old consumers do
not lose compatibility metadata. Applying a built-in action later replaces
the complete pose and returns the preset ID to that action.

The operation is contact-affecting and maps to the existing `pose` intent
constraint. One Inspector commit creates one operation, one scene revision,
and one undo entry.

## Resolved projection

The single resolved actor projection remains the only geometry source.

For Blueprint actors, all anatomy dimensions, mount positions, module local
positions, module dimensions, radii, and lengths are multiplied by the
instance `heightScale`. Entity transform scale remains an independent outer
transform.

The hand and foot primitives gain their own terminal frames. Wrist and ankle
joint rotations apply at those frames before hand/foot offsets and geometry
are evaluated. Rendering, visible bounds, support offset, contact,
composition, software diagnostics, and export therefore see the same result.

## Inspector interaction design

Both actor branches render one unified `ActorPuppetControls` flow beneath the
ordinary transform editor.

### Stature

- numeric field and range input, 1.0-2.4 meters;
- displayed value is the resolved actor stature, not raw transform scale;
- number commit, keyboard step completion, or pointer release submits one
  `actor.height.set` Patch;
- Escape restores the accepted SceneSpec value.

### Limb presence

- four groups: left arm, right arm, left leg, right leg;
- three canonical segments per group;
- Chinese labels with `存在` and `缺失` values;
- absent ancestors disable descendants until an accepted revision restores
  the chain;
- the same UI is available for legacy and Blueprint actors.

### Actions and contact

- action selector is available for both actor branches;
- v0.7 includes neutral standing, kneeling lean, seated, lying supine,
  leaning forward, right-arm reach, walking step, and crouch;
- ground-contact and relationship controls continue to use the accepted scene;
- Blueprint action materialization uses resolved stature.

### Joint editor

- one grouped joint selector prevents a 45-field wall;
- selection groups are torso, left arm, right arm, left leg, and right leg;
- three degree inputs/ranges are labelled X bend, Y twist, and Z side bend;
- numeric values are constrained to -180 through 180 degrees;
- pointer release, keyboard commit, or number-field Enter submits one partial
  joint Patch;
- a reset button writes identity rotation for only the selected joint;
- joint selection and unfinished slider drafts are UI state and are never
  persisted in SceneSpec.

The existing read-only Blueprint summary and variant selector remain visible
as a separate advanced section. They do not become Blueprint authoring tools.

## IntentReport v6

Add one recognized constraint kind: `actor-height`.

Create evidence accepts `entity.body.heightM` for legacy actors and
`actor.blueprintInstance.heightScale` for Blueprint actors. Modify evidence
maps `actor.height.set` to `actor-height` for the targeted actor.

`actor.pose.joints.set` maps to `pose`. `actor.limb-presence.set` continues to
map to `actor-limb-presence`, now for both actor branches. Existing `scale`
continues to mean entity transform scale and is not used as a substitute for
stature.

## Schema compatibility and migration

Canonical scene, patch, and IntentReport versions become 6.

- SceneSpec v5 Blueprint actors receive `heightScale: 1` and
  `limbPresenceOverrides: {}` during migration.
- SceneSpec v1-v4 first follow their existing migration path and then receive
  the v6 canonical shape.
- ScenePatch v5 `entity.add` operations add the two Blueprint instance defaults
  when needed.
- ScenePatch v1-v5 `actor.pose.set` complete-action operations normalize to the
  canonical fifteen-joint map: missing joints receive identity quaternions and
  unknown joint keys are discarded. Other v5 operations retain their existing
  semantics.
- IntentReport v5 migrates without semantic changes.
- Direct structured v1-v5 inputs remain accepted; new v6 fields and operations
  are emitted after canonical parsing.
- Saved canonical scenes use only v6 after this release.

## Lock and concurrency behavior

The new actor operations use the existing lock rules without exceptions.

- `none`: editable in the Inspector;
- `workflow`: Host-authored natural-language corrections use
  `preserveLock: true`; ordinary manual Inspector controls remain disabled;
- `user`: stop and request explicit confirmation before a protected change;
- stale revisions discard the old Patch and require a fresh snapshot and
  re-authored absolute values.

No direct-edit draft is stored in the scene, history, runtime files, or
screenshots.

## Error behavior

Use generic deterministic codes:

- `ACTOR_HEIGHT_TARGET_INVALID` when the target is not an actor or a Blueprint
  reference cannot resolve;
- `ACTOR_HEIGHT_RANGE_INVALID` when stature is outside 1.0-2.4 meters;
- `ACTOR_JOINT_TARGET_INVALID` when the target is not an actor;
- `ACTOR_JOINT_ID_INVALID` for unsupported joint keys;
- existing `ACTOR_LIMB_TARGET_INVALID`, `LIMB_HIERARCHY_CONFLICT`, Blueprint
  reference codes, lock codes, and contact codes retain their precedence.

Patch application remains atomic. A failure creates no revision, history
entry, partial override, or contact movement.

## Testing and acceptance

Implementation follows strict red-green-refactor cycles.

Focused automated coverage must prove:

- v5-to-v6 migration for scenes, entity-add patches, and IntentReports;
- strict v6 schema rejection for invalid height scales, overrides, joint IDs,
  ranges, and quaternions;
- stature operations for legacy and Blueprint actors;
- Blueprint module and limb projection scaling;
- Blueprint limb override precedence and hierarchy normalization;
- wrist and ankle rotations in the resolved projection;
- direct joint operation merge, custom-pose marker, contact enforcement,
  lock behavior, atomic failure, undo, redo, save, and reload;
- all eight action presets materialize normalized complete joint maps for both
  actor branches;
- unified Inspector controls emit the intended minimal Patches and never keep
  accepted actor state in component-local React state;
- IntentReport v6 coverage and operation mapping;
- generated schema, CLI capability, public audit, and Skill validation.

Final acceptance requires fresh:

```text
pnpm verify
```

Real-browser acceptance must use the current opaque workspace and prove, on a
generic scene, that the user can:

1. change the starter actor from 1.72 m to another valid stature;
2. hide a limb parent and observe descendant closure;
3. restore the limb chain;
4. apply kneeling and reaching actions;
5. rotate at least one shoulder, elbow, wrist, hip, knee, ankle, spine, neck,
   and pelvis joint through the Inspector;
6. undo and redo accepted changes;
7. save, reload, inspect Overview and Shot Preview, run composition inspection,
   and export a browser-rendered PNG at the exact accepted revision.

A second generic Blueprint actor acceptance must prove independent instance
height, limb overrides, variant selection, joint posing, save/reload, and
projection consistency without changing its embedded snapshot hash.

Visual acceptance is limited to functional graybox evidence: articulated
segments move at the intended joints, hidden segments are absent, contact is
stable, and the final camera shows the requested pose. Final aesthetic quality
remains a human decision.
