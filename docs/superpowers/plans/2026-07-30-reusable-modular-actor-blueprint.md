# Reusable Modular Actor Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Shubi Shot Director v0.6.0 with strict project-external Actor Blueprint JSON, content-addressed SceneSpec snapshots, reusable posed instances, delta-only variants, bone-mounted box/sphere/cylinder modules, legacy compatibility, and the required browser-export acceptance.

**Architecture:** A Host-only wrapper reads the exact external file and forwards only path-free JSON to a validator. SceneSpec v5 stores one versioned, hash-verified snapshot per unique content hash and blueprint actors reference it; one `resolveActorProjection(scene, actor)` function resolves legacy or blueprint state into the primitives, anchors, and frames consumed by every renderer and geometry system.

**Tech Stack:** TypeScript 6, Zod 4, React 19, React Three Fiber/Three.js, Express, Vitest, Node.js 22, pnpm.

---

## File structure

New focused files:

- `src/domain/canonical-json-sha256.ts`: browser/Node-safe deterministic JSON canonicalization and synchronous SHA-256.
- `src/domain/actor-blueprint.ts`: Blueprint v1 schemas, limits, hashing, snapshot validation, variant closure, deduplication, and generic errors.
- `src/domain/actor-projection.ts`: the sole resolved actor projection, including legacy adaptation, blueprint lookup, mount frames, anchors, and projected body/module primitives.
- `src/editor/ActorBlueprintControls.tsx`: read-only blueprint summary plus existing-variant selector.
- `tests/helpers/actor-blueprint-fixtures.ts`: generic reusable document/snapshot/actor/scene fixtures.
- `tests/fixtures/legacy-actor-v05-projection.json`: generated-before-change
  baseline for stable primitive order and numeric legacy projection parity.
- `tests/actor-blueprint-schema.test.ts`: document, snapshot, limit, variant, hash, and identity rules.
- `tests/actor-blueprint-host-boundary.test.ts`: Host `--file` isolation and summary-only output.
- `tests/actor-blueprint-scene.test.ts`: SceneSpec v5 union, migration, references, multi-instance reuse, persistence, and history.
- `tests/actor-blueprint-patch.test.ts`: registration, variant Patch, locks, contact-owned transform, and intent coverage.
- `tests/actor-projection.test.ts`: legacy parity, mounts, modules, variants, and pose following.
- `tests/actor-blueprint-controls.test.ts`: narrow Inspector behavior and Patch dispatch.
- `tests/actor-blueprint-black-box.test.ts`: generic external-source removal, two-scene persistence, capabilities, and export-preparation assertions.

Existing files changed by responsibility:

- Schema/version/migration: `src/domain/schema-versions.ts`, `src/domain/scene-schema.ts`, `src/domain/shared-schemas.ts`, `src/domain/scene-migrations.ts`, `src/domain/default-scene.ts`, `scripts/generate-schemas.ts`.
- Patch/intent: `src/domain/scene-patch.ts`, `src/domain/apply-scene-patch.ts`, `src/domain/contact-constraints.ts`, `src/domain/intent-report.ts`, `src/domain/intent-coverage.ts`, `src/domain/intent-submission-error.ts`.
- Projection consumers: `src/domain/actor-anatomy.ts`, `src/domain/actor-visible-bounds.ts`, `src/domain/composition-safety.ts`, `src/domain/presets/relationship-presets.ts`, `src/editor/shot-camera-navigation.ts`, `src/three/SceneWorld.tsx`, `server/software-png.ts`.
- Host boundary/CLI/capabilities: `scripts/director.mjs`, `cli/director-runtime.ts`, `cli/runtime-capabilities.ts`, `.agents/skills/shubi-shot-director/scripts/director.mjs`, `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`, `.agents/skills/shubi-shot-director/runtime.json`.
- Editor: `src/editor/manual-patches.ts`, `src/editor/Inspector.tsx`, `src/App.tsx`.
- Skill/docs/release: `.agents/skills/shubi-shot-director/SKILL.md`, focused references, generated schemas, `README.md`, `package.json`, `pnpm-lock.yaml`, `docs/verification.md`, `docs/releases/v0.6.0.md`.

## Task 1: Canonical hashing and strict Actor Blueprint v1

**Files:**

- Create: `src/domain/canonical-json-sha256.ts`
- Create: `src/domain/actor-blueprint.ts`
- Create: `tests/helpers/actor-blueprint-fixtures.ts`
- Create: `tests/actor-blueprint-schema.test.ts`

- [ ] **Step 1: Write failing canonicalization and schema tests**

Add tests with the desired public API:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actorBlueprintDocumentSchema,
  actorBlueprintSnapshotSchema,
  createActorBlueprintSnapshot,
  resolveActorBlueprintVariant,
} from "../src/domain/actor-blueprint";
import {
  canonicalJson,
  canonicalJsonSha256,
} from "../src/domain/canonical-json-sha256";
import { createGenericActorBlueprintDocument } from "./helpers/actor-blueprint-fixtures";

describe("Actor Blueprint v1", () => {
  it("canonicalizes recursive object keys while preserving array order", () => {
    const value = { z: [3, 2, 1], a: { y: 2, x: 1 }, n: -0 };
    const canonical = '{"a":{"x":1,"y":2},"n":0,"z":[3,2,1]}';
    expect(canonicalJson(value)).toBe(canonical);
    expect(canonicalJsonSha256(value)).toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    );
  });

  it("accepts the bounded generic document and creates a verified snapshot", () => {
    const document = actorBlueprintDocumentSchema.parse(
      createGenericActorBlueprintDocument(),
    );
    const snapshot = createActorBlueprintSnapshot(document);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(actorBlueprintSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("keeps both delta objects required but allows them to be empty", () => {
    const document = createGenericActorBlueprintDocument();
    document.variants = [{
      variantId: "neutral",
      limbPresence: {},
      moduleVisibility: {},
    }];
    expect(actorBlueprintDocumentSchema.parse(document).variants[0]).toEqual(
      document.variants[0],
    );
    const missingVisibility = structuredClone(document) as Record<string, unknown>;
    delete (
      (missingVisibility.variants as Array<Record<string, unknown>>)[0]
    ).moduleVisibility;
    expect(() => actorBlueprintDocumentSchema.parse(missingVisibility)).toThrow();
  });

  it("closes descendants and inherits module visibility from the base", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const damaged = resolveActorBlueprintVariant(snapshot, "damaged");
    expect(damaged.limbPresence.upper_arm_r).toBe("absent");
    expect(damaged.limbPresence.forearm_r).toBe("absent");
    expect(damaged.limbPresence.hand_r).toBe("absent");
    expect(damaged.moduleVisibility.shoulder_socket_l).toBe(true);
    expect(damaged.moduleVisibility.shoulder_terminals_r).toBe(true);
  });

  it("rejects a present child beneath an effectively absent ancestor", () => {
    const document = createGenericActorBlueprintDocument();
    document.variants.push({
      variantId: "invalid_chain",
      limbPresence: {
        upper_arm_r: "absent",
        hand_r: "present",
      },
      moduleVisibility: {},
    });
    expect(() => actorBlueprintDocumentSchema.parse(document)).toThrow(
      "ACTOR_BLUEPRINT_VARIANT_INVALID",
    );
  });

  it("rejects a snapshot whose content hash does not match", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    expect(() =>
      actorBlueprintSnapshotSchema.parse({
        ...snapshot,
        contentSha256: "0".repeat(64),
      }),
    ).toThrow("ACTOR_BLUEPRINT_HASH_MISMATCH");
  });
});
```

The fixture must return only generic values and define complete base anatomy,
mirrored shoulder sockets, right-shoulder terminals, knee interfaces, and
`damaged`/`repaired` variants:

```ts
export const createGenericActorBlueprintDocument = () => ({
  schemaVersion: 1 as const,
  blueprintId: "actor_blueprint_1",
  blueprintVersion: 1,
  body: {
    heightM: 1.62,
    shoulderWidthM: 0.38,
    build: "slim" as const,
  },
  proportions: {
    torsoLengthHeightRatio: 0.31,
    torsoDepthHeightRatio: 0.115,
    pelvisWidthShoulderRatio: 0.72,
    pelvisHeightHeightRatio: 0.12,
    headRadiusHeightRatio: 0.075,
    upperArmLengthHeightRatio: 0.19,
    forearmLengthHeightRatio: 0.17,
    upperLegLengthHeightRatio: 0.245,
    lowerLegLengthHeightRatio: 0.235,
    handSizeHeightRatios: [0.055, 0.085, 0.035],
    handOffsetHeightRatios: [0, -0.035, 0.012],
    footSizeHeightRatios: [0.075, 0.055, 0.16],
    footOffsetHeightRatios: [0, -0.025, 0.055],
    torsoRadiusShoulderRatio: 0.28,
    armRadiusHeightRatio: 0.035,
    legRadiusHeightRatio: 0.045,
  },
  skeleton: {
    spineOriginHeightRatio: 0.035,
    headOriginAboveTorsoHeightRatio: 0.055,
    shoulderOffsetShoulderRatio: 0.52,
    shoulderOriginTorsoRatio: 0.78,
    hipOffsetPelvisRatio: 0.31,
    hipOriginHeightRatio: -0.035,
  },
  limbPresence: {
    upper_arm_l: "present" as const,
    forearm_l: "present" as const,
    hand_l: "present" as const,
    upper_arm_r: "present" as const,
    forearm_r: "present" as const,
    hand_r: "present" as const,
    upper_leg_l: "present" as const,
    lower_leg_l: "present" as const,
    foot_l: "present" as const,
    upper_leg_r: "present" as const,
    lower_leg_r: "present" as const,
    foot_r: "present" as const,
  },
  modules: createGenericModules(),
  variants: [
    {
      variantId: "damaged",
      limbPresence: {
        upper_arm_r: "absent" as const,
        lower_leg_l: "absent" as const,
        lower_leg_r: "absent" as const,
      },
      moduleVisibility: {
        shoulder_terminals_r: true,
      },
    },
    {
      variantId: "repaired",
      limbPresence: {
        upper_arm_r: "present" as const,
        forearm_r: "present" as const,
        hand_r: "present" as const,
        lower_leg_l: "absent" as const,
        lower_leg_r: "absent" as const,
      },
      moduleVisibility: {
        shoulder_terminals_r: false,
      },
    },
  ],
});

const localTransform = (
  positionM: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
) => ({
  positionM,
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale,
});

const createGenericModules = () => [
  {
    moduleId: "shoulder_socket_l",
    mount: "shoulder_l" as const,
    visible: true,
    parts: [{
      partId: "socket",
      primitive: "sphere" as const,
      transform: localTransform(),
      radiusM: 0.07,
    }],
  },
  {
    moduleId: "shoulder_socket_r",
    mount: "shoulder_r" as const,
    visible: true,
    parts: [{
      partId: "socket",
      primitive: "sphere" as const,
      transform: localTransform(),
      radiusM: 0.07,
    }],
  },
  {
    moduleId: "shoulder_terminals_r",
    mount: "shoulder_r" as const,
    visible: false,
    parts: [
      {
        partId: "terminal_a",
        primitive: "cylinder" as const,
        transform: localTransform([0, -0.025, 0.025]),
        radiusM: 0.009,
        lengthM: 0.045,
      },
      {
        partId: "terminal_b",
        primitive: "cylinder" as const,
        transform: localTransform([0, 0, 0.03]),
        radiusM: 0.009,
        lengthM: 0.045,
      },
      {
        partId: "terminal_c",
        primitive: "cylinder" as const,
        transform: localTransform([0, 0.025, 0.025]),
        radiusM: 0.009,
        lengthM: 0.045,
      },
    ],
  },
  {
    moduleId: "knee_interface_l",
    mount: "knee_l" as const,
    visible: true,
    parts: [{
      partId: "seal",
      primitive: "box" as const,
      transform: localTransform(),
      sizeM: [0.11, 0.035, 0.11] as [number, number, number],
    }],
  },
  {
    moduleId: "knee_interface_r",
    mount: "knee_r" as const,
    visible: true,
    parts: [{
      partId: "seal",
      primitive: "box" as const,
      transform: localTransform(),
      sizeM: [0.11, 0.035, 0.11] as [number, number, number],
    }],
  },
];
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```text
pnpm test -- tests/actor-blueprint-schema.test.ts
```

Expected: FAIL because `actor-blueprint`, `canonical-json-sha256`, and the
fixture modules do not exist.

- [ ] **Step 3: Implement deterministic canonical JSON and SHA-256**

Implement `canonicalJson(value)` by recursively sorting object keys with
JavaScript default string ordering, preserving arrays, rejecting non-finite
numbers, and calling `JSON.stringify`. Implement the standard 64-round
SHA-256 compression over `new TextEncoder().encode(canonicalJson(value))`.
Export:

```ts
export const canonicalJson = (value: unknown): string;
export const sha256Hex = (source: Uint8Array): string;
export const canonicalJsonSha256 = (value: unknown): string;
```

The implementation must contain the fixed SHA-256 initial words and 64 round
constants, unsigned 32-bit rotations, standard `0x80` padding, 64-bit bit
length split into high/low words, and eight lowercase zero-padded output
words. It must not import `node:crypto`.

- [ ] **Step 4: Implement the strict blueprint schemas and variant resolver**

In `actor-blueprint.ts`, encode every range and count from the approved design
as named exported constants. Use strict Zod objects and a semantic
`superRefine` for unique IDs, known module visibility keys, limb closure, and
stored-hash verification. Export:

```ts
export const ACTOR_BLUEPRINT_SCHEMA_VERSION = 1 as const;
export const actorBlueprintIdSchema: z.ZodString;
export const actorBlueprintDocumentSchema: z.ZodType<ActorBlueprintDocument>;
export const actorBlueprintSnapshotSchema: z.ZodType<ActorBlueprintSnapshot>;
export type ActorBlueprintDocument = z.infer<typeof actorBlueprintDocumentSchema>;
export type ActorBlueprintSnapshot = z.infer<typeof actorBlueprintSnapshotSchema>;
export type ResolvedActorBlueprintVariant = {
  limbPresence: ActorLimbPresence;
  moduleVisibility: Record<string, boolean>;
};
export const createActorBlueprintSnapshot = (
  input: ActorBlueprintDocument,
): ActorBlueprintSnapshot;
export const resolveActorBlueprintVariant = (
  snapshot: ActorBlueprintSnapshot,
  variantId: string,
): ResolvedActorBlueprintVariant;
```

Compute the snapshot hash from an exact object that omits `blueprintId` and
`contentSha256`. Keep both variant delta objects required and permit `{}`.

- [ ] **Step 5: Run focused and full domain tests**

Run:

```text
pnpm test -- tests/actor-blueprint-schema.test.ts
pnpm test -- tests/actor-limb-presence.test.ts tests/actor-limb-schema-migrations.test.ts
pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 1**

```text
git add src/domain/canonical-json-sha256.ts src/domain/actor-blueprint.ts tests/helpers/actor-blueprint-fixtures.ts tests/actor-blueprint-schema.test.ts
git commit -m "feat: define actor blueprint documents"
```

## Task 2: Host-only external file validation boundary

**Files:**

- Modify: `scripts/director.mjs`
- Modify: `cli/director-runtime.ts`
- Modify: `cli/runtime-capabilities.ts`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- Test: `tests/actor-blueprint-host-boundary.test.ts`
- Test: `tests/skill-scripts.test.ts`
- Test: `tests/process-boundary.test.ts`

- [ ] **Step 1: Write failing wrapper and non-forwarding tests**

Spawn the root wrapper and Skill wrapper with a temporary path containing a
unique marker. Assert the public envelope is exactly the summary shape and
instrument the child runtime argument capture to require `--file` and the
marker to be absent:

```ts
expect(envelope).toEqual({
  ok: true,
  data: {
    blueprintId: "actor_blueprint_1",
    blueprintVersion: 1,
    contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    moduleCount: 5,
    variantCount: 2,
    valid: true,
  },
});
expect(capturedRuntimeArgs).toEqual([
  "blueprint",
  "validate",
  "--stdin",
]);
expect(JSON.stringify(capturedRuntimeArgs)).not.toContain(pathMarker);
expect(stdout).not.toContain(externalFile);
expect(stderr).not.toContain(externalFile);
```

Cover invalid JSON, schema version, semantic variant failure, read failure,
Windows drive-relative path rejection, and a 1 MiB input bound with the
approved stable codes.

- [ ] **Step 2: Run boundary tests and verify RED**

```text
pnpm test -- tests/actor-blueprint-host-boundary.test.ts tests/skill-scripts.test.ts tests/process-boundary.test.ts
```

Expected: FAIL because `blueprint validate` is unknown.

- [ ] **Step 3: Add the internal path-free validation command**

Add the internal runtime command:

```text
blueprint validate --stdin
```

It reads at most 1 MiB from stdin, parses JSON, checks `schemaVersion` before
full document parsing, validates through `actorBlueprintDocumentSchema`,
creates the snapshot, and outputs only the six-field summary. Map failures to
the four file/document codes in the required priority.

Add `blueprint.validate` to command/capability policy with
`requiresBridge: false`, `mutatesScene: false`, and
`mayStartBridge: false`.

- [ ] **Step 4: Intercept public `--file` in both Host wrappers**

Before normal runtime forwarding:

1. Parse exactly `blueprint validate --file <value>`.
2. Reject drive-relative paths.
3. Resolve the path against the caller directory.
4. Read one regular file with the 1 MiB bound.
5. Parse the UTF-8 text with `JSON.parse` inside the Host wrapper, map parse
   failure to `ACTOR_BLUEPRINT_FILE_INVALID`, and serialize the in-memory value
   with `JSON.stringify`.
6. Spawn runtime with only `["blueprint", "validate", "--stdin"]`.
7. Pipe only that path-free serialized value to child stdin and close it.
8. Forward only the sanitized JSON envelope.

Extend `runRuntime` with an optional `stdinSource` and use
`stdio: ["pipe", "pipe", "pipe"]` only for this action. Never put the path in
child args, environment, diagnostics, errors, or returned data.

- [ ] **Step 5: Verify path isolation and existing wrapper compatibility**

```text
pnpm test -- tests/actor-blueprint-host-boundary.test.ts tests/skill-scripts.test.ts tests/process-boundary.test.ts tests/skill-compatibility.test.ts
pnpm typecheck
```

Expected: all tests pass and the marker has zero appearances in runtime
captures or output.

- [ ] **Step 6: Commit Task 2**

```text
git add scripts/director.mjs cli/director-runtime.ts cli/runtime-capabilities.ts .agents/skills/shubi-shot-director/scripts/director.mjs .agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs tests/actor-blueprint-host-boundary.test.ts tests/skill-scripts.test.ts tests/process-boundary.test.ts
git commit -m "feat: validate external blueprints at host boundary"
```

## Task 3: SceneSpec v5 snapshots, strict actor union, and legacy normalization

**Files:**

- Modify: `src/domain/schema-versions.ts`
- Modify: `src/domain/scene-schema.ts`
- Modify: `src/domain/shared-schemas.ts`
- Modify: `src/domain/scene-migrations.ts`
- Modify: `src/domain/default-scene.ts`
- Modify: `scripts/generate-schemas.ts`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Test: `tests/actor-blueprint-scene.test.ts`
- Test: `tests/actor-limb-schema-migrations.test.ts`
- Test: `tests/runtime-capabilities.test.ts`
- Test: `tests/public-example.test.ts`

- [ ] **Step 1: Write failing SceneSpec v5 and migration tests**

Test:

```ts
const snapshot = createActorBlueprintSnapshot(
  createGenericActorBlueprintDocument(),
);
const scene = createStructuredScene();
scene.schemaVersion = 5;
scene.actorBlueprints = [snapshot];
scene.entities.push(createBlueprintActor({
  id: "actor_entity_blueprint_1",
  slot: "actor_female_2",
  blueprintId: snapshot.blueprintId,
  variantId: "damaged",
}));
expect(sceneSpecSchema.parse(scene)).toEqual(scene);

const mixed = structuredClone(scene);
Object.assign(requireBlueprintActor(mixed), {
  rig: createLegacyRigRef(),
  body: createLegacyBody(),
});
expect(() => sceneSpecSchema.parse(mixed)).toThrow();

for (const version of [1, 2, 3, 4] as const) {
  const migrated = parseSceneSpecInput(createLegacyScene(version));
  expect(migrated.schemaVersion).toBe(5);
  expect(migrated.actorBlueprints).toEqual([]);
}
```

Also assert duplicate IDs, duplicate hashes, hash mismatch, missing blueprint,
unknown variant, and a blueprint actor containing legacy fields all fail.

- [ ] **Step 2: Run SceneSpec tests and verify RED**

```text
pnpm test -- tests/actor-blueprint-scene.test.ts tests/actor-limb-schema-migrations.test.ts
```

Expected: FAIL because schema version 5, `actorBlueprints`, and blueprint actors
are unsupported.

- [ ] **Step 3: Implement SceneSpec v5 and strict actor branches**

Set only the SceneSpec schema version to 5. Keep Patch and IntentReport at
version 4 until Task 4 adds their v5 operations and migration envelopes.

Define:

```ts
export const legacyActorEntitySchema = z.object({
  ...baseEntityShape,
  kind: z.literal("actor"),
  slot: actorSlotSchema,
  rig: presetRefSchema,
  body: legacyActorBodySchema,
  pose: poseSchema,
  color: colorSchema,
}).strict();

export const blueprintActorEntitySchema = z.object({
  ...baseEntityShape,
  kind: z.literal("actor"),
  slot: actorSlotSchema,
  blueprintInstance: z.object({
    blueprintId: actorBlueprintIdSchema,
    variantId: actorBlueprintSlugSchema,
  }).strict(),
  pose: poseSchema,
  color: colorSchema,
}).strict();

export const actorEntitySchema = z.union([
  legacyActorEntitySchema,
  blueprintActorEntitySchema,
]);
```

Add `actorBlueprints: z.array(actorBlueprintSnapshotSchema).max(64)` to
SceneSpec. In `superRefine`, enforce unique IDs and hashes, and validate every
blueprint actor reference and selected variant.

Export `isLegacyActorEntity` and `isBlueprintActorEntity` type guards.

- [ ] **Step 4: Add explicit v4 normalization**

Capture the old strict v4 entity and SceneSpec schema before changing the
canonical version. `parseSceneSpecInput` must try v5 first, then v4, v1, v2,
and v3. Every legacy result adds `actorBlueprints: []`; v4 retains its complete
limb maps and lock modes unchanged. Add matching v4 Patch and IntentReport
envelopes before Task 4 extends their canonical forms.

- [ ] **Step 5: Generate schemas and verify actor union/reference behavior**

```text
pnpm schemas:generate
pnpm test -- tests/actor-blueprint-scene.test.ts tests/actor-limb-schema-migrations.test.ts tests/runtime-capabilities.test.ts tests/public-example.test.ts
pnpm typecheck
```

Expected: v5 schema is generated, both strict branches are visible as a
mutually exclusive union, old fixtures normalize without user action, and all
commands exit 0.

- [ ] **Step 6: Commit Task 3**

```text
git add src/domain/schema-versions.ts src/domain/scene-schema.ts src/domain/shared-schemas.ts src/domain/scene-migrations.ts src/domain/default-scene.ts scripts/generate-schemas.ts .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/references/generated tests/actor-blueprint-scene.test.ts tests/actor-limb-schema-migrations.test.ts tests/runtime-capabilities.test.ts tests/public-example.test.ts
git commit -m "feat: persist actor blueprint snapshots"
```

## Task 4: Atomic registration, variant Patch, intent coverage, locks, and contact ownership

**Files:**

- Modify: `src/domain/scene-patch.ts`
- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/contact-constraints.ts`
- Modify: `src/domain/intent-report.ts`
- Modify: `src/domain/intent-coverage.ts`
- Modify: `src/domain/intent-submission-error.ts`
- Modify: `src/domain/scene-migrations.ts`
- Test: `tests/actor-blueprint-patch.test.ts`
- Test: `tests/atomic-patch.test.ts`
- Test: `tests/lock-preservation.test.ts`
- Test: `tests/intent-report.test.ts`
- Test: `tests/structured-submission.test.ts`

- [ ] **Step 1: Write failing registration and variant tests**

Use this Patch shape:

```ts
const patch: ScenePatch = {
  schemaVersion: 5,
  patchId: "patch_register_blueprint_1",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  preserveLock: true,
  operations: [
    {
      op: "actor.blueprint.register",
      snapshot,
    },
    {
      op: "entity.add",
      value: createBlueprintActor({
        id: "actor_entity_blueprint_1",
        slot: "actor_female_2",
        blueprintId: snapshot.blueprintId,
        variantId: "damaged",
      }),
    },
  ],
};
const accepted = applyScenePatch(scene, patch).next;
expect(accepted.revision).toBe(scene.revision + 1);
expect(accepted.actorBlueprints).toEqual([snapshot]);
```

Test same ID/same hash reuse, different ID/same hash Host reuse, same
ID/different hash `ACTOR_BLUEPRINT_ID_CONFLICT`, two registrations with the
same hash `ACTOR_BLUEPRINT_HASH_DUPLICATE`, missing references, and atomic
rollback.

For `actor.variant.set`, assert:

```ts
expect(afterActor.pose).toEqual(beforeActor.pose);
expect(afterActor.transform.rotation).toEqual(beforeActor.transform.rotation);
expect(afterActor.transform.scale).toEqual(beforeActor.transform.scale);
expect(afterActor.transform.positionM[0]).toBe(
  beforeActor.transform.positionM[0],
);
expect(afterActor.transform.positionM[2]).toBe(
  beforeActor.transform.positionM[2],
);
```

With contact disabled, assert the whole transform deep-equals. With contact
enabled, assert only Y may differ and undo/redo restores exact values.

- [ ] **Step 2: Run Patch tests and verify RED**

```text
pnpm test -- tests/actor-blueprint-patch.test.ts tests/atomic-patch.test.ts tests/lock-preservation.test.ts tests/intent-report.test.ts
```

Expected: FAIL because the two operations and v5 intent kinds do not exist.

- [ ] **Step 3: Add the two allowlisted operations and error priority**

Set `PATCH_SCHEMA_VERSION = 5`, add the v4-to-v5 Patch migration envelope, and
then add schemas:

```ts
z.object({
  op: z.literal("actor.blueprint.register"),
  snapshot: actorBlueprintSnapshotSchema,
}).strict()

z.object({
  op: z.literal("actor.variant.set"),
  actorId: entityIdSchema,
  variantId: actorBlueprintSlugSchema,
}).strict()
```

Preflight all registration operations after generic Patch scene/revision
checks and before mutation:

1. Snapshot hash schema order.
2. Duplicate hashes/IDs inside the Patch.
3. Conflicts with existing ID.
4. Existing-hash reuse.
5. Blueprint and variant references for later `entity.add`.

Do not add snapshot deletion or garbage collection.

- [ ] **Step 4: Apply variant changes atomically**

Require a blueprint actor, existing referenced snapshot, existing variant, and
normal entity mutability. Set only
`entity.blueprintInstance.variantId`. Let the existing per-operation contact
enforcement run against the new projection. Add an invariant check that any
contact-driven transform difference is restricted to `positionM[1]`.

- [ ] **Step 5: Add IntentReport v5 and coverage**

Set `INTENT_REPORT_SCHEMA_VERSION = 5` and add:

```ts
"actor-blueprint-registration"
"actor-blueprint-instance"
"actor-blueprint-variant"
```

Add entity/scene evidence paths for `actor.blueprintInstance` and
`scene.actorBlueprints`. Map `actor.blueprint.register`,
blueprint `entity.add`, and `actor.variant.set` to their exact intent kinds.
Add v4 migration that changes only the schema version.

- [ ] **Step 6: Verify Patch, history, locks, and intent**

```text
pnpm test -- tests/actor-blueprint-patch.test.ts tests/atomic-patch.test.ts tests/lock-preservation.test.ts tests/intent-report.test.ts tests/structured-submission.test.ts tests/scene-session.test.ts
pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 4**

```text
git add src/domain/scene-patch.ts src/domain/apply-scene-patch.ts src/domain/contact-constraints.ts src/domain/intent-report.ts src/domain/intent-coverage.ts src/domain/intent-submission-error.ts src/domain/scene-migrations.ts tests/actor-blueprint-patch.test.ts tests/atomic-patch.test.ts tests/lock-preservation.test.ts tests/intent-report.test.ts tests/structured-submission.test.ts tests/scene-session.test.ts
git commit -m "feat: register blueprints and select variants"
```

## Task 5: One resolved actor projection with mounts and modules

**Files:**

- Create: `src/domain/actor-projection.ts`
- Modify: `src/domain/actor-anatomy.ts`
- Modify first, then delete after consumers move:
  `src/domain/humanoid-rig.ts`
- Create: `tests/fixtures/legacy-actor-v05-projection.json`
- Create: `tests/actor-projection.test.ts`
- Modify: `tests/actor-rig-projection.test.ts`
- Modify: `tests/humanoid-rig.test.ts`

- [ ] **Step 1: Freeze v0.5 legacy projection and write failing blueprint tests**

Before changing production code, run a one-time fixture writer that imports the
current `deriveActorRigProjection`, serializes its stable primitive IDs, kinds,
centers, sizes/radii/lengths, and frames for the canonical legacy actor, and
writes `tests/fixtures/legacy-actor-v05-projection.json`. Review and commit that
literal fixture. The test imports the JSON, compares primitive order directly,
and uses a locally defined recursive numeric matcher with tolerance `1e-9`:

```ts
const legacy = resolveActorProjection(scene, legacyActor);
expect(legacy.primitives.map(({ id, kind }) => ({ id, kind }))).toEqual(
  legacyBaseline.primitives.map(({ id, kind }) => ({ id, kind })),
);
expectProjectionWithinTolerance(legacy, legacyBaseline, 1e-9);

const blueprint = resolveActorProjection(sceneWithBlueprint, blueprintActor);
expect(Object.keys(blueprint.mountFrames).sort()).toEqual([
  "elbow_l",
  "elbow_r",
  "hip_l",
  "hip_r",
  "knee_l",
  "knee_r",
  "shoulder_l",
  "shoulder_r",
  "wrist_l",
  "wrist_r",
]);
expect(blueprint.primitives.map(({ kind }) => kind)).toEqual(
  expect.arrayContaining(["box", "sphere", "cylinder"]),
);
```

Pose the right upper arm and assert an elbow-mounted module frame changes by
the same quaternion chain. Assert damaged removes the body arm primitives but
keeps right shoulder terminals and knee interfaces.

- [ ] **Step 2: Run projection tests and verify RED**

```text
pnpm test -- tests/actor-projection.test.ts tests/actor-rig-projection.test.ts tests/humanoid-rig.test.ts
```

Expected: FAIL because `resolveActorProjection` and module cylinders do not
exist.

- [ ] **Step 3: Implement legacy and blueprint definition resolution**

Define:

```ts
export type ActorMountId =
  | "shoulder_l" | "shoulder_r"
  | "elbow_l" | "elbow_r"
  | "wrist_l" | "wrist_r"
  | "hip_l" | "hip_r"
  | "knee_l" | "knee_r";

export interface ResolvedActorProjection {
  primitives: readonly ActorProjectionPrimitive[];
  mountFrames: Readonly<Record<ActorMountId, ActorRigFrame>>;
  anchors: Readonly<Record<ActorAnchor, Vec3>>;
  effective: {
    limbPresence: ActorLimbPresence;
    moduleVisibility: Readonly<Record<string, boolean>>;
  };
}

export const resolveActorProjection = (
  scene: SceneSpec,
  actor: ActorEntity,
): ResolvedActorProjection;
```

Legacy actors adapt to the exact current constants and produce no module
primitives. During Task 5, `humanoid-rig.ts` becomes a compatibility re-export
of this implementation so current consumers remain green. Blueprint actors
look up the snapshot, resolve the selected variant, and derive dimensions from
its body/proportion/skeleton fields.

- [ ] **Step 4: Compute all frames before visibility filtering**

Build pelvis, spine, head, both full arm chains, and both full leg chains.
Store all ten mount frames even if a body limb is absent. Emit built-in body
primitives only after frame calculation and limb-presence checks.

Add a cylinder projected primitive with radius, length, frame, center, and
stable ID `module:<moduleId>:<partId>`. Compose:

```text
bone frame * module local transform
```

and apply local scale to primitive geometry.

- [ ] **Step 5: Replace anchor helpers with projection-backed helpers**

Export:

```ts
export const actorAnchorLocalPoint = (
  scene: SceneSpec,
  actor: ActorEntity,
  anchor: ActorAnchor,
): Vec3;

export const actorAnchorWorldPoint = (
  scene: SceneSpec,
  actor: ActorEntity,
  anchor: ActorAnchor,
): Vec3;
```

Both must read `resolveActorProjection(scene, actor).anchors`; neither may
derive dimensions.

- [ ] **Step 6: Verify projection parity and module following**

```text
pnpm test -- tests/actor-projection.test.ts tests/actor-rig-projection.test.ts tests/humanoid-rig.test.ts
pnpm typecheck
```

Expected: legacy projections match within `1e-9`; blueprint mounts and modules
pass.

- [ ] **Step 7: Commit Task 5**

```text
git add src/domain/actor-projection.ts src/domain/actor-anatomy.ts src/domain/humanoid-rig.ts tests/fixtures/legacy-actor-v05-projection.json tests/actor-projection.test.ts tests/actor-rig-projection.test.ts tests/humanoid-rig.test.ts
git commit -m "feat: resolve modular actor projections"
```

## Task 6: Move every geometry consumer to the unified projection

**Files:**

- Modify: `src/domain/actor-visible-bounds.ts`
- Modify: `src/domain/contact-constraints.ts`
- Modify: `src/domain/composition-safety.ts`
- Modify: `src/domain/apply-scene-patch.ts`
- Modify: `src/domain/presets/relationship-presets.ts`
- Modify: `src/editor/shot-camera-navigation.ts`
- Modify: `src/three/SceneWorld.tsx`
- Modify: `server/software-png.ts`
- Delete: `src/domain/humanoid-rig.ts`
- Test: `tests/actor-visible-bounds.test.ts`
- Test: `tests/contact-constraints.test.ts`
- Test: `tests/composition-safety.test.ts`
- Test: `tests/software-png-spatial.test.ts`
- Test: `tests/actor-limb-controls.test.ts`

- [ ] **Step 1: Write failing shared-consumer tests**

For one blueprint actor, obtain projection primitive IDs and assert every
consumer agrees:

```ts
const projection = resolveActorProjection(scene, actor);
const bounds = actorVisibleRigBounds(scene, actor);
expect(bounds.primitiveIds).toEqual(
  projection.primitives.map(({ id }) => id),
);
expect(analyzeComposition(scene).checks.occlusion.status).not.toBe("fail");
const software = renderSceneToPng(scene, 320, 180);
expect(software.diagnostics.actorPrimitiveIds[actor.id]).toEqual(
  projection.primitives.map(({ id }) => id),
);
```

Add a source contract test requiring geometry consumers to import
`actor-projection` and forbidding:

```text
deriveActorAnatomyDimensions(
actor.body.heightM
actor.body.shoulderWidthM
```

inside `SceneWorld.tsx`, `actor-visible-bounds.ts`,
`composition-safety.ts`, and `software-png.ts`.

- [ ] **Step 2: Run shared-consumer tests and verify RED**

```text
pnpm test -- tests/actor-visible-bounds.test.ts tests/contact-constraints.test.ts tests/composition-safety.test.ts tests/software-png-spatial.test.ts tests/actor-limb-controls.test.ts
```

Expected: FAIL because consumers still have actor-only signatures and software
PNG has an independent skeleton.

- [ ] **Step 3: Update bounds, contact, composition, presets, and camera helpers**

Change signatures:

```ts
actorVisibleRigBounds(scene, actor, transform?)
actorVisibleFramingPoints(scene, actor, lowerFraction)
actorAnchorWorldPoint(scene, actor, anchor)
```

Add cylinder bounds as two endpoint discs with radius. Thread the existing
SceneSpec through contact enforcement, composition analysis, relationship
presets, Patch anchor resolution, and shot-camera navigation.

- [ ] **Step 4: Update browser rendering**

Pass `scene` into `MannequinActor`, call only
`resolveActorProjection(scene, actor)`, and render projected cylinder
primitives with:

```tsx
<cylinderGeometry
  args={[primitive.radius, primitive.radius, primitive.length, 16]}
/>
```

Use each projected frame, center, and stable primitive ID.

- [ ] **Step 5: Remove the independent software skeleton**

Delete `jointRotation` and the manual body ratios from
`server/software-png.ts`. Make `addActorGeometry` consume
`resolveActorProjection(scene, actor).primitives`:

- sphere: one projected disc;
- capsule: one projected center stroke plus endpoint discs;
- cylinder: one projected endpoint stroke plus radius discs;
- box: its twelve transformed box edges.

Return diagnostic primitive IDs from the same projection for the contract
test.

- [ ] **Step 6: Delete the obsolete rig module and verify all consumers**

Remove `src/domain/humanoid-rig.ts` only after `rg` shows no imports. Run:

```text
rg -n "humanoid-rig|deriveActorRigProjection|deriveActorAnatomyDimensions\\(actor\\.body\\)" src server
pnpm test -- tests/actor-projection.test.ts tests/actor-visible-bounds.test.ts tests/contact-constraints.test.ts tests/composition-safety.test.ts tests/software-png-spatial.test.ts tests/actor-limb-controls.test.ts tests/shot-camera-navigation.test.ts tests/relationship-presets.test.ts
pnpm typecheck
```

Expected: `rg` has no prohibited consumer hits and all test/typecheck commands
exit 0.

- [ ] **Step 7: Commit Task 6**

```text
git add src/domain/actor-visible-bounds.ts src/domain/contact-constraints.ts src/domain/composition-safety.ts src/domain/apply-scene-patch.ts src/domain/presets/relationship-presets.ts src/editor/shot-camera-navigation.ts src/three/SceneWorld.tsx server/software-png.ts src/domain/humanoid-rig.ts tests/actor-projection.test.ts tests/actor-visible-bounds.test.ts tests/contact-constraints.test.ts tests/composition-safety.test.ts tests/software-png-spatial.test.ts tests/actor-limb-controls.test.ts tests/shot-camera-navigation.test.ts tests/relationship-presets.test.ts
git commit -m "refactor: unify actor geometry consumers"
```

## Task 7: Narrow Inspector summary and existing-variant selector

**Files:**

- Create: `src/editor/ActorBlueprintControls.tsx`
- Modify: `src/editor/manual-patches.ts`
- Modify: `src/editor/Inspector.tsx`
- Modify: `src/App.tsx`
- Create: `tests/actor-blueprint-controls.test.ts`
- Modify: `tests/manual-patches.test.ts`

- [ ] **Step 1: Write failing control and Patch-construction tests**

Test the pure dispatch contract and rendered labels with
`renderToStaticMarkup` from `react-dom/server`, which is already available:

```ts
const patch = createActorVariantPatch(scene, actor.id, "repaired");
expect(patch).toMatchObject({
  schemaVersion: 5,
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "manual",
  preserveLock: false,
  operations: [{
    op: "actor.variant.set",
    actorId: actor.id,
    variantId: "repaired",
  }],
});

const markup = renderToStaticMarkup(
  <ActorBlueprintControls
    scene={scene}
    actor={actor}
    disabled={false}
    onSetVariant={() => undefined}
  />,
);
expect(markup).toContain("actor_blueprint_1");
expect(markup).toContain(">damaged<");
expect(markup).toContain(">repaired<");
```

Assert there are no buttons or inputs for import, rename, duplicate, delete,
module geometry, body, proportions, or skeleton.

- [ ] **Step 2: Run UI tests and verify RED**

```text
pnpm test -- tests/actor-blueprint-controls.test.ts tests/manual-patches.test.ts
```

Expected: FAIL because the component and manual Patch helper do not exist.

- [ ] **Step 3: Implement the narrow component**

Use `isBlueprintActorEntity` to render only blueprint actors. Resolve the
snapshot by exact ID. Show ID, version, first 12 hash characters, module count,
and variant count. Render a native `<select>` from `snapshot.variants`.
Disable for missing references, global disabled state, or any non-`none` lock.
On change, call only `onSetVariant(actor.id, variantId)`.

- [ ] **Step 4: Wire the authoritative Patch route**

Add `setActorVariant` in `App.tsx` using
`createActorVariantPatch(currentScene, actorId, variantId)` and the existing
store `applyPatch`. Pass it through `Inspector`. Keep no React variant draft
after the accepted scene arrives.

- [ ] **Step 5: Verify focused UI and existing Inspector behavior**

```text
pnpm test -- tests/actor-blueprint-controls.test.ts tests/manual-patches.test.ts tests/actor-limb-controls.test.ts tests/lock-ui-semantics.test.ts
pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 7**

```text
git add src/editor/ActorBlueprintControls.tsx src/editor/manual-patches.ts src/editor/Inspector.tsx src/App.tsx tests/actor-blueprint-controls.test.ts tests/manual-patches.test.ts
git commit -m "feat: select actor blueprint variants"
```

## Task 8: Persistence, multi-instance reuse, no-GC history, and path audit

**Files:**

- Modify: `server/scene-persistence.ts`
- Modify: `server/scene-session.ts`
- Modify: `scripts/audit-public-release.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs`
- Modify: `tests/actor-blueprint-scene.test.ts`
- Modify: `tests/scene-persistence.test.ts`
- Modify: `tests/scene-session.test.ts`
- Modify: `tests/public-release-audit.test.ts`

- [ ] **Step 1: Write failing persistence and multi-instance tests**

Create two blueprint actors with `actor_female_1` and `actor_female_2`, one
snapshot, different transforms/poses/colors/locks/variants. Persist, remove
the external fixture, construct a new persistence/session, and assert:

```ts
expect(reloaded.actorBlueprints).toHaveLength(1);
expect(reloaded.entities.filter(isBlueprintActorEntity)).toHaveLength(2);
expect(requireActor(reloaded, first.id)).toMatchObject(first);
expect(requireActor(reloaded, second.id)).toMatchObject(second);
```

Remove both actor entities through an accepted Patch, assert the snapshot
remains, undo, redo, and assert the snapshot remains identical through all
states.

Seed every artifact channel with a unique source path marker and require the
audit to report zero allowed path-bearing blueprint fields.

- [ ] **Step 2: Run persistence/audit tests and verify RED**

```text
pnpm test -- tests/actor-blueprint-scene.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/public-release-audit.test.ts
```

Expected: FAIL until v5 persistence, no-GC behavior, and audit rules are
covered.

- [ ] **Step 3: Preserve snapshots through persistence and history**

Use existing `sceneSpecSchema.parse` and `structuredClone`; do not add an
external file read or snapshot cleanup. Ensure save/load, replace, undo, redo,
event payload, and autosave include the authoritative snapshot array exactly.

- [ ] **Step 4: Extend public/generic audits**

Reject fields and serialized strings matching:

```text
sourcePath
sourceFile
externalPath
blueprintFile
[A-Za-z]:\
the standard local-file URI scheme prefix
```

Scan tracked JSON, generated schemas, scenes, reports, logs, screenshots, and
PNG text chunks. Allow the literal documentation tokens only where the audit
already exempts documentation prose; never exempt runtime artifacts.

- [ ] **Step 5: Verify persistence, history, and audit**

```text
pnpm test -- tests/actor-blueprint-scene.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/public-release-audit.test.ts
pnpm audit:public
```

Expected: all commands exit 0 with zero findings.

- [ ] **Step 6: Commit Task 8**

```text
git add server/scene-persistence.ts server/scene-session.ts scripts/audit-public-release.mjs .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs tests/actor-blueprint-scene.test.ts tests/scene-persistence.test.ts tests/scene-session.test.ts tests/public-release-audit.test.ts
git commit -m "test: preserve reusable actor blueprint state"
```

## Task 9: Capabilities, Skill contract, schemas, version, and release documentation

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `cli/application-metadata.ts`
- Modify: `cli/runtime-capabilities.ts`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/intent-report.md`
- Modify: `.agents/skills/shubi-shot-director/references/visual-qa.md`
- Create: `.agents/skills/shubi-shot-director/references/actor-blueprints.md`
- Modify: `.agents/skills/shubi-shot-director/references/generated/*.schema.json`
- Modify: `README.md`
- Modify: `docs/verification.md`
- Create: `docs/releases/v0.6.0.md`
- Test: `tests/runtime-capabilities.test.ts`
- Test: `tests/skill-compatibility.test.ts`
- Test: `tests/skill-scripts.test.ts`
- Test: `tests/public-onboarding.test.ts`

- [ ] **Step 1: Write failing capability and Skill contract tests**

Require:

```ts
expect(manifest).toMatchObject({
  applicationVersion: "0.6.0",
  sceneSchemaVersion: 5,
  patchSchemaVersion: 5,
  intentReportSchemaVersion: 5,
});
expect(manifest.commands).toContain("blueprint.validate");
expect(manifest.features).toEqual(expect.arrayContaining([
  "actor.blueprint-snapshots",
  "actor.modular-primitives",
  "actor.variants",
  "actor.resolved-projection",
]));
expect(manifest.actorBlueprint).toMatchObject({
  schemaVersion: 1,
  primitives: ["box", "sphere", "cylinder"],
});
```

Add a fresh-agent Skill fixture that chooses Host-only blueprint validation,
hash reuse, registration, blueprint `entity.add`, minimal variant Patch,
snapshot persistence, Overview/Local/Shot Preview, and browser export without
ever storing a path.

- [ ] **Step 2: Run capability/Skill tests and verify RED**

```text
pnpm test -- tests/runtime-capabilities.test.ts tests/skill-compatibility.test.ts tests/skill-scripts.test.ts tests/public-onboarding.test.ts
```

Expected: FAIL on v0.5 versions and missing blueprint contract.

- [ ] **Step 3: Update capability manifests and generated schemas**

Expose schema versions 5, Blueprint schema 1, exact mounts, exact primitives,
delta modes, stable errors, and `blueprint.validate`. Keep capability contract
version 2, semantic authority `host`, structured-only input, forbidden
credentials/models, and loopback-only networking.

Run:

```text
pnpm schemas:generate
```

- [ ] **Step 4: Update the Skill and focused references**

Document the exact external-path procedure, summary-only validator output,
hash conflict matrix, two actor branches, registration and variant Patches,
workflow/user locks, one projection, narrow Inspector, persistence, no-GC,
visual QA, and recovery codes. Remove the old blanket statement that all
mechanical modules are unsupported; keep arbitrary meshes and prostheses
unsupported.

- [ ] **Step 5: Update v0.6.0 package and release docs**

Set every local application/package version source to `0.6.0`. Add release
notes that list only generic features and verification commands. Document the
two-scene/four-view acceptance without committing private paths or the
temporary external file.

- [ ] **Step 6: Verify documentation and public contract**

```text
pnpm test -- tests/runtime-capabilities.test.ts tests/skill-compatibility.test.ts tests/skill-scripts.test.ts tests/public-onboarding.test.ts tests/public-example.test.ts
pnpm audit:public
pnpm typecheck
```

Expected: all commands exit 0 and the audit has zero findings.

- [ ] **Step 7: Commit Task 9**

```text
git add package.json pnpm-lock.yaml cli/application-metadata.ts cli/runtime-capabilities.ts .agents/skills/shubi-shot-director README.md docs/verification.md docs/releases/v0.6.0.md tests/runtime-capabilities.test.ts tests/skill-compatibility.test.ts tests/skill-scripts.test.ts tests/public-onboarding.test.ts tests/public-example.test.ts
git commit -m "docs: prepare actor blueprint v0.6 release"
```

## Task 10: Required generic black-box acceptance and final release gate

**Files:**

- Create outside repository: one temporary `actor-blueprint.json`
- Create under ignored runtime output: two saved SceneSpec files and four PNGs
- Create: `tests/actor-blueprint-black-box.test.ts`
- Modify only if acceptance exposes a defect: the narrow owning source and its
  focused regression test

- [ ] **Step 1: Add the automated black-box preparation test**

The test creates the generic external document in an OS temporary directory,
validates it through the public Skill wrapper, registers the same snapshot in
two scenes, saves both, deletes the source, reloads both, and asserts the fixed
damaged/repaired states and deep-equal base definitions. It also creates two
same-scene instances and requires one snapshot.

- [ ] **Step 2: Run the black-box test and verify RED or GREEN for the right reason**

```text
pnpm test -- tests/actor-blueprint-black-box.test.ts
```

Expected before any acceptance-only defect fix: either PASS, or one focused
failure identifying a missing end-to-end requirement. If it fails, write or
retain the failing regression, fix only the owning implementation, and rerun
until PASS.

- [ ] **Step 3: Run the Skill session doctor and ensure**

From `.agents/skills/shubi-shot-director`:

```text
node scripts/director.mjs doctor
node scripts/director.mjs workspace current
node scripts/director.mjs ensure
node scripts/director.mjs health
```

Require v0.6.0, capability contract 2, workspace routing 1, schema versions 5,
Blueprint schema 1, Host/structured-only/none/forbidden/loopback policies, and
a ready opaque workspace.

- [ ] **Step 4: Validate, submit, save, remove source, and reload both scenes**

Use only generic IDs. Validate the exact temporary file through
`blueprint validate --file`. Submit Scene A damaged-standing and Scene B
repaired-supine as complete Host-authored structured envelopes. Save both
SceneSpec files, remove the external source once, restart/reload, and snapshot
each. Require matching snapshot hash and no structure loss.

- [ ] **Step 5: Export Scene A front, three-quarter, and side**

For each camera state:

1. Apply one minimal camera Patch at the exact current revision.
2. Snapshot and require revision +1.
3. Inspect Overview and affected Local previews.
4. Run `composition inspect --json`.
5. Inspect the real Shot Preview.
6. Export 1920 by 1080 through the connected browser preview.
7. Record scene ID, revision, dimensions, SHA-256, warnings, and visual result.

Write ignored outputs as:

```text
.shubi-shot/acceptance/v0.6.0/front.png
.shubi-shot/acceptance/v0.6.0/three-quarter.png
.shubi-shot/acceptance/v0.6.0/side.png
```

- [ ] **Step 6: Export Scene B repaired supine**

Verify the right arm is present, shoulder terminals hidden, lower legs/feet
absent, knee interfaces visible, and base body/proportion/skeleton/module
definitions deep-equal to Scene A. Repeat composition, Shot Preview, 1920 by
1080 export, metadata recording, and visual inspection for:

```text
.shubi-shot/acceptance/v0.6.0/supine.png
```

- [ ] **Step 7: Inspect all four PNGs and audit artifacts**

Open all four files with the local image viewer. Verify the requested anatomy,
modules, framing, and pose. Confirm each PNG has no text chunks or path
metadata. Scan saved scenes, reports, logs, PNGs, and Git-tracked files for the
unique temporary source marker and require zero findings.

- [ ] **Step 8: Run the full fresh release gate**

```text
pnpm verify
git diff --check
git status --short --branch
```

Require schema generation, typecheck, all tests, lint, production build, Skill
validation, and public audit to exit 0. Review the complete Git diff against
every acceptance criterion in the design.

- [ ] **Step 9: Commit any acceptance evidence that is generic and intended**

Do not commit the external file, saved scenes, PNGs, runtime state, logs, or
machine paths. Commit only generic automated tests or documentation changes:

```text
git add tests/actor-blueprint-black-box.test.ts docs/releases/v0.6.0.md docs/verification.md
git commit -m "test: verify actor blueprint v0.6 acceptance"
```

- [ ] **Step 10: Stop at the approved boundary**

Do not add another UI surface, mesh import, IK, animation, physics, skinning,
snapshot removal, automatic garbage collection, or character-editor feature.
Report the four ignored PNG paths, hashes, verification counts, commits, and
any warnings requiring human aesthetic review.
