import { z } from "zod";
import {
  ACTOR_BLUEPRINT_MAX_SCENE_SNAPSHOTS,
  actorBlueprintIdSchema,
  actorBlueprintSlugSchema,
  actorBlueprintSnapshotSchema,
} from "./actor-blueprint";
import { actorLimbPresenceSchema } from "./actor-anatomy";
import { entityLockModeSchema } from "./entity-lock";
import { SCENE_SCHEMA_VERSION } from "./schema-versions";
import {
  entityIdSchema,
  finiteNumberSchema,
  positiveFiniteNumberSchema,
} from "./schema-primitives";
import {
  spatialLayoutSchema,
  type SpatialLayout,
} from "./spatial-layout";

const finiteNumber = finiteNumberSchema;
const positiveFiniteNumber = positiveFiniteNumberSchema;
const entityId = entityIdSchema;

export const vec3Schema = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
]);

export const quaternionSchema = z
  .tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
  .refine(
    ([x, y, z, w]) =>
      Math.abs(Math.sqrt(x * x + y * y + z * z + w * w) - 1) < 0.001,
    "Quaternion must be normalized.",
  );

export const transformSchema = z
  .object({
    positionM: vec3Schema,
    rotation: quaternionSchema,
    scale: vec3Schema.refine(
      ([x, y, z]) => x > 0 && y > 0 && z > 0,
      "Scale components must be positive.",
    ),
  })
  .strict();

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(500),
    finiteNumber,
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(128),
    z.record(z.string().max(80), jsonValueSchema),
  ]),
);

export const jsonObjectSchema = z.record(z.string().max(80), jsonValueSchema);

export const actorSlotSchema = z
  .string()
  .min(12)
  .max(46)
  .regex(/^actor_(male|female|generic)_[1-9][0-9]*$/);

export const presetRefSchema = z
  .object({
    registry: z.literal("builtin"),
    id: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    version: z.number().int().positive(),
    parameters: jsonObjectSchema,
  })
  .strict();

export const jointIdSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/);

export const poseSchema = z
  .object({
    preset: presetRefSchema,
    joints: z.record(jointIdSchema, quaternionSchema),
  })
  .strict();

const baseEntityShape = {
  id: entityId,
  label: z.string().min(1).max(80),
  parentId: entityId.nullable(),
  transform: transformSchema,
  visible: z.boolean(),
  lockMode: entityLockModeSchema,
};

export const environmentEntitySchema = z
  .object({
    ...baseEntityShape,
    kind: z.literal("environment"),
    preset: presetRefSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const propEntitySchema = z
  .object({
    ...baseEntityShape,
    kind: z.literal("prop"),
    preset: presetRefSchema,
    geometry: z
      .object({
        primitive: z.enum(["box", "cylinder", "plane", "capsule"]),
        sizeM: vec3Schema.refine(
          ([x, y, z]) => x > 0 && y > 0 && z > 0,
          "Geometry size components must be positive.",
        ),
      })
      .strict(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

const actorBodySchema = z
  .object({
    heightM: positiveFiniteNumber.min(1).max(2.4),
    shoulderWidthM: positiveFiniteNumber.min(0.25).max(0.8),
    build: z.enum(["slim", "average", "broad"]),
    limbPresence: actorLimbPresenceSchema,
  })
  .strict();

export const legacyActorEntitySchema = z
  .object({
    ...baseEntityShape,
    kind: z.literal("actor"),
    slot: actorSlotSchema,
    rig: presetRefSchema,
    body: actorBodySchema,
    pose: poseSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const blueprintActorEntitySchema = z
  .object({
    ...baseEntityShape,
    kind: z.literal("actor"),
    slot: actorSlotSchema,
    blueprintInstance: z
      .object({
        blueprintId: actorBlueprintIdSchema,
        variantId: actorBlueprintSlugSchema,
      })
      .strict(),
    pose: poseSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const actorEntitySchema = z.union([
  legacyActorEntitySchema,
  blueprintActorEntitySchema,
]);

export const cameraLensSchema = z
  .object({
    projection: z.literal("perspective"),
    focalLengthMm: positiveFiniteNumber.min(12).max(300),
    sensorWidthMm: positiveFiniteNumber.min(10).max(100),
    nearM: positiveFiniteNumber.min(0.001).max(10),
    farM: positiveFiniteNumber.min(1).max(10_000),
  })
  .strict()
  .refine((lens) => lens.farM > lens.nearM, {
    message: "Camera far plane must be greater than its near plane.",
  });

export const cameraEntitySchema = z
  .object({
    ...baseEntityShape,
    kind: z.literal("camera"),
    lens: cameraLensSchema,
  })
  .strict();

export const sceneEntitySchema = z.union([
  environmentEntitySchema,
  propEntitySchema,
  legacyActorEntitySchema,
  blueprintActorEntitySchema,
  cameraEntitySchema,
]);

export const outputSpecSchema = z
  .object({
    aspect: z
      .object({
        width: z.literal(16),
        height: z.literal(9),
      })
      .strict(),
    resolutionPx: z
      .object({
        width: z.number().int().min(640).max(7680),
        height: z.number().int().min(360).max(4320),
      })
      .strict()
      .refine(
        ({ width, height }) => Math.abs(width / height - 16 / 9) < 0.001,
        "Output resolution must be 16:9.",
      ),
  })
  .strict();

const uniqueEntityIds = (values: string[]): boolean =>
  new Set(values).size === values.length;

export const compositionFramingModeSchema = z.enum([
  "close",
  "medium-close",
  "medium",
  "full",
  "whole-prop",
]);

export const compositionGoalsSchema = z
  .object({
    framing: z
      .object({
        mode: compositionFramingModeSchema,
        targetEntityIds: z
          .array(entityId)
          .min(1)
          .max(16)
          .refine(uniqueEntityIds, "Framing target ids must be unique."),
      })
      .strict()
      .optional(),
    captionZone: z
      .object({
        bottomFraction: positiveFiniteNumber.min(0.05).max(0.45),
      })
      .strict()
      .optional(),
    sideUiZone: z
      .object({
        side: z.enum(["left", "right", "both"]),
        widthFraction: positiveFiniteNumber.min(0.05).max(0.4),
      })
      .strict()
      .optional(),
    criticalEntityIds: z
      .array(entityId)
      .min(1)
      .max(32)
      .refine(uniqueEntityIds, "Critical entity ids must be unique.")
      .optional(),
  })
  .strict()
  .refine(
    (goals) =>
      goals.framing !== undefined ||
      goals.captionZone !== undefined ||
      goals.sideUiZone !== undefined ||
      goals.criticalEntityIds !== undefined,
    "Composition goals must configure at least one goal.",
  );

export const sceneConstraintSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: entityId,
      type: z.literal("ground-contact"),
      entityId,
      surfaceEntityId: entityId.nullable(),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      id: entityId,
      type: z.literal("keep-visible"),
      cameraId: entityId,
      subjectEntityId: entityId,
      anchor: z.enum(["face", "head", "chest", "pelvis", "root"]),
      enabled: z.boolean(),
    })
    .strict(),
]);

export const sceneSpecSchema = z
  .object({
    schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
    sceneId: entityId,
    revision: z.number().int().nonnegative(),
    title: z.string().min(1).max(120),
    coordinateSystem: z
      .object({
        handedness: z.literal("right"),
        upAxis: z.literal("+Y"),
        cameraForwardAxis: z.literal("-Z"),
        lengthUnit: z.literal("meter"),
      })
      .strict(),
    activeCameraId: entityId,
    output: outputSpecSchema,
    compositionGoals: compositionGoalsSchema.optional(),
    spatialLayout: spatialLayoutSchema.nullable().default(null),
    actorBlueprints: z
      .array(actorBlueprintSnapshotSchema)
      .max(ACTOR_BLUEPRINT_MAX_SCENE_SNAPSHOTS),
    entities: z.array(sceneEntitySchema).min(2).max(256),
    constraints: z.array(sceneConstraintSchema).max(256),
  })
  .strict()
  .superRefine((scene, context) => {
    const ids = new Set<string>();
    const slots = new Set<string>();
    const blueprintIds = new Map<string, string>();
    const blueprintHashes = new Map<string, string>();

    for (const [
      blueprintIndex,
      snapshot,
    ] of scene.actorBlueprints.entries()) {
      const existingHash = blueprintIds.get(snapshot.blueprintId);
      if (existingHash !== undefined) {
        context.addIssue({
          code: "custom",
          message: "ACTOR_BLUEPRINT_ID_CONFLICT",
          path: ["actorBlueprints", blueprintIndex, "blueprintId"],
        });
        continue;
      }
      blueprintIds.set(snapshot.blueprintId, snapshot.contentSha256);

      const existingId = blueprintHashes.get(snapshot.contentSha256);
      if (existingId !== undefined) {
        context.addIssue({
          code: "custom",
          message: "ACTOR_BLUEPRINT_HASH_DUPLICATE",
          path: ["actorBlueprints", blueprintIndex, "contentSha256"],
        });
        continue;
      }
      blueprintHashes.set(snapshot.contentSha256, snapshot.blueprintId);
    }

    for (const entity of scene.entities) {
      if (ids.has(entity.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate entity id: ${entity.id}`,
          path: ["entities"],
        });
      }
      ids.add(entity.id);

      if (entity.kind === "actor") {
        if (slots.has(entity.slot)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate actor slot: ${entity.slot}`,
            path: ["entities"],
          });
        }
        slots.add(entity.slot);

        if (isBlueprintActorEntity(entity)) {
          const snapshot = scene.actorBlueprints.find(
            (candidate) =>
              candidate.blueprintId ===
              entity.blueprintInstance.blueprintId,
          );
          if (
            snapshot === undefined ||
            !snapshot.variants.some(
              ({ variantId }) =>
                variantId === entity.blueprintInstance.variantId,
            )
          ) {
            context.addIssue({
              code: "custom",
              message: "ACTOR_BLUEPRINT_REFERENCE_INVALID",
              path: [
                "entities",
                scene.entities.indexOf(entity),
                "blueprintInstance",
              ],
            });
          }
        }
      }
    }

    const activeCamera = scene.entities.find(
      (entity) =>
        entity.id === scene.activeCameraId && entity.kind === "camera",
    );
    if (!activeCamera) {
      context.addIssue({
        code: "custom",
        message: "activeCameraId must reference a camera entity.",
        path: ["activeCameraId"],
      });
    }

    if (
      scene.spatialLayout !== null &&
      scene.entities.some((entity) => entity.kind === "environment")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Connected-region scenes cannot contain environment entities.",
        path: ["entities"],
      });
    }
    if (scene.spatialLayout !== null) {
      for (const [
        membershipIndex,
        membership,
      ] of scene.spatialLayout.memberships.entries()) {
        const entity = scene.entities.find(
          (candidate) => candidate.id === membership.entityId,
        );
        if (!entity) {
          context.addIssue({
            code: "custom",
            message: `Membership references missing scene entity: ${membership.entityId}`,
            path: [
              "spatialLayout",
              "memberships",
              membershipIndex,
              "entityId",
            ],
          });
        } else if (
          entity.kind !== "actor" &&
          entity.kind !== "prop" &&
          entity.kind !== "camera"
        ) {
          context.addIssue({
            code: "custom",
            message: `Membership entity must be actor, prop, or camera: ${membership.entityId}`,
            path: [
              "spatialLayout",
              "memberships",
              membershipIndex,
              "entityId",
            ],
          });
        }
      }
    }

    const compositionGoals = scene.compositionGoals;
    if (compositionGoals) {
      const framing = compositionGoals.framing;
      if (framing) {
        for (const targetId of framing.targetEntityIds) {
          const target = scene.entities.find(
            (entity) => entity.id === targetId,
          );
          if (!target) {
            context.addIssue({
              code: "custom",
              message: `Composition framing references missing entity: ${targetId}`,
              path: ["compositionGoals", "framing", "targetEntityIds"],
            });
            continue;
          }
          const expectedKind =
            framing.mode === "whole-prop" ? "prop" : "actor";
          if (target.kind !== expectedKind) {
            context.addIssue({
              code: "custom",
              message:
                framing.mode === "whole-prop"
                  ? "Whole-prop framing targets must be props."
                  : "Actor framing targets must be actors.",
              path: ["compositionGoals", "framing", "targetEntityIds"],
            });
          }
        }
      }

      for (const criticalId of compositionGoals.criticalEntityIds ?? []) {
        const criticalEntity = scene.entities.find(
          (entity) => entity.id === criticalId,
        );
        if (!criticalEntity) {
          context.addIssue({
            code: "custom",
            message: `Composition goals reference missing critical entity: ${criticalId}`,
            path: ["compositionGoals", "criticalEntityIds"],
          });
        } else if (
          criticalEntity.kind !== "actor" &&
          criticalEntity.kind !== "prop"
        ) {
          context.addIssue({
            code: "custom",
            message: "Critical composition entities must be actors or props.",
            path: ["compositionGoals", "criticalEntityIds"],
          });
        }
      }
    }

    for (const entity of scene.entities) {
      if (entity.parentId !== null && !ids.has(entity.parentId)) {
        context.addIssue({
          code: "custom",
          message: `Missing parent entity: ${entity.parentId}`,
          path: ["entities"],
        });
      }
      if (entity.parentId === entity.id) {
        context.addIssue({
          code: "custom",
          message: `Entity cannot parent itself: ${entity.id}`,
          path: ["entities"],
        });
      }
    }

    for (const entity of scene.entities) {
      const visited = new Set([entity.id]);
      let parentId = entity.parentId;
      while (parentId !== null) {
        if (visited.has(parentId)) {
          context.addIssue({
            code: "custom",
            message: `Parent cycle includes entity: ${entity.id}`,
            path: ["entities"],
          });
          break;
        }
        visited.add(parentId);
        parentId =
          scene.entities.find((candidate) => candidate.id === parentId)
            ?.parentId ?? null;
      }
    }

    const constraintIds = new Set<string>();
    const enabledGroundSubjects = new Set<string>();
    const entityById = new Map(
      scene.entities.map((entity) => [entity.id, entity] as const),
    );

    for (const constraint of scene.constraints) {
      if (constraintIds.has(constraint.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate constraint id: ${constraint.id}`,
          path: ["constraints"],
        });
      }
      constraintIds.add(constraint.id);

      const referencedIds =
        constraint.type === "ground-contact"
          ? [constraint.entityId, constraint.surfaceEntityId]
          : [constraint.cameraId, constraint.subjectEntityId];
      for (const referencedId of referencedIds) {
        if (referencedId !== null && !ids.has(referencedId)) {
          context.addIssue({
            code: "custom",
            message: `Constraint references missing entity: ${referencedId}`,
            path: ["constraints"],
          });
        }
      }

      if (constraint.type === "ground-contact") {
        if (constraint.enabled) {
          if (enabledGroundSubjects.has(constraint.entityId)) {
            context.addIssue({
              code: "custom",
              message:
                "An actor cannot have multiple enabled ground contacts.",
              path: ["constraints"],
            });
          }
          enabledGroundSubjects.add(constraint.entityId);
        }
        const subject = entityById.get(constraint.entityId);
        const surface =
          constraint.surfaceEntityId === null
            ? null
            : entityById.get(constraint.surfaceEntityId);
        if (subject?.kind !== "actor") {
          context.addIssue({
            code: "custom",
            message: "Ground contact currently supports actor subjects.",
            path: ["constraints"],
          });
        }
        if (
          surface !== null &&
          surface !== undefined &&
          surface.kind !== "environment" &&
          surface.kind !== "prop"
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Ground contact surface must be an environment or prop.",
            path: ["constraints"],
          });
        }
        if (constraint.entityId === constraint.surfaceEntityId) {
          context.addIssue({
            code: "custom",
            message: "A contact subject cannot be its own surface.",
            path: ["constraints"],
          });
        }
      } else {
        const camera = entityById.get(constraint.cameraId);
        const subject = entityById.get(constraint.subjectEntityId);
        if (camera?.kind !== "camera") {
          context.addIssue({
            code: "custom",
            message: "Keep-visible cameraId must reference a camera.",
            path: ["constraints"],
          });
        }
        if (subject?.kind !== "actor") {
          context.addIssue({
            code: "custom",
            message: "Keep-visible currently supports actor subjects.",
            path: ["constraints"],
          });
        }
      }
    }
  });

export type Vec3 = z.infer<typeof vec3Schema>;
export type QuaternionTuple = z.infer<typeof quaternionSchema>;
export type TransformSpec = z.infer<typeof transformSchema>;
export type PresetRef = z.infer<typeof presetRefSchema>;
export type PoseSpec = z.infer<typeof poseSchema>;
export type ActorSlot = z.infer<typeof actorSlotSchema>;
export type SceneEntity = z.infer<typeof sceneEntitySchema>;
export type LegacyActorEntity = z.infer<typeof legacyActorEntitySchema>;
export type BlueprintActorEntity = z.infer<
  typeof blueprintActorEntitySchema
>;
export type AnyActorEntity = z.infer<typeof actorEntitySchema>;
export type ActorEntity = LegacyActorEntity;
export type CameraEntity = z.infer<typeof cameraEntitySchema>;
export type CameraLens = z.infer<typeof cameraLensSchema>;
export type OutputSpec = z.infer<typeof outputSpecSchema>;
export type CompositionFramingMode = z.infer<
  typeof compositionFramingModeSchema
>;
export type CompositionGoals = z.infer<typeof compositionGoalsSchema>;
export type SceneConstraint = z.infer<typeof sceneConstraintSchema>;
export type SceneSpec = z.infer<typeof sceneSpecSchema>;
export type LegacySceneEntity = Exclude<SceneEntity, BlueprintActorEntity>;
export type LegacySceneSpec = Omit<SceneSpec, "entities"> & {
  entities: LegacySceneEntity[];
};
export type { SpatialLayout };

export const isLegacyActorEntity = (
  entity: SceneEntity | AnyActorEntity | null | undefined,
): entity is LegacyActorEntity =>
  entity?.kind === "actor" && "rig" in entity && "body" in entity;

export const isBlueprintActorEntity = (
  entity: SceneEntity | AnyActorEntity | null | undefined,
): entity is BlueprintActorEntity =>
  entity?.kind === "actor" && "blueprintInstance" in entity;

export const identityQuaternion = (): QuaternionTuple => [0, 0, 0, 1];

export const identityTransform = (): TransformSpec => ({
  positionM: [0, 0, 0],
  rotation: identityQuaternion(),
  scale: [1, 1, 1],
});
