# Refined White Mannequin v0.8.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing each task and superpowers:verification-before-completion before the release claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Shubi Shot Director v0.8.0 with a substantially more refined built-in white mannequin while preserving SceneSpec v6, the existing fifteen-joint pose controls, Actor Blueprint behavior, contact, composition, persistence, and browser PNG export.

**Architecture:** Keep `resolveActorProjection` as the sole analytical actor representation. Add one audited built-in CC0 GLB whose fourteen normalized mesh sections replace the corresponding profile or ellipsoid geometry only in the Three.js renderer. The existing procedural actor remains the deterministic loading and validation fallback; joint indicators, face direction marker, and Blueprint modules stay procedural.

**Tech Stack:** Blender 4.2 LTS conversion script, glTF 2.0/GLB, TypeScript 6, React 19, React Three Fiber, Three.js, Vitest, Node.js 22, pnpm.

---

## File structure

New focused files:

- `scripts/assets/build-refined-mannequin.py`: deterministic offline conversion from the audited Blender Studio source.
- `public/assets/refined-white-mannequin-v1.glb`: optimized built-in runtime mesh, under the public-audit size limit.
- `public/assets/refined-white-mannequin-v1.json`: public asset manifest with stable nodes, bounds, counts, hash, and attribution identity.
- `docs/assets/refined-white-mannequin-v1.md`: CC0 provenance and exact reproduction instructions without machine-specific paths.
- `src/three/mannequin-asset.ts`: closed built-in asset contract, manifest parser, node validation, and primitive-to-mesh transform.
- `src/three/RefinedMannequin.tsx`: GLB loading, validation, mesh cloning, loading fallback, and error fallback.
- `tests/mannequin-asset.test.ts`: manifest, URL, mapping, transform, and committed-asset integrity tests.
- `tests/mannequin-converter.test.ts`: converter contract and reproducibility metadata tests.
- `docs/releases/v0.8.0.md`: user-facing release scope and known limits.

Existing files changed by responsibility:

- Browser projection: `src/three/SceneWorld.tsx`.
- Public release gate: `tests/public-release-audit.test.ts` and, only if required, `scripts/audit-public-release.mjs`.
- Version/capabilities/docs: `package.json`, `README.md`, `.agents/skills/shubi-shot-director/SKILL.md`, `.agents/skills/shubi-shot-director/runtime.json`, `docs/public-release.md`, `docs/verification.md`.

## Fixed asset contract

The GLB contains exactly these refined mesh nodes:

`pelvis`, `torso`, `neck`, `head`, left/right `upper_arm`, `forearm`, `hand`, `upper_leg`, `lower_leg`, and `foot`.

The converter normalizes every section into a centered unit box. Runtime maps that box to the authoritative analytical primitive bounds. Side-specific source geometry is retained, fingers are joined into each hand, toes are joined into each foot, and sex-specific source geometry is excluded. There is one white material, no armature, animation, texture, camera, light, source path, or private metadata.

---

### Task 1: Lock the built-in asset contract with failing tests

**Files:**

- Create: `tests/mannequin-asset.test.ts`
- Create: `src/three/mannequin-asset.ts`

- [ ] **Step 1: Write the manifest and URL tests**

Assert that the desired module exports one immutable relative URL, fourteen canonical node IDs, and a strict parser. Reject remote, protocol-relative, traversal, absolute filesystem, missing-node, duplicate-node, non-CC0, extra-material, invalid-hash, and over-2-MB manifests.

- [ ] **Step 2: Write primitive mapping tests**

Use neutral, rotated, short, tall, and incomplete-limb projections. Assert that `refinedSectionForPrimitive` maps only the fourteen body primitives, maps left/right IDs exactly, does not map face markers, joint indicators, or Blueprint modules, and omits absent projection sections naturally.

- [ ] **Step 3: Write transform tests**

Assert that a normalized section maps to the primitive's local center and visible dimensions without changing the primitive frame. Profiles derive width from maximum radius, height from min/max `y`, and depth from `depthScale`; ellipsoids derive full dimensions from their radii.

- [ ] **Step 4: Confirm the focused test fails for the missing module**

Run:

```powershell
pnpm vitest run tests/mannequin-asset.test.ts
```

Expected: FAIL because the built-in asset module does not exist.

- [ ] **Step 5: Implement the minimum pure contract**

Implement strict manifest parsing, canonical mapping, and pure transforms. Do not load network URLs, mutate SceneSpec, infer identity from labels, or add public renderer options.

- [ ] **Step 6: Run focused tests and commit**

Run `pnpm vitest run tests/mannequin-asset.test.ts` and `pnpm typecheck`.

Commit: `feat: define built-in refined mannequin contract`

### Task 2: Build and audit the CC0 segmented GLB

**Files:**

- Create: `scripts/assets/build-refined-mannequin.py`
- Create: `tests/mannequin-converter.test.ts`
- Create: `public/assets/refined-white-mannequin-v1.glb`
- Create: `public/assets/refined-white-mannequin-v1.json`
- Create: `docs/assets/refined-white-mannequin-v1.md`

- [ ] **Step 1: Write the converter contract test**

Assert that the script declares the exact source collection names and fourteen output nodes, excludes the female breast object, joins fingers/toes to terminal sections, uses one subdivision level, applies transforms, removes unused authoring objects, and exports GLB without animations, cameras, lights, or custom properties.

- [ ] **Step 2: Confirm the test fails**

Run `pnpm vitest run tests/mannequin-converter.test.ts`.

Expected: FAIL because the committed converter does not exist.

- [ ] **Step 3: Implement and run the Blender converter**

Invoke the script through Blender's background Python mode with explicit `--source` and `--output` arguments. Average shared female/male base topology before subdivision, preserve side-specific shape, join source subsections by canonical section, normalize each final mesh to a centered unit box, smooth shading, and use one neutral white material.

- [ ] **Step 4: Generate and inspect the committed asset**

Record source bundle version, official URLs, source ZIP SHA-256, final GLB SHA-256, byte length, triangles, one material, and per-node normalized bounds. Ensure the GLB is below 2 MB and contains no armature, animation, camera, light, texture, external URI, or machine path.

- [ ] **Step 5: Run asset and audit tests and commit**

Run:

```powershell
pnpm vitest run tests/mannequin-asset.test.ts tests/mannequin-converter.test.ts tests/public-release-audit.test.ts
pnpm audit:public
```

Commit: `feat: add audited CC0 refined mannequin asset`

### Task 3: Render refined sections with deterministic fallback

**Files:**

- Create: `src/three/RefinedMannequin.tsx`
- Modify: `src/three/SceneWorld.tsx`
- Modify: `tests/mannequin-asset.test.ts`

- [ ] **Step 1: Add failing renderer contract tests**

Assert the renderer consumes only the built-in URL, validates every required mesh before rendering, preserves actor color/selection material behavior, clones geometry instead of mutating the shared loader scene, and retains procedural face, joint indicators, and Blueprint modules. Assert incomplete limbs render the remaining refined sections.

- [ ] **Step 2: Confirm the focused tests fail**

Run `pnpm vitest run tests/mannequin-asset.test.ts tests/actor-profile-rendering.test.ts`.

- [ ] **Step 3: Implement loading and error boundaries**

Use the existing local Three.js stack. During loading, render the complete procedural mannequin. If the GLB or required node validation fails, keep the procedural mannequin and emit at most one generic browser diagnostic. Never block editing or propagate an unhandled loader rejection.

- [ ] **Step 4: Replace only supported body geometry**

Apply the primitive frame unchanged, then the pure local position/scale mapping. Retain procedural geometry for face orientation, shoulders, elbows, hips, knees, Blueprint modules, and any unmapped primitive. Missing-limb states are represented by the projection's absent sections, not by hiding source nodes independently.

- [ ] **Step 5: Run renderer and actor regressions and commit**

Run:

```powershell
pnpm vitest run tests/mannequin-asset.test.ts tests/actor-profile-rendering.test.ts tests/actor-*.test.ts tests/contact-constraints.test.ts
pnpm typecheck
pnpm build
```

Commit: `feat: render actors with refined built-in mannequin`

### Task 4: Publish v0.8.0 capability and compatibility docs

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Modify: `docs/public-release.md`
- Modify: `docs/verification.md`
- Create: `docs/releases/v0.8.0.md`
- Modify: `tests/public-release-audit.test.ts`
- Modify: any existing exact-version tests found by `rg '0\\.7\\.0|v0\\.7'`.

- [ ] **Step 1: Write failing version and public-scope assertions**

Require package and Skill runtime version `0.8.0`, a present v0.8.0 release note, generic CC0 provenance, deterministic fallback language, and explicit non-support for arbitrary GLB import, skinning, animation, facial performance, clothing, hair, and final character production.

- [ ] **Step 2: Update public capability text**

Describe the visible improvement as a refined articulated white mannequin. Keep the semantic contract clear: Host Codex still authors SceneSpec/ScenePatch; the built-in mesh is only a renderer projection.

- [ ] **Step 3: Run compatibility and public gates and commit**

Run:

```powershell
pnpm vitest run tests/public-release-audit.test.ts tests/runtime-capabilities.test.ts tests/skill-compatibility.test.ts tests/skill-scripts.test.ts
pnpm audit:public
```

Commit: `docs: release refined white mannequin v0.8.0`

### Task 5: Full verification and visual acceptance

**Files:**

- Update only if evidence requires a fix: implementation files above.
- Store local acceptance screenshots only under ignored `.shubi-shot/` state.

- [ ] **Step 1: Run the fresh repository gate**

Run:

```powershell
pnpm verify
git diff --check
git status --short
```

Expected: schemas, typecheck, all tests, lint, build, public audit, and whitespace checks pass; `.pnpm-store/` remains untracked and excluded.

- [ ] **Step 2: Start the real local Director**

Use an available loopback port and verify the bridge health before browser testing.

- [ ] **Step 3: Perform desktop and mobile canvas acceptance**

Capture and inspect neutral front, three-quarter, bent-arm, Walking preset, short/tall stature, incomplete-limb, and forced-fallback cases. Confirm the canvas is nonblank, framing is complete, actor contact is preserved, mapped pieces do not overlap incoherently, controls remain usable, and no relevant console errors occur.

- [ ] **Step 4: Export the final-camera PNG**

Verify the browser-authored PNG shows the same refined actor and remains nonblank at the requested dimensions. Treat visual taste as user approval, not an automated pass.

- [ ] **Step 5: Request code review and resolve findings**

Ask a reviewer to inspect the complete branch diff for contract regressions, asset provenance/integrity, loader failure behavior, public cleanliness, and missing tests. Fix every Critical or Important issue and rerun the relevant gates.

- [ ] **Step 6: Commit final verified corrections**

Commit only stable scoped changes. Report v0.8.0 capabilities, fallback behavior, verification evidence, and remaining product limits.
