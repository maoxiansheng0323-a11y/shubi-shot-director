# Shot Preview Context Menu and Wall Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep right-button final-camera orbit uninterrupted and hide exactly the first solid wall box intersected by an outside final camera's center ray in Shot Preview and PNG export.

**Architecture:** Add a pure editor-domain projection that derives one stable hidden wall-box key from a spatial layout and effective camera transform. Feed the same effective transform into `ShotCamera` and Shot View's `SceneWorld`, where only the matching derived wall box is omitted; the existing exporter then inherits identical geometry. Make context-menu ownership depend only on active camera-adjustment mode, not transient pointer event order.

**Tech Stack:** TypeScript 6, React 19, React Three Fiber, Three.js scene math, Vitest, Vite, local loopback bridge, Codex in-app Browser.

---

## File map

- Create `src/editor/shot-wall-visibility.ts`: pure visible-volume containment, camera center ray, oriented wall-box intersection, stable key derivation.
- Create `tests/shot-wall-visibility.test.ts`: deterministic geometry coverage for inside/outside cameras, openings, later walls, rotated walls, ties, and empty/hidden layouts.
- Modify `src/editor/ShotCameraNavigation.tsx`: active-surface context-menu policy.
- Modify `tests/shot-camera-ui-contract.test.ts`: event-order regression and Shot View wiring contract.
- Modify `src/three/SceneWorld.tsx`: omit one matching derived wall box only in Shot View.
- Modify `src/editor/ViewportWorkspace.tsx`: resolve and share one effective final-camera transform between camera and wall projection.
- Modify `docs/superpowers/plans/2026-07-28-shot-preview-context-menu-and-wall-visibility.md`: mark completed checkpoints while executing.

### Task 1: Pure first-wall visibility projection

**Files:**
- Create: `src/editor/shot-wall-visibility.ts`
- Create: `tests/shot-wall-visibility.test.ts`

- [x] **Step 1: Write failing geometry tests**

Create a generic two-room fixture with exterior and shared boundaries, including one visible opening. Require this public surface:

```ts
import {
  deriveHiddenShotWallBoxKey,
  shotWallBoxKey,
} from "../src/editor/shot-wall-visibility";

expect(deriveHiddenShotWallBoxKey(layout, insideTransform)).toBeNull();
expect(deriveHiddenShotWallBoxKey(layout, outsideTransform)).toBe(
  shotWallBoxKey("boundary_alpha_west", 0),
);
```

Add separate assertions for an on-edge camera, above-room camera, opening pass-through, ray pointing away, rotated boundary, hidden region/boundary, missing layout, preservation of the later wall, and stable first-in-layout tie-breaking.

- [x] **Step 2: Run the new test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/shot-wall-visibility.test.ts
```

Expected: FAIL because `src/editor/shot-wall-visibility.ts` does not exist.

- [x] **Step 3: Implement stable keys and visible-volume containment**

Create the module with these exports:

```ts
export const shotWallBoxKey = (
  boundaryId: string,
  boxIndex: number,
): string => `${boundaryId}:${boxIndex}`;

export const isCameraInsideVisibleRegionVolume = (
  layout: SpatialLayout,
  positionM: Vec3,
): boolean => /* inclusive XZ polygon and inclusive floor/ceiling */;
```

Use an epsilon-aware point-on-segment check before ray-casting the XZ polygon. Ignore hidden regions and return `false` when no visible region contains the full 3D camera position.

- [x] **Step 4: Implement oriented wall-box ray intersection**

Add a private slab intersection that transforms the world-space ray into each wall box's local coordinates using the inverse Y rotation. For each axis, handle near-zero direction without division by zero. Reject boxes fully behind the origin; when the origin is inside a box, use the positive exit distance.

```ts
const rayDistanceToWallBox = (
  origin: Vec3,
  direction: Vec3,
  wall: SpatialWallBox,
): number | null => /* finite positive entry or exit distance */;
```

- [x] **Step 5: Implement first-hit derivation**

```ts
export const deriveHiddenShotWallBoxKey = (
  layout: SpatialLayout | null,
  cameraTransform: TransformSpec | undefined,
): string | null => /* outside guard, forward ray, stable closest hit */;
```

Derive camera forward by rotating local `[0, 0, -1]` with the camera quaternion. Iterate visible boundaries and `deriveBoundaryWallBoxes(layout, boundary)` in source order. Replace the current winner only for a strictly closer hit outside the tie epsilon.

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/shot-wall-visibility.test.ts tests/spatial-layout.test.ts
```

Expected: both test files PASS.

- [x] **Step 7: Commit the pure projection**

```powershell
git add -- src/editor/shot-wall-visibility.ts tests/shot-wall-visibility.test.ts
git commit -m "feat: derive first blocking shot wall"
```

### Task 2: Context-menu event-order regression

**Files:**
- Modify: `src/editor/ShotCameraNavigation.tsx`
- Modify: `tests/shot-camera-ui-contract.test.ts`

- [x] **Step 1: Write the failing UI contract assertion**

Extend the UI contract test so context-menu suppression is defined by active mode alone and cannot reference `pointerGestureRef.current`:

```ts
expect(source).toContain("if (active) {");
expect(source).not.toMatch(
  /onContextMenu[\s\S]{0,180}pointerGestureRef\.current/u,
);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/shot-camera-ui-contract.test.ts
```

Expected: FAIL because the current handler suppresses only while a right-button gesture reference still exists.

- [x] **Step 3: Make the active surface own context menus**

Replace the current conditional with:

```tsx
onContextMenu={(event) => {
  if (active) {
    event.preventDefault();
  }
}}
```

Do not add a document listener or change pointer capture, orbit math, gesture commit, inactive surfaces, or unrelated browser menus.

- [x] **Step 4: Run focused navigation tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/shot-camera-ui-contract.test.ts tests/shot-camera-navigation.test.ts tests/shot-camera-session.test.ts
```

Expected: all three test files PASS.

- [x] **Step 5: Commit the context-menu fix**

```powershell
git add -- src/editor/ShotCameraNavigation.tsx tests/shot-camera-ui-contract.test.ts
git commit -m "fix: suppress active shot context menu"
```

### Task 3: Share effective camera transform with Shot View walls

**Files:**
- Modify: `src/three/SceneWorld.tsx`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `tests/shot-camera-ui-contract.test.ts`
- Test: `tests/shot-wall-visibility.test.ts`

- [x] **Step 1: Write failing projection wiring assertions**

Require the workspace to pass one effective transform to both projections and SceneWorld to derive a hidden wall key only for Shot View:

```ts
expect(workspace).toContain("effectiveCameraTransform");
expect(workspace).toContain(
  "shotCameraTransform={effectiveCameraTransform}",
);
expect(world).toContain("deriveHiddenShotWallBoxKey");
expect(world).toContain('view === "shot"');
expect(world).toContain("hiddenWallBoxKey");
```

- [x] **Step 2: Run the UI contract and verify RED**

Run:

```powershell
pnpm exec vitest run tests/shot-camera-ui-contract.test.ts
```

Expected: FAIL because Shot View walls do not receive the effective final-camera transform.

- [x] **Step 3: Resolve one effective transform in ShotScene**

Find the active camera and resolve the matching draft without mutating either value:

```ts
const cameraTransformOverride =
  cameraDraft?.cameraId === scene.activeCameraId
    ? cameraDraft.transform
    : undefined;
const effectiveCameraTransform =
  cameraTransformOverride ?? activeCamera?.transform;
```

Pass `cameraTransformOverride` to `ShotCamera` and pass
`effectiveCameraTransform` to the new `SceneWorld` prop
`shotCameraTransform`.

- [x] **Step 4: Omit exactly one derived wall box in Shot View**

Add `shotCameraTransform?: TransformSpec` to `SceneWorldProps`. Derive:

```ts
const hiddenShotWallBoxKey =
  view === "shot"
    ? deriveHiddenShotWallBoxKey(
        scene.spatialLayout,
        shotCameraTransform,
      )
    : null;
```

Pass that key through `SpatialLayoutProjection` to `SpatialBoundaryWalls`. Map derived boxes with their index, compute `shotWallBoxKey(boundary.id, index)`, and return `null` only for the matching key. Keep boundary opacity and all other wall boxes unchanged.

- [x] **Step 5: Run focused projection tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/shot-wall-visibility.test.ts tests/shot-camera-ui-contract.test.ts tests/spatial-preview.test.ts
```

Expected: all three test files PASS.

- [x] **Step 6: Run type, lint, and production build checks**

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [x] **Step 7: Commit Shot View integration**

```powershell
git add -- src/three/SceneWorld.tsx src/editor/ViewportWorkspace.tsx tests/shot-camera-ui-contract.test.ts
git commit -m "feat: hide first blocking shot wall"
```

### Task 4: Real-browser, export, and repository acceptance

**Files:**
- Modify on an in-scope acceptance failure: `src/editor/shot-wall-visibility.ts`, `src/editor/ShotCameraNavigation.tsx`, `src/editor/ViewportWorkspace.tsx`, `src/three/SceneWorld.tsx`, or their tests listed above
- Runtime artifacts: ignored files under `.shubi-shot/`

- [x] **Step 1: Run the complete repository verifier**

Run:

```powershell
pnpm verify
git diff --check
git status --short
```

Expected: verifier and whitespace check exit 0; only the plan checkpoint update may remain uncommitted.

- [x] **Step 2: Verify the Skill wrapper and loopback bridge**

From `.agents/skills/shubi-shot-director`, run `node scripts/director.mjs doctor`, require capability contract v2 and loopback-only structured operation, then run `ensure`, `health`, and `snapshot`. Record the generic scene ID and exact revision without passing prompts or profile data to the runtime.

- [x] **Step 3: Verify right-button behavior in the real embedded browser**

Enter Shot Preview, activate final-camera adjustment, right-click and right-drag within the surface, and confirm no `Quick annotate` or browser context menu appears. Confirm the right-drag still changes the draft and one pointer-up commit advances exactly one revision.

- [x] **Step 4: Verify inside/outside and restoration behavior**

Using generic structured camera patches or direct approved camera controls, verify an inside camera keeps every wall. Move it outside and aim through a solid exterior wall: the first wall box must disappear completely while a later wall remains. Aim through a visible opening and confirm no absent opening section is treated as a wall. Return inside and confirm automatic restoration.

- [x] **Step 5: Verify connected export parity**

With an accepted outside camera and connected current Shot Preview, inspect composition and export:

```powershell
node scripts/director.mjs composition inspect --json
node scripts/director.mjs export png --file .shubi-shot/exports/shot-wall-visibility-acceptance.png --width 1920 --height 1080
```

Expected: export uses the exact current scene ID and revision, returns 1920 x 1080, a SHA-256 hash and warning codes, and visually matches Shot Preview with only the first wall box absent.

- [x] **Step 6: Inspect browser console and canvas pixels**

Require no new error or warning attributable to the change. Confirm the Shot Preview and exported PNG are nonblank, correctly framed, and contain the later wall/scene geometry rather than an empty or fully transparent render.

- [x] **Step 7: Run final public and Git boundary checks**

Run:

```powershell
pnpm audit:public
git diff --check
git status --short --branch
git log -5 --oneline
```

Expected: public audit exits 0; no private profile, asset, credential, machine-specific path, or non-generic fixture is tracked; the main checkout remains untouched.

- [x] **Step 8: Commit acceptance checkpoint updates**

```powershell
git add -- docs/superpowers/plans/2026-07-28-shot-preview-context-menu-and-wall-visibility.md
git commit -m "docs: record shot wall acceptance"
```

Record exact commands, browser observations, scene revision, export dimensions/hash/warnings, and any residual risk in the final handoff.

## Acceptance record

- `pnpm verify`: 60 test files and 1502 tests passed; typecheck, lint,
  production build, and public audit passed. The build retained only the
  existing large-chunk advisory.
- Skill doctor and health: capability contract v2, host semantic authority,
  structured-only input, no model integration, forbidden credentials, and
  loopback-only networking all matched the required contract.
- Real embedded browser: `http://127.0.0.1:4317/`, page identity correct,
  meaningful DOM present, no framework overlay, and no console warnings or
  errors.
- Context menu: a real right-click inside active camera adjustment produced no
  embedded-browser menu. The current Browser control API has no held-right-
  button drag primitive; preserved right-drag orbit behavior is covered by the
  passing navigation, session, and UI-contract suites.
- Outside visual check: at rev105 the camera was placed laterally outside. The
  first solid exterior wall disappeared completely while side walls, the
  connected interior wall, its visible opening, the later room, actor, and prop
  remained rendered.
- Inside restoration check: at rev106 the camera returned inside and looked at
  the same exterior boundary; the wall restored and filled the final view.
- Connected export: rev107, 1920 x 1080, 72,664 bytes, SHA-256
  `029c769d04de0e8cc4aa54c7719792a47ffbc509ea7c62b13c1590a753b0b6e3`,
  warning `ACTIVE_CAMERA_UNLOCKED`, and 18 distinct colors in a fixed pixel
  sample. The PNG visually matched the outside Shot Preview.
- Composition remained intentionally independent: the outside acceptance
  camera reported `SIGHTLINE_INTERSECTS_WALL`, proving render-only wall removal
  did not falsify topology analysis.
- Two undo operations restored the exact original camera transform, 43.5 mm
  lens, and `none` lock mode. The authoritative scene is now rev108 solely
  because undo creates new revisions.
