# Static blocking and pose solving

Use static blocking when a requested still pose depends on support, body-surface contact, relaxed limbs, or anatomical legality that a built-in pose preset alone cannot guarantee. Host Codex remains the semantic authority: it selects the actor, body sites, surfaces, support roles, broad trunk goal, and optional preset seed. The runtime receives only this structured plan and deterministically materializes the final actor transform, complete canonical joint quaternion map, persistent constraints, and diagnostics.

This is a still-pose solver. It has no prompt input, model call, animation, timeline, physics, ragdoll, or gameplay state.

## Supported structured goals

- Body sites: `pelvis`, `upper-back`, `chest`, `head`, left/right `hand`, `knee`, and `foot`.
- Surfaces: implicit world ground with `surfaceEntityId: null` and `surfaceFace: "top"`; room floors; box prop faces; plane prop top faces.
- Contact roles: `support` for a load-bearing relation and `contact` for required touching.
- Relaxed limbs: `arm-l` and `arm-r`. Without `restSurface`, both segments target normalized world gravity `[0, -1, 0]` with a small preferred-direction elbow bend. With `restSurface`, the runtime uses a deterministic two-bone static solve so the hand reaches the selected support surface while the elbow keeps its canonical bend direction.
- Broad pose goals: an optional immutable built-in seed pose, trunk lean/side-bend/twist, and `legPosture: "bent-resting"`.

The solver enforces canonical joint limits and preferred elbow/knee bend directions. It rejects a missing body site, conflicting contact ownership, invalid preset seed, joint reversal, unresolved required contact, surface penetration, out-of-bounds support, or unavailable relaxed limb before visual QA.

Stable failures are `STATIC_BLOCKING_ACTOR_NOT_FOUND`, `STATIC_BLOCKING_CONSTRAINT_CONFLICT`, `STATIC_BLOCKING_POSE_PRESET_INVALID`, and `POSE_DIAGNOSTICS_FAILED`. Refresh the snapshot and correct the structured plan; never retry with raw wording or hand-authored fallback quaternions.

## Create materialization

For a new scene, keep the authored SceneSpec generic and structurally valid, then add `blockingPlans` beside `intentReport` and `scene` in the transient scene-submission envelope. The plan is not persisted. The accepted SceneSpec contains only the materialized pose, transform, and ordinary `body-contact` / `relaxed-limb` constraints.

```json
{
  "schemaVersion": 1,
  "planId": "blocking_plan_1",
  "actorId": "actor_generic_1",
  "seedPose": {
    "registry": "builtin",
    "id": "pose.seated-v1",
    "version": 1
  },
  "trunk": {
    "lean": { "direction": "backward", "angleDeg": 10 }
  },
  "legPosture": "bent-resting",
  "contacts": [
    {
      "constraintId": "contact_pelvis_floor_1",
      "bodySite": "pelvis",
      "surfaceEntityId": "prop_seat_1",
      "surfaceFace": "top",
      "role": "support"
    },
    {
      "constraintId": "contact_back_prop_1",
      "bodySite": "upper-back",
      "surfaceEntityId": "prop_support_1",
      "surfaceFace": "front",
      "role": "support"
    }
  ],
  "relaxedLimbs": [
    {
      "constraintId": "relaxed_arm_r_1",
      "limb": "arm-r",
      "restSurface": {
        "surfaceEntityId": null,
        "surfaceFace": "top"
      }
    }
  ]
}
```

The Host chooses broad values such as a 10-degree backward trunk goal. It must not author the resulting fifteen bespoke joint quaternions. Use built-in pose presets without a blocking plan when no additional support/contact relation is required. Omit `restSurface` for a free-hanging arm. Supply it only when the named world-ground, room-floor, plane-top, or box face must stop the relaxed hand; the runtime first materializes body contacts, then solves the shoulder-elbow-wrist chain against that final geometry.

`restSurface` is a narrow resting-arm semantic, not a general IK target. The gravity ray from the shoulder must encounter a gravity-opposing surface within the legal two-bone reach. An unreachable surface, reversed elbow, joint-limit violation, terminal gap, surface penetration, or out-of-bounds terminal remains a diagnostic failure; the runtime does not force an extreme angle.

## Modify materialization

For an existing scene, put the same plan under one minimal Patch operation:

```json
{
  "op": "actor.blocking.solve",
  "plan": { "schemaVersion": 1, "planId": "blocking_plan_1" }
}
```

The abbreviated object above only illustrates nesting; author the complete plan required by the generated ScenePatch schema. Use the exact current `sceneId` and `baseRevision`. The operation advances one revision and is one undo unit. Reuse a semantic constraint ID when replacing the same relationship. Do not combine enabled legacy whole-actor `ground-contact` and body-site contact for the same actor.

## Deterministic acceptance

Run this before composition inspection or screenshot review:

```text
node scripts/director.mjs pose inspect --json
```

Require `report.status: "pass"` for final acceptance. `check` requires explicit inspection and is emitted as `POSE_DIAGNOSTICS_CHECK` on export; `fail` blocks new static-blocking acceptance, composition inspection, and PNG export. Historical schema-valid scenes load without pose normalization; loading them does not convert a diagnostic failure into acceptance. For each required contact retain `gapM`, `penetrationM`, `boundsOverflowM`, `actorMinGapM`, and anatomical-surface orientation when the body site defines one. Relaxed-limb diagnostics report `mode: "free-hanging" | "surface-resting"`. Free-hanging limbs retain upper/lower gravity deviation. Surface-resting limbs additionally retain the terminal point and gap, arm minimum gap, bounds overflow, elbow bend, terminal gravity drop, upper-arm gravity alignment, and surface gravity opposition; their forearm is not required to remain gravity-parallel after contact. Joint violations include canonical joint, axis, measured angle, allowed range, and reversal code.

Visual QA follows deterministic pose QA and is limited to final composition, readability, and visual confirmation. It is not the primary detector for joint reversal or missing support.
