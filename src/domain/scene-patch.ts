import { z } from "zod";
import { actorLimbPresenceModeSchema } from "./actor-anatomy";
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
import {
  entityRegionMembershipSchema,
  spatialBoundarySchema,
  spatialConnectionSchema,
  spatialOpeningSchema,
  spatialRegionSchema,
} from "./spatial-layout";

export const actorLimbPresenceUpdatesSchema = z
  .object({
    upper_arm_l: actorLimbPresenceModeSchema.optional(),
    forearm_l: actorLimbPresenceModeSchema.optional(),
    hand_l: actorLimbPresenceModeSchema.optional(),
    upper_arm_r: actorLimbPresenceModeSchema.optional(),
    forearm_r: actorLimbPresenceModeSchema.optional(),
    hand_r: actorLimbPresenceModeSchema.optional(),
    upper_leg_l: actorLimbPresenceModeSchema.optional(),
    lower_leg_l: actorLimbPresenceModeSchema.optional(),
    foot_l: actorLimbPresenceModeSchema.optional(),
    upper_leg_r: actorLimbPresenceModeSchema.optional(),
    lower_leg_r: actorLimbPresenceModeSchema.optional(),
    foot_r: actorLimbPresenceModeSchema.optional(),
  })
  .strict()
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
      value: poseSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("actor.limb-presence.set"),
      actorId: entityIdSchema,
      updates: actorLimbPresenceUpdatesSchema,
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
