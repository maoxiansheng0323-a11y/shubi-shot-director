# Lock Provenance and Atomic Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SceneSpec/ScenePatch/IntentReport v3 so Host Codex can correct workflow-locked graybox entities atomically with `preserveLock: true`, while user-protected entities still require explicit confirmation.

**Architecture:** Replace the persisted `locked` boolean with one `lockMode` enum and migrate every v1/v2 true lock to `workflow`. Thread the Patch-level preservation policy through direct operations and indirect contact/relationship effects, enforce postconditions on a cloned scene, and keep save locking as an explicit Patch before side-effect-free serialization. Host Codex remains the only semantic authority; the runtime only validates and applies structured state.

**Tech Stack:** TypeScript 6, Zod 4 schemas/migrations, Vitest, React 19, Zustand, Express loopback bridge, Node.js CLI/Skill wrappers, Three.js browser verification.

---

## Scope check

This is one feature with five dependent checkpoints rather than independent
products:

1. canonical schemas and deterministic migration;
2. atomic lock-aware mutation;
3. intent/capability contracts;
4. editor and explicit-save workflows;
5. Skill guidance and end-to-end verification.

Each checkpoint leaves the repository runnable and receives its own commit.
Do not split out unrelated editor refactors, permissions, collaboration, or
per-property locking.

## File structure

### New focused files

- `src/domain/entity-lock.ts` — canonical lock enum and pure mutation-policy
  helpers shared by Patch and contact logic.
- `src/domain/workflow-lock-patch.ts` — constructs the explicit Patch used by
  CLI/editor save workflows.
- `tests/lock-schema-migrations.test.ts` — v1/v2-to-v3 migration and strict
  canonical schema coverage.
- `tests/lock-preservation.test.ts` — direct, indirect, rollback, revision,
  history, and user-lock behavior.
- `tests/workflow-lock-save.test.ts` — pure save-Patch construction and
  serialization ordering.

### Existing domain files

- `src/domain/schema-versions.ts`
- `src/domain/scene-schema.ts`
- `src/domain/scene-patch.ts`
- `src/domain/scene-migrations.ts`
- `src/domain/default-scene.ts`
- `src/domain/apply-scene-patch.ts`
- `src/domain/contact-constraints.ts`
- `src/domain/presets/relationship-presets.ts`
- `src/domain/intent-report.ts`
- `src/domain/intent-coverage.ts`
- `src/domain/scene-submission.ts`

### Existing bridge, CLI, and editor files

- `server/api.ts`
- `server/scene-session.ts`
- `cli/runtime-capabilities.ts`
- `cli/bridge.ts`
- `cli/director-runtime.ts`
- `src/editor/manual-patches.ts`
- `src/editor/editor-store.ts`
- `src/editor/error-messages.ts`
- `src/editor/Outliner.tsx`
- `src/editor/Inspector.tsx`
- `src/editor/ActorPresetControls.tsx`
- `src/editor/ViewportWorkspace.tsx`
- `src/three/SceneWorld.tsx`
- `src/App.tsx`
- `src/styles.css`

### Skill, generated, examples, and release metadata

- `.agents/skills/shubi-shot-director/SKILL.md`
- `.agents/skills/shubi-shot-director/runtime.json`
- `.agents/skills/shubi-shot-director/references/intent-report.md`
- `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- `.agents/skills/shubi-shot-director/references/recovery-and-concurrency.md`
- `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- `.agents/skills/shubi-shot-director/references/cli-contract.md`
- `.agents/skills/shubi-shot-director/references/generated/*.json`
- `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- `.agents/skills/shubi-shot-director/scripts/director.mjs`
- `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- `.agents/skills/shubi-shot-director/scripts/verify-transition.mjs`
- `scripts/generate-schemas.ts`
- `examples/starter.scene.json`
- `examples/quickstart.scene-submission.json`
- `examples/connected-regions.scene-submission.json`
- `package.json`
- `README.md`
- `docs/verification.md`

## Task 1: Canonical lock schemas and deterministic migration

**Files:**

- Create: `src/domain/entity-lock.ts`
- Create: `tests/lock-schema-migrations.test.ts`
- Modify: `src/domain/schema-versions.ts`
- Modify: `src/domain/scene-schema.ts`
- Modify: `src/domain/scene-patch.ts`
- Modify: `src/domain/scene-migrations.ts`
- Modify: `src/domain/default-scene.ts`
- Modify: `src/editor/manual-patches.ts`
- Modify: all tests currently constructing `PATCH_SCHEMA_VERSION` Patches

- [ ] **Step 1: Write failing v3 schema and migration tests**

Create `tests/lock-schema-migrations.test.ts` with focused fixtures that remove
`lockMode` before adding legacy `locked`:

```ts
import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  parseScenePatchInput,
  parseSceneSpecInput,
} from "../src/domain/scene-migrations";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";

const legacyScene = (version: 1 | 2) => {
  const current = createDefaultScene();
  const entities = current.entities.map(({ lockMode, ...entity }, index) => ({
    ...entity,
    locked: index === 0 || lockMode === "workflow",
  }));
  const source: Record<string, unknown> = {
    ...current,
    schemaVersion: version,
    entities,
  };
  if (version === 1) {
    delete source.spatialLayout;
  }
  return source;
};

describe("lock schema v3 migration", () => {
  it.each([1, 2] as const)(
    "migrates SceneSpec v%s booleans to canonical lock modes",
    (version) => {
      const parsed = parseSceneSpecInput(legacyScene(version));
      expect(parsed.schemaVersion).toBe(3);
      expect(parsed.entities[0].lockMode).toBe("workflow");
      expect(parsed.entities[1].lockMode).toBe("none");
      expect(parsed.entities[0]).not.toHaveProperty("locked");
    },
  );

  it("accepts exactly none, workflow, and user", () => {
    const scene = createDefaultScene();
    for (const lockMode of ["none", "workflow", "user"] as const) {
      expect(
        sceneSpecSchema.parse({
          ...scene,
          entities: scene.entities.map((entity, index) =>
            index === 0 ? { ...entity, lockMode } : entity,
          ),
        }).entities[0].lockMode,
      ).toBe(lockMode);
    }
    expect(() =>
      sceneSpecSchema.parse({
        ...scene,
        entities: scene.entities.map((entity, index) =>
          index === 0 ? { ...entity, lockMode: "legacy" } : entity,
        ),
      }),
    ).toThrow();
  });

  it.each([1, 2] as const)(
    "migrates ScenePatch v%s with strict legacy lock behavior",
    (schemaVersion) => {
      const scene = createDefaultScene();
      const parsed = parseScenePatchInput({
        schemaVersion,
        patchId: "patch_legacy_lock",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "manual",
        operations: [
          {
            op: "entity.flags.set",
            entityId: scene.entities[0].id,
            visible: false,
            locked: true,
          },
        ],
      });
      expect(parsed).toMatchObject({
        schemaVersion: 3,
        preserveLock: false,
        operations: [
          {
            op: "entity.flags.set",
            visible: false,
            lockMode: "workflow",
          },
        ],
      });
    },
  );

  it("requires preserveLock on a canonical v3 Patch", () => {
    const scene = createDefaultScene();
    expect(() =>
      scenePatchSchema.parse({
        schemaVersion: 3,
        patchId: "patch_missing_policy",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "natural-language",
        operations: [{ op: "scene.title.set", value: "Generic shot" }],
      }),
    ).toThrow();
  });

  it("accepts one save-sized Patch with 256 operations", () => {
    const scene = createDefaultScene();
    expect(() =>
      scenePatchSchema.parse({
        schemaVersion: 3,
        patchId: "patch_save_capacity",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "system",
        preserveLock: false,
        operations: Array.from({ length: 256 }, (_, index) => ({
          op: "scene.title.set",
          value: `Generic shot ${index}`,
        })),
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm test -- tests/lock-schema-migrations.test.ts
```

Expected: FAIL because `lockMode`, schema version 3, and `preserveLock` do not
exist.

- [ ] **Step 3: Add the canonical enum and bump schema versions**

Create `src/domain/entity-lock.ts`:

```ts
import { z } from "zod";

export const ENTITY_LOCK_MODES = [
  "none",
  "workflow",
  "user",
] as const;

export const entityLockModeSchema = z.enum(ENTITY_LOCK_MODES);
export type EntityLockMode = z.infer<typeof entityLockModeSchema>;

export const legacyLockedToMode = (
  locked: boolean,
): EntityLockMode => (locked ? "workflow" : "none");
```

Change `src/domain/schema-versions.ts` to:

```ts
export const SCENE_SCHEMA_VERSION = 3 as const;
export const PATCH_SCHEMA_VERSION = 3 as const;
```

In `src/domain/scene-schema.ts`, import `entityLockModeSchema`, replace
`locked: z.boolean()` with `lockMode: entityLockModeSchema`, and export the
inferred lock type from `entity-lock.ts`.

In `src/domain/scene-patch.ts`, make `entity.flags.set` partial but non-empty:

```ts
z.object({
  op: z.literal("entity.flags.set"),
  entityId: entityIdSchema,
  visible: z.boolean().optional(),
  lockMode: entityLockModeSchema.optional(),
})
  .strict()
  .refine(
    ({ visible, lockMode }) =>
      visible !== undefined || lockMode !== undefined,
    "Entity flags must change visibility or lock mode.",
  )
```

Add the required Patch policy immediately before `operations`:

```ts
preserveLock: z.boolean(),
operations: z.array(sceneOperationSchema).min(1).max(256),
```

- [ ] **Step 4: Implement v1/v2 migration without operation-index drift**

In `src/domain/scene-migrations.ts`, use explicit v1 and v2 envelopes and map
each legacy operation one-to-one:

```ts
const migrateLegacyEntity = (
  input: Record<string, unknown> & { locked: boolean },
) => {
  const { locked, ...entity } = input;
  return {
    ...entity,
    lockMode: legacyLockedToMode(locked),
  };
};

const migrateLegacyOperation = (
  operation: Record<string, unknown> & { op: string },
) => {
  if (operation.op !== "entity.flags.set") {
    return operation;
  }
  const { locked, ...rest } = operation;
  return {
    ...rest,
    ...(typeof locked === "boolean"
      ? { lockMode: legacyLockedToMode(locked) }
      : {}),
  };
};
```

For SceneSpec v1, first add `spatialLayout: null`; for v2 retain its existing
layout. For both, replace every legacy entity and parse the complete result
through `sceneSpecSchema`.

For ScenePatch v1, retain the existing prohibition on `spatial.*` operations.
For v1 and v2, set `schemaVersion: PATCH_SCHEMA_VERSION`,
`preserveLock: false`, map operations in place, and parse through
`scenePatchSchema`.

- [ ] **Step 5: Convert canonical defaults and Patch constructors**

Set every new entity in `src/domain/default-scene.ts` to:

```ts
lockMode: "none",
```

Replace every read-only `entity.locked` check with
`isLocked(entity.lockMode)` or `entity.lockMode !== "none"` so the schema
checkpoint still typechecks before the later behavior/UI refinements. This
mechanical compatibility pass includes:

- `cli/director-runtime.ts`
- `src/App.tsx`
- `src/domain/apply-scene-patch.ts`
- `src/domain/contact-constraints.ts`
- `src/domain/presets/relationship-presets.ts`
- `src/editor/ActorPresetControls.tsx`
- `src/editor/Inspector.tsx`
- `src/editor/Outliner.tsx`
- `src/editor/ViewportWorkspace.tsx`
- `src/three/SceneWorld.tsx`
- tests that select or assert locked entities.

At this checkpoint, direct domain errors may still use the legacy generic
`ENTITY_LOCKED`; Task 2 replaces that temporary compatibility behavior with
the specific v3 policy.

In `src/editor/manual-patches.ts`, make every manual Patch strict:

```ts
return {
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: nextPatchId(scope),
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source,
  preserveLock: false,
  operations,
};
```

Add `preserveLock: false` to canonical Patches in:

- `tests/atomic-patch.test.ts`
- `tests/composition-goals.test.ts`
- `tests/helpers/structured-fixtures.ts`
- `tests/relationship-presets.test.ts`
- `tests/shot-regressions.test.ts`
- `tests/skill-scripts.test.ts`
- `tests/spatial-intent.test.ts`
- `tests/spatial-layout.test.ts`
- `tests/spatial-patch.test.ts`

Keep deliberately legacy v1/v2 test inputs unchanged.

- [ ] **Step 6: Run schema tests and type checking**

Run:

```powershell
pnpm test -- tests/lock-schema-migrations.test.ts tests/scene-files.test.ts tests/spatial-patch.test.ts
pnpm typecheck
```

Expected: all selected tests PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit the schema checkpoint**

```powershell
git add src cli tests
git commit -m "feat: add lock provenance schemas"
```

## Task 2: Atomic workflow-lock preservation

**Files:**

- Create: `tests/lock-preservation.test.ts`
- Modify: `src/domain/entity-lock.ts`
- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/contact-constraints.ts`
- Modify: `src/domain/presets/relationship-presets.ts`
- Modify: `server/api.ts`
- Modify: `tests/atomic-patch.test.ts`
- Modify: `tests/contact-constraints.test.ts`
- Modify: `tests/relationship-presets.test.ts`
- Modify: `tests/server-api-health.test.ts`
- Modify: `tests/scene-session.test.ts`

- [ ] **Step 1: Write failing preservation and user-lock tests**

Create `tests/lock-preservation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

const translate = (
  scene: ReturnType<typeof createDefaultScene>,
  entityId: string,
  preserveLock: boolean,
) => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: "patch_lock_translation",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language" as const,
  preserveLock,
  operations: [
    {
      op: "entity.transform.translate" as const,
      entityId,
      deltaM: [0.25, 0, 0] as [number, number, number],
      referenceSpace: "world" as const,
    },
  ],
});

describe("workflow-lock preservation", () => {
  it("changes a workflow-locked entity and preserves its lock", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor) throw new Error("Missing generic actor.");
    actor.lockMode = "workflow";

    const applied = applyScenePatch(
      scene,
      translate(scene, actor.id, true),
    );
    expect(applied.next.revision).toBe(scene.revision + 1);
    expect(
      applied.next.entities.find((entity) => entity.id === actor.id),
    ).toMatchObject({
      lockMode: "workflow",
      transform: { positionM: [0.25, 0.977, 0] },
    });
  });

  it("rejects a user-locked target without mutation", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor) throw new Error("Missing generic actor.");
    actor.lockMode = "user";

    expect(() =>
      applyScenePatch(scene, translate(scene, actor.id, true)),
    ).toThrowError(expect.objectContaining({ code: "USER_LOCKED" }));
  });

  it("keeps strict Patches blocked by workflow locks", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor) throw new Error("Missing generic actor.");
    actor.lockMode = "workflow";

    expect(() =>
      applyScenePatch(scene, translate(scene, actor.id, false)),
    ).toThrowError(expect.objectContaining({ code: "WORKFLOW_LOCKED" }));
  });

  it("rolls back operations, revision, history, and lock state", () => {
    const session = new SceneSession(createDefaultScene());
    const before = session.snapshot();
    before.entities[1].lockMode = "workflow";
    session.replaceScene(before);
    const authoritative = session.snapshot();

    expect(() =>
      session.applyPatch({
        ...translate(
          authoritative,
          authoritative.entities[1].id,
          true,
        ),
        operations: [
          ...translate(
            authoritative,
            authoritative.entities[1].id,
            true,
          ).operations,
          {
            op: "entity.transform.translate",
            entityId: "actor_generic_missing",
            deltaM: [1, 0, 0],
            referenceSpace: "world",
          },
        ],
      }),
    ).toThrow();
    expect(session.snapshot()).toEqual(authoritative);
  });
});
```

Add focused cases for:

- `preserveLock: true` plus a changed `lockMode`;
- removal of a pre-existing workflow/user locked entity;
- addition of an entity already set to `workflow`;
- an indirect ground-contact move reaching workflow and user locks;
- one undo/redo around a successful preserved correction.

- [ ] **Step 2: Run the focused tests and verify failure codes are missing**

Run:

```powershell
pnpm test -- tests/lock-preservation.test.ts tests/contact-constraints.test.ts
```

Expected: FAIL because all lock states still use the old generic guard.

- [ ] **Step 3: Add pure lock-policy helpers**

Extend `src/domain/entity-lock.ts`:

```ts
export type EntityLockErrorCode =
  | "USER_LOCKED"
  | "WORKFLOW_LOCKED";

export const mutationBlockedByLock = (
  mode: EntityLockMode,
  preserveLock: boolean,
): EntityLockErrorCode | null => {
  if (mode === "user") return "USER_LOCKED";
  if (mode === "workflow" && !preserveLock) return "WORKFLOW_LOCKED";
  return null;
};

export const isLocked = (mode: EntityLockMode): boolean =>
  mode !== "none";
```

- [ ] **Step 4: Enforce the Patch preservation transaction**

In `src/domain/apply-scene-patch.ts`:

1. change `requireUnlocked(entity)` to
   `requireMutable(entity, preserveLock)`;
2. pass `patch.preserveLock` into every direct entity operation;
3. preflight `preserveLock: true` Patches before applying operations;
4. pass the same policy into contact enforcement;
5. compare the original lock map after operations and before commit.

Use these exact invariants:

```ts
const originalLocks = new Map(
  current.entities.map(({ id, lockMode }) => [id, lockMode] as const),
);

const assertPreservedLocks = (next: SceneSpec): void => {
  for (const [entityId, lockMode] of originalLocks) {
    const entity = next.entities.find(({ id }) => id === entityId);
    if (!entity && lockMode !== "none") {
      throw new SceneDomainError(
        "LOCK_PRESERVATION_CONFLICT",
        `A locked entity was removed: ${entityId}`,
      );
    }
    if (entity && entity.lockMode !== lockMode) {
      throw new SceneDomainError(
        "LOCK_PRESERVATION_CONFLICT",
        `Entity lock mode changed: ${entityId}`,
      );
    }
  }
};
```

Reject a pre-locked `entity.add` under preservation and any
`entity.flags.set.lockMode` that differs from the original. Apply and validate
only on the clone; never emit an intermediate unlocked scene.

- [ ] **Step 5: Thread the policy through indirect contact effects**

Change `enforceGroundContacts` in
`src/domain/contact-constraints.ts` to accept:

```ts
options: { preserveLock?: boolean } = {}
```

Before changing a snapped actor transform, call
`mutationBlockedByLock(entity.lockMode, options.preserveLock === true)`.
Extend contact error codes with `USER_LOCKED` and `WORKFLOW_LOCKED`, and remove
canonical emission of `LOCKED_ENTITY_CONFLICT`.

In `src/domain/presets/relationship-presets.ts`, allow workflow-locked actors
to participate in deterministic operation construction, but retain
`ROLE_ACTOR_LOCKED` for `lockMode === "user"`. Patch application remains the
final enforcement point.

- [ ] **Step 6: Map stable public errors**

In `server/api.ts`, add safe generic messages:

```ts
case "USER_LOCKED":
  return "A requested scene entity is user protected.";
case "WORKFLOW_LOCKED":
  return "A requested scene entity is workflow locked.";
case "LOCK_PRESERVATION_CONFLICT":
  return "The requested Patch would change preserved lock state.";
```

Retain `ENTITY_LOCKED` and `LOCKED_ENTITY_CONFLICT` only as compatibility
mappings for legacy callers.

- [ ] **Step 7: Run atomic, contact, session, and API tests**

Run:

```powershell
pnpm test -- tests/lock-preservation.test.ts tests/atomic-patch.test.ts tests/contact-constraints.test.ts tests/relationship-presets.test.ts tests/scene-session.test.ts tests/server-api-health.test.ts
pnpm typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 8: Commit the atomic mutation checkpoint**

```powershell
git add src/domain/entity-lock.ts src/domain/apply-scene-patch.ts src/domain/contact-constraints.ts src/domain/presets/relationship-presets.ts server/api.ts tests
git commit -m "feat: preserve workflow locks atomically"
```

## Task 3: IntentReport v3 and structured lock evidence

**Files:**

- Modify: `src/domain/intent-report.ts`
- Modify: `src/domain/intent-coverage.ts`
- Modify: `src/domain/scene-migrations.ts`
- Modify: `src/domain/scene-submission.ts`
- Modify: `tests/intent-report.test.ts`
- Modify: `tests/spatial-intent.test.ts`
- Modify: `tests/structured-submission.test.ts`
- Modify: `tests/structured-submission-cli.test.ts`
- Modify: `tests/helpers/structured-fixtures.ts`

- [ ] **Step 1: Write failing intent migration and coverage tests**

Add to `tests/intent-report.test.ts`:

```ts
import { validateIntentCoverage } from "../src/domain/intent-coverage";
import { createDefaultScene } from "../src/domain/default-scene";

it("accepts lock-protection with entity.lockMode evidence", () => {
  const scene = createDefaultScene();
  const entityId = scene.entities[0].id;
  const report = intentReportSchema.parse({
    schemaVersion: 3,
    operation: "create",
    allowPartial: false,
    recognizedConstraints: [
      {
        id: "constraint_user_protection",
        kind: "lock-protection",
        required: true,
        targets: [entityId],
        evidence: [
          {
            type: "entity-property",
            entityId,
            path: "entity.lockMode",
          },
        ],
      },
    ],
    unsupportedConstraints: [],
    unresolvedRelations: [],
    warnings: [],
    canApplySafely: true,
  });

  expect(() =>
    validateIntentCoverage(report, { after: scene }),
  ).not.toThrow();
});
```

Add a migration case in `tests/structured-submission-cli.test.ts` proving a
v2 `entity.locked` evidence path becomes `entity.lockMode`, while every
`patch-operation` index still points to the same migrated operation.

- [ ] **Step 2: Run the intent tests and verify they fail**

Run:

```powershell
pnpm test -- tests/intent-report.test.ts tests/structured-submission-cli.test.ts
```

Expected: FAIL because IntentReport v3 and `lock-protection` do not exist.

- [ ] **Step 3: Add IntentReport v3 enums and evidence**

In `src/domain/intent-report.ts`:

```ts
export const INTENT_REPORT_SCHEMA_VERSION = 3 as const;

export const INTENT_CONSTRAINT_KINDS_V3 = [
  ...INTENT_CONSTRAINT_KINDS_V2,
  "lock-protection",
] as const;

export const ENTITY_EVIDENCE_PATHS_V3 = [
  ...ENTITY_EVIDENCE_PATHS_V2.filter(
    (path) => path !== "entity.locked",
  ),
  "entity.lockMode",
] as const;
```

Use the v3 arrays in the canonical schemas. Keep exported v1/v2 arrays for
legacy parsing.

Raise the canonical `patch-operation.operationIndex` maximum from 127 to 255
so IntentReport evidence can cover every operation in a 256-operation save
Patch:

```ts
operationIndex: z.number().int().nonnegative().max(255),
```

In `src/domain/intent-coverage.ts`:

- map `entity.lockMode` to `lock-protection`;
- treat it as present for every entity;
- make `entity.flags.set` primary `lock-protection` evidence only when its
  `lockMode` field is present;
- retain visibility evidence only when `visible` is present.

- [ ] **Step 4: Migrate IntentReport v1/v2 deterministically**

In `src/domain/scene-migrations.ts`, parse both legacy report versions and map
only this path:

```ts
const migrateLegacyEvidence = (
  evidence: Record<string, unknown>,
) =>
  evidence.type === "entity-property" &&
  evidence.path === "entity.locked"
    ? { ...evidence, path: "entity.lockMode" }
    : evidence;
```

Set canonical `schemaVersion: INTENT_REPORT_SCHEMA_VERSION`. Do not invent a
`lock-protection` constraint for an old report; only preserve valid existing
evidence and operation indexes.

- [ ] **Step 5: Update structured fixtures and run submission tests**

Set all new fixture reports to schema version 3. Where a fixture intentionally
tests v1/v2 migration, leave it legacy.

Run:

```powershell
pnpm test -- tests/intent-report.test.ts tests/spatial-intent.test.ts tests/structured-submission.test.ts tests/structured-submission-cli.test.ts
pnpm typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit the intent checkpoint**

```powershell
git add src/domain/intent-report.ts src/domain/intent-coverage.ts src/domain/scene-migrations.ts src/domain/scene-submission.ts tests
git commit -m "feat: add lock protection intent coverage"
```

## Task 4: Capability contract and Skill/runtime compatibility

**Files:**

- Modify: `cli/runtime-capabilities.ts`
- Modify: `cli/bridge.ts`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Modify: `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- Modify: `tests/runtime-capabilities.test.ts`
- Modify: `tests/bridge-health.test.ts`
- Modify: `tests/bridge-compatibility-cli.test.ts`
- Modify: `tests/skill-compatibility.test.ts`
- Modify: `tests/skill-runtime-locator.test.ts`
- Modify: `tests/helpers/create-skill-forward-fixtures.ts`

- [ ] **Step 1: Write failing exact-capability tests**

In `tests/runtime-capabilities.test.ts`, require these manifest fields:

```ts
expect(getRuntimeCapabilityManifest()).toMatchObject({
  capabilitiesContractVersion: 2,
  sceneSchemaVersion: 3,
  patchSchemaVersion: 3,
  intentReportSchemaVersion: 3,
  entityLockModes: ["none", "workflow", "user"],
  patchPolicyFields: ["preserveLock"],
  lockErrorCodes: [
    "USER_LOCKED",
    "WORKFLOW_LOCKED",
    "LOCK_PRESERVATION_CONFLICT",
  ],
});
```

Add bridge and Skill compatibility cases that remove or alter each new list and
expect `CAPABILITIES_INVALID` before startup or scene mutation.

- [ ] **Step 2: Run capability tests and verify failure**

Run:

```powershell
pnpm test -- tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/skill-compatibility.test.ts
```

Expected: FAIL because the manifest does not advertise lock semantics.

- [ ] **Step 3: Extend the runtime manifest without changing contract v2**

In `cli/runtime-capabilities.ts`, add:

```ts
export const PATCH_POLICY_FIELDS = ["preserveLock"] as const;
export const LOCK_ERROR_CODES = [
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
] as const;
```

Extend `RuntimeCapabilityManifest`:

```ts
entityLockModes: string[];
patchPolicyFields: string[];
lockErrorCodes: string[];
```

Require unique non-empty arrays in `parseRuntimeCapabilityManifest`, return
defensive copies, and publish exact canonical arrays from
`getRuntimeCapabilityManifest()`.

Update `cli/bridge.ts` to compare these arrays as exact unordered sets just as
it compares commands and features.

- [ ] **Step 4: Align offline Skill metadata and compatibility checks**

Add to `.agents/skills/shubi-shot-director/runtime.json`:

```json
"sceneSchemaVersion": 3,
"patchSchemaVersion": 3,
"intentReportSchemaVersion": 3,
"entityLockModes": ["none", "workflow", "user"],
"patchPolicyFields": ["preserveLock"],
"lockErrorCodes": [
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT"
]
```

Update `runtime-locator.mjs`, `compatibility-plan.mjs`, and `director.mjs` so
all three arrays are required, copied, compared, and included in `doctor`
compatibility decisions. Add safe messages for the three new runtime errors.
Do not change semantic authority, credential policy, bridge protocol, or
capabilities contract version.

- [ ] **Step 5: Run all compatibility tests**

Run:

```powershell
pnpm test -- tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
pnpm typecheck
```

Expected: all selected tests PASS; manifests missing lock semantics are rejected
before mutation.

- [ ] **Step 6: Commit the capability checkpoint**

```powershell
git add cli/runtime-capabilities.ts cli/bridge.ts .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/scripts tests
git commit -m "feat: advertise lock preservation capabilities"
```

## Task 5: Explicit-save workflow and editor lock semantics

**Files:**

- Create: `src/domain/workflow-lock-patch.ts`
- Create: `tests/workflow-lock-save.test.ts`
- Modify: `cli/director-runtime.ts`
- Modify: `src/editor/manual-patches.ts`
- Modify: `src/editor/editor-store.ts`
- Modify: `src/editor/error-messages.ts`
- Modify: `src/editor/Outliner.tsx`
- Modify: `src/editor/Inspector.tsx`
- Modify: `src/editor/ActorPresetControls.tsx`
- Modify: `src/editor/ViewportWorkspace.tsx`
- Modify: `src/three/SceneWorld.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/manual-patches.test.ts`
- Modify: `tests/structured-runtime-e2e.test.ts`
- Modify: `tests/error-messages.test.ts`

- [ ] **Step 1: Write failing save-Patch tests**

Create `tests/workflow-lock-save.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { createWorkflowLockCheckpointPatch } from "../src/domain/workflow-lock-patch";

describe("explicit save workflow locks", () => {
  it("locks every unlocked entity and preserves existing user locks", () => {
    const scene = createDefaultScene();
    scene.entities[0].lockMode = "user";
    scene.entities[1].lockMode = "workflow";

    const patch = createWorkflowLockCheckpointPatch(
      scene,
      "system_save_checkpoint",
      "system",
    );
    expect(patch).not.toBeNull();
    if (!patch) return;

    const next = applyScenePatch(scene, patch).next;
    expect(next.entities.map(({ lockMode }) => lockMode)).toEqual(
      next.entities.map((_, index) =>
        index === 0 ? "user" : "workflow",
      ),
    );
    expect(next.revision).toBe(scene.revision + 1);
  });

  it("returns null when no save lock transition is required", () => {
    const scene = createDefaultScene();
    for (const entity of scene.entities) {
      entity.lockMode = "workflow";
    }
    expect(
      createWorkflowLockCheckpointPatch(
        scene,
        "system_save_checkpoint",
        "system",
      ),
    ).toBeNull();
  });
});
```

Add a structured runtime E2E case proving `scene save` receives the lock Patch
response before it writes the JSON file and the saved scene contains no
`lockMode: "none"`.

- [ ] **Step 2: Run save and manual Patch tests and verify failure**

Run:

```powershell
pnpm test -- tests/workflow-lock-save.test.ts tests/manual-patches.test.ts tests/structured-runtime-e2e.test.ts
```

Expected: FAIL because save currently serializes without an explicit lock
Patch.

- [ ] **Step 3: Implement the pure save-Patch constructor**

Create `src/domain/workflow-lock-patch.ts`:

```ts
import type { ScenePatch } from "./scene-patch";
import type { SceneSpec } from "./scene-schema";
import { PATCH_SCHEMA_VERSION } from "./schema-versions";

export const createWorkflowLockCheckpointPatch = (
  scene: SceneSpec,
  patchId: string,
  source: ScenePatch["source"],
): ScenePatch | null => {
  const operations: ScenePatch["operations"] = scene.entities
    .filter(({ lockMode }) => lockMode === "none")
    .map(({ id }) => ({
      op: "entity.flags.set" as const,
      entityId: id,
      lockMode: "workflow" as const,
    }));
  if (operations.length === 0) return null;
  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId,
    sceneId: scene.sceneId,
    baseRevision: scene.revision,
    source,
    preserveLock: false,
    operations,
  };
};
```

- [ ] **Step 4: Make CLI save patch then serialize**

In `cli/director-runtime.ts`, after the initial snapshot:

1. call `createWorkflowLockCheckpointPatch`;
2. if non-null, POST it to `/api/v1/patches`;
3. parse the accepted scene;
4. serialize only that accepted revision;
5. return the final revision in the command result.

Use a schema-valid generic patch ID capped below 64 characters:

```ts
const patchId = `system_save_${scene.revision}`;
```

If the Patch request fails, do not create or overwrite the output file.

- [ ] **Step 5: Update manual/editor Patch behavior**

Rename `createLockedPatch` to `createLockModePatch`:

```ts
export const createLockModePatch = (
  scene: SceneSpec,
  entityId: string,
  lockMode: SceneEntity["lockMode"],
): ScenePatch =>
  createOperationsPatch(scene, "lock", [
    { op: "entity.flags.set", entityId, lockMode },
  ]);
```

In `src/editor/editor-store.ts`, change:

```ts
saveScene: (requestedName?: string) => Promise<string | null>;
```

The implementation must await `applyPatch` with the save checkpoint Patch,
read the accepted scene, and only then call `downloadSceneFile`.

In `src/App.tsx`, make the Save button await `saveScene()`. A manual lock click
sets `user`; unlocking either locked mode sets `none`. Replace every
`entity.locked` check with `entity.lockMode !== "none"`. Export warning logic
uses `activeCamera.lockMode === "none"`.

- [ ] **Step 6: Update editor labels and generic errors**

Update Outliner/Inspector text so:

- `workflow` renders “流程锁定” / accessible “Workflow locked” semantics;
- `user` renders “用户保护” / accessible “User protected” semantics;
- meaning is available in text or `aria-label`, not color alone.

Add Chinese error mappings in `src/editor/error-messages.ts`:

```ts
USER_LOCKED: "目标受到用户保护，需要先确认解锁",
WORKFLOW_LOCKED: "目标处于流程锁定，请使用保留锁定的修改",
LOCK_PRESERVATION_CONFLICT: "修改会改变应保留的锁定状态，未执行修改",
```

Keep visual styling minimal and consistent with the existing `.entity-lock`.

- [ ] **Step 7: Run editor, save, E2E, and build checks**

Run:

```powershell
pnpm test -- tests/workflow-lock-save.test.ts tests/manual-patches.test.ts tests/error-messages.test.ts tests/editor-concurrency.test.ts tests/structured-runtime-e2e.test.ts
pnpm typecheck
pnpm build
```

Expected: selected tests PASS and production build succeeds.

- [ ] **Step 8: Commit the save/editor checkpoint**

```powershell
git add src/domain/workflow-lock-patch.ts cli/director-runtime.ts src/editor src/three src/App.tsx src/styles.css tests
git commit -m "feat: lock explicit save checkpoints"
```

## Task 6: Skill contract, generated schemas, examples, and version

**Files:**

- Modify: `package.json`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/intent-report.md`
- Modify: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/recovery-and-concurrency.md`
- Modify: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/generated/*.json`
- Modify: `.agents/skills/shubi-shot-director/scripts/verify-transition.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Modify: `examples/starter.scene.json`
- Modify: `examples/quickstart.scene-submission.json`
- Modify: `examples/connected-regions.scene-submission.json`
- Modify: `README.md`
- Modify: `tests/skill-scripts.test.ts`
- Modify: `tests/public-example.test.ts`
- Modify: `tests/public-onboarding.test.ts`
- Modify: `tests/public-release-audit.test.ts`

- [ ] **Step 1: Add failing Skill-documentation assertions**

In `tests/skill-scripts.test.ts`, assert the Skill and references state:

```ts
expect(skill).toContain("preserveLock: true");
expect(skill).toMatch(/workflow locks never require user authorization/iu);
expect(skill).toMatch(/user locks require.*confirmation/iu);
expect(skill).toMatch(/unfinished.*lockMode.*none/iu);
expect(skill).toMatch(/background persistence.*never.*lock/iu);
```

Add generated-schema assertions that:

- SceneSpec requires `lockMode` and does not expose `locked`;
- ScenePatch requires `preserveLock`;
- the lock enum is exactly `none`, `workflow`, `user`;
- IntentReport uses schema version 3 and `entity.lockMode`.

- [ ] **Step 2: Run Skill and public tests and verify failure**

Run:

```powershell
pnpm test -- tests/skill-scripts.test.ts tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts
```

Expected: FAIL until guidance, examples, schemas, and metadata are updated.

- [ ] **Step 3: Update the Skill workflow**

In `SKILL.md` and references, make these rules explicit:

```text
New unfinished graybox entities use lockMode "none".
Ordinary natural-language corrections use preserveLock: true.
Workflow locks never require user authorization.
USER_LOCKED is a stop-and-ask condition.
After explicit confirmation, use preserveLock: false with explicit
lock-mode transition operations in the same atomic Patch.
Background persistence never creates locks.
Explicit save applies workflow locks before serialization.
```

Update all v2 authoring tables and examples to v3. Keep every example generic.
Do not include the motivating private scene, asset labels, paths, or wording.

- [ ] **Step 4: Update examples and transition verification**

Convert canonical example entities:

- old `locked: true` becomes `lockMode: "workflow"`;
- old `locked: false` becomes `lockMode: "none"`.

Set canonical example Patch and report versions to 3 and add
`preserveLock` to every Patch.

In `verify-transition.mjs`, allow only fields actually present in
`entity.flags.set`:

```js
if ("visible" in operation) {
  allowedPrefixes.add(`entities.${operation.entityId}.visible`);
}
if ("lockMode" in operation) {
  allowedPrefixes.add(`entities.${operation.entityId}.lockMode`);
}
```

- [ ] **Step 5: Regenerate schemas and align the Skill digest**

Set `package.json` version to `0.3.0`, then run:

```powershell
pnpm schemas:generate
```

Compute the SHA-256 of
`.agents/skills/shubi-shot-director/references/generated/intent-report.schema.json`
and replace `expectedIntentReportSchemaDigest` in the Skill wrapper with the
exact lowercase digest:

```powershell
(Get-FileHash -Algorithm SHA256 '.agents\skills\shubi-shot-director\references\generated\intent-report.schema.json').Hash.ToLowerInvariant()
```

Do not hand-edit generated JSON.

- [ ] **Step 6: Run Skill, public, schema, and build checks**

Run:

```powershell
pnpm test -- tests/skill-scripts.test.ts tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts tests/skill-compatibility.test.ts
pnpm schemas:generate
git diff --exit-code -- .agents/skills/shubi-shot-director/references/generated
pnpm typecheck
pnpm build
pnpm audit:public
```

Expected: tests PASS, schema regeneration is stable, build succeeds, and the
public audit reports zero findings.

- [ ] **Step 7: Commit the Skill/release checkpoint**

```powershell
git add package.json README.md examples .agents/skills/shubi-shot-director scripts/generate-schemas.ts tests
git commit -m "docs: publish workflow lock contract"
```

## Task 7: Full verification and real-browser acceptance

**Files:**

- Modify: `docs/verification.md`
- Create only ignored transient inputs/outputs under:
  `.shubi-shot/submissions/` and `.shubi-shot/exports/`

- [ ] **Step 1: Run the complete repository verifier**

Run:

```powershell
pnpm verify
```

Expected:

- schemas generate successfully;
- typecheck passes;
- full Vitest suite passes;
- ESLint passes;
- Vite production build succeeds;
- public audit reports zero findings.

Record the exact test count and any non-blocking Vite advisory in
`docs/verification.md`.

- [ ] **Step 2: Verify the Skill/runtime contract before startup**

From `.agents/skills/shubi-shot-director` run:

```powershell
node scripts/director.mjs doctor
```

Expected: compatible capability contract v2 with SceneSpec, ScenePatch, and
IntentReport v3 plus exact lock modes, Patch policy, and error codes.

If an older owned Director instance is running, use only:

```powershell
node scripts/director.mjs stop
node scripts/director.mjs ensure
node scripts/director.mjs health
```

Do not kill a guessed PID or unrelated port owner.

- [ ] **Step 3: Submit a generic workflow-lock correction**

Create an ignored generic connected-region submission containing two generic
props and a final camera. Keep editable entities `none`, submit it, perform the
required overview/local/shot checks, then submit a separate workflow-lock
Patch.

Create a second generic Patch submission with:

```json
{
  "schemaVersion": 3,
  "patchId": "patch_generic_lock_correction",
  "sceneId": "<snapshot sceneId>",
  "baseRevision": "<snapshot revision>",
  "source": "natural-language",
  "preserveLock": true,
  "operations": [
    {
      "op": "entity.transform.translate",
      "entityId": "prop_generic_1",
      "deltaM": [0.25, 0, 0],
      "referenceSpace": "world"
    }
  ]
}
```

Pair it with a schema-valid generic v3 modify `IntentReport`, submit through:

```powershell
node scripts/director.mjs patch submit --file <generic-patch-submission.json>
node scripts/director.mjs snapshot
node scripts/director.mjs composition inspect --json
```

Expected:

- same scene ID;
- revision exactly `baseRevision + 1`;
- only requested transform fields change;
- both workflow lock modes remain unchanged;
- no explicit unlock operations are present;
- no authorization prompt is required.

- [ ] **Step 4: Verify the user-lock stop condition**

Apply a separate explicit lock-policy Patch that sets one generic prop to
`user`, snapshot the new revision, then attempt the same
`preserveLock: true` translation.

Expected:

- `USER_LOCKED`;
- non-zero command exit;
- scene ID and revision unchanged;
- transform and lock mode unchanged;
- Skill guidance classifies it as stop-and-ask rather than retrying.

- [ ] **Step 5: Inspect the real browser and export**

Open the returned loopback `uiUrl` in the integrated browser. Verify:

- workflow and user lock labels are distinct;
- overview and local views render;
- Shot Preview is connected to the exact current scene ID/revision;
- manual controls remain disabled for both locked modes;
- the workflow-preserved correction is visible;
- save locks remaining `none` entities before download.

Export:

```powershell
node scripts/director.mjs export png --file .shubi-shot/exports/lock-preservation.png --width 1920 --height 1080 --force
```

Verify the returned scene ID, revision, dimensions, SHA-256, and warnings.
Visually inspect the exported final camera; a composition report alone is not
acceptance evidence.

- [ ] **Step 6: Record evidence and rerun cleanliness checks**

Update `docs/verification.md` with only generic evidence:

- commit/branch;
- verifier result and test count;
- capability versions and lock fields;
- accepted generic scene ID and revisions;
- user-lock rejection code and unchanged revision;
- PNG dimensions, SHA-256, and warnings;
- browser viewport and inspected views;
- public audit result.

Then run:

```powershell
pnpm audit:public
git diff --check
git status --short --branch
```

Expected: public audit has zero findings, no whitespace errors, and only the
intended verification document remains uncommitted.

- [ ] **Step 7: Commit verified completion**

```powershell
git add docs/verification.md
git commit -m "test: verify workflow lock preservation"
git status --short --branch
```

Expected: clean `codex/lock-provenance` worktree.

## Final completion gate

Before reporting completion:

- inspect `git log --oneline` and confirm every planned checkpoint exists;
- rerun `pnpm verify` after the final documentation commit;
- confirm no ignored transient submission contains source wording or private
  profile data;
- confirm no user-lock test ever mutates revision or state;
- confirm the final browser export used the connected Shot Preview;
- report any unverified item as pending rather than complete;
- do not push or create a release unless the user separately requests it.
