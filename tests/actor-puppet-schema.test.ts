import { describe, expect, it } from "vitest";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { snapTransformToContact } from "../src/domain/contact-constraints";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  INTENT_REPORT_SCHEMA_VERSION,
  intentReportSchema,
} from "../src/domain/intent-report";
import {
  parseIntentReportInput,
  parseScenePatchInput,
  parseSceneSpecInput,
} from "../src/domain/scene-migrations";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { sceneSubmissionSchema } from "../src/domain/scene-submission";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";
import {
  isBlueprintActorEntity,
  jointIdSchema,
  sceneSpecSchema,
} from "../src/domain/scene-schema";
import {
  canonicalHumanoidJointIds,
  materializePose,
} from "../src/domain/presets/pose-presets";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
  createLegacyV5BlueprintGroundContactScene,
  createLegacyV5NonBlueprintGroundContactScene,
} from "./helpers/actor-blueprint-fixtures";
import { createSceneSubmission } from "./helpers/structured-fixtures";

const createCanonicalBlueprintSceneInput = () => {
  const scene = structuredClone(createDefaultScene()) as Record<
    string,
    unknown
  >;
  const snapshot = createActorBlueprintSnapshot(
    createGenericActorBlueprintDocument(),
  );
  const actor = createBlueprintActor() as unknown as Record<string, unknown>;
  actor.blueprintInstance = {
    ...(actor.blueprintInstance as Record<string, unknown>),
    heightScale: 1,
    limbPresenceOverrides: {},
  };
  scene.schemaVersion = 6;
  scene.actorBlueprints = [snapshot];
  scene.entities = [
    ...(scene.entities as Array<Record<string, unknown>>).filter(
      (entity) => entity.kind !== "actor",
    ),
    actor,
  ];
  scene.constraints = [];
  return scene;
};

const createLegacyV5BlueprintSceneInput = () => {
  const scene = createCanonicalBlueprintSceneInput();
  scene.schemaVersion = 5;
  const actor = (scene.entities as Array<Record<string, unknown>>).find(
    (entity) => entity.kind === "actor",
  );
  if (!actor) throw new Error("Blueprint actor fixture is missing.");
  const instance = actor.blueprintInstance as Record<string, unknown>;
  delete instance.heightScale;
  delete instance.limbPresenceOverrides;
  return scene;
};

const createIntentReportV5 = () => ({
  schemaVersion: 5,
  operation: "modify" as const,
  allowPartial: false,
  recognizedConstraints: [],
  unsupportedConstraints: [],
  unresolvedRelations: [],
  warnings: [],
  canApplySafely: true,
});

const createLegacySparseJointSceneInput = (
  schemaVersion: 1 | 2 | 3 | 4 | 5,
): Record<string, unknown> => {
  const scene = structuredClone(createDefaultScene()) as unknown as Record<
    string,
    unknown
  >;
  scene.schemaVersion = schemaVersion;
  scene.revision = 23;
  const entities = scene.entities as Array<Record<string, unknown>>;
  const actor = entities.find((entity) => entity.kind === "actor");
  if (!actor) throw new Error("Legacy actor fixture is missing.");
  (actor.pose as Record<string, unknown>).joints = {
    hand_r: [0, 0, 0, 1],
    elbow_r: [0, 0, 0, 1],
  };

  if (schemaVersion <= 2) {
    for (const entity of entities) {
      entity.locked = entity.lockMode !== "none";
      delete entity.lockMode;
    }
  }
  if (schemaVersion <= 3) {
    delete (actor.body as Record<string, unknown>).limbPresence;
  }
  if (schemaVersion === 1) {
    delete scene.spatialLayout;
  }
  if (schemaVersion === 4) {
    delete scene.actorBlueprints;
  }
  return scene;
};

const legacyPuppetJointAliasCases = [
  ["root", "pelvis", [0.6, 0, 0, 0.8]],
  ["chest", "spine", [0, 0.6, 0, 0.8]],
  ["head", "neck", [0, 0, 0.6, 0.8]],
  ["shoulder_l", "upper_arm_l", [-0.6, 0, 0, 0.8]],
  ["elbow_l", "forearm_l", [0, -0.6, 0, 0.8]],
  ["wrist_l", "hand_l", [0, 0, -0.6, 0.8]],
  ["shoulder_r", "upper_arm_r", [0.8, 0, 0, 0.6]],
  ["elbow_r", "forearm_r", [0, 0.8, 0, 0.6]],
  ["wrist_r", "hand_r", [0, 0, 0.8, 0.6]],
  ["hip_l", "upper_leg_l", [-0.8, 0, 0, 0.6]],
  ["knee_l", "lower_leg_l", [0, -0.8, 0, 0.6]],
  ["ankle_l", "foot_l", [0, 0, -0.8, 0.6]],
  ["hip_r", "upper_leg_r", [0.5, 0.5, 0.5, 0.5]],
  ["knee_r", "lower_leg_r", [0.5, 0.5, -0.5, 0.5]],
  ["ankle_r", "foot_r", [0.5, -0.5, 0.5, 0.5]],
] as const;

const createLegacyAliasJointMap = (): Record<string, unknown> => ({
  ...Object.fromEntries(
    legacyPuppetJointAliasCases.map(([legacyJointId, , rotation]) => [
      legacyJointId,
      rotation,
    ]),
  ),
  truly_unknown_joint: [-0.5, 0.5, 0.5, 0.5],
});

const expectLegacyAliasJointsPreserved = (
  joints: Record<string, unknown>,
): void => {
  expect(Object.keys(joints)).toEqual([...canonicalHumanoidJointIds]);
  for (const [legacyJointId, canonicalJointId, rotation] of
    legacyPuppetJointAliasCases) {
    expect(
      joints[canonicalJointId],
      `${legacyJointId} -> ${canonicalJointId}`,
    ).toEqual(rotation);
    expect(joints).not.toHaveProperty(legacyJointId);
  }
  expect(joints).not.toHaveProperty("truly_unknown_joint");
};

describe("actor puppet schema v6", () => {
  it("publishes scene, Patch, and IntentReport schema version 6", () => {
    expect(SCENE_SCHEMA_VERSION).toBe(6);
    expect(PATCH_SCHEMA_VERSION).toBe(6);
    expect(INTENT_REPORT_SCHEMA_VERSION).toBe(6);
  });

  it("publishes the exact fifteen adjustable humanoid joints", () => {
    expect(canonicalHumanoidJointIds).toEqual([
      "pelvis",
      "spine",
      "neck",
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
    expect(jointIdSchema.safeParse("upper_arm_r").success).toBe(true);
    expect(jointIdSchema.safeParse("elbow_r").success).toBe(false);
  });

  it("requires canonical Blueprint instance stature and limb overrides", () => {
    const canonical = createCanonicalBlueprintSceneInput();
    expect(sceneSpecSchema.safeParse(canonical).success).toBe(true);

    const missingHeight = structuredClone(canonical);
    const actor = (
      missingHeight.entities as Array<Record<string, unknown>>
    ).find((entity) => entity.kind === "actor");
    if (!actor) throw new Error("Blueprint actor fixture is missing.");
    delete (actor.blueprintInstance as Record<string, unknown>).heightScale;
    expect(sceneSpecSchema.safeParse(missingHeight).success).toBe(false);

    const unknownOverride = structuredClone(canonical);
    const overrideActor = (
      unknownOverride.entities as Array<Record<string, unknown>>
    ).find((entity) => entity.kind === "actor");
    if (!overrideActor) throw new Error("Blueprint actor fixture is missing.");
    (
      overrideActor.blueprintInstance as Record<string, unknown>
    ).limbPresenceOverrides = { elbow_l: "absent" };
    expect(sceneSpecSchema.safeParse(unknownOverride).success).toBe(false);
  });

  it("rejects Blueprint instance stature outside 1.0 to 2.4 meters", () => {
    const scene = createCanonicalBlueprintSceneInput();
    const actor = (scene.entities as Array<Record<string, unknown>>).find(
      (entity) => entity.kind === "actor",
    );
    if (!actor) throw new Error("Blueprint actor fixture is missing.");
    (actor.blueprintInstance as Record<string, unknown>).heightScale = 2;
    expect(sceneSpecSchema.safeParse(scene).success).toBe(false);
  });

  it("accepts allowlisted stature and partial joint operations", () => {
    const base = {
      schemaVersion: 6,
      patchId: "patch_actor_puppet_schema_1",
      sceneId: "scene_starter",
      baseRevision: 0,
      source: "manual" as const,
      preserveLock: false,
    };
    const heightPatch = {
      ...base,
      operations: [
        {
          op: "actor.height.set",
          actorId: "actor_generic_1",
          heightM: 1.55,
        },
      ],
    };
    const jointPatch = {
      ...base,
      patchId: "patch_actor_puppet_schema_2",
      operations: [
        {
          op: "actor.pose.joints.set",
          actorId: "actor_generic_1",
          updates: { hand_l: [0, 0, 0, 1] },
        },
      ],
    };

    expect(scenePatchSchema.safeParse(heightPatch).success).toBe(true);
    expect(scenePatchSchema.safeParse(jointPatch).success).toBe(true);
    expect(
      scenePatchSchema.safeParse({
        ...jointPatch,
        operations: [
          {
            ...jointPatch.operations[0],
            updates: {},
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      scenePatchSchema.safeParse({
        ...jointPatch,
        operations: [
          {
            ...jointPatch.operations[0],
            updates: { elbow_l: [0, 0, 0, 1] },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      scenePatchSchema.safeParse({
        ...jointPatch,
        operations: [
          {
            ...jointPatch.operations[0],
            updates: { hand_l: [0, 0, 0, 2] },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires complete canonical joint maps for complete action operations", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor) throw new Error("Actor fixture is missing.");
    const completePose = materializePose(actor, "pose.walking-step-v1");
    const patch = {
      schemaVersion: 6,
      patchId: "patch_complete_action_schema_1",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual" as const,
      preserveLock: false,
      operations: [
        {
          op: "actor.pose.set",
          entityId: actor.id,
          value: completePose,
        },
      ],
    };

    expect(scenePatchSchema.safeParse(patch).success).toBe(true);
    expect(
      scenePatchSchema.safeParse({
        ...patch,
        operations: [
          {
            ...patch.operations[0],
            value: {
              ...completePose,
              joints: { hand_r: [0, 0, 0, 1] },
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      scenePatchSchema.safeParse({
        ...patch,
        operations: [
          {
            ...patch.operations[0],
            value: {
              ...completePose,
              joints: {
                ...completePose.joints,
                elbow_r: [0, 0, 0, 1],
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires complete canonical joint maps for stored SceneSpec poses", () => {
    const scene = structuredClone(createDefaultScene()) as unknown as Record<
      string,
      unknown
    >;
    const actor = (scene.entities as Array<Record<string, unknown>>).find(
      (entity) => entity.kind === "actor",
    );
    if (!actor) throw new Error("Actor fixture is missing.");
    const typedActor = createDefaultScene().entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!typedActor || typedActor.kind !== "actor") {
      throw new Error("Typed actor fixture is missing.");
    }
    const completePose = materializePose(
      typedActor,
      "pose.walking-step-v1",
    );
    actor.pose = completePose;
    expect(sceneSpecSchema.safeParse(scene).success).toBe(true);

    const empty = structuredClone(scene);
    const emptyActor = (
      empty.entities as Array<Record<string, unknown>>
    ).find((entity) => entity.kind === "actor");
    if (!emptyActor) throw new Error("Empty actor fixture is missing.");
    (emptyActor.pose as Record<string, unknown>).joints = {};
    expect(sceneSpecSchema.safeParse(empty).success).toBe(false);

    const sparse = structuredClone(scene);
    const sparseActor = (
      sparse.entities as Array<Record<string, unknown>>
    ).find((entity) => entity.kind === "actor");
    if (!sparseActor) throw new Error("Sparse actor fixture is missing.");
    (sparseActor.pose as Record<string, unknown>).joints = {
      hand_r: [0, 0, 0, 1],
    };
    expect(sceneSpecSchema.safeParse(sparse).success).toBe(false);

    const extra = structuredClone(scene);
    const extraActor = (
      extra.entities as Array<Record<string, unknown>>
    ).find((entity) => entity.kind === "actor");
    if (!extraActor) throw new Error("Extra-joint actor fixture is missing.");
    (
      (extraActor.pose as Record<string, unknown>).joints as Record<
        string,
        unknown
      >
    ).elbow_r = [0, 0, 0, 1];
    expect(sceneSpecSchema.safeParse(extra).success).toBe(false);
  });

  it("rejects create submissions whose explicit action has an empty joint map", () => {
    const submission = createSceneSubmission();
    const actor = submission.scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!actor || actor.kind !== "actor") {
      throw new Error("Submission actor fixture is missing.");
    }
    actor.pose.preset.id = "pose.walking-step-v1";
    (actor.pose as unknown as Record<string, unknown>).joints = {};

    expect(sceneSubmissionSchema.safeParse(submission).success).toBe(false);
  });

  it.each([1, 2, 3, 4, 5] as const)(
    "expands v%s complete-action patches to the canonical fifteen joints",
    (schemaVersion) => {
      const scene = createDefaultScene();
      const actor = scene.entities.find((entity) => entity.kind === "actor");
      if (!actor) throw new Error("Actor fixture is missing.");
      const migrated = parseScenePatchInput({
        schemaVersion,
        patchId: `patch_complete_action_migration_${schemaVersion}`,
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "manual",
        ...(schemaVersion >= 3 ? { preserveLock: false } : {}),
        operations: [
          {
            op: "actor.pose.set",
            entityId: actor.id,
            value: {
              preset: {
                registry: "builtin",
                id: "pose.walking-step-v1",
                version: 1,
                parameters: { contactOffsetM: 0.9 },
              },
              joints: {
                hand_r: [0, 0, 0, 1],
                elbow_r: [0, 0, 0, 1],
              },
            },
          },
        ],
      });
      const operation = migrated.operations[0];
      if (operation?.op !== "actor.pose.set") {
        throw new Error("Migrated action operation is missing.");
      }

      expect(Object.keys(operation.value.joints)).toEqual([
        ...canonicalHumanoidJointIds,
      ]);
      expect(operation.value.joints.pelvis).toEqual([0, 0, 0, 1]);
      expect(operation.value.joints.hand_r).toEqual([0, 0, 0, 1]);
      expect(operation.value.joints).not.toHaveProperty("elbow_r");
    },
  );

  it.each([1, 2, 3, 4, 5] as const)(
    "expands v%s stored actor poses to the canonical fifteen joints",
    (schemaVersion) => {
      const migrated = parseSceneSpecInput(
        createLegacySparseJointSceneInput(schemaVersion),
      );
      const actor = migrated.entities.find(
        (entity) => entity.kind === "actor",
      );
      if (!actor || actor.kind !== "actor") {
        throw new Error("Migrated actor fixture is missing.");
      }

      expect(migrated.revision).toBe(23);
      expect(Object.keys(actor.pose.joints)).toEqual([
        ...canonicalHumanoidJointIds,
      ]);
      expect(actor.pose.joints.pelvis).toEqual([0, 0, 0, 1]);
      expect(actor.pose.joints.hand_r).toEqual([0, 0, 0, 1]);
      expect(actor.pose.joints).not.toHaveProperty("elbow_r");
    },
  );

  it.each([1, 2, 3, 4, 5] as const)(
    "expands v%s entity.add actor poses to the canonical fifteen joints",
    (schemaVersion) => {
      const legacyScene = createLegacySparseJointSceneInput(schemaVersion);
      const actor = (
        legacyScene.entities as Array<Record<string, unknown>>
      ).find((entity) => entity.kind === "actor");
      if (!actor) throw new Error("Legacy actor fixture is missing.");
      const migrated = parseScenePatchInput({
        schemaVersion,
        patchId: `patch_actor_pose_entity_add_migration_${schemaVersion}`,
        sceneId: "scene_starter",
        baseRevision: 23,
        source: "manual",
        ...(schemaVersion >= 3 ? { preserveLock: false } : {}),
        operations: [{ op: "entity.add", value: actor }],
      });
      const operation = migrated.operations[0];
      if (operation?.op !== "entity.add" || operation.value.kind !== "actor") {
        throw new Error("Migrated entity.add actor is missing.");
      }

      expect(Object.keys(operation.value.pose.joints)).toEqual([
        ...canonicalHumanoidJointIds,
      ]);
      expect(operation.value.pose.joints.pelvis).toEqual([0, 0, 0, 1]);
      expect(operation.value.pose.joints.hand_r).toEqual([0, 0, 0, 1]);
      expect(operation.value.pose.joints).not.toHaveProperty("elbow_r");
    },
  );

  it.each([1, 2, 3, 4, 5] as const)(
    "preserves v%s legacy joint aliases in stored actor poses",
    (schemaVersion) => {
      const legacyScene = createLegacySparseJointSceneInput(schemaVersion);
      const legacyActor = (
        legacyScene.entities as Array<Record<string, unknown>>
      ).find((entity) => entity.kind === "actor");
      if (!legacyActor) throw new Error("Legacy actor fixture is missing.");
      (legacyActor.pose as Record<string, unknown>).joints =
        createLegacyAliasJointMap();

      const migrated = parseSceneSpecInput(legacyScene);
      const actor = migrated.entities.find(
        (entity) => entity.kind === "actor",
      );
      if (!actor || actor.kind !== "actor") {
        throw new Error("Migrated actor fixture is missing.");
      }

      expectLegacyAliasJointsPreserved(actor.pose.joints);
    },
  );

  it.each([1, 2, 3, 4, 5] as const)(
    "preserves v%s legacy joint aliases in entity.add actor poses",
    (schemaVersion) => {
      const legacyScene = createLegacySparseJointSceneInput(schemaVersion);
      const legacyActor = (
        legacyScene.entities as Array<Record<string, unknown>>
      ).find((entity) => entity.kind === "actor");
      if (!legacyActor) throw new Error("Legacy actor fixture is missing.");
      (legacyActor.pose as Record<string, unknown>).joints =
        createLegacyAliasJointMap();

      const migrated = parseScenePatchInput({
        schemaVersion,
        patchId: `patch_legacy_alias_entity_add_${schemaVersion}`,
        sceneId: "scene_starter",
        baseRevision: 23,
        source: "manual",
        ...(schemaVersion >= 3 ? { preserveLock: false } : {}),
        operations: [{ op: "entity.add", value: legacyActor }],
      });
      const operation = migrated.operations[0];
      if (operation?.op !== "entity.add" || operation.value.kind !== "actor") {
        throw new Error("Migrated entity.add actor is missing.");
      }

      expectLegacyAliasJointsPreserved(operation.value.pose.joints);
    },
  );

  it.each([1, 2, 3, 4, 5] as const)(
    "preserves v%s legacy joint aliases in actor.pose.set",
    (schemaVersion) => {
      const scene = createDefaultScene();
      const actor = scene.entities.find((entity) => entity.kind === "actor");
      if (!actor) throw new Error("Actor fixture is missing.");
      const migrated = parseScenePatchInput({
        schemaVersion,
        patchId: `patch_legacy_alias_pose_set_${schemaVersion}`,
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "manual",
        ...(schemaVersion >= 3 ? { preserveLock: false } : {}),
        operations: [
          {
            op: "actor.pose.set",
            entityId: actor.id,
            value: {
              preset: {
                registry: "builtin",
                id: "pose.walking-step-v1",
                version: 1,
                parameters: { contactOffsetM: 0.9 },
              },
              joints: createLegacyAliasJointMap(),
            },
          },
        ],
      });
      const operation = migrated.operations[0];
      if (operation?.op !== "actor.pose.set") {
        throw new Error("Migrated actor.pose.set operation is missing.");
      }

      expectLegacyAliasJointsPreserved(operation.value.joints);
    },
  );

  it.each([1, 2, 3, 4, 5] as const)(
    "prefers canonical joints over legacy aliases in v%s actor.pose.set",
    (schemaVersion) => {
      const scene = createDefaultScene();
      const actor = scene.entities.find((entity) => entity.kind === "actor");
      if (!actor) throw new Error("Actor fixture is missing.");
      const canonicalForearmRotation = [-0.5, 0.5, -0.5, 0.5] as const;
      const migrated = parseScenePatchInput({
        schemaVersion,
        patchId: `patch_legacy_alias_precedence_${schemaVersion}`,
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "manual",
        ...(schemaVersion >= 3 ? { preserveLock: false } : {}),
        operations: [
          {
            op: "actor.pose.set",
            entityId: actor.id,
            value: {
              preset: {
                registry: "builtin",
                id: "pose.walking-step-v1",
                version: 1,
                parameters: { contactOffsetM: 0.9 },
              },
              joints: {
                ...createLegacyAliasJointMap(),
                forearm_r: canonicalForearmRotation,
              },
            },
          },
        ],
      });
      const operation = migrated.operations[0];
      if (operation?.op !== "actor.pose.set") {
        throw new Error("Migrated actor.pose.set operation is missing.");
      }

      expect(operation.value.joints.forearm_r).toEqual(
        canonicalForearmRotation,
      );
    },
  );

  it("migrates v5 Blueprint scenes and entity.add patches to v6 defaults", () => {
    const legacyScene = createLegacyV5BlueprintSceneInput();
    const migratedScene = parseSceneSpecInput(legacyScene);
    const migratedActor = migratedScene.entities.find(
      (entity) => entity.kind === "actor",
    );
    expect(migratedScene.schemaVersion).toBe(6);
    expect(migratedActor).toMatchObject({
      blueprintInstance: {
        heightScale: 1,
        limbPresenceOverrides: {},
      },
    });

    const actor = (legacyScene.entities as Array<Record<string, unknown>>).find(
      (entity) => entity.kind === "actor",
    );
    if (!actor) throw new Error("Blueprint actor fixture is missing.");
    const migratedPatch = parseScenePatchInput({
      schemaVersion: 5,
      patchId: "patch_actor_puppet_migration_1",
      sceneId: "scene_starter",
      baseRevision: 0,
      source: "manual",
      preserveLock: false,
      operations: [{ op: "entity.add", value: actor }],
    });
    expect(migratedPatch.schemaVersion).toBe(6);
    expect(migratedPatch.operations[0]).toMatchObject({
      op: "entity.add",
      value: {
        blueprintInstance: {
          heightScale: 1,
          limbPresenceOverrides: {},
        },
      },
    });
  });

  it.each(["none", "workflow", "user"] as const)(
    "rebases v5 Blueprint ground contact during migration while preserving the %s lock",
    (lockMode) => {
      const legacyScene = createLegacyV5BlueprintGroundContactScene(lockMode);
      const legacyActor = (
        legacyScene.entities as Array<Record<string, unknown>>
      ).find((entity) => entity.kind === "actor");
      if (!legacyActor) throw new Error("Legacy Blueprint actor is missing.");
      const legacyTransform = structuredClone(
        legacyActor.transform as {
          positionM: [number, number, number];
          rotation: [number, number, number, number];
          scale: [number, number, number];
        },
      );
      const legacyPreset = structuredClone(
        (legacyActor.pose as Record<string, unknown>).preset,
      );
      const legacyRevision = legacyScene.revision;

      const migrated = parseSceneSpecInput(legacyScene);
      const actor = migrated.entities.find(
        (entity) => entity.id === "actor_entity_blueprint_1",
      );
      if (!actor || actor.kind !== "actor") {
        throw new Error("Migrated Blueprint actor is missing.");
      }
      const snapped = snapTransformToContact(
        migrated,
        actor.id,
        actor.transform,
      );

      expect(migrated.revision).toBe(legacyRevision);
      expect(actor.lockMode).toBe(lockMode);
      expect(actor.transform.positionM[1]).not.toBeCloseTo(
        legacyTransform.positionM[1],
        4,
      );
      expect(actor.transform.positionM[0]).toBe(legacyTransform.positionM[0]);
      expect(actor.transform.positionM[2]).toBe(legacyTransform.positionM[2]);
      expect(actor.transform.rotation).toEqual(legacyTransform.rotation);
      expect(actor.transform.scale).toEqual(legacyTransform.scale);
      expect(actor.pose.preset).toEqual(legacyPreset);
      expect(actor.transform).toEqual(snapped);
    },
  );

  it.each(["workflow", "user"] as const)(
    "does not rebase v5 non-Blueprint ground contact through a %s lock during parsing",
    (lockMode) => {
      const legacyScene = createLegacyV5NonBlueprintGroundContactScene(lockMode);
      const before = structuredClone(legacyScene);
      const legacyActor = (
        legacyScene.entities as Array<Record<string, unknown>>
      ).find((entity) => entity.kind === "actor");
      if (legacyActor === undefined) {
        throw new Error("Legacy actor fixture is missing.");
      }
      const legacyTransform = structuredClone(legacyActor.transform);

      const migrated = parseSceneSpecInput(legacyScene);
      const actor = migrated.entities.find(
        (entity) => entity.id === legacyActor.id,
      );

      expect(actor?.kind).toBe("actor");
      expect(isBlueprintActorEntity(actor)).toBe(false);
      expect(actor?.lockMode).toBe(lockMode);
      expect(actor?.transform).toEqual(legacyTransform);
      expect(legacyScene).toEqual(before);
    },
  );

  it("migrates IntentReport v5 and accepts actor-height evidence in v6", () => {
    expect(parseIntentReportInput(createIntentReportV5()).schemaVersion).toBe(6);
    expect(
      intentReportSchema.safeParse({
        ...createIntentReportV5(),
        schemaVersion: 6,
        recognizedConstraints: [
          {
            id: "intent_actor_height_1",
            kind: "actor-height",
            required: true,
            targets: ["actor_generic_1"],
            evidence: [
              {
                type: "entity-property",
                entityId: "actor_generic_1",
                path: "actor.blueprintInstance.heightScale",
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
