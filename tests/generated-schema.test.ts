import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchemaObject, ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import { ACTOR_LIMB_PART_IDS } from "../src/domain/actor-anatomy";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";
import {
  createExplicitPuppetActionPose,
  createPatchSubmission,
  createSceneSubmission,
  createStructuredPatch,
  createStructuredScene,
} from "./helpers/structured-fixtures";

const generatedSchemaDirectory = path.resolve(
  ".agents/skills/shubi-shot-director/references/generated",
);

const readGeneratedSchema = async (
  fileName: string,
): Promise<AnySchemaObject> =>
  JSON.parse(
    await readFile(path.join(generatedSchemaDirectory, fileName), "utf8"),
  ) as AnySchemaObject;

const compileGeneratedSchema = async (
  fileName: string,
): Promise<ValidateFunction> => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(await readGeneratedSchema(fileName));
};

const patchWithQuaternion = (quaternion: readonly number[]): unknown => {
  const scene = createStructuredScene();
  return {
    ...createStructuredPatch(scene),
    operations: [
      {
        op: "actor.pose.joints.set",
        actorId: "actor_generic_1",
        updates: { pelvis: quaternion },
      },
    ],
  };
};

const sceneWithQuaternion = (quaternion: readonly number[]): unknown => {
  const scene = structuredClone(createStructuredScene()) as unknown as {
    entities: Array<{
      kind: string;
      pose?: { joints: Record<string, readonly number[]> };
    }>;
  };
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor?.pose) throw new Error("Actor fixture is missing its pose.");
  actor.pose.joints.pelvis = quaternion;
  return scene;
};

const sceneWithCompleteStoredPose = () => {
  const scene = createStructuredScene();
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor || actor.kind !== "actor") {
    throw new Error("Actor fixture is missing its pose.");
  }
  actor.pose = createExplicitPuppetActionPose();
  return scene;
};

const generatedDocumentCases = [
  {
    fileName: "scene-spec.schema.json",
    document: sceneWithQuaternion,
  },
  {
    fileName: "scene-patch.schema.json",
    document: patchWithQuaternion,
  },
  {
    fileName: "scene-submission.schema.json",
    document: (quaternion: readonly number[]) => {
      const submission = createSceneSubmission();
      submission.scene = sceneWithQuaternion(
        quaternion,
      ) as typeof submission.scene;
      return submission;
    },
  },
  {
    fileName: "patch-submission.schema.json",
    document: (quaternion: readonly number[]) => {
      const submission = createPatchSubmission();
      submission.patch = patchWithQuaternion(
        quaternion,
      ) as typeof submission.patch;
      return submission;
    },
  },
] as const;

type JsonSchemaNode = {
  additionalProperties?: JsonSchemaNode | boolean;
  properties?: Record<string, JsonSchemaNode>;
  "x-shubi-limb-hierarchy"?: unknown;
  "x-shubi-resolved-stature"?: unknown;
  [key: string]: unknown;
};

const generatedSchemaFiles = [
  "scene-spec.schema.json",
  "scene-patch.schema.json",
  "intent-report.schema.json",
  "scene-submission.schema.json",
  "patch-submission.schema.json",
] as const;

const findSchemaNodes = (
  value: unknown,
  predicate: (node: JsonSchemaNode) => boolean,
): JsonSchemaNode[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      findSchemaNodes(item, predicate),
    );
  }
  if (typeof value !== "object" || value === null) return [];

  const node = value as JsonSchemaNode;
  return [
    ...(predicate(node) ? [node] : []),
    ...Object.values(node).flatMap((child) =>
      findSchemaNodes(child, predicate),
    ),
  ];
};

const hasPropertySignature = (
  node: JsonSchemaNode,
  propertyNames: readonly string[],
): boolean =>
  propertyNames.every(
    (propertyName) => node.properties?.[propertyName] !== undefined,
  );

const isCanonicalLimbSchema = (
  node: JsonSchemaNode | undefined,
): node is JsonSchemaNode => {
  if (node?.properties === undefined) return false;
  const propertyNames = Object.keys(node.properties);
  return (
    propertyNames.length === ACTOR_LIMB_PART_IDS.length &&
    ACTOR_LIMB_PART_IDS.every((partId) =>
      Object.prototype.hasOwnProperty.call(node.properties, partId),
    )
  );
};

const findBlueprintInstanceSchemas = (value: unknown): JsonSchemaNode[] =>
  findSchemaNodes(value, (node) =>
    hasPropertySignature(node, [
      "blueprintId",
      "variantId",
      "heightScale",
      "limbPresenceOverrides",
    ]),
  );

const findEmbeddedLimbSchemas = (value: unknown): JsonSchemaNode[] =>
  findSchemaNodes(
    value,
    (node) =>
      isCanonicalLimbSchema(node.properties?.limbPresence) ||
      isCanonicalLimbSchema(node.properties?.limbPresenceOverrides),
  ).flatMap((node) =>
    [
      node.properties?.limbPresence,
      node.properties?.limbPresenceOverrides,
    ].filter(isCanonicalLimbSchema),
  );

const expectedLimbHierarchyAnnotation = {
  chains: [
    ["upper_arm_l", "forearm_l", "hand_l"],
    ["upper_arm_r", "forearm_r", "hand_r"],
    ["upper_leg_l", "lower_leg_l", "foot_l"],
    ["upper_leg_r", "lower_leg_r", "foot_r"],
  ],
  enforcedBy: "runtime-zod-refinement",
};

const findOperationSchema = (
  value: unknown,
  operationName: string,
): JsonSchemaNode | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findOperationSchema(item, operationName);
      if (match) return match;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const node = value as JsonSchemaNode;
  if (node.properties?.op?.const === operationName) return node;
  for (const child of Object.values(node)) {
    const match = findOperationSchema(child, operationName);
    if (match) return match;
  }
  return undefined;
};

const createBlueprintScene = () => {
  const scene = createDefaultScene();
  const snapshot = createActorBlueprintSnapshot(
    createGenericActorBlueprintDocument(),
  );
  const actor = createBlueprintActor();

  return sceneSpecSchema.parse({
    ...scene,
    actorBlueprints: [snapshot],
    entities: [
      ...scene.entities.filter((entity) => entity.kind !== "actor"),
      actor,
    ],
    constraints: [],
  });
};

const createCompleteActionPatch = () => {
  const scene = createStructuredScene();
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor) throw new Error("Actor fixture is missing.");

  return {
    ...createStructuredPatch(scene),
    operations: [
      {
        op: "actor.pose.set" as const,
        entityId: actor.id,
        value: createExplicitPuppetActionPose(),
      },
    ],
  };
};

const createLimbHierarchyConflictFixture = () => {
  const scene = createStructuredScene();
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor) throw new Error("Actor fixture is missing.");
  const patch = scenePatchSchema.parse({
    ...createStructuredPatch(scene),
    operations: [
      {
        op: "actor.limb-presence.set",
        actorId: actor.id,
        updates: {
          upper_arm_l: "absent",
          hand_l: "present",
        },
      },
    ],
  });

  return { scene, patch };
};

type LimbHierarchyConflictFixture = ReturnType<
  typeof createLimbHierarchyConflictFixture
>;

const limbHierarchyPatchCases = [
  {
    fileName: "scene-patch.schema.json",
    document: ({ patch }: LimbHierarchyConflictFixture) => patch,
  },
  {
    fileName: "patch-submission.schema.json",
    document: ({ scene, patch }: LimbHierarchyConflictFixture) => ({
      ...createPatchSubmission(scene),
      patch,
    }),
  },
] as const;

describe("generated JSON Schemas", () => {
  it.each(generatedSchemaFiles)(
    "publishes runtime-only actor semantics as vendor annotations in %s",
    async (fileName) => {
      const schema = await readGeneratedSchema(fileName);
      const blueprintInstanceSchemas = findBlueprintInstanceSchemas(schema);
      const embeddedLimbSchemas = findEmbeddedLimbSchemas(schema);

      if (fileName === "intent-report.schema.json") {
        expect(blueprintInstanceSchemas).toEqual([]);
        expect(embeddedLimbSchemas).toEqual([]);
        return;
      }

      expect(blueprintInstanceSchemas.length).toBeGreaterThan(0);
      for (const blueprintInstanceSchema of blueprintInstanceSchemas) {
        expect(
          blueprintInstanceSchema.properties?.heightScale?.[
            "x-shubi-resolved-stature"
          ],
        ).toEqual({
          formula: "snapshot.body.heightM * heightScale",
          minimumM: 1,
          maximumM: 2.4,
          enforcedBy: "runtime-zod-refinement",
        });
      }

      expect(embeddedLimbSchemas.length).toBeGreaterThan(0);
      for (const propertySchema of embeddedLimbSchemas) {
        expect(propertySchema["x-shubi-limb-hierarchy"]).toEqual(
          expectedLimbHierarchyAnnotation,
        );
      }
    },
  );

  it.each(limbHierarchyPatchCases)(
    "annotates actor.limb-presence.set updates in $fileName while runtime enforces hierarchy",
    async ({ fileName, document }) => {
      const schema = await readGeneratedSchema(fileName);
      const operation = findOperationSchema(
        schema,
        "actor.limb-presence.set",
      );
      expect(
        operation?.properties?.updates?.["x-shubi-limb-hierarchy"],
      ).toEqual(expectedLimbHierarchyAnnotation);

      const fixture = createLimbHierarchyConflictFixture();
      const validate = await compileGeneratedSchema(fileName);
      expect(
        validate(document(fixture)),
        JSON.stringify(validate.errors),
      ).toBe(true);

      let runtimeError: unknown;
      try {
        applyScenePatch(fixture.scene, fixture.patch);
      } catch (error) {
        runtimeError = error;
      }
      expect(runtimeError).toMatchObject({
        code: "LIMB_HIERARCHY_CONFLICT",
      });
    },
  );

  it.each(generatedDocumentCases)(
    "enforces exact quaternion tuple length in $fileName through Ajv 2020",
    async ({ fileName, document }) => {
      const validate = await compileGeneratedSchema(fileName);

      expect(
        validate(document([0, 0, 0, 1])),
        JSON.stringify(validate.errors),
      ).toBe(true);
      expect(validate(document([0, 0, 1]))).toBe(false);
      expect(validate(document([0, 0, 0, 1, 0]))).toBe(false);
    },
  );

  it("publishes normalization as an annotation while runtime Zod enforces it", async () => {
    const schema = await readGeneratedSchema("scene-patch.schema.json");
    const operation = findOperationSchema(
      schema,
      "actor.pose.joints.set",
    );
    const updates = operation?.properties?.updates;
    const quaternion =
      typeof updates?.additionalProperties === "object"
        ? updates.additionalProperties
        : undefined;

    expect(quaternion).toMatchObject({
      minItems: 4,
      maxItems: 4,
      items: false,
      "x-shubi-normalized-quaternion": true,
    });

    const validate = await compileGeneratedSchema(
      "scene-patch.schema.json",
    );
    expect(validate(patchWithQuaternion([0, 0, 0, 2]))).toBe(true);
    expect(
      scenePatchSchema.safeParse(
        patchWithQuaternion([0, 0, 0, 2]),
      ).success,
    ).toBe(false);
  });

  it("keeps resolved Blueprint stature structural in Ajv and final in runtime Zod", async () => {
    const scene = createBlueprintScene();
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor" && "blueprintInstance" in entity,
    );
    if (!actor || !("blueprintInstance" in actor)) {
      throw new Error("Blueprint actor fixture is missing.");
    }
    actor.blueprintInstance.heightScale = 2;

    const validate = await compileGeneratedSchema(
      "scene-spec.schema.json",
    );
    expect(validate(scene), JSON.stringify(validate.errors)).toBe(true);
    expect(sceneSpecSchema.safeParse(scene).success).toBe(false);
  });

  it("keeps limb hierarchy structural in Ajv and final in runtime Zod", async () => {
    const scene = createBlueprintScene();
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor" && "blueprintInstance" in entity,
    );
    if (!actor || !("blueprintInstance" in actor)) {
      throw new Error("Blueprint actor fixture is missing.");
    }
    actor.blueprintInstance.limbPresenceOverrides = {
      upper_arm_l: "absent",
      hand_l: "present",
    };

    const validate = await compileGeneratedSchema(
      "scene-spec.schema.json",
    );
    expect(validate(scene), JSON.stringify(validate.errors)).toBe(true);
    expect(sceneSpecSchema.safeParse(scene).success).toBe(false);
  });

  it("enforces complete actor.pose.set joint maps through generated Ajv", async () => {
    const validate = await compileGeneratedSchema(
      "scene-patch.schema.json",
    );
    const complete = createCompleteActionPatch();
    expect(validate(complete), JSON.stringify(validate.errors)).toBe(true);

    const missingJoint = structuredClone(complete);
    delete (
      missingJoint.operations[0]!.value.joints as Partial<
        typeof missingJoint.operations[0]["value"]["joints"]
      >
    ).hand_r;
    expect(validate(missingJoint)).toBe(false);

    const extraJoint = structuredClone(complete);
    (
      extraJoint.operations[0]!.value.joints as Record<
        string,
        readonly number[]
      >
    ).elbow_r = [0, 0, 0, 1];
    expect(validate(extraJoint)).toBe(false);
  });

  it("enforces complete stored pose joint maps through generated Ajv", async () => {
    const validateScene = await compileGeneratedSchema(
      "scene-spec.schema.json",
    );
    const complete = sceneWithCompleteStoredPose();
    expect(validateScene(complete), JSON.stringify(validateScene.errors)).toBe(
      true,
    );

    const missingJoint = structuredClone(complete);
    const missingActor = missingJoint.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!missingActor || missingActor.kind !== "actor") {
      throw new Error("Missing-joint actor fixture is missing.");
    }
    delete (
      missingActor.pose.joints as Partial<typeof missingActor.pose.joints>
    ).hand_r;
    expect(validateScene(missingJoint)).toBe(false);

    const empty = structuredClone(complete);
    const emptyActor = empty.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!emptyActor || emptyActor.kind !== "actor") {
      throw new Error("Empty-joint actor fixture is missing.");
    }
    (emptyActor.pose as unknown as Record<string, unknown>).joints = {};
    expect(validateScene(empty)).toBe(false);

    const extraJoint = structuredClone(complete);
    const extraActor = extraJoint.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!extraActor || extraActor.kind !== "actor") {
      throw new Error("Extra-joint actor fixture is missing.");
    }
    (
      extraActor.pose.joints as Record<string, readonly number[]>
    ).elbow_r = [0, 0, 0, 1];
    expect(validateScene(extraJoint)).toBe(false);

    const validateSubmission = await compileGeneratedSchema(
      "scene-submission.schema.json",
    );
    const submission = createSceneSubmission();
    submission.scene = complete;
    expect(
      validateSubmission(submission),
      JSON.stringify(validateSubmission.errors),
    ).toBe(true);
    const emptySubmission = structuredClone(submission);
    const submissionActor = emptySubmission.scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!submissionActor || submissionActor.kind !== "actor") {
      throw new Error("Submission actor fixture is missing.");
    }
    (submissionActor.pose as unknown as Record<string, unknown>).joints = {};
    expect(validateSubmission(emptySubmission)).toBe(false);
  });
});
