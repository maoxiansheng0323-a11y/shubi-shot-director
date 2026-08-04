# Direct Studio Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser editor behave as a directly manageable graybox studio with a persistent UI-only editor camera, an always-visible active shot-camera preview, explicit multi-camera activation, whole-entity manipulation, and editor-view-relative single-joint actor posing.

**Architecture:** `SceneSpec` and the local `SceneSession` remain the sole persistent authority. The editor camera, selection/focus, explicit shot orbit target, input ownership, and all live drafts remain React/Zustand UI state. Pure React-free modules perform navigation, bounds/framing, selection classification, ground drag, keyboard movement, primitive-to-joint mapping, and joint-drag math. Controllers capture exact `sceneId`/`baseRevision` sessions, project drafts into both views, and submit one allowlisted operation without rebasing. One connected shot view remains the authoritative preview/export renderer whether compact or expanded.

**Tech Stack:** React 19, TypeScript 6, React Three Fiber 9, Drei 10, Three.js 0.182, Zustand 5, Vitest 4, Vite 8.

---

## Guardrails

- Keep `SceneSpec`, `ScenePatch`, `IntentReport`, and Blueprint schema versions unchanged.
- Do not serialize editor-camera state, focus, selected joint, preview expansion, explicit orbit target, input sessions, or drafts.
- Keep all fixtures and labels generic; never load external project-profile data into tests, screenshots, logs, or commits.
- A completed gesture creates at most one revision and one undo step. A no-op creates none.
- `workflow` locks are editable only through an operation with `preserveLock: true`; `user` locks remain mutation-blocked until the existing explicit unlock operation succeeds.
- Never retry or rebase an absolute draft after scene/revision conflict.
- Keep exactly one mounted `ShotExporter`; compact/expanded layout must not create a second export renderer.
- Stage only named files. Keep `.pnpm-store/` untracked and out of every commit.

## Task 1: Free Shot Rotation And Explicit Target Resolution

**Files:**

- Modify: `src/editor/shot-camera-navigation.ts`
- Create: `src/editor/shot-camera-target-lock.ts`
- Modify: `tests/shot-camera-navigation.test.ts`
- Create: `tests/shot-camera-target-lock.test.ts`

- [ ] Add failing pure-navigation tests for in-place free rotation.

  Cover unchanged position/scale, horizontal yaw, vertical pitch clamping, no roll, total-delta determinism, a complete horizontal revolution, and independence from scene constraints/framing.

- [ ] Run the focused tests and confirm the new assertions fail for the missing APIs.

  ```powershell
  pnpm exec vitest run tests/shot-camera-navigation.test.ts tests/shot-camera-target-lock.test.ts
  ```

- [ ] Add the explicit APIs and remove automatic target semantics from right-drag math.

  ```ts
  export const rotateShotCameraFree = (
    camera: CameraEntitySpec,
    totalDeltaPx: readonly [number, number],
  ): TransformSpec;

  export const deriveShotPanReferenceDistance = (
    scene: SceneSpec,
    camera: CameraEntitySpec,
    explicitTargetM?: Vec3 | null,
  ): number;
  ```

  `rotateShotCameraFree` must not accept `SceneSpec`. Recompute from the original transform and total pointer delta, clamp pitch to `SHOT_ORBIT_MAX_PITCH`, and build a normalized no-roll look quaternion. Rename `panShotCamera`'s target parameter to a positive distance scalar.

- [ ] Add transient target-list and target-center helpers.

  ```ts
  export interface ShotOrbitTargetOption {
    entityId: string;
    label: string;
    kind: "actor" | "prop";
  }

  export const listShotOrbitTargets = (scene: SceneSpec): ShotOrbitTargetOption[];
  export const resolveShotOrbitTargetCenter = (
    scene: SceneSpec,
    entityId: string,
  ): Vec3 | null;
  export const reconcileShotOrbitTargetId = (
    scene: SceneSpec,
    activeCameraId: string,
    previous: { sceneId: string; activeCameraId: string; entityId: string | null },
  ): string | null;
  ```

  List only visible actors/props in stable entity order. Actors use `actorVisibleRigBounds`; props use transformed geometry corners. Invalid, hidden, removed, or unsupported targets resolve to `null`.

- [ ] Run focused tests to green and commit.

  ```powershell
  pnpm exec vitest run tests/shot-camera-navigation.test.ts tests/shot-camera-target-lock.test.ts
  git add src/editor/shot-camera-navigation.ts src/editor/shot-camera-target-lock.ts tests/shot-camera-navigation.test.ts tests/shot-camera-target-lock.test.ts
  git commit -m "fix: make shot rotation explicitly targeted"
  ```

## Task 2: Integrate The Shot Target Selector Without Selection Side Effects

**Files:**

- Modify: `src/editor/ShotCameraNavigation.tsx`
- Modify: `tests/shot-camera-ui-contract.test.ts`
- Modify: `src/styles.css`

- [ ] Add failing UI-contract tests for the selector and gesture routing.

  Assert that the selector defaults to `Off (free rotation)`, lists only visible actors/props, is disabled while protected/disabled/drafting/committing, survives valid revisions, resets for scene/active-camera/target invalidation, and does not let navigation keys intercept native select input.

- [ ] Replace the auto-derived orbit target with a captured explicit choice.

  At pointer-down capture the current target ID and finite center. Route right-drag to `rotateShotCameraFree` when absent and `orbitShotCamera` only when present. Left-drag receives only a positive pan reference distance. Do not retarget an in-progress gesture.

- [ ] Remove `onSelectCamera` calls from mount, pointer-down, nudge, wheel, and key paths.

  Shot-camera navigation must not change studio selection or focus. Keep the existing pointer capture, wheel debounce, held-key transaction, workflow preservation, user-lock block, stale cancellation, and one-patch behavior.

- [ ] Add the labeled selector to the existing control band and keep the image unobscured.

  Use a real `<select aria-label="Right-drag orbit target">`; preserve keyboard access and mark the control as excluded from navigation-key handlers.

- [ ] Run focused tests and commit.

  ```powershell
  pnpm exec vitest run tests/shot-camera-navigation.test.ts tests/shot-camera-target-lock.test.ts tests/shot-camera-ui-contract.test.ts tests/shot-camera-commands.test.ts tests/shot-camera-session.test.ts
  git add src/editor/ShotCameraNavigation.tsx src/styles.css tests/shot-camera-ui-contract.test.ts
  git commit -m "feat: add explicit shot orbit target control"
  ```

## Task 3: Active Camera Command And Compact Preview Contract

**Files:**

- Modify: `src/editor/manual-patches.ts`
- Create: `src/editor/active-camera-command.ts`
- Create: `src/editor/CompactShotPreviewControls.tsx`
- Modify: `tests/manual-patches.test.ts`
- Create: `tests/active-camera-command.test.ts`
- Create: `tests/compact-shot-preview.test.tsx`

- [ ] Write failing tests for a domain patch helper and captured active-camera command.

  ```ts
  export const createActiveCameraPatch = (
    scene: SceneSpec,
    cameraId: string,
  ): ScenePatch | null;

  export const activateShotCamera = (
    getState: () => Pick<EditorStoreState, "scene" | "applyPatch">,
    cameraId: string,
  ): Promise<SceneSpec | null>;
  ```

  Assert camera existence/kind, no-op for current camera, exactly one `scene.active-camera.set`, no retry after failure, and permission to activate a user-protected camera without mutating it.

- [ ] Implement the helper and command through the existing store mutation path.

  Do not migrate constraints or change either camera transform/lens. Return the accepted authoritative scene or `null` for no-op/failure according to existing command conventions.

- [ ] Write failing component tests for the compact controls.

  Require active camera label, stable all-camera selector, output resolution/aspect label, explicit expand button, selector-only activation, and keyboard-accessible controls. Selecting a camera must not call studio selection/focus callbacks.

- [ ] Implement `CompactShotPreviewControls` as a presentation component with explicit callbacks.

- [ ] Run focused tests and commit.

  ```powershell
  pnpm exec vitest run tests/manual-patches.test.ts tests/active-camera-command.test.ts tests/compact-shot-preview.test.tsx
  git add src/editor/manual-patches.ts src/editor/active-camera-command.ts src/editor/CompactShotPreviewControls.tsx tests/manual-patches.test.ts tests/active-camera-command.test.ts tests/compact-shot-preview.test.tsx
  git commit -m "feat: add active shot camera controls"
  ```

## Task 4: Persistent Studio View And Always-Mounted Shot View

**Files:**

- Modify: `src/editor/spatial-preview.ts`
- Modify: `src/editor/CompactWorkspaceTabs.tsx`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/spatial-preview.test.ts`
- Modify: `tests/compact-workspace.test.ts`
- Create: `tests/studio-workspace-layout.test.tsx`

- [ ] Add failing contract tests for simultaneous studio and shot projection.

  Require Overview/Local as editor filters, remove Shot from the mutually exclusive spatial mode model, keep one editor scene mounted, keep one shot scene/exporter mounted, and model `shotPreviewExpanded` separately. Closing expanded preview must preserve the same editor-camera component instance.

- [ ] Refactor `ViewportWorkspace` to one R3F `Canvas` with two persistent `View` regions.

  The studio view fills the workspace. The shot view is a lower-right 16:9 overlay in compact mode and covers the refinement surface only while expanded. Pointer events are bounded to the visible view; compact controls carry `data-studio-keyboard-exclusion` and do not leak through to the studio.

- [ ] Keep `ShotScene` and `ShotExporter` mounted exactly once.

  `ShotScene` uses `scene.activeCameraId` in both layouts. Expansion changes only CSS/region geometry and the availability of `ShotCameraNavigation`; it must not create a second renderer/exporter or mutate the editor camera.

- [ ] Route compact camera selection through `activateShotCamera` and cancel incompatible shot-camera drafts before activation.

- [ ] Aggregate a temporary `hasLocalDraft` input in `App` and disable export for any draft category, initially including the existing shot-camera draft.

- [ ] Run layout/regression tests and commit.

  ```powershell
  pnpm exec vitest run tests/spatial-preview.test.ts tests/compact-workspace.test.ts tests/studio-workspace-layout.test.tsx tests/shot-exporter.test.ts tests/shot-regressions.test.ts
  git add src/editor/spatial-preview.ts src/editor/CompactWorkspaceTabs.tsx src/editor/ViewportWorkspace.tsx src/App.tsx src/styles.css tests/spatial-preview.test.ts tests/compact-workspace.test.ts tests/studio-workspace-layout.test.tsx
  git commit -m "feat: keep studio and shot preview visible together"
  ```

## Task 5: Studio Selection, Entity Bounds, Frame, And Follow

**Files:**

- Create: `src/editor/studio-selection.ts`
- Create: `src/editor/studio-interaction-math.ts`
- Create: `src/editor/EditorCameraRig.tsx`
- Modify: `src/editor/editor-store.ts`
- Create: `tests/studio-selection.test.ts`
- Create: `tests/studio-interaction-math.test.ts`
- Create: `tests/editor-focus-state.test.ts`

- [ ] Add failing tests for deterministic ordinary selection, double-click focus, right-click classification, Escape, and reconciliation.

  Use `STUDIO_POINTER_DRAG_THRESHOLD_PX = 5` and `STUDIO_DOUBLE_CLICK_MS = 300`. Actor/prop/camera support red focus; environment remains ordinary blue selection. A focused entity must also be selected. Scene replacement clears focus; same scene/entity/kind can retain focus across authoritative revision.

- [ ] Implement a pure selection reducer and add transient store fields/actions.

  ```ts
  focusedEntityId: string | null;
  focusedActorJointId: CanonicalPuppetJointId | null;
  focusRequestVersion: number;
  focusEntity(entityId: string): void;
  focusActorJoint(jointId: CanonicalPuppetJointId | null): void;
  clearStudioFocus(): void;
  reconcileStudioFocus(previousScene: SceneSpec | null, nextScene: SceneSpec): void;
  ```

  Keep these fields out of `SceneSpec`; run the same reconciliation path for command responses, SSE updates, undo, redo, and scene replacement.

- [ ] Add failing tests and pure math for actor/prop/camera bounds, frame-selected, and follow.

  ```ts
  export interface EntityWorldBound { centerM: Vec3; radiusM: number }
  export interface EditorCameraFrame { positionM: Vec3; targetM: Vec3 }
  export const resolveEntityWorldBound = (
    scene: SceneSpec,
    entityId: string,
    transformOverrides?: Readonly<Record<string, TransformSpec | undefined>>,
  ): EntityWorldBound | null;
  export const frameSelectedBound = (
    bound: EntityWorldBound,
    viewDirection: Vec3,
    verticalFovDeg: number,
    aspect: number,
    options?: { fitFraction?: number; minimumDistanceM?: number },
  ): EditorCameraFrame | null;
  export const followFocusedCenter = (
    frame: EditorCameraFrame,
    previousCenterM: Vec3,
    nextCenterM: Vec3,
  ): EditorCameraFrame;
  ```

  Actor bounds use visible-rig points; prop bounds use all transformed corners; camera proxy bounds share a fixed generic point set. Preserve current view direction and fit both vertical/horizontal FOV. Follow translates camera and target by center delta without reframing.

- [ ] Implement `EditorCameraRig` with stable `PerspectiveCamera`/`OrbitControls` refs.

  It owns UI-only frame/follow application and remains mounted across shot-preview expansion. It must never write scene state.

- [ ] Run focused tests and commit.

  ```powershell
  pnpm exec vitest run tests/studio-selection.test.ts tests/studio-interaction-math.test.ts tests/editor-focus-state.test.ts
  git add src/editor/studio-selection.ts src/editor/studio-interaction-math.ts src/editor/EditorCameraRig.tsx src/editor/editor-store.ts tests/studio-selection.test.ts tests/studio-interaction-math.test.ts tests/editor-focus-state.test.ts
  git commit -m "feat: add deterministic studio focus and framing"
  ```

## Task 6: Lock-Preserving Entity Movement Sessions

**Files:**

- Create: `src/editor/studio-gesture-session.ts`
- Create: `src/editor/studio-entity-commands.ts`
- Create: `src/editor/StudioInteractionController.tsx`
- Modify: `src/editor/manual-patches.ts`
- Modify: `src/App.tsx`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Create: `tests/studio-gesture-session.test.ts`
- Create: `tests/studio-entity-commands.test.ts`
- Create: `tests/studio-direct-drag.test.ts`
- Create: `tests/studio-keyboard-movement.test.ts`
- Create: `tests/studio-right-pointer.test.ts`

- [ ] Add failing tests for exact captured sessions and lock decisions.

  A session is valid only for the captured scene, revision, entity ID, kind, and focus. `none` commits normally, `workflow` commits with `preserveLock: true`, `user` never creates a draft, and a cancelled/stale session never submits.

- [ ] Add pure ground-drag and editor-relative keyboard movement tests to `studio-interaction-math.test.ts`.

  Implement ray/horizontal-plane intersection, no-jump X/Z drag with captured pointer offset, horizontal forward/right axes, 0.1 m default, 0.5 m Shift, 0.02 m Alt-priority, and PageUp/PageDown world-Y movement.

- [ ] Implement transform command with latest-authority validation and no retry.

  `entity.transform.set` is the only mutation. Contact snapping occurs deterministically at commit; no-op drafts submit nothing. Pending drafts remain projected until accepted/failure/conflict resolution.

- [ ] Implement the single input-owner `StudioInteractionController`.

  Coordinate body pointer drag, keyboard-held-key transaction, TransformControls ownership, short right click versus right-drag pan, Escape/cancel, active-camera expansion exclusion, and explicit reset of Three object transforms after cancelled gizmo mutation.

- [ ] Make only red-focused actor/prop/camera editable.

  Actor torso/pelvis, prop body, and camera proxy can begin ground drag. Workflow entities expose handles; user-protected entities remain inspectable but expose no mutation handle. Environment never enters focused edit mode.

- [ ] Project entity transform drafts into both studio and compact shot views and include them in `hasLocalDraft` export blocking.

- [ ] Implement studio keyboard ownership.

  The studio surface must be focused; ignore input, textarea, select, contenteditable, `[data-studio-keyboard-exclusion]`, compact preview, and expanded shot controls. Multiple held keys share one captured session and commit only after the last keyup.

- [ ] Run focused tests and commit.

  ```powershell
  pnpm exec vitest run tests/studio-interaction-math.test.ts tests/studio-gesture-session.test.ts tests/studio-entity-commands.test.ts tests/studio-direct-drag.test.ts tests/studio-keyboard-movement.test.ts tests/studio-right-pointer.test.ts tests/editor-concurrency.test.ts tests/lock-preservation.test.ts
  git add src/editor/studio-interaction-math.ts src/editor/studio-gesture-session.ts src/editor/studio-entity-commands.ts src/editor/StudioInteractionController.tsx src/editor/manual-patches.ts src/editor/ViewportWorkspace.tsx src/App.tsx tests/studio-interaction-math.test.ts tests/studio-gesture-session.test.ts tests/studio-entity-commands.test.ts tests/studio-direct-drag.test.ts tests/studio-keyboard-movement.test.ts tests/studio-right-pointer.test.ts
  git commit -m "feat: add direct studio entity manipulation"
  ```

## Task 7: Shared Actor Part Targets And Direct Joint Handles

**Files:**

- Create: `src/editor/actor-part-target.ts`
- Modify: `src/domain/actor-projection.ts`
- Modify: `src/three/RefinedMannequin.tsx`
- Modify: `src/three/SceneWorld.tsx`
- Create: `tests/actor-part-target.test.ts`
- Modify: `tests/actor-projection.test.ts`
- Create: `tests/scene-world-studio-contract.test.ts`

- [ ] Add failing mapping tests for every canonical procedural/refined primitive.

  Head/face/neck map to `neck`; shoulder/upper-arm, elbow/forearm, hand, hip/upper-leg, knee/lower-leg, and foot map by side to their canonical one-joint target. Torso/pelvis return a whole-entity body handle. Absent-limb geometry and `module:*` Blueprint primitives never return a joint target.

- [ ] Extend resolved actor projection with renderer-independent joint handle metadata.

  ```ts
  export interface ActorDirectJointHandle {
    jointId: DirectActorJointId;
    parentFrame: NumericFrame;
    restDirection: Vec3;
    segmentLengthM: number;
    primitiveIds: readonly string[];
  }
  ```

  Build handles from canonical rig anatomy, not mesh-node names. Do not persist them. Explicit parent frames are required because a rendered primitive frame is not always the joint parent frame.

- [ ] Add shared hit metadata and color priority to both procedural and refined paths.

  Green focused part overrides red entity focus, which overrides blue ordinary selection. All primitives belonging to the same selected joint render green; the remaining focused actor stays red. Do not add per-frame global renderer state.

- [ ] Keep the existing TransformControls contract except for focused/workflow visibility already introduced in Task 6.

- [ ] Run actor/projection/renderer tests and commit.

  ```powershell
  pnpm exec vitest run tests/actor-part-target.test.ts tests/actor-projection.test.ts tests/actor-puppet-projection.test.ts tests/actor-rig-projection.test.ts tests/refined-mannequin-renderer.test.ts tests/scene-world-studio-contract.test.ts
  git add src/editor/actor-part-target.ts src/domain/actor-projection.ts src/three/RefinedMannequin.tsx src/three/SceneWorld.tsx tests/actor-part-target.test.ts tests/actor-projection.test.ts tests/scene-world-studio-contract.test.ts
  git commit -m "feat: expose actor parts for studio editing"
  ```

## Task 8: View-Relative Single-Joint Drag Math And Command

**Files:**

- Create: `src/editor/actor-joint-drag.ts`
- Create: `src/editor/actor-joint-commands.ts`
- Modify: `src/editor/manual-patches.ts`
- Modify: `src/domain/scene-math.ts`
- Create: `tests/actor-joint-drag.test.ts`
- Create: `tests/actor-joint-commands.test.ts`
- Modify: `tests/manual-patches.test.ts`

- [ ] Write failing numeric tests for pointer-ray/view-plane joint dragging.

  Cover pointer-down no-jump, front-versus-side view distinction, normalized output, deterministic total-delta behavior, axial-twist preservation, nonuniform actor scale, near-parallel ray, zero-length direction, 180-degree shortest arc, and quaternion sign equivalence.

- [ ] Implement a pure captured drag model using the full parent world linear transform.

  ```ts
  export interface ActorJointDragCapture {
    actorId: string;
    jointId: DirectActorJointId;
    originalJointRotation: QuaternionTuple;
    jointOriginWorldM: Vec3;
    originalEndpointWorldM: Vec3;
    originalPlaneHitWorldM: Vec3;
    manipulationPlaneNormal: Vec3;
    inverseParentWorldLinear: Mat3Tuple;
    restDirectionParent: Vec3;
  }

  export const beginActorJointDrag = (input: {
    actorId: string;
    jointId: DirectActorJointId;
    originalJointRotation: QuaternionTuple;
    jointOriginWorldM: Vec3;
    originalEndpointWorldM: Vec3;
    manipulationPlaneNormal: Vec3;
    inverseParentWorldLinear: Mat3Tuple;
    restDirectionParent: Vec3;
    pointerRay: NumericRay;
  }): ActorJointDragCapture | null;
  export const updateActorJointDrag = (
    capture: ActorJointDragCapture,
    pointerRay: NumericRay,
  ): QuaternionTuple | null;
  ```

  Intersect the current ray with the captured image-parallel plane, apply the plane-hit delta to the captured endpoint, convert desired world direction through the inverse parent linear transform, and compose a shortest-arc swing with the original local quaternion. Change exactly one joint.

- [ ] Extend `createActorJointPatch` with `ManualPatchOptions` and add a captured command.

  The command follows transform-session rules: `none` commits, `workflow` uses `preserveLock: true`, `user` blocks, no-op/stale/cancelled submits nothing, and failure never retries.

- [ ] Run focused tests and commit.

  ```powershell
  pnpm exec vitest run tests/actor-joint-drag.test.ts tests/actor-joint-commands.test.ts tests/manual-patches.test.ts tests/actor-puppet-patch.test.ts
  git add src/editor/actor-joint-drag.ts src/editor/actor-joint-commands.ts src/editor/manual-patches.ts src/domain/scene-math.ts tests/actor-joint-drag.test.ts tests/actor-joint-commands.test.ts tests/manual-patches.test.ts
  git commit -m "feat: add view-relative actor joint dragging"
  ```

## Task 9: Integrate Actor Part Focus, Pose Drafts, And Accessible Status

**Files:**

- Modify: `src/editor/StudioInteractionController.tsx`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `src/three/SceneWorld.tsx`
- Modify: `src/editor/Outliner.tsx`
- Modify: `src/editor/Inspector.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Create: `tests/studio-actor-part-integration.test.tsx`
- Create: `tests/studio-workspace-integration.test.tsx`
- Modify: `tests/lock-ui-semantics.test.ts`

- [ ] Add failing integration tests for red actor focus, supported part click to green, one-joint draft, and clear/cancel behavior.

  Individual part hit testing is enabled only after actor focus. Torso/pelvis remain body-drag handles. Part drag disables OrbitControls, projects the pose override into studio and shot preview, blocks export, commits one joint once, and restores authority on cancel/conflict/failure.

- [ ] Wire actor handle metadata and joint-drag command into the studio controller.

  Capture the exact editor camera basis/ray and exact scene/revision/actor/joint. A focus change, missing part, scene change, external authoritative revision, right click, Escape, or pointer cancel discards the draft without retry.

- [ ] Add camera double-click activation without coupling focus and activation.

  Focus/frame the camera immediately. If inactive, submit one active-camera patch; failure keeps inspection focus but leaves the authoritative active camera unchanged. Actor/prop double-click never activates a camera. Compact selector activation never changes studio focus.

- [ ] Aggregate shot transform, entity transform, and actor pose drafts.

  Both views receive identical overrides. `hasLocalDraft` blocks export and active-camera switches cancel only incompatible drafts. Accepted scene responses must not overwrite a newer authoritative store revision.

- [ ] Add non-color status and alternatives.

  Outliner and Inspector show ordinary selection, entity edit focus, and focused joint text. Add keyboard-operable `Focus in studio`. Keep the existing explicit user-unlock path and ensure workflow remains workflow after direct edits.

- [ ] Run integration/regression tests and commit.

  ```powershell
  pnpm exec vitest run tests/studio-actor-part-integration.test.tsx tests/studio-workspace-integration.test.tsx tests/lock-ui-semantics.test.ts tests/editor-concurrency.test.ts tests/shot-regressions.test.ts tests/shot-exporter.test.ts
  git add src/editor/StudioInteractionController.tsx src/editor/ViewportWorkspace.tsx src/three/SceneWorld.tsx src/editor/Outliner.tsx src/editor/Inspector.tsx src/App.tsx src/styles.css tests/studio-actor-part-integration.test.tsx tests/studio-workspace-integration.test.tsx tests/lock-ui-semantics.test.ts
  git commit -m "feat: integrate studio actor part editing"
  ```

## Task 10: Documentation, Full Gates, And Browser Acceptance

**Files:**

- Modify: `README.md`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: relevant files under `.agents/skills/shubi-shot-director/references/`
- Modify: `docs/verification.md`
- Modify: UI contract or regression tests only when browser verification exposes a reproducible defect

- [ ] Update user and Skill guidance.

  State that the editor camera is UI-only; compact preview shows the active persistent shot camera; camera selection/activation is explicit; double-click focuses; red means entity edit; green means one joint; limb drag follows editor viewpoint; expanded shot right-drag is free by default and orbits only an explicit visible actor/prop target. Remove wording that says Shot Preview replaces the studio or automatically follows a composition/keep-visible target.

- [ ] Run focused tests for every milestone, then the full repository gates.

  ```powershell
  pnpm test:parallel
  pnpm test:workspace-e2e
  pnpm verify
  git diff --check
  pnpm audit:public
  ```

- [ ] Read `.agents/skills/shubi-shot-director/references/visual-qa.md` completely before making visual or export claims.

- [ ] Start the connected local workspace and perform real-browser acceptance with a generic scene containing two cameras, one actor, one prop, and one workflow-locked editable entity.

  Verify distant double-click framing/follow; torso/prop/camera movement; front/side one-joint drag; compact camera selector; camera double-click activation; expanded free rotation and explicit actor/prop orbit; keys/modifiers; right-click/Escape; workflow/user locks; undo/redo; external-revision cancellation; no console errors; and connected generic 1920×1080 export metadata (`sceneId`, revision, dimensions, SHA-256, warnings).

- [ ] Audit scope and generated/public cleanliness before the final commit.

  ```powershell
  git status --short
  git diff --stat
  git diff --check
  git diff -- . ':!.pnpm-store/**'
  ```

  Confirm no schema version changed, no private/project-specific data entered the repository, and `.pnpm-store/` remains untracked and unstaged.

- [ ] Commit the verified documentation and evidence.

  ```powershell
  git add README.md .agents/skills/shubi-shot-director/SKILL.md .agents/skills/shubi-shot-director/references docs/verification.md
  git diff --cached --check
  git commit -m "docs: verify direct studio manipulation"
  ```

## Completion Review

- [ ] Dispatch an independent spec-compliance reviewer against both approved design documents and this plan.
- [ ] Dispatch an independent code-quality reviewer over the complete implementation range.
- [ ] Fix every Critical or Important finding with a failing regression test first, rerun focused and full gates, and commit fixes separately.
- [ ] Re-run `pnpm verify`, `pnpm audit:public`, and `git diff --check` from the final commit before reporting completion.
