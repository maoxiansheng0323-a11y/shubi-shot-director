import { z } from "zod";
import { actorLimbPresenceUpdatesSchema } from "./actor-anatomy";
import {
  canonicalPuppetJointIdSchema,
  canonicalPuppetJointIds,
} from "./actor-joints";
import {
  MAX_ACTOR_HEIGHT_M,
  MIN_ACTOR_HEIGHT_M,
} from "./actor-stature";
import {
  actorBlueprintSlugSchema,
  actorBlueprintSnapshotSchema,
  actorBlueprintSnapshotStructureSchema,
} from "./actor-blueprint";
import { entityLockModeSchema } from "./entity-lock";
import {
  cameraLensSchema,
  compositionGoalsSchema,
  entityIdSchema,
  jsonObjectSchema,
  outputSpecSchema,
  poseSchema,
  quaternionSchema,
  sceneConstraintSchema,
  sceneEntitySchema,
  transformSchema,
  vec3Schema,
} from "./shared-schemas";
import { PATCH_SCHEMA_VERSION } from "./schema-versions";
import { staticBlockingPlanSchema } from "./static-blocking-schema";
import {
  entityRegionMembershipSchema,
  spatialBoundarySchema,
  spatialConnectionSchema,
  spatialOpeningSchema,
  spatialRegionSchema,
} from "./spatial-layout";

export const actorLimbPresenceOperationUpdatesSchema =
  actorLimbPresenceUpdatesSchema
  .refine(
    (updates) => Object.keys(updates).length > 0,
    "Actor limb presence updates must contain at least one part.",
  )
  .refine(
    (updates) =>
      Object.values(updates).every(
        (mode) => mode === "present" || mode === "absent",
      ),
    "Actor limb presence updates cannot contain undefined modes.",
  );

export const ACTOR_HEIGHT_RANGE_ERROR_CODE =
  "ACTOR_HEIGHT_RANGE_INVALID" as const;
export const ACTOR_JOINT_ID_ERROR_CODE = "ACTOR_JOINT_ID_INVALID" as const;

export type ActorPuppetInputErrorCode =
  | typeof ACTOR_HEIGHT_RANGE_ERROR_CODE
  | typeof ACTOR_JOINT_ID_ERROR_CODE;

const containsValidationMessage = (value: unknown, message: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry) => containsValidationMessage(entry, message));
  }
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.message === message) return true;
  return Object.values(record).some((entry) =>
    containsValidationMessage(entry, message),
  );
};

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const operationForIssue = (
  input: unknown,
  operationIndex: number,
): Record<string, unknown> | undefined => {
  const envelope = recordValue(input);
  const patch = recordValue(envelope?.patch) ?? envelope;
  const operations = patch?.operations;
  return Array.isArray(operations)
    ? recordValue(operations[operationIndex])
    : undefined;
};

export const actorPuppetInputErrorCode = (
  error: unknown,
  input: unknown,
): ActorPuppetInputErrorCode | undefined => {
  if (!(error instanceof z.ZodError) || error.issues.length !== 1) {
    return undefined;
  }
  const [issue] = error.issues;
  const [operationsKey, operationIndex, propertyKey, nestedKey] = issue.path;
  if (operationsKey !== "operations" || typeof operationIndex !== "number") {
    return undefined;
  }
  const operation = operationForIssue(input, operationIndex);
  if (
    issue.path.length === 3 &&
    propertyKey === "heightM" &&
    operation?.op === "actor.height.set" &&
    issue.message === ACTOR_HEIGHT_RANGE_ERROR_CODE
  ) {
    return ACTOR_HEIGHT_RANGE_ERROR_CODE;
  }
  if (
    issue.path.length === 4 &&
    propertyKey === "updates" &&
    typeof nestedKey === "string" &&
    operation?.op === "actor.pose.joints.set" &&
    containsValidationMessage(issue, ACTOR_JOINT_ID_ERROR_CODE)
  ) {
    return ACTOR_JOINT_ID_ERROR_CODE;
  }
  return undefined;
};

const actorPuppetJointUpdateIdSchema = z.enum(canonicalPuppetJointIds, {
  error: ACTOR_JOINT_ID_ERROR_CODE,
});

const completeActionPoseSchema = poseSchema.extend({
  joints: z.record(canonicalPuppetJointIdSchema, quaternionSchema),
});

const operationSchemas = [
  z
    .object({
      op: z.literal("actor.blueprint.register"),
      snapshot: actorBlueprintSnapshotStructureSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("entity.add"),
      value: sceneEntitySchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("entity.remove"),
      entityId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("entity.transform.set"),
      entityId: entityIdSchema,
      value: transformSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("entity.transform.translate"),
      entityId: entityIdSchema,
      deltaM: vec3Schema,
      referenceSpace: z.enum(["world", "local", "camera"]),
      referenceCameraId: entityIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("entity.transform.rotate"),
      entityId: entityIdSchema,
      deltaRotation: quaternionSchema,
      referenceSpace: z.enum(["world", "local"]),
    })
    .strict(),
  z
    .object({
      op: z.literal("entity.flags.set"),
      entityId: entityIdSchema,
      visible: z.boolean().optional(),
      lockMode: entityLockModeSchema.optional(),
    })
    .strict()
    .refine(
      (operation) =>
        operation.visible !== undefined ||
        operation.lockMode !== undefined,
      "Entity flags operation must set visible or lockMode.",
    ),
  z
    .object({
      op: z.literal("entity.preset.parameters.set"),
      entityId: entityIdSchema,
      value: jsonObjectSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.pose.set"),
      entityId: entityIdSchema,
      value: completeActionPoseSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.height.set"),
      actorId: entityIdSchema,
      heightM: z
        .number()
        .finite()
        .min(MIN_ACTOR_HEIGHT_M, ACTOR_HEIGHT_RANGE_ERROR_CODE)
        .max(MAX_ACTOR_HEIGHT_M, ACTOR_HEIGHT_RANGE_ERROR_CODE),
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.pose.joints.set"),
      actorId: entityIdSchema,
      updates: z
        .partialRecord(actorPuppetJointUpdateIdSchema, quaternionSchema)
        .refine(
          (updates) => Object.keys(updates).length > 0,
          "Actor joint updates must contain at least one joint.",
        ),
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.blocking.solve"),
      plan: staticBlockingPlanSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.limb-presence.set"),
      actorId: entityIdSchema,
      updates: actorLimbPresenceOperationUpdatesSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.variant.set"),
      actorId: entityIdSchema,
      variantId: actorBlueprintSlugSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("camera.lens.set"),
      entityId: entityIdSchema,
      value: cameraLensSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("camera.look-at"),
      entityId: entityIdSchema,
      target: z.discriminatedUnion("type", [
        z
          .object({
            type: z.literal("point"),
            pointM: vec3Schema,
          })
          .strict(),
        z
          .object({
            type: z.literal("entity-anchor"),
            entityId: entityIdSchema,
            anchor: z.enum(["face", "head", "chest", "pelvis", "root"]),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      op: z.literal("constraint.set"),
      value: sceneConstraintSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("constraint.remove"),
      constraintId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("scene.active-camera.set"),
      cameraId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("scene.output.set"),
      value: outputSpecSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("scene.composition-goals.set"),
      value: compositionGoalsSchema.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal("scene.title.set"),
      value: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.region.visibility.set"),
      regionId: entityIdSchema,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.region.upsert"),
      value: spatialRegionSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.region.remove"),
      regionId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.boundary.upsert"),
      value: spatialBoundarySchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.boundary.visibility.set"),
      boundaryId: entityIdSchema,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.boundary.remove"),
      boundaryId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.opening.upsert"),
      value: spatialOpeningSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.opening.remove"),
      openingId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.connection.upsert"),
      value: spatialConnectionSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.connection.remove"),
      connectionId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.membership.set"),
      value: entityRegionMembershipSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("spatial.membership.remove"),
      entityId: entityIdSchema,
    })
    .strict(),
] as const;

export const sceneOperationSchema = z.discriminatedUnion(
  "op",
  operationSchemas,
);

export const scenePatchStructureSchema = z
  .object({
    schemaVersion: z.literal(PATCH_SCHEMA_VERSION),
    patchId: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z][a-z0-9_-]*$/),
    sceneId: entityIdSchema,
    baseRevision: z.number().int().nonnegative(),
    source: z.enum(["manual", "natural-language", "system"]),
    preserveLock: z.boolean(),
    operations: z.array(sceneOperationSchema).min(1).max(256),
  })
  .strict();

export const scenePatchSchema = scenePatchStructureSchema.superRefine(
  (patch, context) => {
    for (const [operationIndex, operation] of patch.operations.entries()) {
      if (operation.op !== "actor.blueprint.register") continue;
      const parsed = actorBlueprintSnapshotSchema.safeParse(
        operation.snapshot,
      );
      if (parsed.success) continue;
      for (const issue of parsed.error.issues) {
        context.addIssue({
          ...issue,
          path: [
            "operations",
            operationIndex,
            "snapshot",
            ...issue.path,
          ],
        });
      }
    }
  },
);

export type SceneOperation = z.infer<typeof sceneOperationSchema>;
export type ScenePatch = z.infer<typeof scenePatchSchema>;
