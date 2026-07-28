# Shot Camera Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users adjust the active final camera directly inside Shot Preview with the approved mouse and keyboard mappings while preserving workflow locks, authoritative revisions, undo history, and browser-rendered export fidelity.

**Architecture:** Add a pure numeric navigation module and a small gesture-session guard, then connect them through one focused Shot Preview controller in `ViewportWorkspace`. Draft transform and focal length values stay in React UI state and feed the existing `ShotCamera`; completed gestures submit existing allowlisted Patch operations with `preserveLock: true` through the editor store.

**Tech Stack:** TypeScript 6, React 19, Three.js math through existing domain helpers, React Three Fiber/Drei, Zustand, Zod ScenePatch validation, Vitest, Vite, local structured bridge, in-app browser.

---

## File map

- Create `src/editor/shot-camera-navigation.ts`: pure target derivation, pan,
  orbit, keyboard movement, focal wheel normalization, and numeric constants.
- Create `src/editor/shot-camera-session.ts`: gesture base-revision and camera
  eligibility guard with no React or bridge dependency.
- Create `src/editor/shot-camera-commands.ts`: testable store-facing transform
  and lens commits with exact revision and lock-preservation guards.
- Create `src/editor/ShotCameraNavigation.tsx`: focused Shot Preview mode button,
  pointer/keyboard/wheel controller, local drafts, debounce, and cleanup.
- Modify `src/editor/manual-patches.ts`: optional lock preservation for existing
  transform and lens Patch helpers.
- Modify `src/three/SceneWorld.tsx`: accept a focal-length override in
  `ShotCamera` in addition to the existing transform override.
- Modify `src/editor/ViewportWorkspace.tsx`: mount the navigation controller,
  feed draft overrides to `ShotScene`, and expose pending-draft state.
- Modify `src/App.tsx`: submit camera-only lock-preserving commits and block
  export while a draft exists.
- Modify `src/styles.css`: compact active/focus styles for the mode control and
  transparent interaction surface.
- Create `tests/shot-camera-navigation.test.ts`: pure numeric and target tests.
- Create `tests/shot-camera-session.test.ts`: revision, lock, and eligibility
  tests.
- Create `tests/shot-camera-commands.test.ts`: accepted, no-op, workflow, user,
  and stale command tests.
- Create `tests/shot-camera-ui-contract.test.ts`: stable source-level UI wiring
  checks in the repository's existing no-jsdom test style.
- Modify `tests/manual-patches.test.ts`: preserve-lock transform and lens Patch
  tests.
- Modify `README.md` and `.agents/skills/shubi-shot-director/SKILL.md`: document
  the direct adjustment workflow without changing the structured authority
  boundary.
- Modify `docs/verification.md`: add final generic browser/export evidence only
  after acceptance succeeds.

### Task 1: Pure camera navigation and deterministic orbit target

**Files:**
- Create: `src/editor/shot-camera-navigation.ts`
- Create: `tests/shot-camera-navigation.test.ts`
- Read: `src/domain/scene-math.ts`
- Read: `src/domain/actor-visible-bounds.ts`
- Read: `src/domain/humanoid-rig.ts`

- [ ] **Step 1: Write failing pan, orbit, keyboard, focal, and target tests**

Create fixtures from `createDefaultScene()` and assert all approved invariants:

```ts
import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { rotateVector } from "../src/domain/scene-math";
import {
  adjustShotFocalLength,
  deriveShotOrbitTarget,
  moveShotCameraByKey,
  orbitShotCamera,
  panShotCamera,
} from "../src/editor/shot-camera-navigation";

const cameraIn = () => {
  const scene = createDefaultScene();
  const camera = scene.entities.find(
    (entity) => entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (camera?.kind !== "camera") throw new Error("Missing camera fixture.");
  return { scene, camera };
};

describe("shot camera navigation", () => {
  it("pans in the image plane without rotating", () => {
    const { camera } = cameraIn();
    const next = panShotCamera(camera, [0, 1, 0], [100, -50], 720);
    expect(next.rotation).toEqual(camera.transform.rotation);
    expect(next.positionM).not.toEqual(camera.transform.positionM);
  });

  it("orbits around a fixed target and keeps looking at it", () => {
    const { camera } = cameraIn();
    const target = [0, 1, 0] as const;
    const beforeRadius = Math.hypot(
      ...camera.transform.positionM.map((value, axis) => value - target[axis]),
    );
    const next = orbitShotCamera(camera, target, [120, -45]);
    const afterRadius = Math.hypot(
      ...next.positionM.map((value, axis) => value - target[axis]),
    );
    expect(afterRadius).toBeCloseTo(beforeRadius, 8);
    const forward = rotateVector([0, 0, -1], next.rotation);
    const toTarget = target.map(
      (value, axis) => value - next.positionM[axis],
    );
    const length = Math.hypot(...toTarget);
    expect(forward).toEqual(
      toTarget.map((value) => expect.closeTo(value / length, 8)),
    );
  });

  it.each([
    ["ArrowUp", [0, 0, -1]],
    ["ArrowDown", [0, 0, 1]],
    ["ArrowLeft", [-1, 0, 0]],
    ["ArrowRight", [1, 0, 0]],
    ["PageUp", [0, 1, 0]],
    ["PageDown", [0, -1, 0]],
  ] as const)("moves %s in the approved direction", (key, expectedLocal) => {
    const { camera } = cameraIn();
    const next = moveShotCameraByKey(camera, key, {});
    const delta = next.positionM.map(
      (value, axis) => value - camera.transform.positionM[axis],
    );
    const expectedWorld = key.startsWith("Page")
      ? expectedLocal
      : rotateVector([...expectedLocal], camera.transform.rotation);
    expect(delta).toEqual(expectedWorld.map((value) => expect.closeTo(value * 0.1, 8)));
    expect(next.rotation).toEqual(camera.transform.rotation);
  });

  it("uses normal, fast, and precision focal steps with hard clamps", () => {
    expect(adjustShotFocalLength(35, -1, {})).toBe(35.5);
    expect(adjustShotFocalLength(35, -1, { shiftKey: true })).toBe(37);
    expect(adjustShotFocalLength(35, -1, { shiftKey: true, altKey: true })).toBe(35.1);
    expect(adjustShotFocalLength(299.9, -1, { shiftKey: true })).toBe(300);
    expect(adjustShotFocalLength(12.1, 1, { shiftKey: true })).toBe(12);
  });

  it("prefers a framing keep-visible anchor for the orbit target", () => {
    const { scene, camera } = cameraIn();
    scene.compositionGoals = {
      framing: { mode: "full", targetEntityIds: ["actor_generic_1"] },
    };
    scene.constraints.push({
      id: "constraint_visible_actor_1",
      type: "keep-visible",
      cameraId: camera.id,
      subjectEntityId: "actor_generic_1",
      anchor: "face",
      enabled: true,
    });
    const target = deriveShotOrbitTarget(scene, camera);
    expect(target.source).toBe("keep-visible-framing");
    expect(target.targetM[1]).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
pnpm vitest run tests/shot-camera-navigation.test.ts
```

Expected: FAIL because `src/editor/shot-camera-navigation.ts` does not exist.

- [ ] **Step 3: Implement the pure navigation module**

Create numeric helpers and these stable exports:

```ts
export type ShotNavigationKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "PageUp"
  | "PageDown";

export interface ShotNavigationModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ShotOrbitTarget {
  targetM: Vec3;
  source:
    | "keep-visible-framing"
    | "keep-visible"
    | "framing"
    | "visible-bounds"
    | "camera-forward";
}

export const SHOT_KEY_STEP_M = 0.1;
export const SHOT_KEY_FAST_STEP_M = 0.5;
export const SHOT_KEY_FINE_STEP_M = 0.02;
export const SHOT_WHEEL_STEP_MM = 0.5;
export const SHOT_WHEEL_FAST_STEP_MM = 2;
export const SHOT_WHEEL_FINE_STEP_MM = 0.1;
export const SHOT_ORBIT_RADIANS_PER_PIXEL = 0.005;
export const SHOT_ORBIT_MAX_PITCH = Math.PI / 2 - Math.PI / 180;

export const panShotCamera = (
  camera: CameraEntity,
  targetM: Vec3,
  deltaPx: readonly [number, number],
  viewportHeightPx: number,
): TransformSpec => {
  const distanceM = Math.max(
    0.1,
    Math.hypot(
      ...camera.transform.positionM.map(
        (value, axis) => value - targetM[axis],
      ),
    ),
  );
  const sensorHeightMm = camera.lens.sensorWidthMm * (9 / 16);
  const verticalFov = 2 * Math.atan(
    sensorHeightMm / (2 * camera.lens.focalLengthMm),
  );
  const metersPerPixel =
    (2 * distanceM * Math.tan(verticalFov / 2)) /
    Math.max(1, viewportHeightPx);
  const right = rotateVector([1, 0, 0], camera.transform.rotation);
  const up = rotateVector([0, 1, 0], camera.transform.rotation);
  const translation = addVectors(
    scaleVector(right, deltaPx[0] * metersPerPixel),
    scaleVector(up, -deltaPx[1] * metersPerPixel),
  );
  return {
    ...camera.transform,
    positionM: addVectors(camera.transform.positionM, translation),
  };
};

export const orbitShotCamera = (
  camera: CameraEntity,
  targetM: Vec3,
  deltaPx: readonly [number, number],
): TransformSpec => {
  const offset = subtractVectors(camera.transform.positionM, targetM);
  const radius = Math.max(0.05, Math.hypot(...offset));
  const yaw =
    Math.atan2(offset[0], offset[2]) -
    deltaPx[0] * SHOT_ORBIT_RADIANS_PER_PIXEL;
  const pitch = clamp(
    Math.asin(clamp(offset[1] / radius, -1, 1)) -
      deltaPx[1] * SHOT_ORBIT_RADIANS_PER_PIXEL,
    -SHOT_ORBIT_MAX_PITCH,
    SHOT_ORBIT_MAX_PITCH,
  );
  const horizontalRadius = Math.cos(pitch) * radius;
  const positionM: Vec3 = [
    targetM[0] + Math.sin(yaw) * horizontalRadius,
    targetM[1] + Math.sin(pitch) * radius,
    targetM[2] + Math.cos(yaw) * horizontalRadius,
  ];
  return {
    ...camera.transform,
    positionM,
    rotation: lookAtQuaternion(positionM, targetM),
  };
};

export const moveShotCameraByKey = (
  camera: CameraEntity,
  key: ShotNavigationKey,
  modifiers: ShotNavigationModifiers,
): TransformSpec => {
  const stepM = modifiers.altKey
    ? SHOT_KEY_FINE_STEP_M
    : modifiers.shiftKey
      ? SHOT_KEY_FAST_STEP_M
      : SHOT_KEY_STEP_M;
  const localDirections: Partial<Record<ShotNavigationKey, Vec3>> = {
    ArrowUp: [0, 0, -1],
    ArrowDown: [0, 0, 1],
    ArrowLeft: [-1, 0, 0],
    ArrowRight: [1, 0, 0],
  };
  const direction =
    key === "PageUp"
      ? ([0, 1, 0] as Vec3)
      : key === "PageDown"
        ? ([0, -1, 0] as Vec3)
        : rotateVector(
            localDirections[key] ?? [0, 0, 0],
            camera.transform.rotation,
          );
  return {
    ...camera.transform,
    positionM: addVectors(
      camera.transform.positionM,
      scaleVector(direction, stepM),
    ),
  };
};

export const adjustShotFocalLength = (
  focalLengthMm: number,
  deltaY: number,
  modifiers: ShotNavigationModifiers,
): number => {
  if (deltaY === 0) return focalLengthMm;
  const stepMm = modifiers.altKey
    ? SHOT_WHEEL_FINE_STEP_MM
    : modifiers.shiftKey
      ? SHOT_WHEEL_FAST_STEP_MM
      : SHOT_WHEEL_STEP_MM;
  const next = focalLengthMm + (deltaY < 0 ? stepMm : -stepMm);
  return Math.round(clamp(next, 12, 300) * 10) / 10;
};

export const deriveShotOrbitTarget = (
  scene: SceneSpec,
  camera: CameraEntity,
): ShotOrbitTarget => {
  const framingIds = scene.compositionGoals?.framing?.targetEntityIds ?? [];
  const constraints = scene.constraints.filter(
    (constraint): constraint is KeepVisibleConstraint =>
      constraint.type === "keep-visible" &&
      constraint.enabled &&
      constraint.cameraId === camera.id,
  );
  for (const entityId of framingIds) {
    const constraint = constraints.find(
      (candidate) => candidate.subjectEntityId === entityId,
    );
    const targetM = constraint
      ? resolveConstraintTarget(scene, constraint)
      : null;
    if (targetM) return { targetM, source: "keep-visible-framing" };
  }
  for (const constraint of constraints) {
    const targetM = resolveConstraintTarget(scene, constraint);
    if (targetM) return { targetM, source: "keep-visible" };
  }
  for (const entityId of framingIds) {
    const entity = scene.entities.find(
      (candidate) => candidate.id === entityId && candidate.visible,
    );
    const targetM = entity ? visibleEntityCenter(entity) : null;
    if (targetM) return { targetM, source: "framing" };
  }
  const boundsCenter = visibleSceneBoundsCenter(scene);
  const forward = rotateVector([0, 0, -1], camera.transform.rotation);
  if (boundsCenter) {
    const projectedDistance = dotVectors(
      subtractVectors(boundsCenter, camera.transform.positionM),
      forward,
    );
    if (projectedDistance > 0.1) {
      return {
        targetM: addVectors(
          camera.transform.positionM,
          scaleVector(forward, projectedDistance),
        ),
        source: "visible-bounds",
      };
    }
  }
  return {
    targetM: addVectors(camera.transform.positionM, scaleVector(forward, 5)),
    source: "camera-forward",
  };
};
```

Define `clamp`, `scaleVector`, `subtractVectors`, `dotVectors`,
`resolveConstraintTarget`, `visibleEntityCenter`, and
`visibleSceneBoundsCenter` as private total helpers in the same file. Use
`rotateVector`, `lookAtQuaternion`, `actorAnchorWorldPoint`,
`actorVisibleRigBounds`, and `transformPoint`; do not construct React state or
browser events here. For visible-bounds fallback, include visible actor points,
transformed prop primitive corners, and connected region floor/ceiling corners.
Exclude camera entities. Empty point collections return `null`; all returned
vectors contain finite values.

- [ ] **Step 4: Run navigation tests and related math regressions**

Run:

```powershell
pnpm vitest run tests/shot-camera-navigation.test.ts tests/actor-visible-bounds.test.ts tests/composition-safety.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/editor/shot-camera-navigation.ts tests/shot-camera-navigation.test.ts
git commit -m "feat: add deterministic shot camera navigation"
```

### Task 2: Gesture guard and lock-preserving Patch helpers

**Files:**
- Create: `src/editor/shot-camera-session.ts`
- Create: `tests/shot-camera-session.test.ts`
- Modify: `src/editor/manual-patches.ts`
- Modify: `tests/manual-patches.test.ts`

- [ ] **Step 1: Write failing session and Patch tests**

Add tests that prove exact revision checks and preserved locks:

```ts
const scene = createDefaultScene();
const camera = scene.entities.find((entity) => entity.kind === "camera")!;
camera.lockMode = "workflow";
const session = createShotCameraGestureSession(scene, camera.id);

expect(decideShotCameraGesture(session, scene, camera.id)).toEqual({
  status: "commit",
});
expect(
  decideShotCameraGesture(session, { ...scene, revision: 1 }, camera.id),
).toMatchObject({ status: "conflict" });

camera.lockMode = "user";
expect(decideShotCameraGesture(session, scene, camera.id)).toMatchObject({
  status: "blocked",
  code: "SHOT_CAMERA_USER_LOCKED",
});
```

Extend manual Patch tests:

```ts
expect(
  createTransformPatch(scene, camera.id, transform, { preserveLock: true }),
).toMatchObject({ preserveLock: true });
expect(
  createCameraLensPatch(scene, camera, 50, { preserveLock: true }),
).toMatchObject({ preserveLock: true });
```

- [ ] **Step 2: Run both files and verify RED**

```powershell
pnpm vitest run tests/shot-camera-session.test.ts tests/manual-patches.test.ts
```

Expected: FAIL for the missing session module and unsupported options.

- [ ] **Step 3: Implement the gesture guard and optional Patch policy**

Create:

```ts
export interface ShotCameraGestureSession {
  sceneId: string;
  baseRevision: number;
  cameraId: string;
  cancelled: boolean;
}

export const createShotCameraGestureSession = (
  scene: SceneSpec,
  cameraId: string,
): ShotCameraGestureSession => ({
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  cameraId,
  cancelled: false,
});

export const decideShotCameraGesture = (
  session: ShotCameraGestureSession | null,
  scene: SceneSpec,
  cameraId: string,
):
  | { status: "commit" }
  | { status: "conflict"; code: "SHOT_CAMERA_REVISION_CONFLICT" }
  | { status: "blocked"; code: "SHOT_CAMERA_USER_LOCKED" } => {
  const camera = scene.entities.find(
    (entity) => entity.kind === "camera" && entity.id === cameraId,
  );
  if (camera?.kind === "camera" && camera.lockMode === "user") {
    return { status: "blocked", code: "SHOT_CAMERA_USER_LOCKED" };
  }
  if (
    !session ||
    session.cancelled ||
    session.sceneId !== scene.sceneId ||
    session.baseRevision !== scene.revision ||
    session.cameraId !== cameraId ||
    camera?.kind !== "camera"
  ) {
    return { status: "conflict", code: "SHOT_CAMERA_REVISION_CONFLICT" };
  }
  return { status: "commit" };
};
```

Add an options type to both Patch helpers while retaining `false` defaults:

```ts
interface ManualPatchOptions {
  preserveLock?: boolean;
}

export const createTransformPatch = (
  scene: SceneSpec,
  entityId: string,
  transform: TransformSpec,
  options: ManualPatchOptions = {},
): ScenePatch => createOperationsPatch(
  scene,
  "transform",
  [{ op: "entity.transform.set", entityId, value: transform }],
  "manual",
  options.preserveLock ?? false,
);
```

Apply the same option to `createCameraLensPatch`. Extend
`createOperationsPatch` with a final `preserveLock = false` argument without
changing any existing call result.

- [ ] **Step 4: Run tests and verify schema-valid lock preservation**

```powershell
pnpm vitest run tests/shot-camera-session.test.ts tests/manual-patches.test.ts tests/lock-preservation.test.ts
```

Expected: all selected tests PASS; existing manual operations still default to
`preserveLock: false`.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- src/editor/shot-camera-session.ts src/editor/manual-patches.ts tests/shot-camera-session.test.ts tests/manual-patches.test.ts
git commit -m "feat: preserve camera locks across gestures"
```

### Task 3: Draft focal projection and focused interaction controller

**Files:**
- Create: `src/editor/ShotCameraNavigation.tsx`
- Modify: `src/three/SceneWorld.tsx`
- Create: `tests/shot-camera-ui-contract.test.ts`

- [ ] **Step 1: Write failing renderer and controller contract tests**

Use the repository's source-contract style to require stable semantics without
adding jsdom:

```ts
const controllerSource = readFileSync(
  new URL("../src/editor/ShotCameraNavigation.tsx", import.meta.url),
  "utf8",
);
const sceneWorldSource = readFileSync(
  new URL("../src/three/SceneWorld.tsx", import.meta.url),
  "utf8",
);

expect(controllerSource).toContain('aria-pressed={active}');
expect(controllerSource).toContain('aria-label="调整最终镜头"');
expect(controllerSource).toContain("onPointerDown");
expect(controllerSource).toContain("onPointerMove");
expect(controllerSource).toContain("onWheel");
expect(controllerSource).toContain("onKeyDown");
expect(controllerSource).toContain("onKeyUp");
expect(controllerSource).toContain("preventDefault");
expect(controllerSource).toContain("setPointerCapture");
expect(controllerSource).toContain("releasePointerCapture");
expect(controllerSource).toContain("180");
expect(sceneWorldSource).toContain("focalLengthOverrideMm");
```

- [ ] **Step 2: Run the contract test and verify RED**

```powershell
pnpm vitest run tests/shot-camera-ui-contract.test.ts
```

Expected: FAIL because the controller file and focal override do not exist.

- [ ] **Step 3: Add a focal override to `ShotCamera`**

Extend the public props and layout effect:

```tsx
export const ShotCamera = ({
  scene,
  makeDefault = true,
  transformOverride,
  focalLengthOverrideMm,
}: {
  scene: SceneSpec;
  makeDefault?: boolean;
  transformOverride?: TransformSpec;
  focalLengthOverrideMm?: number;
}) => {
  // Existing camera lookup and ref stay unchanged.
  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !cameraEntity) return;
    camera.filmGauge = cameraEntity.lens.sensorWidthMm;
    camera.setFocalLength(
      focalLengthOverrideMm ?? cameraEntity.lens.focalLengthMm,
    );
    camera.aspect = 16 / 9;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [cameraEntity, focalLengthOverrideMm]);
  // Existing PerspectiveCamera projection stays unchanged.
};
```

- [ ] **Step 4: Implement `ShotCameraNavigation`**

Expose one controlled component interface:

```ts
export interface ShotCameraNavigationProps {
  scene: SceneSpec;
  disabled: boolean;
  onSelectCamera: (cameraId: string) => void;
  onDraftChange: (draft: ShotCameraDraft | null) => void;
  onCommitTransform: (
    session: ShotCameraGestureSession,
    transform: TransformSpec,
  ) => Promise<SceneSpec | void>;
  onCommitFocalLength: (
    session: ShotCameraGestureSession,
    focalLengthMm: number,
  ) => Promise<SceneSpec | void>;
}

export interface ShotCameraDraft {
  cameraId: string;
  transform?: TransformSpec;
  focalLengthMm?: number;
  pending: boolean;
}
```

The component must:

1. render the pressed/disabled mode button and a focusable transparent surface;
2. select and focus the active camera on mode entry;
3. derive and retain one orbit target for the current eligible mode session;
4. start one gesture session on pointer-down, first navigation key, or first
   wheel event;
5. compute drafts with Task 1 helpers from the gesture's original camera;
6. pointer-capture left/right drags and suppress only active right-drag context
   menus;
7. aggregate held navigation keys until the last key-up;
8. debounce wheel commit by exactly 180 ms;
9. ignore editable targets and prevent browser defaults only while active and
   focused;
10. clear timers, held keys, pointer capture, and drafts on cancel/unmount;
11. retain mode and orbit target after its own accepted Patch;
12. cancel an external revision draft, refresh the target, and keep mode only
    if the camera remains eligible;
13. exit on `Escape`, scene replacement, active-camera replacement, preview
    exit, or user protection.

Use refs for active gesture and base values, state for visible active/draft
status, and `finally` cleanup for async commits. Do not call the bridge or store
directly from this component.

- [ ] **Step 5: Run controller, renderer, and navigation tests**

```powershell
pnpm vitest run tests/shot-camera-ui-contract.test.ts tests/shot-camera-navigation.test.ts tests/shot-camera-session.test.ts
pnpm typecheck
```

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- src/editor/ShotCameraNavigation.tsx src/three/SceneWorld.tsx tests/shot-camera-ui-contract.test.ts
git commit -m "feat: add shot preview camera controller"
```

### Task 4: Workspace, store commit path, export guard, and responsive styling

**Files:**
- Create: `src/editor/shot-camera-commands.ts`
- Create: `tests/shot-camera-commands.test.ts`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/shot-camera-ui-contract.test.ts`

- [ ] **Step 1: Add failing integration contract and store tests**

Require the workspace to feed both draft types into the final camera and App to
submit lock-preserving patches:

```ts
expect(workspaceSource).toContain("<ShotCameraNavigation");
expect(workspaceSource).toContain("focalLengthOverrideMm");
expect(workspaceSource).toContain("onCameraDraftChange");
expect(appSource).toContain("preserveLock: true");
expect(appSource).toContain("cameraDraftActive");
expect(appSource).toMatch(/exportDisabled[\s\S]*cameraDraftActive/u);
```

Create command tests with a workflow-locked camera and a minimal injected store
surface:

```ts
const getState = () => ({
  scene,
  applyPatch: vi.fn(async (patch: ScenePatch) =>
    applyScenePatch(scene, patch).next,
  ),
});
const session = createShotCameraGestureSession(scene, camera.id);
const transform = {
  ...camera.transform,
  positionM: [1, 2, 3] as Vec3,
};
const accepted = await commitShotCameraTransform(getState, session, transform);
expect(getState().applyPatch).toHaveBeenCalledWith(
  expect.objectContaining({ preserveLock: true }),
);
expect(
  accepted?.entities.find((entity) => entity.id === camera.id)?.lockMode,
).toBe("workflow");
```

Add separate cases for exact no-op, stale revision, changed scene ID, changed
active camera, and user lock. Every rejected case must make zero `applyPatch`
calls. Add equivalent accepted/no-op coverage for focal length.

- [ ] **Step 2: Run integration tests and verify RED**

```powershell
pnpm vitest run tests/shot-camera-ui-contract.test.ts tests/shot-camera-commands.test.ts
```

Expected: FAIL because workspace and App are not wired.

- [ ] **Step 3: Extend workspace props and feed live drafts**

Add these props:

```ts
interactionDisabled: boolean;
onCommitCameraTransform: (
  session: ShotCameraGestureSession,
  transform: TransformSpec,
) => Promise<SceneSpec | void>;
onCommitCameraFocalLength: (
  session: ShotCameraGestureSession,
  focalLengthMm: number,
) => Promise<SceneSpec | void>;
onCameraDraftChange: (active: boolean) => void;
```

Store the current `ShotCameraDraft`, pass its transform and focal values to
`ShotScene`, mount `ShotCameraNavigation` only for Shot Preview, and notify App
when a draft starts or clears. The existing editor transform draft remains
independent.

- [ ] **Step 4: Implement testable camera commands and connect App**

Create `shot-camera-commands.ts` with an injected state getter matching the
Zustand store's `scene` and `applyPatch` surface. Both commands fetch current
state, require exact scene ID and revision from the session, require the same
active camera, reject `user`, skip no-ops, and call one existing Patch helper
with `{ preserveLock: true }`.

```ts
export type ShotCameraCommandState = Pick<
  EditorStoreState,
  "scene" | "applyPatch"
>;

export const commitShotCameraTransform = async (
  getState: () => ShotCameraCommandState,
  session: ShotCameraGestureSession,
  transform: TransformSpec,
): Promise<SceneSpec | void> => {
  const state = getState();
  const currentScene = state.scene;
  const camera = currentScene?.entities.find(
    (entity) => entity.kind === "camera" && entity.id === session.cameraId,
  );
  if (
    !currentScene ||
    currentScene.sceneId !== session.sceneId ||
    currentScene.revision !== session.baseRevision ||
    camera?.kind !== "camera" ||
    camera.id !== currentScene.activeCameraId ||
    camera.lockMode === "user" ||
    transformsEqual(camera.transform, transform)
  ) return;
  return state.applyPatch(
    createTransformPatch(currentScene, camera.id, transform, {
      preserveLock: true,
    }),
  );
};
```

Implement `commitShotCameraFocalLength` with the same guard, a `1e-8` no-op
epsilon, and `createCameraLensPatch(..., { preserveLock: true })`. App callbacks
delegate to these commands with `useEditorStore.getState`. Add
`cameraDraftActive` state and include it in `exportDisabled`.

- [ ] **Step 5: Add stable styles without overlapping the shot**

Add compact classes for:

```css
.shot-camera-controls {
  position: absolute;
  z-index: 5;
  left: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.shot-camera-toggle {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(226, 232, 240, 0.24);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.88);
  color: #e2e8f0;
}
.shot-camera-toggle[aria-pressed="true"] {
  border-color: #d5a951;
  color: #f7d991;
}
.shot-camera-toggle:focus-visible {
  outline: 2px solid #9fb8cf;
  outline-offset: 2px;
}
.shot-camera-surface {
  position: absolute;
  z-index: 3;
  inset: 0;
  outline: none;
  cursor: grab;
}
.shot-camera-surface.is-dragging { cursor: grabbing; }
.shot-camera-focal-readout {
  min-width: 64px;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}
```

Use existing neutral colors, border radius at or below 8 px, stable dimensions,
and media rules that keep controls clear of the mode switcher. Add no nested
card and no instructional overlay.

- [ ] **Step 6: Run integration and full editor regression tests**

```powershell
pnpm vitest run tests/shot-camera-ui-contract.test.ts tests/shot-camera-commands.test.ts tests/editor-concurrency.test.ts tests/manual-patches.test.ts tests/compact-workspace.test.ts tests/spatial-preview.test.ts
pnpm typecheck
pnpm lint
```

Expected: all tests PASS; TypeScript and ESLint report no errors.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/editor/shot-camera-commands.ts src/editor/ViewportWorkspace.tsx src/App.tsx src/styles.css tests/shot-camera-commands.test.ts tests/shot-camera-ui-contract.test.ts
git commit -m "feat: adjust final camera in shot preview"
```

### Task 5: Public Skill and onboarding alignment

**Files:**
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `README.md`
- Modify: `tests/skill-scripts.test.ts`
- Modify: `tests/public-onboarding.test.ts`

- [ ] **Step 1: Write failing documentation contract assertions**

Require generic guidance to mention:

```ts
expect(skill).toMatch(/Shot Preview[\s\S]*adjust/i);
expect(skill).toMatch(/workflow[\s\S]*preserveLock: true/i);
expect(readme).toContain("调整镜头");
expect(readme).toContain("PageUp");
expect(readme).toContain("PageDown");
```

- [ ] **Step 2: Run documentation tests and verify RED**

```powershell
pnpm vitest run tests/skill-scripts.test.ts tests/public-onboarding.test.ts
```

Expected: targeted assertions FAIL before documentation changes.

- [ ] **Step 3: Document the direct adjustment workflow**

Update the UI quick-start section with the approved controls:

```text
Shot Preview -> 调整镜头
left drag: image-plane camera translation
right drag: orbit around the primary composition target
wheel: focal length in millimeters
Arrow keys: forward/back/left/right
PageUp/PageDown: world-Y movement
Shift: fast; Alt: precision; Escape: cancel and exit
```

State that workflow locks remain workflow locked through `preserveLock: true`,
user locks remain a stop condition, drafts are not SceneSpec state, and export
requires a committed current Shot Preview. Keep examples generic.

- [ ] **Step 4: Run documentation and public audit tests**

```powershell
pnpm vitest run tests/skill-scripts.test.ts tests/public-onboarding.test.ts
pnpm audit:public
```

Expected: tests PASS and public audit reports zero findings.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- .agents/skills/shubi-shot-director/SKILL.md README.md tests/skill-scripts.test.ts tests/public-onboarding.test.ts
git commit -m "docs: explain direct shot camera controls"
```

### Task 6: Full verification and real-browser acceptance

**Files:**
- Modify: `docs/verification.md`
- Create transient ignored files only under: `.shubi-shot/submissions/`,
  `.shubi-shot/exports/`, `.shubi-shot/verification/`

- [ ] **Step 1: Run the complete repository gate**

```powershell
pnpm verify
pnpm audit:public
git diff --check
```

Expected: schema generation, type checking, all tests, ESLint, production
build, and public audit PASS. Only the existing Vite large-chunk advisory may
remain.

- [ ] **Step 2: Restart the compatible bridge and verify the contract**

```powershell
node scripts/director.mjs doctor
node scripts/director.mjs ensure
node scripts/director.mjs health
node scripts/director.mjs snapshot
```

Expected: capability contract v2, schema v4, structured-only/credential-
forbidden/loopback-only boundaries, current generic scene, and the returned
loopback URL.

- [ ] **Step 3: Run real-browser gesture acceptance**

Open or reload the returned URL in the in-app browser. Use a generic connected
scene with a workflow-locked camera and verify:

1. `调整镜头` enters without unlocking and selects/focuses the active camera;
2. left-drag changes position while rotation and lens remain exact;
3. right-drag changes position/rotation, preserves target radius, and keeps the
   generic primary subject targeted;
4. wheel-up/down changes only focal length with normal, `Shift`, and `Alt`
   steps;
5. all arrow and page keys move in the approved axes and modifiers;
6. each complete gesture advances one revision and keeps `workflow`;
7. input fields and the page behave normally outside the active focused mode;
8. undo/redo restore exact transform and lens states;
9. an external Patch during a draft cancels the draft without retry;
10. `user` protection disables the mode and produces no draft;
11. console warnings/errors are empty and controls do not overlap at desktop
    and compact viewports.

- [ ] **Step 4: Inspect composition and export the accepted current revision**

```powershell
node scripts/director.mjs composition inspect --json
node scripts/director.mjs export png --file .shubi-shot/exports/shot-camera-navigation.png --width 1920 --height 1080 --force
```

Expected: export returns the exact current scene ID/revision, 1920 x 1080,
SHA-256, and no warnings. Inspect the full-resolution PNG and verify it matches
the browser Shot Preview.

- [ ] **Step 5: Record generic evidence and remove transients**

Append one concise dated section to `docs/verification.md` with test counts,
browser viewport, revision transitions, lock results, interaction checks,
composition result, PNG dimensions/bytes/hash/warnings, and any non-blocking
advisory. Remove only the transient generic test submissions and export after
recording evidence.

- [ ] **Step 6: Re-run final gates after the record**

```powershell
pnpm verify
pnpm audit:public
git diff --check
git status --short --branch
```

Expected: all gates PASS and only the verification record is uncommitted.

- [ ] **Step 7: Commit the acceptance record**

```powershell
git add -- docs/verification.md
git commit -m "test: verify direct shot camera navigation"
git status --short --branch
```

Expected: the isolated worktree is clean on `codex/lock-provenance`. Do not
merge or push.
