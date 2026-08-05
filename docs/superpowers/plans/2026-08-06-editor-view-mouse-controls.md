# Editor View Mouse Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.9.2 with empty-space left-drag panning, right-drag orbiting, and thresholded right-click selection clearing in the UI-only studio editor view.

**Architecture:** Keep `EditorCameraRig` and its Drei `OrbitControls` as transient UI state, but give their mouse buttons an explicit mapping. Classify the editor surface's right-button gesture in `StudioInteractionController`; remove competing React Three Fiber context-menu mutation paths so only a short right click clears selection. No gesture in this plan authors a `ScenePatch` or changes a shot camera.

**Tech Stack:** React 19, TypeScript 6, React Three Fiber 9, Drei 10, Three.js 0.182, Vitest 4, pnpm 11.

---

## Guardrails

- Keep SceneSpec and ScenePatch schemas unchanged.
- Keep editor camera, gesture state, selection, and focus out of persistent scene state.
- Preserve focused entity left-drag, limb drag, wheel zoom, and expanded Shot Preview controls.
- Use the existing `STUDIO_POINTER_DRAG_THRESHOLD_PX = 5` boundary: exactly 5 px clears, more than 5 px orbits without clearing.
- Stage only named files; leave `.pnpm-store/` untracked.

### Task 1: Lock The Intended Mouse Contract With Failing Tests

**Files:**

- Modify: `tests/editor-camera-rig.test.ts`
- Modify: `tests/studio-selection.test.ts`
- Modify: `tests/studio-world-interaction.test.ts`

- [ ] Add a test importing `EDITOR_VIEW_MOUSE_BUTTONS` and asserting `{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }`.
- [ ] Add right-button classification assertions proving exactly 5 px returns `"clear"` and 6 px returns `"orbit"`.
- [ ] Replace the old SceneWorld context-menu expectation with a contract that `StudioInteractionController` listens for `pointerdown`, `pointermove`, `pointerup`, cancellation, and `contextmenu`, while `SceneWorld` contains no context-menu selection clearing.
- [ ] Run `pnpm exec vitest run tests/editor-camera-rig.test.ts tests/studio-selection.test.ts tests/studio-world-interaction.test.ts` and confirm failures identify the missing mapping, old `"pan"` classification, and decentralized context-menu handlers.

### Task 2: Implement The Minimal Editor-View Fix

**Files:**

- Modify: `src/editor/EditorCameraRig.tsx`
- Modify: `src/editor/studio-selection.ts`
- Modify: `src/editor/StudioInteractionController.tsx`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `src/three/SceneWorld.tsx`

- [ ] Export and pass this explicit mapping to `OrbitControls`:

  ```ts
  export const EDITOR_VIEW_MOUSE_BUTTONS = {
    LEFT: MOUSE.PAN,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.ROTATE,
  } as const;
  ```

- [ ] Rename the right-drag `StudioPointerClassification` result from `"pan"` to `"orbit"`.
- [ ] In `StudioInteractionController`, record a right-button pointer-down point, mark it dragged only after the shared threshold, clear focus on pointer-up only for a short click, always suppress native context menus, and discard gesture state on cancel, lost capture, leave, cleanup, or disabled interaction.
- [ ] Remove entity/root `onContextMenu` clearing from `SceneWorld` and remove the editor section's unconditional React `onContextMenu` callback.
- [ ] Change the editor viewport label to `Editor viewport. Left-drag to pan, right-drag to orbit, and scroll to zoom.`
- [ ] Re-run the three focused test files to green, then run the existing direct-drag and shot-camera regression files.

### Task 3: Record v0.9.2 As A Maintenance Release

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/public-release.md`
- Create: `docs/releases/v0.9.2.md`
- Modify: `docs/verification.md`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `tests/public-release-audit.test.ts`
- Modify: `tests/public-onboarding.test.ts`
- Modify: `tests/runtime-capabilities.test.ts`
- Modify: `tests/structured-runtime-e2e.test.ts`

- [ ] Update version-contract tests first from `0.9.0`/`v0.9.0` to `0.9.2`/`v0.9.2`, then run them and confirm they fail against current metadata and docs.
- [ ] Set `package.json` to `0.9.2`; update README controls/version links, public release parameters, Skill editor-view guidance, and verified-platform wording.
- [ ] Add `docs/releases/v0.9.2.md` describing the two root causes, the corrected mapping, unchanged shot-camera boundary, checks, and graybox limits.
- [ ] Prepend `docs/verification.md` with the exact v0.9.2 focused/browser/full-gate evidence gathered during this work.
- [ ] Run the focused release-contract tests to green.

### Task 4: Verify, Commit, Push, And Update GitHub

**Files:**

- Verify all modified source, tests, docs, and generated schema outputs.

- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm audit:public`, and the generic-output audit.
- [ ] Start the local development server and perform real-browser checks for empty-space left pan, right orbit, short right-click clear, entity left-drag, unchanged scene revision during view navigation, and unchanged Shot Preview.
- [ ] Run fresh final gates: `pnpm verify` and `git diff --check`.
- [ ] Inspect `git status --short`, the scoped diff, and `git diff-tree` after commit; exclude `.pnpm-store/`.
- [ ] Commit the v0.9.2 implementation, push `codex/direct-studio-manipulation`, update PR #3 to v0.9.2 with real verification evidence, and prepare the matching GitHub release announcement without moving the existing v0.9.0 tag.
