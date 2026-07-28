import { describe, expect, expectTypeOf, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  ACTOR_LIMB_CHAINS,
  ACTOR_LIMB_PART_IDS,
  ACTOR_LIMB_PRESENCE_MODES,
  actorLimbPresenceSchema,
  createAllPresentLimbPresence,
  deriveActorAnatomyDimensions,
  resolveActorLimbPresenceUpdates,
  type ActorLimbPresence,
} from "../src/domain/actor-anatomy";
import {
  parseIntentReportInput,
  parseScenePatchInput,
  parseSceneSpecInput,
} from "../src/domain/scene-migrations";
import { INTENT_REPORT_SCHEMA_VERSION } from "../src/domain/intent-report";
import { PATCH_SCHEMA_VERSION, SCENE_SCHEMA_VERSION } from "../src/domain/schema-versions";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";

const allAbsent = (): ActorLimbPresence =>
  Object.fromEntries(
    ACTOR_LIMB_PART_IDS.map((partId) => [partId, "absent"]),
  ) as ActorLimbPresence;

const sceneWithoutLimbPresence = (schemaVersion: 1 | 2 | 3) => {
  const current = structuredClone(createDefaultScene()) as Record<string, unknown>;
  current.schemaVersion = schemaVersion;
  current.revision = 17;
  const entities = current.entities as Array<Record<string, unknown>>;
  const actor = entities.find((entity) => entity.kind === "actor");
  if (!actor) throw new Error("Default scene is missing actor.");
  const body = actor.body as Record<string, unknown>;
  delete body.limbPresence;
  if (schemaVersion === 1 || schemaVersion === 2) {
    for (const entity of entities) {
      entity.locked = entity.lockMode !== "none";
      delete entity.lockMode;
    }
    if (schemaVersion === 1) delete current.spatialLayout;
  }
  return current;
};

const actorFromScene = (scene: ReturnType<typeof createDefaultScene>) => {
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor || actor.kind !== "actor") throw new Error("Default scene is missing actor.");
  return actor;
};

describe("canonical actor limb anatomy", () => {
  it("publishes the exact twelve ordered parts, two modes, and four chains", () => {
    expect(ACTOR_LIMB_PRESENCE_MODES).toEqual(["present", "absent"]);
    expect(ACTOR_LIMB_PART_IDS).toEqual([
      "upper_arm_l",
      "forearm_l",
      "hand_l",
      "upper_arm_r",
      "forearm_r",
      "hand_r",
      "upper_leg_l",
      "lower_leg_l",
      "foot_l",
      "upper_leg_r",
      "lower_leg_r",
      "foot_r",
    ]);
    expect(ACTOR_LIMB_CHAINS).toEqual({
      leftArm: ["upper_arm_l", "forearm_l", "hand_l"],
      rightArm: ["upper_arm_r", "forearm_r", "hand_r"],
      leftLeg: ["upper_leg_l", "lower_leg_l", "foot_l"],
      rightLeg: ["upper_leg_r", "lower_leg_r", "foot_r"],
    });
  });

  it.each([
    ["missing key", { upper_arm_l: "present" }],
    ["extra key", { ...createAllPresentLimbPresence(), elbow_l: "present" }],
    ["unknown key", { ...createAllPresentLimbPresence(), unknown: "present" }],
    ["unknown mode", { ...createAllPresentLimbPresence(), hand_l: "missing" }],
  ])("rejects %s from the strict presence map", (_label, value) => {
    expect(actorLimbPresenceSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a detached present descendant", () => {
    const value = allAbsent();
    value.hand_l = "present";
    expect(actorLimbPresenceSchema.safeParse(value).success).toBe(false);
  });

  it("resolves hierarchical updates without mutating inputs", () => {
    const current = createAllPresentLimbPresence();
    const updates = { upper_arm_l: "absent" as const };
    const beforeCurrent = structuredClone(current);
    const beforeUpdates = structuredClone(updates);

    const resolved = resolveActorLimbPresenceUpdates(current, updates);

    expect(resolved).toEqual({
      ...current,
      upper_arm_l: "absent",
      forearm_l: "absent",
      hand_l: "absent",
    });
    expect(current).toEqual(beforeCurrent);
    expect(updates).toEqual(beforeUpdates);
  });

  it("restores ancestors for an explicitly present child but not descendants for a present parent", () => {
    const current = allAbsent();
    const child = resolveActorLimbPresenceUpdates(current, { hand_l: "present" });
    expect(child.upper_arm_l).toBe("present");
    expect(child.forearm_l).toBe("present");
    expect(child.hand_l).toBe("present");

    const parentOnly = resolveActorLimbPresenceUpdates(allAbsent(), {
      upper_arm_l: "present",
    });
    expect(parentOnly).toEqual({ ...allAbsent(), upper_arm_l: "present" });

    const childAbsent = resolveActorLimbPresenceUpdates(
      createAllPresentLimbPresence(),
      { forearm_l: "absent" },
    );
    expect(childAbsent.upper_arm_l).toBe("present");
    expect(childAbsent.forearm_l).toBe("absent");
    expect(childAbsent.hand_l).toBe("absent");
  });

  it("resolves the same closure regardless of update key order", () => {
    const current = allAbsent();
    const first = resolveActorLimbPresenceUpdates(current, {
      upper_arm_l: "present",
      hand_l: "present",
    });
    const second = resolveActorLimbPresenceUpdates(current, {
      hand_l: "present",
      upper_arm_l: "present",
    });
    expect(first).toEqual(second);
  });

  it("rejects contradictory parent-absent and descendant-present updates", () => {
    expect(() =>
      resolveActorLimbPresenceUpdates(createAllPresentLimbPresence(), {
        upper_arm_l: "absent",
        hand_l: "present",
      }),
    ).toThrowError(expect.objectContaining({ code: "LIMB_HIERARCHY_CONFLICT" }));
  });

  it("returns defensive all-present maps and derives generic mannequin dimensions", () => {
    const first = createAllPresentLimbPresence();
    const second = createAllPresentLimbPresence();
    first.hand_l = "absent";
    expect(second.hand_l).toBe("present");

    const firstScene = createDefaultScene();
    const secondScene = createDefaultScene();
    actorFromScene(firstScene).body.limbPresence.hand_r = "absent";
    expect(actorFromScene(secondScene).body.limbPresence.hand_r).toBe("present");

    const dimensions = deriveActorAnatomyDimensions({
      heightM: 1.72,
      shoulderWidthM: 0.42,
      build: "average",
    });
    expectTypeOf(dimensions.faceOffset).toEqualTypeOf<
      readonly [number, number, number]
    >();
    expectTypeOf(dimensions.handSize).toEqualTypeOf<
      readonly [number, number, number]
    >();
    expectTypeOf(dimensions.handOffset).toEqualTypeOf<
      readonly [number, number, number]
    >();
    expectTypeOf(dimensions.footSize).toEqualTypeOf<
      readonly [number, number, number]
    >();
    expectTypeOf(dimensions.footOffset).toEqualTypeOf<
      readonly [number, number, number]
    >();
    expect(dimensions).toMatchObject({
      heightM: 1.72,
      shoulderWidthM: 0.42,
      torsoLength: 1.72 * 0.31,
      upperArmLength: 1.72 * 0.19,
      forearmLength: 1.72 * 0.17,
      upperLegLength: 1.72 * 0.245,
      lowerLegLength: 1.72 * 0.235,
    });
  });
});

describe("actor limb schema migrations", () => {
  it("requires limbPresence in canonical v4 actors", () => {
    const canonical = structuredClone(createDefaultScene()) as unknown as Record<
      string,
      unknown
    >;
    const actor = (canonical.entities as Array<Record<string, unknown>>).find(
      (entity) => entity.kind === "actor",
    );
    if (!actor) throw new Error("Default scene is missing actor.");
    delete (actor.body as Record<string, unknown>).limbPresence;
    expect(sceneSpecSchema.safeParse(canonical).success).toBe(false);
  });

  it.each([1, 2, 3] as const)(
    "migrates SceneSpec v%s actors to all-present v4 without changing revision",
    (schemaVersion) => {
      const parsed = parseSceneSpecInput(sceneWithoutLimbPresence(schemaVersion));
      expect(parsed.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
      expect(parsed.revision).toBe(17);
      expect(actorFromScene(parsed).body.limbPresence).toEqual(
        createAllPresentLimbPresence(),
      );
    },
  );

  it.each([128, 129, 256])(
    "migrates all %s v3 patch operations without reordering or changing content",
    (operationCount) => {
      const operations = Array.from({ length: operationCount }, (_, index) => ({
        op: "scene.title.set" as const,
        value: `Migrated title ${index}`,
      }));
      const parsed = parseScenePatchInput({
        schemaVersion: 3,
        patchId: "patch_v3_operation_limit",
        sceneId: "scene_starter",
        baseRevision: 17,
        source: "manual",
        preserveLock: false,
        operations,
      });

      expect(parsed.operations).toHaveLength(operationCount);
      expect(parsed.operations).toEqual(operations);
    },
  );

  it("rejects a v3 patch with 257 operations", () => {
    const operations = Array.from({ length: 257 }, (_, index) => ({
      op: "scene.title.set" as const,
      value: `Rejected title ${index}`,
    }));
    expect(() =>
      parseScenePatchInput({
        schemaVersion: 3,
        patchId: "patch_v3_over_operation_limit",
        sceneId: "scene_starter",
        baseRevision: 17,
        source: "manual",
        preserveLock: false,
        operations,
      }),
    ).toThrow();
  });

  it("rejects mixed v3 anatomy and a v3 limb patch operation", () => {
    const mixedScene = sceneWithoutLimbPresence(3);
    const actor = (
      mixedScene.entities as Array<Record<string, unknown>>
    ).find((entity) => entity.kind === "actor");
    if (!actor) throw new Error("Legacy scene is missing actor.");
    (actor.body as Record<string, unknown>).limbPresence =
      createAllPresentLimbPresence();
    expect(() => parseSceneSpecInput(mixedScene)).toThrow();

    const limbOperationPatch = {
      schemaVersion: 3,
      patchId: "patch_mixed_anatomy",
      sceneId: "scene_starter",
      baseRevision: 17,
      source: "manual",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          entityId: "actor_generic_1",
          updates: { hand_l: "absent" },
        },
      ],
    };
    expect(() => parseScenePatchInput(limbOperationPatch)).toThrow();
    expect(
      scenePatchSchema.safeParse({
        ...limbOperationPatch,
        schemaVersion: PATCH_SCHEMA_VERSION,
      }).success,
    ).toBe(false);
  });

  it.each([1, 2, 3] as const)(
    "migrates a v%s actor entity.add while preserving operation order and indices",
    (schemaVersion) => {
      const legacyScene = sceneWithoutLimbPresence(schemaVersion);
      const actor = (
        legacyScene.entities as Array<Record<string, unknown>>
      ).find((entity) => entity.kind === "actor");
      if (!actor) throw new Error("Legacy scene is missing actor.");
      const patch = {
        schemaVersion,
        patchId: "patch_actor_migration",
        sceneId: "scene_starter",
        baseRevision: 17,
        source: "manual",
        ...(schemaVersion === 3 ? { preserveLock: true } : {}),
        operations: [
          { op: "scene.title.set", value: "Migrated" },
          { op: "entity.add", value: actor },
        ],
      };
      const parsed = parseScenePatchInput(patch);
      expect(parsed.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
      expect(parsed.preserveLock).toBe(schemaVersion === 3);
      expect(parsed.operations.map((operation) => operation.op)).toEqual([
        "scene.title.set",
        "entity.add",
      ]);
      const add = parsed.operations[1];
      expect(add.op).toBe("entity.add");
      if (add.op === "entity.add" && add.value.kind === "actor") {
        expect(add.value.body.limbPresence).toEqual(
          createAllPresentLimbPresence(),
        );
      }
    },
  );

  it("migrates IntentReport v3 to v4 without inventing a limb intent kind", () => {
    const current = createDefaultScene();
    const report = {
      schemaVersion: 3,
      operation: "create",
      allowPartial: false,
      recognizedConstraints: [
        {
          id: "intent_camera_height_1",
          kind: "camera-height",
          required: true,
          targets: ["camera_shot_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: current.activeCameraId,
              path: "camera.heightM",
            },
          ],
        },
      ],
      unsupportedConstraints: [],
      unresolvedRelations: [],
      warnings: [],
      canApplySafely: true,
    };
    const parsed = parseIntentReportInput(report);
    expect(parsed.schemaVersion).toBe(INTENT_REPORT_SCHEMA_VERSION);
    expect(parsed.recognizedConstraints.map(({ kind }) => kind)).toEqual([
      "camera-height",
    ]);
    expect(
      parsed.recognizedConstraints
        .map(({ kind }) => kind as string)
        .includes("actor-limb-presence"),
    ).toBe(false);
  });
});
