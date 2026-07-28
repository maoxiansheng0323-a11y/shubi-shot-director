# Actor Limb Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Shubi Shot Director v0.4.0 with canonical `present`/`absent` state for twelve humanoid limb segments so creation, atomic edits, locks, contact, composition, browser rendering, persistence, history, and PNG export agree on the visible graybox anatomy.

**Architecture:** Add one domain-owned anatomy contract for canonical part IDs, hierarchy, presence closure, and mannequin dimensions, plus one pure visible-rig-bounds module for pose-aware geometry. Persist the complete map in SceneSpec v4, mutate it only through one allowlisted ScenePatch v4 operation, cover it through IntentReport v4, and project the same state into contact, composition, Three.js, Inspector controls, Skill guidance, and capability checks. Host Codex remains the only semantic authority and may translate explicitly supplied private context into generic part IDs in memory only.

**Tech Stack:** TypeScript 6, Zod 4, React 19, React Three Fiber/Three.js, Zustand, Vitest, Express loopback bridge, Node.js Skill wrapper, pnpm.

---

## File and responsibility map

- `src/domain/actor-anatomy.ts`: canonical part IDs, modes, chains, strict map schema, default map, update closure, and shared mannequin dimensions.
- `src/domain/actor-visible-bounds.ts`: pose-aware visible primitive points, bounds, and support height derived from the anatomy contract.
- `src/domain/scene-schema.ts`: canonical SceneSpec v4 actor-body persistence.
- `src/domain/scene-patch.ts`: allowlisted `actor.limb-presence.set` operation.
- `src/domain/scene-migrations.ts`: v1-v3 SceneSpec, ScenePatch, and IntentReport migration into v4 without invented absences.
- `src/domain/apply-scene-patch.ts`: atomic limb mutation, lock enforcement, error routing, and contact re-solve.
- `src/domain/intent-report.ts` and `src/domain/intent-coverage.ts`: v4 constraint kind and exact evidence coverage.
- `src/domain/contact-constraints.ts`: support from visible geometry instead of fixed full-body contact offsets.
- `src/domain/composition-safety.ts`: framing, occlusion, and actor camera-collision proxies from visible geometry.
- `src/three/SceneWorld.tsx`: conditionally rendered limb chains using shared dimensions and presence state.
- `src/editor/ActorLimbControls.tsx`: non-specialist four-group anatomy controls.
- `src/editor/manual-patches.ts`, `src/editor/Inspector.tsx`, and `src/App.tsx`: manual v4 Patch construction and authoritative revision flow.
- `cli/runtime-capabilities.ts`, `.agents/skills/shubi-shot-director/runtime.json`, and Skill wrapper scripts: v4 compatibility and exact anatomy capability advertisement.
- `.agents/skills/shubi-shot-director/`: host authoring rules, generated schemas, generic examples, and forward validation.
- `tests/`: focused schema, migration, domain, geometry, UI, capability, Skill, history, and public-boundary coverage.

### Task 1: Canonical anatomy contract, SceneSpec v4, migrations, and capabilities

**Files:**

- Create: `src/domain/actor-anatomy.ts`
- Create: `tests/actor-limb-schema-migrations.test.ts`
- Modify: `package.json`
- Modify: `src/domain/schema-versions.ts`
- Modify: `src/domain/scene-schema.ts`
- Modify: `src/domain/scene-migrations.ts`
- Modify: `src/domain/default-scene.ts`
- Modify: `src/domain/intent-report.ts`
- Modify: `cli/runtime-capabilities.ts`
- Modify: `cli/bridge.ts`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Modify: `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Modify: `tests/lock-schema-migrations.test.ts`
- Modify: `tests/runtime-capabilities.test.ts`
- Modify: `tests/bridge-health.test.ts`
- Modify: `tests/bridge-compatibility-cli.test.ts`
- Modify: `tests/skill-compatibility.test.ts`
- Modify: `tests/skill-runtime-locator.test.ts`
- Modify: `tests/helpers/structured-fixtures.ts`
- Modify: `tests/helpers/create-skill-forward-fixtures.ts`
- Modify: every TypeScript fixture that constructs an actor body directly

- [ ] **Step 1: Write failing v4 schema and migration tests**

Create `tests/actor-limb-schema-migrations.test.ts` with focused assertions equivalent to:

```ts
import { describe, expect, it } from "vitest";
import {
  ACTOR_LIMB_PART_IDS,
  createAllPresentLimbPresence,
} from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  parseIntentReportInput,
  parseScenePatchInput,
  parseSceneSpecInput,
} from "../src/domain/scene-migrations";
import { sceneSpecSchema } from "../src/domain/scene-schema";

const actorFrom = (scene: ReturnType<typeof createDefaultScene>) => {
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor || actor.kind !== "actor") throw new Error("Missing actor fixture.");
  return actor;
};

describe("actor limb schema v4", () => {
  it("requires all twelve canonical parts and exactly two modes", () => {
    const scene = createDefaultScene();
    expect(ACTOR_LIMB_PART_IDS).toHaveLength(12);
    expect(actorFrom(scene).body.limbPresence).toEqual(
      createAllPresentLimbPresence(),
    );
    expect(sceneSpecSchema.safeParse(scene).success).toBe(true);

    const missing = structuredClone(scene);
    delete (actorFrom(missing).body.limbPresence as Record<string, unknown>).hand_r;
    expect(sceneSpecSchema.safeParse(missing).success).toBe(false);

    const extra = structuredClone(scene);
    (actorFrom(extra).body.limbPresence as Record<string, unknown>).wing_l = "absent";
    expect(sceneSpecSchema.safeParse(extra).success).toBe(false);

    const unknownMode = structuredClone(scene);
    (actorFrom(unknownMode).body.limbPresence as Record<string, unknown>).foot_l = "hidden";
    expect(sceneSpecSchema.safeParse(unknownMode).success).toBe(false);
  });

  it("rejects a detached present descendant", () => {
    const scene = createDefaultScene();
    actorFrom(scene).body.limbPresence.upper_arm_r = "absent";
    expect(sceneSpecSchema.safeParse(scene).success).toBe(false);
  });

  it.each([1, 2, 3] as const)(
    "migrates SceneSpec v%s actors to all-present v4 without changing revision",
    (schemaVersion) => {
      const legacy = structuredClone(createDefaultScene()) as unknown as Record<string, unknown>;
      legacy.schemaVersion = schemaVersion;
      legacy.revision = 9;
      for (const entity of legacy.entities as Array<Record<string, unknown>>) {
        if (entity.kind === "actor") {
          delete (entity.body as Record<string, unknown>).limbPresence;
        }
        if (schemaVersion < 3) {
          entity.locked = entity.lockMode !== "none";
          delete entity.lockMode;
        }
      }
      if (schemaVersion === 1) delete legacy.spatialLayout;

      const migrated = parseSceneSpecInput(legacy);
      expect(migrated.schemaVersion).toBe(4);
      expect(migrated.revision).toBe(9);
      expect(actorFrom(migrated).body.limbPresence).toEqual(
        createAllPresentLimbPresence(),
      );
    },
  );

  it("migrates v3 Patch and IntentReport without inventing limb intent", () => {
    const scene = createDefaultScene();
    const patch = parseScenePatchInput({
      schemaVersion: 3,
      patchId: "patch_legacy_v3",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: true,
      operations: [{ op: "scene.title.set", value: "Legacy title" }],
    });
    expect(patch.schemaVersion).toBe(4);
    expect(patch.operations).toEqual([
      { op: "scene.title.set", value: "Legacy title" },
    ]);

    const report = parseIntentReportInput({
      schemaVersion: 3,
      operation: "modify",
      allowPartial: false,
      recognizedConstraints: [],
      unsupportedConstraints: [],
      unresolvedRelations: [],
      warnings: [],
      canApplySafely: true,
    });
    expect(report.schemaVersion).toBe(4);
    expect(report.recognizedConstraints).toEqual([]);
  });
});
```

Update `tests/lock-schema-migrations.test.ts` so canonical SceneSpec and ScenePatch fixtures use version 4, while v1-v3 remain migration inputs. Add assertions that a v3 `entity.add` actor receives an all-present map and that every migrated Patch operation retains its original index and order.

- [ ] **Step 2: Write failing exact-capability tests**

Extend the expected manifest in `tests/runtime-capabilities.test.ts`, Skill compatibility tests, bridge tests, and runtime-locator tests with:

```ts
const EXPECTED_ACTOR_LIMB_PART_IDS = [
  "upper_arm_l", "forearm_l", "hand_l",
  "upper_arm_r", "forearm_r", "hand_r",
  "upper_leg_l", "lower_leg_l", "foot_l",
  "upper_leg_r", "lower_leg_r", "foot_r",
] as const;
const EXPECTED_ACTOR_LIMB_PRESENCE_MODES = ["present", "absent"] as const;
const EXPECTED_ACTOR_LIMB_ERROR_CODES = ["LIMB_HIERARCHY_CONFLICT"] as const;

expect(getRuntimeCapabilityManifest()).toMatchObject({
  capabilitiesContractVersion: 2,
  applicationVersion: "0.4.0",
  sceneSchemaVersion: 4,
  patchSchemaVersion: 4,
  intentReportSchemaVersion: 4,
  features: expect.arrayContaining(["actor.limb-presence"]),
  actorLimbPartIds: [...EXPECTED_ACTOR_LIMB_PART_IDS],
  actorLimbPresenceModes: [...EXPECTED_ACTOR_LIMB_PRESENCE_MODES],
  actorLimbErrorCodes: [...EXPECTED_ACTOR_LIMB_ERROR_CODES],
});
```

For each new array, add cases for missing, empty, duplicate, non-string, and mismatched values. Require `doctor` and the bridge compatibility gate to reject them with `CAPABILITIES_INVALID` before scene mutation.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
pnpm test -- tests/actor-limb-schema-migrations.test.ts tests/lock-schema-migrations.test.ts tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
```

Expected: FAIL because v4 constants, the anatomy module, actor maps, and anatomy capability fields do not exist.

- [ ] **Step 4: Add the canonical anatomy contract**

Create `src/domain/actor-anatomy.ts` with these public exports and deterministic rules:

```ts
import { z } from "zod";

export const ACTOR_LIMB_PRESENCE_MODES = ["present", "absent"] as const;
export const actorLimbPresenceModeSchema = z.enum(ACTOR_LIMB_PRESENCE_MODES);
export type ActorLimbPresenceMode = z.infer<typeof actorLimbPresenceModeSchema>;

export const ACTOR_LIMB_CHAINS = {
  leftArm: ["upper_arm_l", "forearm_l", "hand_l"],
  rightArm: ["upper_arm_r", "forearm_r", "hand_r"],
  leftLeg: ["upper_leg_l", "lower_leg_l", "foot_l"],
  rightLeg: ["upper_leg_r", "lower_leg_r", "foot_r"],
} as const;

export const ACTOR_LIMB_PART_IDS = [
  ...ACTOR_LIMB_CHAINS.leftArm,
  ...ACTOR_LIMB_CHAINS.rightArm,
  ...ACTOR_LIMB_CHAINS.leftLeg,
  ...ACTOR_LIMB_CHAINS.rightLeg,
] as const;
export type ActorLimbPartId = (typeof ACTOR_LIMB_PART_IDS)[number];

export const actorLimbPresenceSchema = z
  .object({
    upper_arm_l: actorLimbPresenceModeSchema,
    forearm_l: actorLimbPresenceModeSchema,
    hand_l: actorLimbPresenceModeSchema,
    upper_arm_r: actorLimbPresenceModeSchema,
    forearm_r: actorLimbPresenceModeSchema,
    hand_r: actorLimbPresenceModeSchema,
    upper_leg_l: actorLimbPresenceModeSchema,
    lower_leg_l: actorLimbPresenceModeSchema,
    foot_l: actorLimbPresenceModeSchema,
    upper_leg_r: actorLimbPresenceModeSchema,
    lower_leg_r: actorLimbPresenceModeSchema,
    foot_r: actorLimbPresenceModeSchema,
  })
  .strict()
  .superRefine((presence, context) => {
    for (const chain of Object.values(ACTOR_LIMB_CHAINS)) {
      for (let parentIndex = 0; parentIndex < chain.length - 1; parentIndex += 1) {
        if (presence[chain[parentIndex]] !== "absent") continue;
        for (let childIndex = parentIndex + 1; childIndex < chain.length; childIndex += 1) {
          if (presence[chain[childIndex]] === "present") {
            context.addIssue({
              code: "custom",
              message: "An absent limb parent cannot have a present descendant.",
              path: [chain[childIndex]],
            });
          }
        }
      }
    }
  });

export type ActorLimbPresence = z.infer<typeof actorLimbPresenceSchema>;
export type ActorLimbPresenceUpdates = Partial<ActorLimbPresence>;

export const createAllPresentLimbPresence = (): ActorLimbPresence =>
  Object.fromEntries(
    ACTOR_LIMB_PART_IDS.map((partId) => [partId, "present"]),
  ) as ActorLimbPresence;

export class ActorLimbPresenceError extends Error {
  readonly code = "LIMB_HIERARCHY_CONFLICT" as const;
}

export const resolveActorLimbPresenceUpdates = (
  current: ActorLimbPresence,
  updates: ActorLimbPresenceUpdates,
): ActorLimbPresence => {
  for (const chain of Object.values(ACTOR_LIMB_CHAINS)) {
    for (let parentIndex = 0; parentIndex < chain.length - 1; parentIndex += 1) {
      const parent = chain[parentIndex];
      if (updates[parent] !== "absent") continue;
      for (const descendant of chain.slice(parentIndex + 1)) {
        if (updates[descendant] === "present") {
          throw new ActorLimbPresenceError(
            `Conflicting explicit limb states: ${parent}, ${descendant}`,
          );
        }
      }
    }
  }

  const next: ActorLimbPresence = { ...current, ...updates };
  for (const chain of Object.values(ACTOR_LIMB_CHAINS)) {
    for (const [index, partId] of chain.entries()) {
      if (updates[partId] === "absent") {
        for (const descendant of chain.slice(index + 1)) next[descendant] = "absent";
      }
      if (updates[partId] === "present") {
        for (const ancestor of chain.slice(0, index)) next[ancestor] = "present";
      }
    }
  }
  return actorLimbPresenceSchema.parse(next);
};

export interface ActorAnatomyDimensions {
  heightM: number;
  shoulderWidthM: number;
  spineOriginY: number;
  torsoLength: number;
  torsoRadius: number;
  torsoCapsuleLength: number;
  pelvisWidth: number;
  pelvisHeight: number;
  pelvisDepth: number;
  torsoDepth: number;
  headOriginY: number;
  upperArmLength: number;
  forearmLength: number;
  upperLegLength: number;
  lowerLegLength: number;
  headRadius: number;
  faceRadius: number;
  faceOffset: readonly [number, number, number];
  armRadius: number;
  forearmRadius: number;
  shoulderRadius: number;
  elbowRadius: number;
  legRadius: number;
  lowerLegRadius: number;
  hipRadius: number;
  kneeRadius: number;
  shoulderOffsetX: number;
  shoulderOriginY: number;
  hipOffsetX: number;
  hipOriginY: number;
  handSize: readonly [number, number, number];
  handOffset: readonly [number, number, number];
  footSize: readonly [number, number, number];
  footOffset: readonly [number, number, number];
}

export const deriveActorAnatomyDimensions = (body: {
  heightM: number;
  shoulderWidthM: number;
  build: "slim" | "average" | "broad";
}): ActorAnatomyDimensions => {
  const buildScale = body.build === "broad" ? 1.12 : body.build === "slim" ? 0.9 : 1;
  const torsoLength = body.heightM * 0.31;
  const pelvisWidth = body.shoulderWidthM * 0.72;
  const torsoDepth = body.heightM * 0.115 * buildScale;
  const headRadius = body.heightM * 0.075;
  const armRadius = body.heightM * 0.035 * buildScale;
  const legRadius = body.heightM * 0.045 * buildScale;
  return {
    heightM: body.heightM,
    shoulderWidthM: body.shoulderWidthM,
    spineOriginY: body.heightM * 0.035,
    torsoLength,
    torsoRadius: body.shoulderWidthM * 0.28,
    torsoCapsuleLength: Math.max(0.02, torsoLength - body.shoulderWidthM * 0.48),
    pelvisWidth,
    pelvisHeight: body.heightM * 0.12,
    pelvisDepth: torsoDepth * 0.86,
    torsoDepth,
    headOriginY: torsoLength + body.heightM * 0.055,
    upperArmLength: body.heightM * 0.19,
    forearmLength: body.heightM * 0.17,
    upperLegLength: body.heightM * 0.245,
    lowerLegLength: body.heightM * 0.235,
    headRadius,
    faceRadius: headRadius * 0.34,
    faceOffset: [0, -headRadius * 0.05, headRadius * 0.84],
    armRadius,
    forearmRadius: armRadius * 0.82,
    shoulderRadius: armRadius * 1.28,
    elbowRadius: armRadius * 1.08,
    legRadius,
    lowerLegRadius: legRadius * 0.82,
    hipRadius: legRadius * 1.3,
    kneeRadius: legRadius * 1.08,
    shoulderOffsetX: body.shoulderWidthM * 0.52,
    shoulderOriginY: torsoLength * 0.78,
    hipOffsetX: pelvisWidth * 0.31,
    hipOriginY: -body.heightM * 0.035,
    handSize: [body.heightM * 0.055, body.heightM * 0.085, body.heightM * 0.035],
    handOffset: [0, -body.heightM * 0.035, 0.012],
    footSize: [body.heightM * 0.075, body.heightM * 0.055, body.heightM * 0.16],
    footOffset: [0, -body.heightM * 0.025, body.heightM * 0.055],
  };
};
```

Keep all error text generic: canonical part IDs and generic actor IDs are allowed; aliases and source wording are not.

- [ ] **Step 5: Upgrade canonical schemas and legacy migration**

Set all three canonical versions to 4:

```ts
export const SCENE_SCHEMA_VERSION = 4 as const;
export const PATCH_SCHEMA_VERSION = 4 as const;
export const INTENT_REPORT_SCHEMA_VERSION = 4 as const;
```

In `actorEntitySchema.body`, require:

```ts
limbPresence: actorLimbPresenceSchema,
```

Add `limbPresence: createAllPresentLimbPresence()` to `createDefaultScene()` and every TypeScript actor fixture. In `scene-migrations.ts`:

- retain the current v1 and v2 lock migration;
- add a strict v3 entity envelope that requires `lockMode`, rejects `locked`, and rejects an actor body already containing `limbPresence`;
- add all-present maps only to actor entities during v1-v3 migration;
- add a v3 Patch envelope that requires `preserveLock`, rejects `actor.limb-presence.set`, upgrades `entity.add` actor values, and preserves operation order;
- add a v3 IntentReport envelope using the exact v3 constraint kinds/evidence paths and upgrade it without adding `actor-limb-presence` constraints.

The migration entrypoints must still parse canonical v4 first and must not change scene revision, history, file contents, or lock modes.

Set `package.json` version to `0.4.0` in the same checkpoint so the runtime manifest never reports v4 schemas under the old minor application version.

- [ ] **Step 6: Publish exact anatomy capabilities without changing contract v2**

In `cli/runtime-capabilities.ts`, import the anatomy constants and add:

```ts
export const ACTOR_LIMB_ERROR_CODES = ["LIMB_HIERARCHY_CONFLICT"] as const;

// in RUNTIME_FEATURE_IDS
"actor.limb-presence",

// in RuntimeCapabilityManifest
actorLimbPartIds: string[];
actorLimbPresenceModes: string[];
actorLimbErrorCodes: string[];

// in getRuntimeCapabilityManifest()
actorLimbPartIds: [...ACTOR_LIMB_PART_IDS],
actorLimbPresenceModes: [...ACTOR_LIMB_PRESENCE_MODES],
actorLimbErrorCodes: [...ACTOR_LIMB_ERROR_CODES],
```

Require non-empty unique string arrays, return defensive copies, and compare them as exact unordered sets in `cli/bridge.ts`. Add the same fields to `runtime.json`, `runtime-locator.mjs`, `compatibility-plan.mjs`, and `director.mjs`. `doctor` must reject a v4 runtime lacking any anatomy field before authoring or submission.

- [ ] **Step 7: Run schema, migration, capability, type, and build checks**

Run:

```powershell
pnpm test -- tests/actor-limb-schema-migrations.test.ts tests/lock-schema-migrations.test.ts tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
pnpm typecheck
pnpm build
```

Expected: all selected tests PASS; canonical v4 requires a complete valid map; v1-v3 migrate all actors to all-present; capability contract remains v2 and advertises exact anatomy support.

- [ ] **Step 8: Commit the schema checkpoint**

```powershell
git add package.json src/domain/actor-anatomy.ts src/domain/schema-versions.ts src/domain/scene-schema.ts src/domain/scene-migrations.ts src/domain/default-scene.ts src/domain/intent-report.ts cli/runtime-capabilities.ts cli/bridge.ts .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/scripts tests
git commit -m "feat: add canonical actor limb schema"
```

### Task 2: Atomic limb Patch, hierarchy closure, IntentReport v4, locks, and history

**Files:**

- Create: `tests/actor-limb-presence.test.ts`
- Modify: `src/domain/scene-patch.ts`
- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/intent-report.ts`
- Modify: `src/domain/intent-coverage.ts`
- Modify: `src/editor/error-messages.ts`
- Modify: `tests/intent-report.test.ts`
- Modify: `tests/error-messages.test.ts`
- Modify: `tests/lock-preservation.test.ts`
- Modify: `tests/atomic-patch.test.ts`
- Modify: `tests/scene-persistence.test.ts`
- Modify: `tests/scene-session.test.ts`

- [ ] **Step 1: Write failing atomic Patch and history tests**

Create `tests/actor-limb-presence.test.ts` with cases equivalent to:

```ts
import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { applyScenePatch, SceneDomainError } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

const actor = (scene: ReturnType<typeof createDefaultScene>) => {
  const value = scene.entities.find((entity) => entity.kind === "actor");
  if (!value || value.kind !== "actor") throw new Error("Missing actor fixture.");
  return value;
};

const patch = (
  scene: ReturnType<typeof createDefaultScene>,
  updates: Record<string, "present" | "absent">,
  preserveLock = true,
) => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: "patch_actor_limb_presence",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language" as const,
  preserveLock,
  operations: [{
    op: "actor.limb-presence.set" as const,
    actorId: actor(scene).id,
    updates,
  }],
});

const expectCode = (callback: () => unknown, code: string) => {
  try {
    callback();
    throw new Error("Expected SceneDomainError.");
  } catch (error) {
    expect(error).toBeInstanceOf(SceneDomainError);
    expect((error as SceneDomainError).code).toBe(code);
  }
};

describe("actor limb presence patches", () => {
  it("cascades parent absence and restores required ancestors", () => {
    const scene = createDefaultScene();
    const removed = applyScenePatch(scene, patch(scene, {
      upper_arm_r: "absent",
      lower_leg_l: "absent",
      lower_leg_r: "absent",
    })).next;
    expect(actor(removed).body.limbPresence).toMatchObject({
      upper_arm_r: "absent", forearm_r: "absent", hand_r: "absent",
      lower_leg_l: "absent", foot_l: "absent",
      lower_leg_r: "absent", foot_r: "absent",
    });

    const restored = applyScenePatch(removed, patch(removed, { hand_r: "present" })).next;
    expect(actor(restored).body.limbPresence).toMatchObject({
      upper_arm_r: "present", forearm_r: "present", hand_r: "present",
    });
  });

  it("does not restore descendants from a parent or alter ancestors from a child absence", () => {
    const scene = createDefaultScene();
    const removed = applyScenePatch(scene, patch(scene, { forearm_l: "absent" })).next;
    const parentOnly = applyScenePatch(
      removed,
      patch(removed, { upper_arm_l: "present" }),
    ).next;
    expect(actor(parentOnly).body.limbPresence).toMatchObject({
      upper_arm_l: "present", forearm_l: "absent", hand_l: "absent",
    });

    const terminalOnly = applyScenePatch(
      parentOnly,
      patch(parentOnly, { foot_r: "absent" }),
    ).next;
    expect(actor(terminalOnly).body.limbPresence).toMatchObject({
      upper_leg_r: "present", lower_leg_r: "present", foot_r: "absent",
    });
  });

  it("rejects explicit parent-absent child-present conflict atomically", () => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);
    expectCode(
      () => applyScenePatch(scene, patch(scene, {
        upper_arm_r: "absent",
        hand_r: "present",
      })),
      "LIMB_HIERARCHY_CONFLICT",
    );
    expect(scene).toEqual(before);
  });

  it.each(["missing", "prop"] as const)("rejects %s actor targets", (kind) => {
    const scene = createDefaultScene();
    const input = patch(scene, { hand_l: "absent" });
    input.operations[0].actorId = kind === "missing" ? "actor_missing_1" : "prop_block_1";
    expectCode(() => applyScenePatch(scene, input), "ACTOR_LIMB_TARGET_INVALID");
  });

  it("preserves workflow locks and rejects user locks", () => {
    const workflowScene = createDefaultScene();
    actor(workflowScene).lockMode = "workflow";
    const changed = applyScenePatch(
      workflowScene,
      patch(workflowScene, { hand_l: "absent" }, true),
    ).next;
    expect(actor(changed)).toMatchObject({
      lockMode: "workflow",
      body: { limbPresence: { hand_l: "absent" } },
    });

    const userScene = createDefaultScene();
    actor(userScene).lockMode = "user";
    expectCode(
      () => applyScenePatch(userScene, patch(userScene, { hand_l: "absent" }, true)),
      "USER_LOCKED",
    );
  });

  it("creates one revision and one undo/redo step", () => {
    const session = new SceneSession(createDefaultScene());
    const before = session.snapshot();
    const accepted = session.applyPatch(patch(before, { foot_r: "absent" }));
    expect(accepted.revision).toBe(before.revision + 1);
    expect(session.historyStatus()).toEqual({ canUndo: true, canRedo: false });
    expect(actor(session.undo()!).body.limbPresence.foot_r).toBe("present");
    expect(actor(session.redo()!).body.limbPresence.foot_r).toBe("absent");
  });
});
```

Add a multi-operation rollback case: change scene title, apply a valid limb update, then target a missing actor. Assert no scene, revision, lock, contact, history, or listener change.

Add persistence/session cases that serialize and reparse the exact v4 map, replace the current session from a saved scene without losing absences, and prove background persistence does not change anatomy or create a lock.

- [ ] **Step 2: Write failing IntentReport v4 coverage tests**

In `tests/intent-report.test.ts`, add create and modify cases:

```ts
expect(() => validateIntentCoverage({
  schemaVersion: 4,
  operation: "create",
  allowPartial: false,
  recognizedConstraints: [{
    id: "intent_actor_limb_presence_1",
    kind: "actor-limb-presence",
    required: true,
    targets: ["actor_generic_1"],
    evidence: [{
      type: "entity-property",
      entityId: "actor_generic_1",
      path: "entity.body.limbPresence.upper_arm_r",
    }],
  }],
  unsupportedConstraints: [],
  unresolvedRelations: [],
  warnings: [],
  canApplySafely: true,
}, { after: scene })).not.toThrow();
```

For modify, use `patch-operation` evidence pointing to `actor.limb-presence.set`. Add failures for a prop target, wrong operation index, evidence for an unrelated actor, and a prosthesis request represented as `UNSUPPORTED_CONSTRAINT` with `canApplySafely: false`; require `UNSUPPORTED_DESCRIPTION` instead of a presence edit.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
pnpm test -- tests/actor-limb-presence.test.ts tests/intent-report.test.ts tests/lock-preservation.test.ts tests/atomic-patch.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/error-messages.test.ts
```

Expected: FAIL because the operation, v4 intent kind/evidence, errors, and contact affected-ID routing do not exist.

- [ ] **Step 4: Add the allowlisted operation and strict update shape**

In `src/domain/scene-patch.ts`, add a strict update schema with all twelve optional canonical keys, reject zero keys, and add:

```ts
z.object({
  op: z.literal("actor.limb-presence.set"),
  actorId: entityIdSchema,
  updates: actorLimbPresenceUpdatesSchema,
}).strict(),
```

The public operation uses `actorId`, not a JSON path and not `entityId`. It accepts one through twelve known keys only.

- [ ] **Step 5: Apply hierarchy closure inside the existing transaction**

In `src/domain/apply-scene-patch.ts`, add:

```ts
case "actor.limb-presence.set": {
  const entity = scene.entities.find((candidate) => candidate.id === operation.actorId);
  if (!entity || entity.kind !== "actor") {
    throw new SceneDomainError(
      "ACTOR_LIMB_TARGET_INVALID",
      `Actor target is invalid: ${operation.actorId}`,
    );
  }
  requireMutable(entity, preserveLock);
  try {
    entity.body.limbPresence = resolveActorLimbPresenceUpdates(
      entity.body.limbPresence,
      operation.updates,
    );
  } catch (error) {
    if (error instanceof ActorLimbPresenceError) {
      throw new SceneDomainError(error.code, error.message);
    }
    throw error;
  }
  return;
}
```

Add `operation.actorId` to `contactAffectedEntityIds`. Keep contact enforcement after the operation and before final schema validation so contact failure rolls back anatomy too. Add the new operation to the workflow-lock direct-family test.

- [ ] **Step 6: Add IntentReport v4 evidence and operation coverage**

In `intent-report.ts`:

```ts
export const INTENT_CONSTRAINT_KINDS_V4 = [
  ...INTENT_CONSTRAINT_KINDS_V3,
  "actor-limb-presence",
] as const;

export const ACTOR_LIMB_EVIDENCE_PATHS = ACTOR_LIMB_PART_IDS.map(
  (partId) =>
    `entity.body.limbPresence.${partId}` as
      `entity.body.limbPresence.${ActorLimbPartId}`,
);

export const ENTITY_EVIDENCE_PATHS_V4 = [
  ...ENTITY_EVIDENCE_PATHS_V3,
  ...ACTOR_LIMB_EVIDENCE_PATHS,
] as const;
```

Use the v4 enums in the canonical schemas. In `intent-coverage.ts`:

- recognize any path in `ACTOR_LIMB_EVIDENCE_PATHS` only for actor targets and `actor-limb-presence`;
- add `actor-limb-presence` to `entityKindsForAddedEntity` for actor creation;
- map `actor.limb-presence.set` only to `actor-limb-presence` and its actor target;
- require all declared targets to be actors;
- reject evidence that points to a different actor or a non-limb operation.

- [ ] **Step 7: Add generic user-facing errors and run GREEN checks**

Add to `src/editor/error-messages.ts`:

```ts
ACTOR_LIMB_TARGET_INVALID: "目标不是可编辑的人偶，未执行肢体修改",
LIMB_HIERARCHY_CONFLICT: "同一次修改中的肢体上下游状态互相冲突，未执行修改",
```

Run:

```powershell
pnpm test -- tests/actor-limb-presence.test.ts tests/intent-report.test.ts tests/lock-preservation.test.ts tests/atomic-patch.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/error-messages.test.ts
pnpm typecheck
```

Expected: selected tests PASS; each accepted Patch advances once; every hierarchy, target, lock, intent, contact, or final-schema failure leaves authority and history unchanged.

- [ ] **Step 8: Commit the atomic domain checkpoint**

```powershell
git add src/domain/scene-patch.ts src/domain/apply-scene-patch.ts src/domain/intent-report.ts src/domain/intent-coverage.ts src/editor/error-messages.ts tests
git commit -m "feat: apply actor limb presence atomically"
```

### Task 3: Shared visible anatomy, contact support, and composition safety

**Files:**

- Create: `src/domain/actor-visible-bounds.ts`
- Create: `tests/actor-visible-bounds.test.ts`
- Modify: `src/domain/humanoid-rig.ts`
- Modify: `src/domain/contact-constraints.ts`
- Modify: `src/domain/composition-safety.ts`
- Modify: `tests/contact-constraints.test.ts`
- Modify: `tests/composition-safety.test.ts`
- Modify: `tests/shot-regressions.test.ts`

- [ ] **Step 1: Write failing visible-bounds and support tests**

Create `tests/actor-visible-bounds.test.ts` with assertions for the actual rendered primitives:

```ts
import { describe, expect, it } from "vitest";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";

const actor = (scene: ReturnType<typeof createDefaultScene>) => {
  const value = scene.entities.find((entity) => entity.kind === "actor");
  if (!value || value.kind !== "actor") throw new Error("Missing actor fixture.");
  return value;
};

describe("visible actor rig bounds", () => {
  it("keeps all-present standing support at the accepted value", () => {
    const value = actor(createDefaultScene());
    const bounds = actorVisibleRigBounds(value);
    expect(bounds.supportOffsetM).toBeCloseTo(0.977, 3);
    expect(bounds.primitiveIds).toContain("foot_l");
    expect(bounds.primitiveIds).toContain("foot_r");
  });

  it("removes absent chains from primitives and bounds", () => {
    const scene = createDefaultScene();
    const changed = applyScenePatch(scene, {
      schemaVersion: 4,
      patchId: "patch_visible_bounds",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: true,
      operations: [{
        op: "actor.limb-presence.set",
        actorId: actor(scene).id,
        updates: {
          upper_arm_r: "absent",
          lower_leg_l: "absent",
          lower_leg_r: "absent",
        },
      }],
    }).next;
    const bounds = actorVisibleRigBounds(actor(changed));
    expect(bounds.primitiveIds).not.toEqual(
      expect.arrayContaining([
        "shoulder_r", "upper_arm_r", "elbow_r", "forearm_r", "hand_r",
        "knee_l", "lower_leg_l", "foot_l", "knee_r", "lower_leg_r", "foot_r",
      ]),
    );
    expect(bounds.supportOffsetM).toBeLessThan(0.977);
  });
});
```

Extend contact tests with:

- one complete leg remaining keeps standing support on that leg;
- both lower legs absent place the visible upper-leg ends on the surface;
- both full leg chains absent use the lowest pelvis/torso/arm geometry;
- a limb Patch re-solves enabled contact in the same revision;
- an indirect contact move of a user-locked actor returns `USER_LOCKED` and rolls back.

Extend composition tests so absent parts do not expand full framing bounds or the occlusion proxy, and the camera can be tested against an actor's visible proxy without phantom limbs.

- [ ] **Step 2: Run geometry tests and verify RED**

Run:

```powershell
pnpm test -- tests/actor-visible-bounds.test.ts tests/contact-constraints.test.ts tests/composition-safety.test.ts tests/shot-regressions.test.ts
```

Expected: FAIL because support and composition still assume a full humanoid and the visible-bounds helper is absent.

- [ ] **Step 3: Implement the pure visible-rig contract**

Create `src/domain/actor-visible-bounds.ts` with this public shape:

```ts
export type ActorVisiblePrimitiveId =
  | "pelvis" | "torso" | "head" | "face"
  | "shoulder_l" | "elbow_l" | "hip_l" | "knee_l"
  | "shoulder_r" | "elbow_r" | "hip_r" | "knee_r"
  | ActorLimbPartId;

export interface ActorVisibleRigBounds {
  primitiveIds: ActorVisiblePrimitiveId[];
  localPoints: Vec3[];
  worldPoints: Vec3[];
  minLocal: Vec3;
  maxLocal: Vec3;
  minWorld: Vec3;
  maxWorld: Vec3;
  supportOffsetM: number;
}

export declare const actorVisibleRigBounds: (
  actor: ActorEntity,
  transform?: TransformSpec,
) => ActorVisibleRigBounds;

export declare const actorVisibleFramingPoints: (
  actor: ActorEntity,
  lowerFraction: number,
) => Vec3[];
```

Implement `actorVisibleRigBounds` by reproducing the exact current SceneWorld hierarchy with `deriveActorAnatomyDimensions`, `actor.pose.joints`, `rotateVector`, and `transformPoint`. Add conservative points for these primitives:

| Primitive | Presence condition | Geometry used for points |
| --- | --- | --- |
| pelvis | always | eight corners of the pelvis box |
| torso | always | capsule endpoints expanded by torso radius |
| head and face | always | center plus six axis-radius points |
| shoulder or hip proxy | matching upper segment present | center plus six sphere-radius points |
| upper arm/leg capsule | matching upper segment present | joint-to-end endpoints expanded by radius |
| elbow or knee proxy | matching middle segment present | center plus six sphere-radius points |
| forearm/lower-leg capsule | matching middle segment present | joint-to-end endpoints expanded by radius |
| hand/foot box | matching terminal present | eight transformed box corners using existing offsets |

For a capsule, add both endpoint centers plus `+/-radius` on local X, Y, and Z after the complete parent/joint rotation. For a box, transform all eight corners. Compute `supportOffsetM` as `transform.positionM[1] - minWorld[1]`. The function must not read `contactOffsetM`; that parameter remains load-compatible metadata only.

`actorVisibleFramingPoints` computes `sliceY = minLocal[1] + (maxLocal[1] - minLocal[1]) * lowerFraction`, retains local points with `point[1] >= sliceY`, always adds face/head anchor points, then applies the actor transform.

Update `humanoid-rig.ts` to use `deriveActorAnatomyDimensions` for spine origin, torso length, head origin, head radius, and face offset. Anchor behavior and existing anchor tests must remain unchanged.

- [ ] **Step 4: Snap contact from visible support geometry**

Replace `actorContactOffsetM` in `contact-constraints.ts` with:

```ts
const actorSupportOffsetM = (
  entity: SceneEntity,
  transform: TransformSpec,
): number => {
  if (entity.kind !== "actor") {
    throw new ContactConstraintError(
      "CONTACT_TARGET_UNSUPPORTED",
      "Ground contact currently supports actor targets only.",
    );
  }
  return actorVisibleRigBounds(entity, transform).supportOffsetM;
};
```

Then compute the snapped Y as:

```ts
const supportOffsetM = actorSupportOffsetM(entity, candidate);
positionM: [candidate.positionM[0], surfaceY + supportOffsetM, candidate.positionM[2]],
```

Remove `CONTACT_OFFSET_INVALID` from active contact behavior and update its tests. Keep parsing older pose metadata without using it as geometry authority.

- [ ] **Step 5: Use visible bounds for composition**

In `composition-safety.ts`:

- replace `actorLocalBounds`, `actorFullBoundsPoints`, and fixed `actorContactOffset` with `actorVisibleRigBounds` and `actorVisibleFramingPoints`;
- keep framing fractions `close: 0.72`, `medium-close: 0.5`, `medium: 0.3`, `full: 0`;
- build the actor occlusion proxy from the visible world AABB center and half diagonal;
- add `CAMERA_INSIDE_ACTOR_PROXY` to `compositionIssueCodes` and report it only when the camera lies inside the visible actor AABB;
- keep face/head/chest/pelvis anchors available because those regions are never removable;
- mark actor proxy checks approximate and require visual confirmation.

Use this exact proxy calculation:

```ts
const center: Vec3 = [
  (bounds.minWorld[0] + bounds.maxWorld[0]) / 2,
  (bounds.minWorld[1] + bounds.maxWorld[1]) / 2,
  (bounds.minWorld[2] + bounds.maxWorld[2]) / 2,
];
const radiusM = Math.hypot(
  bounds.maxWorld[0] - center[0],
  bounds.maxWorld[1] - center[1],
  bounds.maxWorld[2] - center[2],
);
```

- [ ] **Step 6: Run geometry, regression, type, and build checks**

Run:

```powershell
pnpm test -- tests/actor-visible-bounds.test.ts tests/contact-constraints.test.ts tests/composition-safety.test.ts tests/shot-regressions.test.ts tests/actor-limb-presence.test.ts
pnpm typecheck
pnpm build
```

Expected: selected tests PASS; all-present contact remains within one millimeter of accepted behavior; absent geometry contributes neither support nor composition proxy volume.

- [ ] **Step 7: Commit the geometry checkpoint**

```powershell
git add src/domain/actor-visible-bounds.ts src/domain/humanoid-rig.ts src/domain/contact-constraints.ts src/domain/composition-safety.ts tests
git commit -m "feat: derive support from visible anatomy"
```

### Task 4: Conditional Three.js rendering and authoritative Inspector controls

**Files:**

- Create: `src/editor/ActorLimbControls.tsx`
- Create: `tests/actor-limb-controls.test.ts`
- Modify: `src/three/SceneWorld.tsx`
- Modify: `src/editor/manual-patches.ts`
- Modify: `src/editor/Inspector.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/manual-patches.test.ts`
- Modify: `tests/lock-ui-semantics.test.ts`

- [ ] **Step 1: Write failing manual-Patch and control-render tests**

Extend `tests/manual-patches.test.ts`:

```ts
const limbPatch = scenePatchSchema.parse(
  createActorLimbPresencePatch(
    scene,
    "actor_generic_1",
    { lower_leg_l: "absent" },
  ),
);
expect(limbPatch).toMatchObject({
  schemaVersion: 4,
  baseRevision: scene.revision,
  source: "manual",
  preserveLock: false,
  operations: [{
    op: "actor.limb-presence.set",
    actorId: "actor_generic_1",
    updates: { lower_leg_l: "absent" },
  }],
});
```

Create `tests/actor-limb-controls.test.ts` using `renderToStaticMarkup`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { Inspector } from "../src/editor/Inspector";

const actorFrom = (scene: ReturnType<typeof createDefaultScene>) => {
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor || actor.kind !== "actor") throw new Error("Missing actor fixture.");
  return actor;
};

const renderActor = (configure?: (actor: ReturnType<typeof actorFrom>) => void) => {
  const scene = createDefaultScene();
  const actor = actorFrom(scene);
  configure?.(actor);
  return renderToStaticMarkup(createElement(Inspector, {
    scene,
    selectedId: actor.id,
    onSetLimbPresence: () => undefined,
  }));
};

describe("actor limb controls", () => {
  it("renders twelve text-labelled controls in four groups", () => {
    const markup = renderActor();
    expect(markup.match(/data-limb-part=/gu)).toHaveLength(12);
    for (const group of ["左臂", "右臂", "左腿", "右腿"]) {
      expect(markup).toContain(group);
    }
    expect(markup).toContain("Present");
  });

  it("disables descendants when an ancestor is absent", () => {
    const markup = renderActor((actor) => {
      actor.body.limbPresence.upper_arm_r = "absent";
      actor.body.limbPresence.forearm_r = "absent";
      actor.body.limbPresence.hand_r = "absent";
    });
    expect(markup).toMatch(/data-limb-part="forearm_r"[^>]*data-disabled-reason="Restore upper_arm_r first"/u);
    expect(markup).toMatch(/data-limb-part="hand_r"[^>]*disabled/u);
  });

  it.each(["workflow", "user"] as const)(
    "disables all limb controls for %s locks",
    (lockMode) => {
      const markup = renderActor((actor) => { actor.lockMode = lockMode; });
      expect(markup.match(/data-limb-part=/gu)).toHaveLength(12);
      expect(markup.match(/data-limb-part=[^>]*disabled/gu)).toHaveLength(12);
    },
  );
});
```

Define the local `actorFrom` test helper with the same strict actor-kind check used by other tests. Render once with an all-present scene and once with an accepted updated scene; assert the second markup reflects only the authoritative SceneSpec and no component-owned anatomy draft.

- [ ] **Step 2: Add a pure renderer-source guard and verify RED**

In `tests/actor-limb-controls.test.ts`, read `src/three/SceneWorld.tsx` and require imports of `deriveActorAnatomyDimensions` and `ACTOR_LIMB_CHAINS`, plus explicit presence checks for upper, middle, and terminal segments. Reject the old duplicated dimension expressions such as `height * 0.19` and unconditional `terminal={hand}`.

Run:

```powershell
pnpm test -- tests/manual-patches.test.ts tests/actor-limb-controls.test.ts tests/lock-ui-semantics.test.ts
```

Expected: FAIL because controls, manual Patch helper, and conditional rendering are absent.

- [ ] **Step 3: Render only present chain segments**

In `SceneWorld.tsx`, derive all dimensions once:

```ts
const dimensions = deriveActorAnatomyDimensions(actor.body);
const present = (partId: ActorLimbPartId) =>
  actor.body.limbPresence[partId] === "present";
```

Change `DownwardLimb` to accept `renderChild` and `renderTerminal`:

```tsx
interface LimbProps {
  color: string;
  selected: boolean;
  length: number;
  radius: number;
  jointRotation: QuaternionTuple;
  renderChild: boolean;
  childRotation: QuaternionTuple;
  childLength: number;
  childRadius: number;
  renderTerminal: boolean;
  terminal: ReactNode;
}

const DownwardLimb = (props: LimbProps) => (
  <group quaternion={props.jointRotation}>
    <GrayMesh
      color={props.color}
      selected={props.selected}
      position={[0, -props.length / 2, 0]}
    >
      <capsuleGeometry
        args={[props.radius, Math.max(0.01, props.length - props.radius * 2), 6, 12]}
      />
    </GrayMesh>
    {props.renderChild ? (
      <group position={[0, -props.length, 0]} quaternion={props.childRotation}>
        <GrayMesh color={props.color} selected={props.selected}>
          <sphereGeometry args={[props.radius * 1.08, 12, 8]} />
        </GrayMesh>
        <GrayMesh
          color={props.color}
          selected={props.selected}
          position={[0, -props.childLength / 2, 0]}
        >
          <capsuleGeometry
            args={[
              props.childRadius,
              Math.max(0.01, props.childLength - props.childRadius * 2),
              6,
              12,
            ]}
          />
        </GrayMesh>
        {props.renderTerminal ? (
          <group position={[0, -props.childLength, 0]}>{props.terminal}</group>
        ) : null}
      </group>
    ) : null}
  </group>
);
```

Render a shoulder/hip proxy and its `DownwardLimb` only when the upper segment is present. Set `renderChild` from the middle segment and `renderTerminal` from the hand/foot segment. This yields:

- absent upper arm: no shoulder, upper arm, elbow, forearm, or hand;
- absent forearm: shoulder and upper arm only;
- absent hand: shoulder, upper arm, elbow, and forearm only;
- the corresponding hip/knee/leg/foot behavior for each leg chain.

Overview, Local preview, Shot Preview, selection edges, and export already share `SceneWorld`; do not add a second renderer.

- [ ] **Step 4: Add the manual Patch constructor**

In `src/editor/manual-patches.ts`, add:

```ts
export const createActorLimbPresencePatch = (
  scene: SceneSpec,
  actorId: string,
  updates: ActorLimbPresenceUpdates,
): ScenePatch =>
  createOperationsPatch(scene, "limb_presence", [{
    op: "actor.limb-presence.set",
    actorId,
    updates,
  }]);
```

Manual controls retain `preserveLock: false` and are disabled for both locked modes; ordinary Host-authored corrections continue to use `preserveLock: true`.

- [ ] **Step 5: Add four-group Inspector controls**

Create `src/editor/ActorLimbControls.tsx`. Iterate `Object.entries(ACTOR_LIMB_CHAINS)` so the canonical lists are not duplicated. Use these group labels and part labels:

```ts
const groupLabels = {
  leftArm: "左臂",
  rightArm: "右臂",
  leftLeg: "左腿",
  rightLeg: "右腿",
} as const;

const partLabels: Record<ActorLimbPartId, string> = {
  upper_arm_l: "左上臂", forearm_l: "左前臂", hand_l: "左手",
  upper_arm_r: "右上臂", forearm_r: "右前臂", hand_r: "右手",
  upper_leg_l: "左大腿", lower_leg_l: "左小腿", foot_l: "左脚",
  upper_leg_r: "右大腿", lower_leg_r: "右小腿", foot_r: "右脚",
};
```

For each part, render a labelled `<select>` with `Present` and `Absent`. Disable it when the editor is disabled, the actor lock is not `none`, the callback is absent, or any ancestor in its chain is absent. Include `data-limb-part` and a text/title reason such as `Restore upper_arm_r first`; do not rely on color alone. On change, emit only `(actor.id, partId, mode)` and keep no anatomy state after the callback.

Add this prop through `Inspector`:

```ts
onSetLimbPresence?: (
  actorId: string,
  partId: ActorLimbPartId,
  mode: ActorLimbPresenceMode,
) => void;
```

Render `ActorLimbControls` between the actor summary and pose/contact controls.

- [ ] **Step 6: Route controls through the current SceneSession revision**

In `App.tsx`, add:

```ts
const setActorLimbPresence = useCallback(async (
  actorId: string,
  partId: ActorLimbPartId,
  mode: ActorLimbPresenceMode,
): Promise<void> => {
  const state = useEditorStore.getState();
  const currentScene = state.scene;
  const actor = currentScene?.entities.find((entity) => entity.id === actorId);
  if (!currentScene || !actor || actor.kind !== "actor" || actor.lockMode !== "none") return;
  try {
    await state.applyPatch(
      createActorLimbPresencePatch(currentScene, actor.id, { [partId]: mode }),
    );
    setLocalError(null);
  } catch (error) {
    setLocalError(userFacingError(error));
  }
}, []);
```

Pass it to `Inspector`. After success, the store's accepted scene drives every control and rendered segment; after failure, the current scene remains unchanged.

- [ ] **Step 7: Add minimal styling and run UI checks**

Add compact `.limb-control-groups`, `.limb-control-group`, and `.limb-control-row` styles consistent with existing Inspector controls. Preserve keyboard access and readable labels in the compact pane.

Run:

```powershell
pnpm test -- tests/manual-patches.test.ts tests/actor-limb-controls.test.ts tests/lock-ui-semantics.test.ts tests/editor-concurrency.test.ts
pnpm typecheck
pnpm build
```

Expected: selected tests PASS; all twelve controls are readable; downstream disabling and both lock modes behave correctly; the production build succeeds.

- [ ] **Step 8: Commit the renderer/editor checkpoint**

```powershell
git add src/three/SceneWorld.tsx src/editor/ActorLimbControls.tsx src/editor/manual-patches.ts src/editor/Inspector.tsx src/App.tsx src/styles.css tests
git commit -m "feat: edit and render visible actor limbs"
```

### Task 5: Skill contract, generated schemas, generic examples, and v0.4.0 metadata

**Files:**

- Modify: `README.md`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/agents/openai.yaml`
- Modify: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/intent-report.md`
- Modify: `.agents/skills/shubi-shot-director/references/external-profiles.md`
- Modify: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/visual-qa.md`
- Modify: `.agents/skills/shubi-shot-director/references/generated/scene-spec.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/scene-patch.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/intent-report.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/scene-submission.schema.json`
- Modify: `.agents/skills/shubi-shot-director/references/generated/patch-submission.schema.json`
- Modify: `.agents/skills/shubi-shot-director/scripts/verify-transition.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Create: `scripts/canonical-json-sha256.mjs`
- Modify: `examples/starter.scene.json`
- Modify: `examples/quickstart.scene-submission.json`
- Modify: `examples/connected-regions.scene-submission.json`
- Modify: `tests/skill-scripts.test.ts`
- Modify: `tests/public-example.test.ts`
- Modify: `tests/public-onboarding.test.ts`
- Modify: `tests/public-release-audit.test.ts`
- Modify: `tests/helpers/create-skill-forward-fixtures.ts`

- [ ] **Step 1: Activate the Skill-writing disciplines before editing**

Read and follow `skill-creator`, `superpowers:writing-skills`, and `superpowers:test-driven-development` completely. Confirm the existing Skill folder is being updated rather than initialized. Keep `SKILL.md` concise and put detailed v4 tables in focused references.

- [ ] **Step 2: Write failing Skill and public-contract tests**

In `tests/skill-scripts.test.ts` and public tests, require:

```ts
expect(skill).toContain("SceneSpec, ScenePatch, and IntentReport schema version 4");
expect(skill).toContain("actor.limb-presence.set");
expect(skill).toContain("actor-limb-presence");
expect(skill).toMatch(/upper_arm_r[\s\S]*forearm_r[\s\S]*hand_r/u);
expect(skill).toMatch(/workflow[\s\S]*preserveLock: true/u);
expect(skill).toMatch(/user[\s\S]*explicit confirmation/u);
expect(skill).toMatch(/prosthe|replacement|mechanical[\s\S]*unsupported/iu);
expect(skill).toMatch(/Overview[\s\S]*Local[\s\S]*Shot Preview/u);
```

Require generated schemas to expose:

- SceneSpec v4 with a required strict twelve-key `body.limbPresence` object;
- ScenePatch v4 with `actor.limb-presence.set`, strict one-to-twelve-key updates, and `preserveLock`;
- IntentReport v4 with `actor-limb-presence` and all twelve exact evidence paths;
- no fields for prosthesis, replacement mesh, source wording, profile path, alias, arbitrary skeleton, or attachment.

Require every public JSON example actor to carry a complete map and every example to remain generic.

- [ ] **Step 3: Run Skill/public tests and verify RED**

Run:

```powershell
pnpm test -- tests/skill-scripts.test.ts tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
```

Expected: FAIL until v4 guidance, examples, generated schemas, metadata, and compatibility fixtures are aligned.

- [ ] **Step 4: Update the Skill's host-authoring workflow**

Update `SKILL.md` and references with these exact rules:

```text
Canonical v4 stores all twelve limb keys with only present or absent.
For create, Host Codex authors the complete map before scene submit.
For modify, use one minimal actor.limb-presence.set operation.
An absent parent closes all descendants to absent.
A present child restores required ancestors.
Explicit parent absent plus descendant present in one operation is invalid.
Ordinary workflow-locked corrections use preserveLock: true without asking.
USER_LOCKED remains a stop-and-ask condition.
Replacement parts, prostheses, mechanical limbs, sockets, or custom meshes are unsupported and must not be reduced to presence state.
ACTOR_LIMB_TARGET_INVALID means the target must be refreshed or corrected to an actor; it never authorizes a fallback entity.
LIMB_HIERARCHY_CONFLICT means the single operation must be re-authored without contradictory explicit states.
Inspect Overview, affected Local previews, Shot Preview, contact, framing, persistence, and export before a visual-success claim.
```

In `external-profiles.md`, retain the existing strict alias-only profile schema. State that any anatomy explicitly supplied in the current user instruction is translated in host memory into canonical generic part states; it is not added to the alias profile, runtime input, repository, logs, screenshots, or saved source metadata. This keeps the repository out of project-specific character-system scope.

In `intent-report.md`, add all twelve v4 evidence paths and map `actor.limb-presence.set` to `actor-limb-presence`. Include one generic creation example and one generic modification example that removes a complete right arm chain and both lower-leg chains. Do not include a character name or motivating source description.

- [ ] **Step 5: Update examples and transition verification**

Set example SceneSpec and IntentReport versions to 4. Add the complete all-present map to each generic actor. Add one ignored test fixture or inline test object demonstrating:

```json
{
  "op": "actor.limb-presence.set",
  "actorId": "actor_generic_1",
  "updates": {
    "upper_arm_r": "absent",
    "lower_leg_l": "absent",
    "lower_leg_r": "absent"
  }
}
```

Update `verify-transition.mjs` so this operation allows only the target actor's `body.limbPresence` paths plus deterministic contact transform paths. It must reject unrelated actor fields, other entities, labels, presets, locks, and scene metadata.

- [ ] **Step 6: Regenerate schemas, update digests, and publish v0.4.0 metadata**

Confirm `package.json` is already `0.4.0` from Task 1. Update README's verified-version language without claiming the final browser gate yet. Run:

```powershell
pnpm schemas:generate
$intentDigest = node scripts/canonical-json-sha256.mjs .agents/skills/shubi-shot-director/references/generated/intent-report.schema.json
$intentDigest
```

The helper hashes the parsed schema's normalized JSON, matching the wrapper rather than hashing raw file bytes. Replace the Skill wrapper's expected IntentReport schema digest with the printed lowercase value. Update `agents/openai.yaml` so its display text mentions generic editable limb presence without implying modular characters or production assets.

- [ ] **Step 7: Validate the Skill and run a fresh-agent application check**

Run the Skill validator through the current Codex installation:

```powershell
python "$env:CODEX_HOME\skills\.system\skill-creator\scripts\quick_validate.py" '.agents\skills\shubi-shot-director'
```

If `CODEX_HOME` is unset, resolve the current installed `skill-creator` root from the active Skill catalog and run the same script without recording a machine-specific path in the repository.

Then start a fresh agent with only the updated Skill path and this generic request:

```text
Create or modify a generic graybox actor so the complete right arm and both lower-leg chains are absent. Keep any workflow lock, stop on a user lock, inspect the real views, and report a request for a mechanical replacement as unsupported.
```

Require the fresh agent to select v4 structured authoring, use canonical part IDs, choose `preserveLock: true` for a workflow lock, avoid hidden geometry/zero scale/detached entities, and keep private context out of artifacts. If the first pass fails, revise the Skill and rerun with a clean fresh agent that has not seen the diagnosis.

- [ ] **Step 8: Run Skill, public, schema, and release checks**

Run:

```powershell
pnpm test -- tests/skill-scripts.test.ts tests/public-example.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts tests/actor-limb-schema-migrations.test.ts tests/intent-report.test.ts
pnpm schemas:generate
git diff --exit-code -- .agents/skills/shubi-shot-director/references/generated
pnpm typecheck
pnpm build
pnpm audit:public
```

Expected: selected tests PASS; generated schemas are stable; build succeeds; public audit reports zero findings; the Skill validator and fresh-agent check pass.

- [ ] **Step 9: Commit the Skill/release checkpoint**

```powershell
git add README.md examples .agents/skills/shubi-shot-director scripts/generate-schemas.ts tests
git commit -m "docs: publish actor limb presence contract"
```

### Task 6: Full verifier, real bridge/browser acceptance, persistence, and 1920x1080 export

**Files:**

- Modify: `docs/verification.md`
- Create only ignored generic transient inputs/outputs under `.shubi-shot/submissions/` and `.shubi-shot/exports/`

- [ ] **Step 1: Run the complete repository verifier**

Run:

```powershell
pnpm verify
```

Expected:

- schema generation succeeds;
- TypeScript passes;
- the complete Vitest suite passes;
- ESLint passes;
- Vite production build succeeds;
- public audit reports zero findings.

Record the exact file/test count and any non-blocking Vite advisory in `docs/verification.md`.

- [ ] **Step 2: Verify the Skill/runtime contract before startup**

From `.agents/skills/shubi-shot-director`, run:

```powershell
node scripts/director.mjs doctor
```

Expected: capability contract v2, application v0.4.0, SceneSpec/ScenePatch/IntentReport v4, feature `actor.limb-presence`, exact twelve part IDs, exact `present/absent` modes, and `LIMB_HIERARCHY_CONFLICT`.

If an older owned Director instance is running, use only:

```powershell
node scripts/director.mjs stop
node scripts/director.mjs ensure
node scripts/director.mjs health
```

Do not kill a guessed PID or unrelated port owner.

- [ ] **Step 3: Submit a generic connected-layout all-present scene**

Create an ignored v4 scene-submission file with:

- two generic connected regions and one opening so Overview and Local preview are meaningful;
- one generic actor with all twelve parts present and an enabled ground contact;
- one generic prop and one final camera;
- framing and critical-entity goals targeting the actor;
- all unfinished entities at `lockMode: "none"`;
- a complete generic v4 create IntentReport with limb-presence evidence.

Submit and inspect:

```powershell
node scripts/director.mjs scene submit --file .shubi-shot/submissions/actor-limb-create.json
node scripts/director.mjs snapshot
node scripts/director.mjs composition inspect --json
```

Expected: accepted scene revision 0, all-present legacy visual parity, valid contact, and no private data in the submission or output.

- [ ] **Step 4: Verify workflow-lock correction without authorization**

Apply an explicit checkpoint Patch that sets the generic actor to `workflow`. Snapshot the accepted revision, then submit a v4 modify envelope with:

```json
{
  "schemaVersion": 4,
  "patchId": "patch_generic_limb_absence",
  "sceneId": "scene_generic_limb_1",
  "baseRevision": 1,
  "source": "natural-language",
  "preserveLock": true,
  "operations": [
    {
      "op": "actor.limb-presence.set",
      "actorId": "actor_generic_1",
      "updates": {
        "upper_arm_r": "absent",
        "lower_leg_l": "absent",
        "lower_leg_r": "absent"
      }
    }
  ]
}
```

Use the actual snapshot scene ID and revision in the transient file if they differ from the generic seed. Pair the Patch with a v4 `actor-limb-presence` IntentReport whose evidence points to operation index 0.

Run `patch submit`, `snapshot`, and `composition inspect --json`. Require:

- same scene ID;
- revision exactly plus one;
- workflow lock unchanged;
- right upper arm/forearm/hand absent;
- both lower legs and feet absent;
- only anatomy plus deterministic contact transform changed;
- no authorization prompt and no explicit unlock operations.

- [ ] **Step 5: Verify hierarchy conflict and user-lock stop behavior**

Submit a separate Patch that explicitly requests `upper_arm_r: "absent"` and `hand_r: "present"`. Require `LIMB_HIERARCHY_CONFLICT`, non-zero exit, and unchanged scene revision/state.

Then use an explicit strict lock-policy Patch to set the generic actor to `user`. Snapshot, attempt a `preserveLock: true` limb change, and require:

- `USER_LOCKED`;
- non-zero command exit;
- unchanged scene ID and revision;
- unchanged anatomy, transform, contact, and lock;
- Skill guidance classifies it as stop-and-ask.

- [ ] **Step 6: Verify persistence, load, undo, and redo**

Save the accepted scene to an ignored file:

```powershell
node scripts/director.mjs scene save --file .shubi-shot/exports/actor-limb.scene.json --force
```

Verify the saved JSON has schemaVersion 4 and the exact canonical limb map. Stop only the owned Director, ensure a fresh compatible bridge, load the saved file, and snapshot again. Then exercise undo and redo around a new generic limb Patch. Require exact anatomy and deterministic contact at every accepted state; restart/load must retain the map and undo/redo revisions must increase rather than reuse old revision numbers.

- [ ] **Step 7: Inspect the real browser and export PNG**

Open the returned loopback `uiUrl` in the integrated browser. Inspect:

- Overview: connected geometry and actor placement remain readable;
- affected Local preview: no detached right hand, no detached feet, and no phantom support;
- Inspector: twelve controls in four groups reflect the accepted SceneSpec; locked controls are disabled with text meaning;
- Shot Preview: the same missing anatomy, correct ground contact, no bottom crop, and framing based on visible geometry;
- save/export controls remain reachable at the current revision.

Export only from the connected current Shot Preview:

```powershell
node scripts/director.mjs export png --file .shubi-shot/exports/actor-limb-presence.png --width 1920 --height 1080 --force
```

Verify returned scene ID, revision, width, height, SHA-256, and warnings. Open the PNG and visually confirm that it matches Shot Preview. Composition output alone is not acceptance evidence.

- [ ] **Step 8: Record generic evidence and rerun cleanliness checks**

Append a v0.4.0 section to `docs/verification.md` containing only generic evidence:

- branch and commit under test;
- verifier file/test count;
- capability versions and anatomy fields;
- accepted generic scene ID and revision sequence;
- workflow-lock preserved correction;
- hierarchy and user-lock rejection codes with unchanged revisions;
- save/load/undo/redo result;
- browser viewport and inspected views;
- PNG dimensions, SHA-256, and warnings;
- public audit result.

Run:

```powershell
pnpm audit:public
git diff --check
git status --short --branch
```

Expected: public audit has zero findings, no whitespace errors, and only `docs/verification.md` remains uncommitted. Inspect ignored transient files and remove them after evidence is recorded; do not delete user scene files.

- [ ] **Step 9: Commit verified completion and rerun the final gate**

```powershell
git add docs/verification.md
git commit -m "test: verify actor limb presence"
pnpm verify
git log --oneline -8
git status --short --branch
```

Expected: the final verifier passes after the documentation commit and the `codex/lock-provenance` worktree is clean.

## Final completion gate

Before reporting completion:

- confirm every checkpoint commit in this plan exists;
- confirm canonical data cannot contain a detached present descendant;
- confirm old v1-v3 scenes retain all-present appearance;
- confirm workflow locks preserve ordinary limb corrections without user authorization;
- confirm user locks never mutate without the explicit atomic transition;
- confirm renderer, contact, composition, Inspector, persistence, history, and PNG show the same anatomy;
- confirm replacement-part requirements are reported unsupported;
- confirm generated schemas and Skill metadata are v4/v0.4.0 while capability contract stays v2;
- confirm no private name, source wording, profile content, asset, or machine-specific path exists in tracked or transient evidence;
- report any missing browser or export evidence as pending rather than complete;
- do not merge, push, tag, or release unless the user separately requests it.
