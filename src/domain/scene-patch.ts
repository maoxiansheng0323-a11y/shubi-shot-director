import { z } from "zod";
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

const operationSchemas = [
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
      visible: z.boolean(),
      locked: z.boolean(),
    })
    .strict(),
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
] as const;

export const sceneOperationSchema = z.discriminatedUnion(
  "op",
  operationSchemas,
);

export const scenePatchSchema = z
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
    operations: z.array(sceneOperationSchema).min(1).max(128),
  })
  .strict();

export type SceneOperation = z.infer<typeof sceneOperationSchema>;
export type ScenePatch = z.infer<typeof scenePatchSchema>;
