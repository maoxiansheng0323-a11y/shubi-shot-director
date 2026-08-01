# Adjustable Actor Puppet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Shubi Shot Director v0.7.0 with authoritative actor stature, cross-branch limb presence, fifteen directly adjustable joints, and simple reusable actions.

**Architecture:** Add schema-v6 actor instance fields and allowlisted actor-domain Patch operations, then consume them through the existing resolved actor projection and authoritative editor Patch route. Legacy and Blueprint actors share one Inspector experience while Blueprint snapshots remain immutable and every geometry consumer continues to use the same resolved projection.

**Tech Stack:** TypeScript 6, Zod 4, React 19, Zustand, Three.js / React Three Fiber, Vitest, Express bridge, generated JSON Schema, pnpm.

---

## File structure

Create:

- `src/domain/actor-joints.ts` — canonical fifteen-joint IDs, grouping, strict update schema helpers, and custom-pose ID.
- `src/domain/actor-stature.ts` — resolved actor stature and Blueprint snapshot lookup helpers without rendering dependencies.
- `src/editor/ActorStatureControls.tsx` — authoritative height number/range editor.
- `src/editor/ActorJointControls.tsx` — selected-joint XYZ degree editor and reset control.
- `tests/actor-puppet-schema.test.ts` — v6 actor, operation, and migration contract.
- `tests/actor-puppet-patch.test.ts` — height, limb override, joint, lock, contact, undo, and atomic behavior.
- `tests/actor-puppet-projection.test.ts` — Blueprint scale, wrist, ankle, and shared-projection behavior.
- `tests/actor-puppet-controls.test.ts` — unified Inspector markup and Patch dispatch behavior.
- `tests/actor-puppet-black-box.test.ts` — CLI/bridge save-load and capability acceptance.
- `docs/releases/v0.7.0.md` — public generic release notes and verification evidence.

Modify:

- `src/domain/schema-versions.ts`, `src/domain/scene-schema.ts`, `src/domain/scene-patch.ts`, `src/domain/intent-report.ts`, and `src/domain/scene-migrations.ts` — canonical v6 contract and migration.
- `src/domain/actor-anatomy.ts`, `src/domain/actor-blueprint.ts`, `src/domain/actor-projection.ts`, and `src/domain/actor-visible-bounds.ts` — shared limb overrides, scale, wrist/ankle projection, and bounds.
- `src/domain/apply-scene-patch.ts`, `src/domain/intent-coverage.ts`, and `src/domain/contact-constraints.ts` — operation application, evidence mapping, locks, and contact enforcement.
- `src/domain/presets/pose-presets.ts`, `src/domain/presets/relationship-presets.ts`, and `src/domain/presets/index.ts` — complete fifteen-joint actions for either actor branch.
- `src/editor/ActorLimbControls.tsx`, `src/editor/ActorPresetControls.tsx`, `src/editor/ActorBlueprintControls.tsx`, `src/editor/Inspector.tsx`, `src/editor/manual-patches.ts`, and `src/App.tsx` — unified authoritative actor controls.
- `src/styles.css` — compact puppet control layout.
- `cli/runtime-capabilities.ts`, `cli/director-runtime.ts`, `README.md`, `docs/verification.md`, `docs/public-release.md`, `package.json`, the named generic examples, the five generated schemas, and the named Shubi Shot Director Skill references in Task 7 — public v0.7 contract and Skill instructions.
- Existing actor, migration, schema, projection, preset, lock, persistence, bridge, CLI, and public-audit tests — v6 expectations and regression coverage.

## Task 1: Define the v6 puppet schema and migrations

**Files:**

- Create: `src/domain/actor-joints.ts`
- Create: `src/domain/actor-stature.ts`
- Modify: `src/domain/actor-anatomy.ts`
- Modify: `src/domain/schema-versions.ts`
- Modify: `src/domain/scene-schema.ts`
- Modify: `src/domain/scene-patch.ts`
- Modify: `src/domain/intent-report.ts`
- Modify: `src/domain/scene-migrations.ts`
- Test: `tests/actor-puppet-schema.test.ts`
- Test: `tests/lock-schema-migrations.test.ts`
- Test: `tests/actor-limb-schema-migrations.test.ts`

- [ ] **Step 1: Write failing v6 schema tests**

Add tests that require:

```ts
expect(SCENE_SCHEMA_VERSION).toBe(6);
expect(PATCH_SCHEMA_VERSION).toBe(6);
expect(INTENT_REPORT_SCHEMA_VERSION).toBe(6);
expect(canonicalPuppetJointIds).toEqual([
  "pelvis", "spine", "neck",
  "upper_arm_l", "forearm_l", "hand_l",
  "upper_arm_r", "forearm_r", "hand_r",
  "upper_leg_l", "lower_leg_l", "foot_l",
  "upper_leg_r", "lower_leg_r", "foot_r",
]);
```

Require a Blueprint actor to contain:

```ts
blueprintInstance: {
  blueprintId: "actor_blueprint_1",
  variantId: "default",
  heightScale: 1,
  limbPresenceOverrides: {},
}
```

Require strict rejection of unknown override keys, non-positive scale, resolved
stature outside 1.0-2.4 m, empty joint updates, unknown joint IDs, and
non-normalized joint quaternions. Require v5 scenes and v5 `entity.add` patches
to migrate to the two Blueprint defaults.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```text
pnpm test -- tests/actor-puppet-schema.test.ts tests/lock-schema-migrations.test.ts tests/actor-limb-schema-migrations.test.ts
```

Expected: FAIL because v6 constants, fields, operations, and migrations do not
exist.

- [ ] **Step 3: Add canonical joint and override primitives**

Create `src/domain/actor-joints.ts` with:

```ts
import { z } from "zod";

export const canonicalPuppetJointIds = [
  "pelvis", "spine", "neck",
  "upper_arm_l", "forearm_l", "hand_l",
  "upper_arm_r", "forearm_r", "hand_r",
  "upper_leg_l", "lower_leg_l", "foot_l",
  "upper_leg_r", "lower_leg_r", "foot_r",
] as const;

export const canonicalPuppetJointIdSchema = z.enum(
  canonicalPuppetJointIds,
);
export type CanonicalPuppetJointId =
  (typeof canonicalPuppetJointIds)[number];
export const CUSTOM_POSE_PRESET_ID = "pose.custom-v1" as const;
```

Export the existing strict partial limb schema from `actor-anatomy.ts` as
`actorLimbPresenceUpdatesSchema` so both ScenePatch and Blueprint instance
overrides use exactly one key allowlist.

- [ ] **Step 4: Add actor stature helpers**

Create `src/domain/actor-stature.ts` with the public interface:

```ts
export const MIN_ACTOR_HEIGHT_M = 1;
export const MAX_ACTOR_HEIGHT_M = 2.4;

export const requireActorBlueprintSnapshot = (
  scene: Pick<SceneSpec, "actorBlueprints">,
  actor: BlueprintActorEntity,
): ActorBlueprintSnapshot => {
  const snapshot = scene.actorBlueprints.find(
    ({ blueprintId }) =>
      blueprintId === actor.blueprintInstance.blueprintId,
  );
  if (!snapshot) {
    throw new Error("ACTOR_BLUEPRINT_REFERENCE_INVALID");
  }
  return snapshot;
};

export const actorStatureHeightM = (
  scene: Pick<SceneSpec, "actorBlueprints">,
  actor: AnyActorEntity,
): number => isLegacyActorEntity(actor)
  ? actor.body.heightM
  : requireActorBlueprintSnapshot(scene, actor).body.heightM *
    actor.blueprintInstance.heightScale;
```

The helper throws only `ACTOR_BLUEPRINT_REFERENCE_INVALID` for a missing
snapshot and has no dependency on actor projection.

- [ ] **Step 5: Bump schemas and add new operation shapes**

Set scene and Patch constants to 6. Add `heightScale` and
`limbPresenceOverrides` to Blueprint instances and validate resolved height in
the SceneSpec cross-record refinement.

Add these strict operations:

```ts
{
  op: z.literal("actor.height.set"),
  actorId: entityIdSchema,
  heightM: positiveFiniteNumberSchema.min(1).max(2.4),
}
```

```ts
{
  op: z.literal("actor.pose.joints.set"),
  actorId: entityIdSchema,
  updates: z.partialRecord(
    canonicalPuppetJointIdSchema,
    quaternionSchema,
  ).refine((value) => Object.keys(value).length > 0),
}
```

Add `actor-height` to IntentReport v6 and the Blueprint instance height-scale
entity evidence path.

- [ ] **Step 6: Implement v5-to-v6 migration**

Add strict v5 envelopes. Migrate every v5 Blueprint actor with:

```ts
blueprintInstance: {
  ...entity.blueprintInstance,
  heightScale: 1,
  limbPresenceOverrides: {},
}
```

Apply the same conversion to v5 `entity.add` Patch values. Migrate v5
IntentReports by changing only `schemaVersion` to 6. Preserve existing v1-v4
migration order and error precedence.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass with no warnings.

- [ ] **Step 8: Commit Task 1**

```text
git add src/domain/actor-joints.ts src/domain/actor-stature.ts src/domain/actor-anatomy.ts src/domain/schema-versions.ts src/domain/scene-schema.ts src/domain/scene-patch.ts src/domain/intent-report.ts src/domain/scene-migrations.ts tests/actor-puppet-schema.test.ts tests/lock-schema-migrations.test.ts tests/actor-limb-schema-migrations.test.ts
git commit -m "feat: define actor puppet v6 schema"
```

## Task 2: Apply authoritative stature and cross-branch limb operations

**Files:**

- Modify: `src/domain/actor-blueprint.ts`
- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/contact-constraints.ts`
- Modify: `src/domain/intent-coverage.ts`
- Test: `tests/actor-puppet-patch.test.ts`
- Test: `tests/actor-blueprint-patch.test.ts`
- Test: `tests/actor-limb-presence.test.ts`
- Test: `tests/atomic-patch.test.ts`
- Test: `tests/lock-preservation.test.ts`

- [ ] **Step 1: Write failing height and Blueprint limb tests**

Cover:

```ts
const next = applyScenePatch(scene, {
  schemaVersion: 6,
  patchId: "patch_actor_height_1",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "manual",
  preserveLock: false,
  operations: [{
    op: "actor.height.set",
    actorId: actor.id,
    heightM: 1.55,
  }],
}).next;
```

Assert legacy height and proportional shoulder width, Blueprint heightScale,
unchanged `transform.scale`, contact-owned Y adjustment only, lock rejection,
and atomic rollback. Apply `actor.limb-presence.set` to a Blueprint actor and
assert minimal instance overrides, ancestor restoration, descendant closure,
variant switching with manual overrides retained, and unchanged snapshot hash.

- [ ] **Step 2: Run focused tests and verify RED**

```text
pnpm test -- tests/actor-puppet-patch.test.ts tests/actor-blueprint-patch.test.ts tests/actor-limb-presence.test.ts tests/atomic-patch.test.ts tests/lock-preservation.test.ts
```

Expected: FAIL on unhandled operations and legacy-only limb targeting.

- [ ] **Step 3: Resolve Blueprint variant plus instance overrides**

Extend `actor-blueprint.ts` with:

```ts
export const resolveActorBlueprintInstance = (
  snapshot: ActorBlueprintSnapshot,
  variantId: string,
  overrides: ActorLimbPresenceUpdates,
): ResolvedActorBlueprintVariant => {
  const variant = resolveActorBlueprintVariant(snapshot, variantId);
  return {
    ...variant,
    limbPresence: resolveActorLimbPresenceUpdates(
      variant.limbPresence,
      overrides,
    ),
  };
};
```

Add a helper that computes the minimal override delta by comparing the desired
complete state to the selected variant's effective state.

- [ ] **Step 4: Apply `actor.height.set`**

In `apply-scene-patch.ts`, require a mutable actor. For legacy actors, scale
height and shoulder width. For Blueprint actors, set `heightScale` from the
snapshot base. Scale numeric `contactOffsetM` compatibility metadata by the
same ratio. Emit the designed height error codes and mark the operation as
contact-affecting.

- [ ] **Step 5: Generalize `actor.limb-presence.set`**

Keep the legacy branch unchanged. For Blueprint actors, resolve the selected
variant base, apply the requested hierarchy update to the current effective
state, store the minimal delta, and preserve the embedded snapshot and variant.
Reject non-actors and missing Blueprint references atomically.

- [ ] **Step 6: Map intent coverage**

Map `actor.height.set` to `actor-height` and retain
`actor.limb-presence.set` as primary `actor-limb-presence` evidence for either
actor branch. Update target validation so `actor-height` accepts actors only.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 8: Commit Task 2**

```text
git add src/domain/actor-blueprint.ts src/domain/apply-scene-patch.ts src/domain/contact-constraints.ts src/domain/intent-coverage.ts tests/actor-puppet-patch.test.ts tests/actor-blueprint-patch.test.ts tests/actor-limb-presence.test.ts tests/atomic-patch.test.ts tests/lock-preservation.test.ts
git commit -m "feat: edit actor stature and limb overrides"
```

## Task 3: Add direct joint updates and articulated wrist/ankle projection

**Files:**

- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/actor-anatomy.ts`
- Modify: `src/domain/actor-projection.ts`
- Modify: `src/domain/actor-visible-bounds.ts`
- Modify: `server/software-png.ts`
- Test: `tests/actor-puppet-patch.test.ts`
- Test: `tests/actor-puppet-projection.test.ts`
- Test: `tests/actor-rig-projection.test.ts`
- Test: `tests/actor-visible-bounds.test.ts`
- Test: `tests/software-png-spatial.test.ts`

- [ ] **Step 1: Write failing direct-joint and projection tests**

Assert a one-joint update preserves all other joints, sets
`pose.custom-v1`, enforces contact, and supports legacy and Blueprint actors.
Assert wrist rotation moves the hand primitive but not the forearm endpoint;
ankle rotation moves the foot primitive but not the lower-leg endpoint. Assert
the browser renderer, visible bounds, and software diagnostics all consume the
same projection.

- [ ] **Step 2: Run focused tests and verify RED**

```text
pnpm test -- tests/actor-puppet-patch.test.ts tests/actor-puppet-projection.test.ts tests/actor-rig-projection.test.ts tests/actor-visible-bounds.test.ts tests/software-png-spatial.test.ts
```

Expected: FAIL because partial joint application and terminal joint frames are
missing.

- [ ] **Step 3: Apply `actor.pose.joints.set`**

Merge validated updates into `entity.pose.joints`, then replace only the
preset ID:

```ts
entity.pose = {
  preset: {
    ...entity.pose.preset,
    id: CUSTOM_POSE_PRESET_ID,
  },
  joints: {
    ...entity.pose.joints,
    ...operation.updates,
  },
};
```

Require a mutable actor, mark the operation contact-affecting, and map it to
`pose` intent coverage.

- [ ] **Step 4: Scale Blueprint projection by instance height**

Resolve base anatomy once, multiply every length-like anatomy field by
`heightScale`, and multiply Blueprint module positions and primitive dimensions
by the same factor. Do not multiply entity transform scale or snapshot data.

- [ ] **Step 5: Add wrist and ankle frames**

In `computeFrames`, create terminal rotation frames from `hand_l`, `hand_r`,
`foot_l`, and `foot_r`. Use those frames for hand/foot primitives and wrist
module mounts. Keep elbow and knee semantics unchanged.

- [ ] **Step 6: Keep all consumers on the resolved projection**

Remove any software diagnostic fallback that re-derives joints independently.
The server renderer, WebGL renderer, visible bounds, contacts, and composition
must receive only `resolveActorProjection` output.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 8: Commit Task 3**

```text
git add src/domain/apply-scene-patch.ts src/domain/actor-anatomy.ts src/domain/actor-projection.ts src/domain/actor-visible-bounds.ts server/software-png.ts tests/actor-puppet-patch.test.ts tests/actor-puppet-projection.test.ts tests/actor-rig-projection.test.ts tests/actor-visible-bounds.test.ts tests/software-png-spatial.test.ts
git commit -m "feat: articulate actor puppet joints"
```

## Task 4: Expand action presets for both actor branches

**Files:**

- Modify: `src/domain/presets/pose-presets.ts`
- Modify: `src/domain/presets/relationship-presets.ts`
- Modify: `src/domain/presets/index.ts`
- Modify: `src/App.tsx`
- Test: `tests/pose-presets.test.ts`
- Test: `tests/relationship-presets.test.ts`
- Test: `tests/actor-blueprint-scene.test.ts`

- [ ] **Step 1: Write failing complete-action tests**

Require eight preset IDs and complete fifteen-key normalized joint maps for a
legacy actor and a Blueprint actor. Require `right-arm reach`, `walking step`,
and `crouch` to produce visibly distinct shoulder/elbow/wrist or hip/knee/ankle
rotations. Require relationship materialization to accept either actor branch.

- [ ] **Step 2: Run focused tests and verify RED**

```text
pnpm test -- tests/pose-presets.test.ts tests/relationship-presets.test.ts tests/actor-blueprint-scene.test.ts
```

Expected: FAIL because only eleven joints and five actions are available and
App rejects Blueprint action application.

- [ ] **Step 3: Move preset joint IDs to the canonical list**

Import `canonicalPuppetJointIds` and materialize identity values for all
fifteen joints. Define the three new actions with explicit degree maps and keep
the existing five IDs stable.

- [ ] **Step 4: Materialize actions from resolved stature**

Change the public API to accept `scene` and any actor, or pass
`actorStatureHeightM(scene, actor)` explicitly. App must find any actor, require
`lockMode: "none"`, and submit one `actor.pose.set` Patch.

- [ ] **Step 5: Generalize relationship actor typing**

Replace legacy `ActorEntity` narrowing with `AnyActorEntity` in relationship
presets and controls. Preserve the existing atomic multi-operation behavior.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 4**

```text
git add src/domain/presets/pose-presets.ts src/domain/presets/relationship-presets.ts src/domain/presets/index.ts src/App.tsx tests/pose-presets.test.ts tests/relationship-presets.test.ts tests/actor-blueprint-scene.test.ts
git commit -m "feat: expand actor puppet actions"
```

## Task 5: Build unified authoritative Inspector controls

**Files:**

- Create: `src/editor/ActorStatureControls.tsx`
- Create: `src/editor/ActorJointControls.tsx`
- Modify: `src/editor/ActorLimbControls.tsx`
- Modify: `src/editor/ActorPresetControls.tsx`
- Modify: `src/editor/ActorBlueprintControls.tsx`
- Modify: `src/editor/Inspector.tsx`
- Modify: `src/editor/manual-patches.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `tests/actor-puppet-controls.test.ts`
- Test: `tests/actor-limb-controls.test.ts`
- Test: `tests/actor-blueprint-controls.test.ts`
- Test: `tests/manual-patches.test.ts`
- Test: `tests/lock-ui-semantics.test.ts`

- [ ] **Step 1: Write failing Inspector and manual Patch tests**

Require these helpers:

```ts
createActorHeightPatch(scene, actorId, heightM)
createActorJointPatch(scene, actorId, jointId, rotation)
```

Require any selected actor to render stature, twelve limb controls, eight
actions, and fifteen selectable joints. Require exactly three joint-axis
degree controls and one reset button for the current joint. Require Blueprint
metadata and variant selection to remain present. Require all actor editing
controls disabled for global disabled, workflow lock, user lock, or missing
callback.

- [ ] **Step 2: Run focused tests and verify RED**

```text
pnpm test -- tests/actor-puppet-controls.test.ts tests/actor-limb-controls.test.ts tests/actor-blueprint-controls.test.ts tests/manual-patches.test.ts tests/lock-ui-semantics.test.ts
```

Expected: FAIL because unified controls and Patch helpers do not exist.

- [ ] **Step 3: Implement authoritative height controls**

Render a number input and range input from accepted `actorStatureHeightM`.
Local state may contain only an unfinished draft. Number Enter/blur, slider
pointer release, and slider keyboard completion call `onSetHeight(actor.id,
value)` once. Escape restores the accepted value.

- [ ] **Step 4: Generalize limb and action controls**

Accept `AnyActorEntity`. Resolve Blueprint effective limb presence from the
scene before rendering the twelve controls. Use Chinese `存在` and `缺失`
option labels. Keep hierarchy disable explanations. Make action, contact, and
relationship controls accept either actor branch.

- [ ] **Step 5: Implement joint controls**

Use a grouped native select for the fifteen IDs. Convert the selected accepted
quaternion to XYZ degrees. Render three number/range controls with -180 to 180
limits. Commit with:

```ts
onSetJointRotation?.(
  actor.id,
  selectedJointId,
  quaternionFromEulerDegrees(nextDegrees),
);
```

Reset submits `[0, 0, 0, 1]`. Keep selected joint and unfinished degrees as UI
state only; synchronize accepted values after every scene revision.

- [ ] **Step 6: Wire App through manual Patches**

Add callbacks that read the current store scene, reject stale/missing/locked
targets, submit one minimal Patch, and rely on the accepted scene for UI
updates. Pass them through `Inspector` for both actor branches.

- [ ] **Step 7: Add compact styles**

Use the existing Inspector visual language. Keep one-column labels at narrow
widths, three equal axis columns, visible focus states, and no horizontal
scrolling at 800 x 900.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run the Step 2 command and `pnpm typecheck`. Expected: all pass.

- [ ] **Step 9: Commit Task 5**

```text
git add src/editor/ActorStatureControls.tsx src/editor/ActorJointControls.tsx src/editor/ActorLimbControls.tsx src/editor/ActorPresetControls.tsx src/editor/ActorBlueprintControls.tsx src/editor/Inspector.tsx src/editor/manual-patches.ts src/App.tsx src/styles.css tests/actor-puppet-controls.test.ts tests/actor-limb-controls.test.ts tests/actor-blueprint-controls.test.ts tests/manual-patches.test.ts tests/lock-ui-semantics.test.ts
git commit -m "feat: add actor puppet inspector controls"
```

## Task 6: Verify persistence, history, CLI, and structured submissions

**Files:**

- Create: `tests/actor-puppet-black-box.test.ts`
- Modify: `tests/scene-persistence.test.ts`
- Modify: `tests/scene-session.test.ts`
- Modify: `tests/structured-runtime-e2e.test.ts`
- Modify: `tests/structured-submission.test.ts`
- Modify: `tests/intent-report.test.ts`
- Modify: `tests/helpers/actor-blueprint-fixtures.ts`
- Modify: `tests/helpers/structured-fixtures.ts`
- Modify: examples under `examples/`

- [ ] **Step 1: Write failing integration tests**

Create one generic legacy scene and one generic Blueprint scene. Apply height,
limb, action, and joint operations; assert revision increments exactly once per
Patch, undo/redo exact equality, save/load exact canonical v6 state, Blueprint
hash stability, and structured submit evidence coverage.

- [ ] **Step 2: Run focused tests and verify RED**

```text
pnpm test -- tests/actor-puppet-black-box.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/structured-runtime-e2e.test.ts tests/structured-submission.test.ts tests/intent-report.test.ts
```

Expected: FAIL on v5 fixtures, capability omissions, or incomplete v6 evidence
mapping.

- [ ] **Step 3: Update fixtures and examples**

Convert canonical fixtures to schema 6, add Blueprint instance defaults, and
write complete fifteen-key pose maps where the fixture claims an explicit
action. Keep legacy-version fixtures unchanged when they intentionally test
migration.

- [ ] **Step 4: Complete persistence and submission wiring**

Ensure serialization emits v6, parse paths migrate v1-v5, history stores
canonical v6 revisions, and structured coverage recognizes the two new
operations and `actor-height` constraint.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 6**

```text
git add tests/actor-puppet-black-box.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/structured-runtime-e2e.test.ts tests/structured-submission.test.ts tests/intent-report.test.ts tests/helpers/actor-blueprint-fixtures.ts tests/helpers/structured-fixtures.ts examples
git commit -m "test: verify actor puppet persistence"
```

## Task 7: Update the Skill, capabilities, schemas, and public release contract

**Files:**

- Modify: `cli/runtime-capabilities.ts`
- Modify: `cli/director-runtime.ts`
- Modify: `scripts/generate-schemas.ts`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/intent-report.md`
- Modify: `.agents/skills/shubi-shot-director/references/actor-blueprints.md`
- Modify: `.agents/skills/shubi-shot-director/references/visual-qa.md`
- Modify: `.agents/skills/shubi-shot-director/references/generated/intent-report.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/patch-submission.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/scene-patch.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/scene-spec.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/scene-submission.schema.json`
- Modify: `README.md`
- Modify: `docs/public-release.md`
- Modify: `docs/verification.md`
- Create: `docs/releases/v0.7.0.md`
- Modify: `package.json`
- Test: `tests/runtime-capabilities.test.ts`
- Test: `tests/bridge-compatibility-cli.test.ts`
- Test: `tests/skill-compatibility.test.ts`
- Test: `tests/public-release-audit.test.ts`

- [ ] **Step 1: Write failing public-contract tests**

Require application version `0.7.0`, scene/Patch/Intent version 6, features
`actor.height`, `actor.pose-joints`, `actor.blueprint-instance-limb-overrides`,
the fifteen joint IDs, height limits, and the new operation/error codes. Require
generated schemas and Skill text to contain the same contract and no private
data.

- [ ] **Step 2: Run focused tests and verify RED**

```text
pnpm test -- tests/runtime-capabilities.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/public-release-audit.test.ts
```

Expected: FAIL on v0.6/v5 capability output and missing Skill guidance.

- [ ] **Step 3: Update capability output and CLI validation**

Expose only deterministic public metadata. Do not add prompts, profile paths,
credentials, model configuration, or non-loopback routes.

- [ ] **Step 4: Regenerate JSON Schemas**

Run:

```text
pnpm schemas:generate
```

Expected: generated SceneSpec, ScenePatch, IntentReport, and submission schemas
contain v6 fields and operations.

- [ ] **Step 5: Update Skill authoring rules**

Document:

- create-time stature and complete pose evidence;
- `actor.height.set` for height corrections;
- `actor.pose.joints.set` for minimal joint corrections;
- `actor.limb-presence.set` for either actor branch;
- Blueprint manual overrides layered above variants;
- exact snapshot/baseRevision, lock, contact, visual QA, and recovery behavior;
- generic IDs only and no external profile leakage.

- [ ] **Step 6: Update versioned documentation**

Set package version to `0.7.0`, add concise release notes, update README and
verification gates, and keep all examples generic.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 8: Commit Task 7**

```text
git add cli/runtime-capabilities.ts cli/director-runtime.ts scripts/generate-schemas.ts .agents/skills/shubi-shot-director/SKILL.md .agents/skills/shubi-shot-director/references/scene-authoring.md .agents/skills/shubi-shot-director/references/patch-authoring.md .agents/skills/shubi-shot-director/references/intent-report.md .agents/skills/shubi-shot-director/references/actor-blueprints.md .agents/skills/shubi-shot-director/references/visual-qa.md .agents/skills/shubi-shot-director/references/generated/intent-report.schema.json .agents/skills/shubi-shot-director/references/generated/patch-submission.schema.json .agents/skills/shubi-shot-director/references/generated/scene-patch.schema.json .agents/skills/shubi-shot-director/references/generated/scene-spec.schema.json .agents/skills/shubi-shot-director/references/generated/scene-submission.schema.json README.md docs/public-release.md docs/verification.md docs/releases/v0.7.0.md package.json tests/runtime-capabilities.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/public-release-audit.test.ts
git commit -m "docs: publish actor puppet v0.7 contract"
```

## Task 8: Full verification and real-browser acceptance

**Files:**

- Modify as needed only when a failing verification has a proven in-scope root cause.
- Add generic ignored submissions/exports only under `.shubi-shot/` during acceptance.

- [ ] **Step 1: Run the complete release gate**

```text
pnpm verify
```

Expected: schema generation, typecheck, all Vitest files, lint, build, and
public audit exit 0 with no warnings requiring action.

- [ ] **Step 2: Restart the current Director workspace on v0.7**

From `.agents/skills/shubi-shot-director`:

```text
node scripts/director.mjs stop
node scripts/director.mjs doctor
node scripts/director.mjs workspace current
node scripts/director.mjs ensure
node scripts/director.mjs health
```

Expected: capability contract v2, workspace routing v1, application 0.7.0,
scene/Patch/Intent version 6, structured-only input, no model integration,
forbidden credentials, loopback-only networking, and ready status.

- [ ] **Step 3: Perform legacy actor browser acceptance**

Use the in-app browser at the returned loopback URL. Select the generic actor
and verify through unique DOM controls and authoritative revision changes:

- stature edit;
- limb parent hide/restore;
- kneeling and reaching actions;
- pelvis, spine, neck, shoulder, elbow, wrist, hip, knee, and ankle edits;
- undo and redo;
- save and reload.

Inspect Overview and Shot Preview after the final accepted revision.

- [ ] **Step 4: Perform Blueprint actor browser acceptance**

Submit a generic Blueprint scene, then verify independent instance stature,
limb override, variant change, joint edit, action, save/reload, and unchanged
snapshot SHA-256.

- [ ] **Step 5: Inspect composition and export**

Run:

```text
node scripts/director.mjs composition inspect --json
node scripts/director.mjs export png --file .shubi-shot/exports/actor-puppet-v07.png --width 1920 --height 1080
```

Require exact scene ID/revision, browser-rendered final camera, dimensions,
SHA-256, warning codes, and visual confirmation that the adjusted limbs and
joint pose are visible and contact is stable.

- [ ] **Step 6: Re-run final verification after browser fixes**

If browser acceptance caused code changes, rerun `pnpm verify` from scratch.
Then run `git status --short`, `git diff --check`, and inspect the exact diff
scope.

- [ ] **Step 7: Commit final acceptance evidence**

```text
git add docs/verification.md docs/releases/v0.7.0.md
git commit -m "test: verify actor puppet v0.7 acceptance"
```

Do not add ignored runtime submissions, scenes, logs, screenshots, or PNG
exports to Git.

## Plan self-review

- Spec coverage: every v0.7 design requirement maps to Tasks 1-8.
- Scope: no IK, viewport gizmos, animation, skinning, private assets, or
  Blueprint authoring UI is included.
- Type consistency: `actor.height.set`, `actor.pose.joints.set`,
  `heightScale`, `limbPresenceOverrides`, `actor-height`, and the fifteen joint
  IDs use one spelling throughout.
- TDD: every production task begins with a failing focused test and explicit
  RED verification before implementation.
- Completion: only fresh `pnpm verify`, browser acceptance, composition
  inspection, export evidence, and final diff inspection permit a completion
  claim.
