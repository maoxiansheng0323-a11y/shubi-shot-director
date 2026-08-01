# Humanoid Actor Silhouette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rod-and-block actor geometry with a generic articulated humanoid mannequin silhouette without changing persisted scene contracts.

**Architecture:** Extend the internal resolved actor projection with `profile` and `ellipsoid` primitives. Generate all legacy and Blueprint body shapes through the existing shared projection, then teach browser rendering, visible bounds, contact, and diagnostic PNG export to consume the same primitives.

**Tech Stack:** TypeScript, React Three Fiber, Three.js, Vitest, Zod-backed SceneSpec v6 runtime.

---

### Task 1: Define the internal projection contract with tests

**Files:**
- Modify: `src/domain/actor-projection.ts`
- Test: `tests/actor-rig-projection.test.ts`
- Test: `tests/actor-puppet-projection.test.ts`

- [ ] **Step 1: Write failing projection assertions**

Add assertions that a resolved actor contains `neck`, uses `profile` for torso,
pelvis, head, upper/lower arms, and upper/lower legs, and uses `ellipsoid` for
the face, hands, and feet. Assert that torso radius grows from waist to chest,
thigh radius narrows toward the knee, and calf radius grows then narrows toward
the ankle.

```ts
const torso = primitiveById(projection.primitives, "torso");
expect(torso.kind).toBe("profile");
if (torso.kind !== "profile") throw new Error("Torso is not a profile.");
expect(torso.points[0].radius).toBeLessThan(
  Math.max(...torso.points.map(({ radius }) => radius)),
);
expect(primitiveById(projection.primitives, "neck").kind).toBe("profile");
expect(primitiveById(projection.primitives, "head").kind).toBe("profile");
expect(primitiveById(projection.primitives, "face").kind).toBe("ellipsoid");
expect(primitiveById(projection.primitives, "hand_l").kind).toBe("ellipsoid");
expect(primitiveById(projection.primitives, "foot_l").kind).toBe("ellipsoid");
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
pnpm vitest run tests/actor-rig-projection.test.ts tests/actor-puppet-projection.test.ts
```

Expected: FAIL because `profile`, `ellipsoid`, and `neck` do not exist.

- [ ] **Step 3: Add the projection types**

Add these internal types and include them in `ActorProjectionPrimitive`:

```ts
export interface ActorProjectionProfilePoint {
  readonly y: number;
  readonly radius: number;
}

export interface ActorProjectionProfilePrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "profile";
  readonly points: readonly ActorProjectionProfilePoint[];
  readonly depthScale: number;
  readonly radialSegments: number;
}

export interface ActorProjectionEllipsoidPrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "ellipsoid";
  readonly radii: readonly [number, number, number];
  readonly widthSegments: number;
  readonly heightSegments: number;
}
```

Add `neck` to `ActorProjectionPrimitiveId`. Keep SceneSpec and Blueprint schemas
unchanged.

- [ ] **Step 4: Run TypeScript to confirm only unhandled-consumer errors remain**

Run: `pnpm typecheck`

Expected: FAIL at exhaustive primitive consumers until Tasks 2-4 implement the
new kinds; no SceneSpec/schema errors.

### Task 2: Generate humanoid body profiles

**Files:**
- Modify: `src/domain/actor-projection.ts`
- Modify: `src/domain/actor-anatomy.ts`
- Test: `tests/actor-rig-projection.test.ts`
- Test: `tests/actor-puppet-projection.test.ts`
- Test: `tests/actor-projection.test.ts`

- [ ] **Step 1: Add focused anatomy helpers**

Add small pure helpers in `actor-projection.ts` that return immutable profile
points and keep every endpoint on the existing rig span:

```ts
const profilePoint = (y: number, radius: number) => ({ y, radius });

const limbProfile = (
  length: number,
  radii: readonly [number, number, number, number],
): readonly ActorProjectionProfilePoint[] => [
  profilePoint(-length / 2, radii[0]),
  profilePoint(-length * 0.2, radii[1]),
  profilePoint(length * 0.2, radii[2]),
  profilePoint(length / 2, radii[3]),
];
```

Derive neck height/radius, head radii, torso waist/chest radii, pelvis shell
radii, and limb taper values from existing `ActorAnatomyDimensions`. Do not add
persistent fields or infer from actor IDs.

- [ ] **Step 2: Replace body primitives without moving frames**

Use the existing `frames.pelvis`, `frames.spine`, `frames.head`, arm frames, and
leg frames. Keep each limb center and total length unchanged. Add the neck in
the spine frame between the torso top and head base. Retain shoulder, elbow,
hip, and knee spheres as joint indicators, with radii reduced only enough to
blend into the new profiles.

- [ ] **Step 3: Preserve limb removal and Blueprint layering**

Keep all existing `limbPresence` checks and module projection order. Confirm a
missing parent still suppresses its shaped descendants and Blueprint module
IDs/hashes remain unchanged.

- [ ] **Step 4: Run projection tests**

Run:

```powershell
pnpm vitest run tests/actor-projection.test.ts tests/actor-rig-projection.test.ts tests/actor-puppet-projection.test.ts tests/actor-limb-presence.test.ts
```

Expected: PASS with the new geometric baseline.

### Task 3: Render profile and ellipsoid primitives in the browser

**Files:**
- Modify: `src/three/SceneWorld.tsx`
- Test: `tests/actor-rig-projection.test.ts`

- [ ] **Step 1: Add mesh scale support**

Extend `GrayMeshProps` with `scale?: [number, number, number]` and forward it to
the `<mesh>` element.

- [ ] **Step 2: Render `ellipsoid`**

Render `sphereGeometry` with the stored segments and set mesh scale to the
three radii, using a unit-radius sphere.

- [ ] **Step 3: Render `profile`**

Import `Vector2` from Three.js, convert points with
`new Vector2(point.radius, point.y)`, render `<latheGeometry>`, and apply
`scale={[1, 1, primitive.depthScale]}`. Keep selection edges and actor color.

- [ ] **Step 4: Run typecheck and build**

Run: `pnpm typecheck && pnpm build`

Expected: PASS once all projection consumers are exhaustive.

### Task 4: Keep visible bounds and contact authoritative

**Files:**
- Modify: `src/domain/actor-visible-bounds.ts`
- Test: `tests/actor-visible-bounds.test.ts`
- Test: `tests/contact-constraints.test.ts`

- [ ] **Step 1: Write failing extrema tests**

Add one rotated forearm profile and one rotated/scaled ellipsoid test. Assert the
reported min/max contains the analytically transformed surface and that floor
contact places the lowest visible foot point at the target plane.

- [ ] **Step 2: Implement ellipsoid support points**

For local axis gradients and actor-world axis gradients, transform each gradient
into primitive-local space, solve the ellipsoid support point, transform it back
through the primitive frame, and add both signs to `localPoints`.

- [ ] **Step 3: Implement profile-ring support points**

Treat every profile point as an ellipse with radii
`[point.radius, 0, point.radius * depthScale]`. Add its local/world support
points. This makes contact and composition consume the rendered outline instead
of a capsule approximation.

- [ ] **Step 4: Run bounds and contact tests**

Run:

```powershell
pnpm vitest run tests/actor-visible-bounds.test.ts tests/contact-constraints.test.ts
```

Expected: PASS for present limbs, absent limb chains, rotated joints, and actor
scale.

### Task 5: Keep diagnostic software PNG aligned

**Files:**
- Modify: `server/software-png.ts`
- Test: `tests/software-png.test.ts`

- [ ] **Step 1: Write a failing export-consumer test**

Create a scene with the humanoid actor and assert the diagnostic renderer lists
the `neck` primitive and produces non-empty projected strokes/discs for both new
primitive kinds.

- [ ] **Step 2: Draw profile geometry**

For each profile ring, project the left/right depth-scaled extrema and connect
adjacent rings with longitudinal strokes. Draw a restrained ring disc at the
largest profile point so the diagnostic image remains readable.

- [ ] **Step 3: Draw ellipsoid geometry**

Project the center and the three principal-axis endpoints. Use the largest
screen-space axis as the diagnostic disc radius and draw the long axis as a
stroke.

- [ ] **Step 4: Run software export tests**

Run: `pnpm vitest run tests/software-png.test.ts`

Expected: PASS without changing the browser-rendered export contract.

### Task 6: Verify compatibility and visual acceptance

**Files:**
- Modify: `docs/verification.md`
- Modify: `docs/releases/v0.7.0.md`

- [ ] **Step 1: Run the actor regression set**

Run:

```powershell
pnpm vitest run tests/actor-*.test.ts tests/contact-constraints.test.ts tests/scene-persistence.test.ts
```

Expected: all selected files pass.

- [ ] **Step 2: Run the full repository gate**

Run: `pnpm verify`

Expected: typecheck, all tests, lint, build, and public audit pass. The existing
Vite large-chunk advisory may remain.

- [ ] **Step 3: Validate the Skill**

Run with the bundled Python environment that includes PyYAML:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" '.agents\skills\shubi-shot-director'
```

Expected: `Skill is valid!`. If the system Python lacks PyYAML, use the Codex
workspace Python reported by `codex_app__load_workspace_dependencies`; do not
install packages globally.

- [ ] **Step 4: Perform real-browser acceptance**

Use the current opaque workspace. Verify legacy and Blueprint actors in front,
three-quarter, and bent-limb views; test stature, limb absence, two pose presets,
one individual joint, undo/redo, save/reload, browser warnings, composition, and
PNG export.

- [ ] **Step 5: Record evidence and commit**

Update release/verification evidence with exact test counts, scene revision,
PNG dimensions/hash, warnings, and any unchecked composition targets. Commit
the implementation and evidence as stable milestones, preserving the feature
branch and worktree for user testing.
