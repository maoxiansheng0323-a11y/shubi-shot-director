# Generic Connected Multi-Region Scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic same-floor connected-region SceneSpec v2 with deterministic walls/openings/connections, overview/local/shot views, legacy single-room migration, and a real abstract black-box export.

**Architecture:** Keep actors, props, cameras, constraints, and revisioned `SceneSession` unchanged while adding a nullable `SpatialLayout` to SceneSpec v2. Host Codex authors all region semantics; focused domain modules validate and derive geometry, rendering projects that geometry, and UI-only view state switches between overview, local focus, and the already-authoritative shot camera.

**Tech Stack:** TypeScript 6, Zod 4, React 19, React Three Fiber, Drei, Three.js, Zustand, Vitest, Express, pnpm.

---

## File structure

### New focused modules

- `src/domain/spatial-layout.ts`: spatial Zod schemas, polygon/boundary/opening validation, adjacency, bounds, and wall-segment derivation.
- `src/domain/scene-migrations.ts`: SceneSpec v1, ScenePatch v1, and IntentReport v1 parsing/migration into canonical v2.
- `src/three/SpatialLayoutWorld.tsx`: region-floor and split-wall Three.js projections.
- `src/editor/spatial-view.ts`: pure overview/local view-state and opacity calculations.
- `tests/spatial-layout.test.ts`: spatial schema and derived-geometry unit tests.
- `tests/scene-migrations.test.ts`: legacy compatibility tests.
- `tests/spatial-patch.test.ts`: allowlisted spatial patch behavior.
- `tests/spatial-composition.test.ts`: opening sightline and boundary collision tests.
- `tests/spatial-view.test.ts`: UI-only focus and opacity tests.
- `tests/connected-regions-blackbox.test.ts`: real structured server/CLI acceptance assertions where reusable.
- `examples/connected-regions.scene-submission.json`: committed abstract three-region submission.

### Existing modules to change

- `src/domain/schema-versions.ts`, `scene-schema.ts`, `shared-schemas.ts`,
  `scene-patch.ts`, `apply-scene-patch.ts`, `intent-report.ts`,
  `intent-coverage.ts`, `scene-submission.ts`, `default-scene.ts`,
  `composition-safety.ts`: versioned contracts and deterministic behavior.
- `server/scene-session.ts`, `scene-persistence.ts`, `software-png.ts`,
  `cli/director-runtime.ts`, `src/editor/scene-files.ts`,
  `scene-client.ts`: use canonical migration at external input boundaries.
- `cli/runtime-capabilities.ts`, generated Skill schemas, Skill runtime
  metadata, compatibility scripts, and their tests: publish schema v2.
- `src/three/SceneWorld.tsx`, `src/editor/ViewportWorkspace.tsx`,
  `Outliner.tsx`, `Inspector.tsx`, `App.tsx`, `styles.css`: render and expose
  overview/local/shot behavior.
- `.agents/skills/shubi-shot-director/SKILL.md` and relevant references:
  replace the connected-environment unsupported path with v2 authoring rules.
- `README.md`, `docs/verification.md`: document the public capability and black-box result.

## Task 1: Spatial layout schema and deterministic geometry

**Files:**

- Create: `src/domain/spatial-layout.ts`
- Create: `tests/spatial-layout.test.ts`
- Modify: `src/domain/scene-schema.ts`
- Modify: `src/domain/shared-schemas.ts`

- [ ] **Step 1: Write failing valid-layout and geometry tests**

Add a reusable abstract layout fixture and assertions:

```ts
const layout: SpatialLayout = {
  floorY: 0,
  regions: [
    {
      id: "region_alpha",
      label: "Region Alpha",
      footprintXZ: [[-4, -2], [0, -2], [0, 2], [-4, 2]],
      heightM: 2.8,
      visible: true,
    },
    {
      id: "region_beta",
      label: "Region Beta",
      footprintXZ: [[0, -2], [4, -2], [4, 2], [0, 2]],
      heightM: 2.8,
      visible: true,
    },
  ],
  boundaries: [
    {
      id: "boundary_alpha_beta",
      label: "Shared boundary",
      regionIds: ["region_alpha", "region_beta"],
      startXZ: [0, -2],
      endXZ: [0, 2],
      heightM: 2.8,
      thicknessM: 0.1,
      visible: true,
    },
  ],
  openings: [
    {
      id: "opening_alpha_beta",
      label: "Opening Alpha Beta",
      boundaryId: "boundary_alpha_beta",
      offsetM: 1.2,
      widthM: 1.2,
      bottomM: 0,
      heightM: 2.1,
      visible: true,
    },
  ],
  connections: [
    {
      id: "connection_alpha_beta",
      label: "Connection Alpha Beta",
      regionIds: ["region_alpha", "region_beta"],
      openingId: "opening_alpha_beta",
      allowsPassage: true,
      allowsSight: true,
      enabled: true,
    },
  ],
  memberships: [],
};

expect(spatialLayoutSchema.parse(layout)).toEqual(layout);
expect(spatialAdjacency(layout).get("region_alpha")).toEqual(
  new Set(["region_beta"]),
);
expect(deriveBoundaryWallBoxes(layout, layout.boundaries[0])).toHaveLength(3);
expect(spatialLayoutBounds(layout)).toMatchObject({
  min: [-4, 0, -2],
  max: [4, 2.8, 2],
});
```

Add one test per invalid behavior: self-intersection, zero area, boundary off
footprint, opening outside wall, overlapping openings, connection mismatch,
duplicate membership, and environment/layout conflict at SceneSpec level.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run tests/spatial-layout.test.ts
```

Expected: FAIL because `spatial-layout.ts`, `spatialLayoutSchema`, and derived
geometry exports do not exist.

- [ ] **Step 3: Implement the minimal spatial schemas and helpers**

Create strict schemas with these public types:

```ts
export const xzSchema = z.tuple([finiteNumber, finiteNumber]);
export const spatialRegionSchema = z.object({
  id: entityIdSchema,
  label: z.string().min(1).max(80),
  footprintXZ: z.array(xzSchema).min(3).max(32),
  heightM: positiveFiniteNumber.min(0.2).max(100),
  visible: z.boolean(),
}).strict();

export const spatialLayoutSchema = z.object({
  floorY: finiteNumber.min(-1000).max(1000),
  regions: z.array(spatialRegionSchema).min(1).max(64),
  boundaries: z.array(spatialBoundarySchema).max(256),
  openings: z.array(spatialOpeningSchema).max(256),
  connections: z.array(spatialConnectionSchema).max(256),
  memberships: z.array(entityRegionMembershipSchema).max(256),
}).strict().superRefine(validateSpatialLayout);
```

Keep numeric tolerance in one exported constant. Implement polygon area,
segment intersection, point-on-footprint-edge, wall splitting, layout bounds,
and adjacency without semantic inference.

Add `spatialLayout: spatialLayoutSchema.nullable().default(null)` to SceneSpec
v2 and refine environment/layout conflicts and membership entity kinds.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
pnpm vitest run tests/spatial-layout.test.ts tests/scene-domain.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/spatial-layout.ts src/domain/scene-schema.ts src/domain/shared-schemas.ts tests/spatial-layout.test.ts
git commit -m "feat: add generic spatial layout schema"
```

## Task 2: Canonical v2 migration and legacy single-room compatibility

**Files:**

- Create: `src/domain/scene-migrations.ts`
- Create: `tests/scene-migrations.test.ts`
- Modify: `src/domain/schema-versions.ts`
- Modify: `src/domain/default-scene.ts`
- Modify: `src/domain/scene-submission.ts`
- Modify: `server/scene-session.ts`
- Modify: `server/scene-persistence.ts`
- Modify: `server/software-png.ts`
- Modify: `cli/director-runtime.ts`
- Modify: `src/editor/scene-files.ts`
- Modify: `src/editor/scene-client.ts`

- [ ] **Step 1: Write failing migration tests**

Use a literal v1 scene with no `spatialLayout`:

```ts
const migrated = parseSceneSpecInput(legacyScene);
expect(migrated.schemaVersion).toBe(2);
expect(migrated.spatialLayout).toBeNull();
expect(migrated.sceneId).toBe(legacyScene.sceneId);
expect(migrated.entities).toEqual(legacyScene.entities);
expect(migrated.constraints).toEqual(legacyScene.constraints);
```

Cover CLI create, session replace, persistence load, and browser file load with
the same migration function. Assert invalid v1 input leaves the accepted
session unchanged.

- [ ] **Step 2: Run migration tests and verify RED**

```powershell
pnpm vitest run tests/scene-migrations.test.ts tests/scene-files.test.ts tests/scene-session.test.ts
```

Expected: FAIL because schema version 2 and migration functions do not exist.

- [ ] **Step 3: Implement strict input unions and canonical output**

Set:

```ts
export const SCENE_SCHEMA_VERSION = 2 as const;
export const PATCH_SCHEMA_VERSION = 2 as const;
```

Define internal v1 schemas and:

```ts
export const parseSceneSpecInput = (input: unknown): SceneSpec => {
  const current = sceneSpecSchema.safeParse(input);
  if (current.success) return current.data;
  const legacy = legacySceneSpecV1Schema.parse(input);
  return sceneSpecSchema.parse({
    ...legacy,
    schemaVersion: SCENE_SCHEMA_VERSION,
    spatialLayout: null,
  });
};
```

Replace external-boundary `sceneSpecSchema.parse(...)` calls with
`parseSceneSpecInput(...)`. Keep internal post-mutation validation on the
current v2 `sceneSpecSchema`.

Update the default scene and v2 fixtures to contain canonical
`spatialLayout: null`.

- [ ] **Step 4: Run migration and regression tests**

```powershell
pnpm vitest run tests/scene-migrations.test.ts tests/scene-files.test.ts tests/scene-session.test.ts tests/scene-persistence.test.ts tests/shot-regressions.test.ts
```

Expected: PASS, with v1 data preserved and v2 output canonical.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/schema-versions.ts src/domain/scene-migrations.ts src/domain/default-scene.ts src/domain/scene-submission.ts server/scene-session.ts server/scene-persistence.ts server/software-png.ts cli/director-runtime.ts src/editor/scene-files.ts src/editor/scene-client.ts tests/scene-migrations.test.ts
git commit -m "feat: migrate legacy scenes to scene spec v2"
```

## Task 3: Allowlisted spatial patches and atomic topology edits

**Files:**

- Create: `tests/spatial-patch.test.ts`
- Modify: `src/domain/scene-patch.ts`
- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/scene-migrations.ts`
- Modify: `tests/atomic-patch.test.ts`
- Modify: `tests/manual-patches.test.ts`

- [ ] **Step 1: Write failing tests for each spatial operation**

Create one base connected scene and exercise:

```ts
const patch: ScenePatch = {
  schemaVersion: 2,
  patchId: "patch_region_visibility",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  operations: [
    {
      op: "spatial.region.visibility.set",
      regionId: "region_beta",
      visible: false,
    },
  ],
};

const { next } = applyScenePatch(scene, patch);
expect(next.spatialLayout?.regions.find(({ id }) => id === "region_beta")?.visible)
  .toBe(false);
expect(next.revision).toBe(scene.revision + 1);
```

Add upsert/remove/membership tests and an atomic failure where removing a
referenced region leaves the original scene byte-for-byte unchanged.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/spatial-patch.test.ts tests/atomic-patch.test.ts
```

Expected: FAIL because spatial operations are not in the discriminated union.

- [ ] **Step 3: Add operation schemas and minimal application code**

Add the exact operation literals from the design. Upsert by stable ID, remove
only the requested record, set only the requested visibility flag, and use
complete `sceneSpecSchema.parse(next)` as the final transaction gate.

Add `parseScenePatchInput` to migrate v1 patches containing only v1 operations:

```ts
return scenePatchSchema.parse({
  ...legacy,
  schemaVersion: PATCH_SCHEMA_VERSION,
});
```

- [ ] **Step 4: Run patch tests and verify GREEN**

```powershell
pnpm vitest run tests/spatial-patch.test.ts tests/atomic-patch.test.ts tests/manual-patches.test.ts tests/scene-session.test.ts
```

Expected: PASS; invalid topology produces no revision change.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/scene-patch.ts src/domain/apply-scene-patch.ts src/domain/scene-migrations.ts tests/spatial-patch.test.ts tests/atomic-patch.test.ts tests/manual-patches.test.ts
git commit -m "feat: add atomic spatial patch operations"
```

## Task 4: IntentReport v2, coverage, capabilities, and generated schemas

**Files:**

- Modify: `src/domain/intent-report.ts`
- Modify: `src/domain/intent-coverage.ts`
- Modify: `src/domain/scene-submission.ts`
- Modify: `cli/runtime-capabilities.ts`
- Modify: `scripts/generate-schemas.ts`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Modify: `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- Modify: generated JSON schemas
- Modify: `tests/intent-report.test.ts`
- Modify: `tests/structured-submission.test.ts`
- Modify: `tests/runtime-capabilities.test.ts`
- Modify: `tests/skill-runtime-locator.test.ts`
- Modify: `tests/skill-scripts.test.ts`

- [ ] **Step 1: Write failing v2 intent and compatibility tests**

Require v2 create evidence:

```ts
{
  id: "intent_region_alpha",
  kind: "spatial-region",
  required: true,
  targets: ["region_alpha"],
  evidence: [{ type: "scene-property", path: "scene.spatialLayout.regions" }],
}
```

Require a spatial patch constraint to point to the correct operation index.
Test v1 legacy submission migration only when the payload is non-spatial.
Assert doctor and runtime metadata publish all three schema versions as `2`.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/intent-report.test.ts tests/structured-submission.test.ts tests/runtime-capabilities.test.ts tests/skill-runtime-locator.test.ts tests/skill-scripts.test.ts
```

Expected: FAIL on schema version and unknown spatial constraint kinds.

- [ ] **Step 3: Implement v2 intent allowlists and coverage**

Set `INTENT_REPORT_SCHEMA_VERSION = 2`. Add the six spatial kinds and
allowlisted paths:

```ts
"scene.spatialLayout.regions"
"scene.spatialLayout.boundaries"
"scene.spatialLayout.openings"
"scene.spatialLayout.connections"
"scene.spatialLayout.memberships"
```

Map spatial patch operations to compatible intent kinds and exact target IDs.
Update structured submission parsing so both report and payload are migrated
before policy/coverage validation.

Update runtime metadata and generated schemas together; do not change
`capabilitiesContractVersion`, semantic authority, credential policy, or network
policy.

- [ ] **Step 4: Generate schemas and run focused contract tests**

```powershell
pnpm schemas:generate
pnpm vitest run tests/intent-report.test.ts tests/structured-submission.test.ts tests/runtime-capabilities.test.ts tests/skill-runtime-locator.test.ts tests/skill-scripts.test.ts
```

Expected: PASS and generated schema files contain v2 spatial definitions.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/intent-report.ts src/domain/intent-coverage.ts src/domain/scene-submission.ts cli/runtime-capabilities.ts scripts/generate-schemas.ts .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/scripts/runtime-locator.mjs .agents/skills/shubi-shot-director/references/generated tests/intent-report.test.ts tests/structured-submission.test.ts tests/runtime-capabilities.test.ts tests/skill-runtime-locator.test.ts tests/skill-scripts.test.ts
git commit -m "feat: publish spatial structured contracts v2"
```

## Task 5: Spatial walls in composition and camera safety

**Files:**

- Create: `tests/spatial-composition.test.ts`
- Modify: `src/domain/composition-safety.ts`
- Modify: `src/domain/spatial-layout.ts`

- [ ] **Step 1: Write failing wall/opening safety tests**

Build two aligned camera-to-subject rays:

- the first crosses the opening span and an enabled `allowsSight: true`
  connection and must not report `ROOM_WALL_OCCLUSION`;
- the second crosses the same boundary outside the opening and must fail
  topology;
- a camera inside a derived solid wall box must fail camera collision.

Also assert legacy environment behavior remains unchanged.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/spatial-composition.test.ts tests/composition-safety.test.ts
```

Expected: FAIL because composition uses only legacy room proxies.

- [ ] **Step 3: Integrate derived spatial wall volumes**

Expose solid boundary boxes from `spatial-layout.ts`. In composition analysis:

```ts
const spatialWalls =
  scene.spatialLayout === null
    ? []
    : deriveSpatialWallBoxes(scene.spatialLayout);
```

Use the same segment-vs-AABB and point-inside-AABB primitives already used for
legacy room proxies. Do not treat disabled or non-sight connections as open
sightlines.

- [ ] **Step 4: Run composition tests**

```powershell
pnpm vitest run tests/spatial-composition.test.ts tests/composition-safety.test.ts tests/composition-goals.test.ts
```

Expected: PASS for spatial and legacy scenes.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/spatial-layout.ts src/domain/composition-safety.ts tests/spatial-composition.test.ts
git commit -m "feat: inspect spatial walls and openings"
```

## Task 6: Three.js spatial rendering

**Files:**

- Create: `src/three/SpatialLayoutWorld.tsx`
- Create: `tests/spatial-rendering.test.tsx`
- Modify: `src/three/SceneWorld.tsx`
- Modify: `src/three/shot-export-utils.ts`
- Modify: `server/software-png.ts`

- [ ] **Step 1: Write failing rendering contract tests**

Assert the spatial projection renders:

- one floor mesh per visible region;
- solid wall boxes split around each visible opening;
- no legacy `RoomEnvironment` when `spatialLayout` is non-null;
- exact persistent visibility in `view="shot"`;
- opacity overrides only for editor views.

Test pure exported projection builders when WebGL is not required.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/spatial-rendering.test.tsx tests/shot-exporter.test.ts
```

Expected: FAIL because no spatial projection exists.

- [ ] **Step 3: Implement neutral region floors and split walls**

Create `SpatialLayoutWorld` with `ShapeGeometry` floors and box wall segments
from the domain helper. Accept:

```ts
interface SpatialLayoutWorldProps {
  layout: SpatialLayout;
  view: "editor" | "shot";
  focusedRegionId: string | null;
  regionOpacity: ReadonlyMap<string, number>;
}
```

Use generic gray materials and stable editor accents derived from region order,
not labels. In shot view use only persistent `visible` flags and opacity `1`.

Mount it once in `SceneWorld`; keep actors, props, and cameras projected by the
existing entity path.

- [ ] **Step 4: Run rendering and export utility tests**

```powershell
pnpm vitest run tests/spatial-rendering.test.tsx tests/shot-exporter.test.ts tests/preview-export-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/three/SpatialLayoutWorld.tsx src/three/SceneWorld.tsx src/three/shot-export-utils.ts server/software-png.ts tests/spatial-rendering.test.tsx
git commit -m "feat: render connected spatial layouts"
```

## Task 7: Overview, Local, and Shot Preview workspace

**Files:**

- Create: `src/editor/spatial-view.ts`
- Create: `tests/spatial-view.test.ts`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `src/editor/Outliner.tsx`
- Modify: `src/editor/Inspector.tsx`
- Modify: `src/editor/editor-store.ts`
- Modify: `src/editor/compact-workspace.ts`
- Modify: `src/editor/CompactWorkspaceTabs.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/compact-workspace.test.ts`
- Modify: `tests/editor-concurrency.test.ts`

- [ ] **Step 1: Write failing pure view-state tests**

Define:

```ts
type SpatialViewMode = "overview" | "local" | "shot";

expect(regionOpacityMap(layout, "region_alpha")).toEqual(
  new Map([
    ["region_alpha", 1],
    ["region_beta", 0.34],
    ["region_gamma", 0.12],
  ]),
);
expect(selectRegionFocus(state, "region_beta")).toMatchObject({
  mode: "local",
  focusedRegionId: "region_beta",
});
```

Assert these functions do not mutate SceneSpec. Add component/source assertions
that the shot view stays mounted and export-ready while Overview or Local is
visible.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/spatial-view.test.ts tests/compact-workspace.test.ts tests/editor-concurrency.test.ts
```

Expected: FAIL because spatial view state and controls do not exist.

- [ ] **Step 3: Implement UI-only view state and single canvas tabs**

Store `viewMode` and `focusedRegionId` in React/Zustand editor state, never in
SceneSpec. Replace the side-by-side visible layout with tabs:

```tsx
<button data-view-mode="overview">整体总览</button>
<button data-view-mode="local" disabled={!scene.spatialLayout}>局部</button>
<button data-view-mode="shot">镜头预览</button>
```

Keep the shot `View` mounted at a valid 16:9 size behind the active surface so
the browser export client remains connected. Overview fits combined bounds;
Local fits the focused polygon and applies editor-only opacity by graph
distance.

Add a Spatial outliner group. Region selection sets UI focus and Local mode
without calling `applyPatch`. Show read-only region/boundary/opening/membership
facts in Inspector. Preserve all existing entity transform and camera controls.

For `spatialLayout: null`, disable Local and preserve Overview/entity editing,
Shot Preview, history, save/load, and export.

- [ ] **Step 4: Run UI tests and typecheck**

```powershell
pnpm vitest run tests/spatial-view.test.ts tests/compact-workspace.test.ts tests/editor-concurrency.test.ts tests/manual-patches.test.ts
pnpm typecheck
```

Expected: PASS with no revision changes from view switching.

- [ ] **Step 5: Commit**

```powershell
git add src/editor/spatial-view.ts src/editor/ViewportWorkspace.tsx src/editor/Outliner.tsx src/editor/Inspector.tsx src/editor/editor-store.ts src/editor/compact-workspace.ts src/editor/CompactWorkspaceTabs.tsx src/App.tsx src/styles.css tests/spatial-view.test.ts tests/compact-workspace.test.ts tests/editor-concurrency.test.ts
git commit -m "feat: add overview and local region views"
```

## Task 8: Public Skill, generic example, and documentation

**Files:**

- Create: `examples/connected-regions.scene-submission.json`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/connected-environments.md`
- Modify: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/intent-report.md`
- Modify: `.agents/skills/shubi-shot-director/references/visual-qa.md`
- Modify: `README.md`
- Modify: `docs/verification.md`
- Modify: `tests/public-example.test.ts`
- Modify: `tests/public-onboarding.test.ts`
- Modify: `tests/public-release-audit.test.ts`

- [ ] **Step 1: Write failing public-contract tests**

Require a parsed abstract example with:

```ts
expect(scene.spatialLayout?.regions.map(({ id }) => id)).toEqual([
  "region_alpha",
  "region_beta",
  "region_gamma",
]);
expect(scene.entities.some(({ kind }) => kind === "environment")).toBe(false);
```

Audit Skill/docs/runtime for forbidden hard-coded room dictionaries and ensure
the connected-environment reference no longer reports the supported MVP as
unsupported.

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm vitest run tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts tests/skill-scripts.test.ts
```

Expected: FAIL because no connected example or authoring guidance exists.

- [ ] **Step 3: Add the abstract submission and authoring rules**

Use only generic labels and IDs. The example must contain three regions, shared
boundaries, two openings, two connections, actor/prop/camera memberships,
composition goals, and a valid create IntentReport v2.

Document exact Host responsibilities and explicit unsupported vertical/complex
features. Never add room-name routing, prompt parsing, profiles, aliases,
credentials, or model configuration to runtime code or Skill fixtures.

- [ ] **Step 4: Generate schemas and run public audits**

```powershell
pnpm schemas:generate
pnpm vitest run tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts tests/skill-scripts.test.ts
pnpm audit:public
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs
```

Expected: PASS with no private or semantic runtime data.

- [ ] **Step 5: Commit**

```powershell
git add examples/connected-regions.scene-submission.json .agents/skills/shubi-shot-director README.md docs/verification.md tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts
git commit -m "docs: publish generic connected-region workflow"
```

## Task 9: Full verification and real black-box visual acceptance

**Files:**

- Create ignored runtime outputs under `.shubi-shot/blackbox-connected-regions/`
- Modify: `docs/verification.md` only if recording generic verification evidence

- [ ] **Step 1: Run the complete repository gate**

```powershell
pnpm verify
```

Expected: schema generation, typecheck, all Vitest tests, ESLint, Vite build,
and public audit all PASS.

- [ ] **Step 2: Run Director doctor and start the compatible bridge**

```powershell
node .agents/skills/shubi-shot-director/scripts/director.mjs doctor
node .agents/skills/shubi-shot-director/scripts/director.mjs ensure
```

Expected: capability contract v2 with scene/patch/intent schema version 2,
host semantic authority, structured-only input, no model integration,
credential forbidden, and loopback-only network.

- [ ] **Step 3: Submit the abstract scene and verify revision**

```powershell
node .agents/skills/shubi-shot-director/scripts/director.mjs scene submit --file examples/connected-regions.scene-submission.json
node .agents/skills/shubi-shot-director/scripts/director.mjs snapshot
node .agents/skills/shubi-shot-director/scripts/director.mjs composition inspect --json
```

Expected: accepted generic scene ID, canonical SceneSpec v2, revision continuity,
three regions, two connected openings, and composition report with no blocking
schema/topology/camera-collision error for the chosen shot.

- [ ] **Step 4: Perform real browser interaction**

Open the returned local UI URL in the integrated browser. Verify:

1. Overview visibly shows the full three-region combination.
2. Selecting `region_beta` enters Local without changing revision.
3. Local keeps adjacent context faded.
4. Move one generic prop with the existing transform control; revision advances
   exactly once.
5. Shot Preview shows the active final camera and remains export-ready.
6. Save and reload preserve the layout, memberships, camera, and revision rules.

Capture ignored screenshots:

- `.shubi-shot/blackbox-connected-regions/overview.png`
- `.shubi-shot/blackbox-connected-regions/local-region-beta.png`

- [ ] **Step 5: Export the browser-rendered perspective**

```powershell
node .agents/skills/shubi-shot-director/scripts/director.mjs export png --file .shubi-shot/blackbox-connected-regions/perspective.png --width 1920 --height 1080
```

Expected: exact current scene ID/revision, 1920x1080 dimensions, SHA-256, and no
blocking preview mismatch.

- [ ] **Step 6: Verify saved output and legacy compatibility**

Run one v1 single-room create/load/edit/export smoke flow after the v2 black-box
scene. Require canonical v2 snapshot with `spatialLayout: null` and unchanged
single-room controls.

- [ ] **Step 7: Run final clean-state evidence**

```powershell
git diff --check
git status --short
pnpm verify
```

Expected: no unstaged source drift, no ignored output staged, and the full gate
passes freshly.

- [ ] **Step 8: Commit any final generic verification documentation**

```powershell
git add docs/verification.md
git commit -m "docs: record connected-region verification"
```

Do not commit runtime screenshots or exports unless a later explicit public
documentation decision requires one. Show the three ignored images to the user
using absolute local paths.
