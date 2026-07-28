# Shot Preview Always-On Camera Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shot Preview camera controls immediately usable and add reliable six-way movement buttons.

**Architecture:** Remove the separate activation state from `ShotCameraNavigation` and derive eligibility from the active camera and editor state. Reuse `moveShotCameraByKey` for both keys and button clicks so every input path shares direction semantics and the existing lock-preserving commit callback.

**Tech Stack:** React, TypeScript, Vitest, CSS, Three.js projection through the existing editor workspace.

---

### Task 1: Prove The Broken Activation Contract

**Files:**
- Modify: `tests/shot-camera-ui-contract.test.ts`

- [ ] **Step 1: Require an always-owned surface and six explicit movement buttons**

Update the source contract to reject `useState(false)`, `aria-pressed`, and
conditional pointer events. Require unconditional context-menu prevention plus
the labels `镜头前移`, `镜头后移`, `镜头左移`, `镜头右移`, `镜头上移`, and
`镜头下移`.

- [ ] **Step 2: Verify the test fails for the inactive-mode implementation**

Run `pnpm vitest run tests/shot-camera-ui-contract.test.ts` and require a
failure caused by the old activation contract.

### Task 2: Implement Always-On Input And Button Commits

**Files:**
- Modify: `src/editor/ShotCameraNavigation.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Remove activation state and mode entry/exit branches**

Make eligibility equal to `!disabled && camera != null && camera.lockMode !==
"user"`. Keep the transparent surface mounted, focus it when eligible, and
always call `event.preventDefault()` for its `contextmenu` event.

- [ ] **Step 2: Add one-click movement commits**

For each movement button, clone the current camera, create one gesture session,
call `moveShotCameraByKey`, and pass the result to `commitTransform`. Disable
all buttons when the camera is ineligible.

- [ ] **Step 3: Add compact stable styling**

Place a six-button icon pad beside the focal-length readout with fixed 30 px
controls, no nested cards, no overlap with the preview label, and familiar
arrow symbols plus tooltips/accessible labels.

- [ ] **Step 4: Verify the focused contract turns green**

Run `pnpm vitest run tests/shot-camera-ui-contract.test.ts
tests/shot-camera-navigation.test.ts tests/shot-camera-commands.test.ts` and
require all selected tests to pass.

### Task 3: Regression And Browser Acceptance

**Files:**
- Modify only if evidence is recorded: `docs/verification.md`

- [ ] **Step 1: Run static and repository gates**

Run `pnpm typecheck`, `pnpm lint`, `pnpm verify`, `pnpm audit:public`, and
`git diff --check`.

- [ ] **Step 2: Exercise the real Shot Preview**

At the loopback UI, verify without clicking an activation toggle that keyboard
movement advances the revision, every movement button advances exactly one
revision in the expected direction, and right-click produces no browser menu.
Confirm mouse pan/orbit and wheel remain functional, user lock disables the
controls, console errors are absent, and controls do not overlap at desktop
and compact widths.

- [ ] **Step 3: Commit the verified implementation**

Stage only the plan, spec, focused tests, component, styles, and any concise
verification record; commit a stable milestone without merging or pushing.
