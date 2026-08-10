import { z } from "zod";
import { entityIdSchema, finiteNumberSchema } from "./schema-primitives";
import {
  compositionFramingModeSchema,
} from "./scene-schema";
import {
  contactSurfaceFaceSchema,
  staticBlockingPlanSchema,
} from "./static-blocking-schema";

export const SHOT_INTENT_SCHEMA_VERSION = 1 as const;
export const SHOT_INTENT_PATCH_SCHEMA_VERSION = 1 as const;

const uniqueIds = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const distanceRangeSchema = z
  .object({
    minM: finiteNumberSchema.min(0).max(100),
    maxM: finiteNumberSchema.min(0).max(100),
  })
  .strict()
  .refine(({ minM, maxM }) => maxM >= minM, {
    message: "The maximum relationship distance must not be below the minimum.",
  });

const hardSpatialRelationshipSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("spatial-relationship"),
    subjectId: entityIdSchema,
    referenceId: entityIdSchema,
    relation: z.enum([
      "in-front-of",
      "behind",
      "left-of",
      "right-of",
      "beside",
      "near",
      "separated",
      "above",
      "below",
    ]),
    distance: distanceRangeSchema,
    axisFrame: z.enum(["world", "reference"]).default("reference"),
  })
  .strict()
  .refine(({ subjectId, referenceId }) => subjectId !== referenceId, {
    message: "A spatial relationship requires two different entities.",
  });

const hardFacingRelationshipSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("facing"),
    subjectId: entityIdSchema,
    targetEntityId: entityIdSchema,
  })
  .strict()
  .refine(({ subjectId, targetEntityId }) => subjectId !== targetEntityId, {
    message: "An entity cannot face itself.",
  });

const hardSurfacePlacementSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("surface-placement"),
    subjectId: entityIdSchema,
    surfaceEntityId: entityIdSchema.nullable(),
    surfaceFace: contactSurfaceFaceSchema,
    mode: z.enum(["on", "against"]),
    clearanceM: finiteNumberSchema.min(0).max(2).default(0),
  })
  .strict()
  .refine(
    ({ surfaceEntityId, surfaceFace }) =>
      surfaceEntityId !== null || surfaceFace === "top",
    { message: "Implicit world ground only exposes its top surface." },
  );

const hardContainmentSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("inside-region"),
    entityId: entityIdSchema,
    regionId: entityIdSchema,
    marginM: finiteNumberSchema.min(0).max(10).default(0.05),
  })
  .strict();

const hardActorBlockingSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("actor-blocking"),
    plan: staticBlockingPlanSchema,
  })
  .strict();

const hardVisibilitySchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("visibility"),
    entityId: entityIdSchema,
    anchor: z.enum(["face", "head", "chest", "pelvis", "root"]).optional(),
    requiredPartIds: z
      .array(z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/))
      .max(24)
      .refine(uniqueIds, "Required actor-part ids must be unique.")
      .default([]),
    minVisibleRatio: finiteNumberSchema.min(0.01).max(1).default(0.5),
  })
  .strict();

const hardFramingSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("framing"),
    mode: compositionFramingModeSchema,
    targetEntityIds: z
      .array(entityIdSchema)
      .min(1)
      .max(16)
      .refine(uniqueIds, "Framing target ids must be unique."),
  })
  .strict();

const hardSafeAreaSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("safe-area"),
    captionBottomFraction: finiteNumberSchema.min(0.05).max(0.45).optional(),
    sideUi: z
      .object({
        side: z.enum(["left", "right", "both"]),
        widthFraction: finiteNumberSchema.min(0.05).max(0.4),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    ({ captionBottomFraction, sideUi }) =>
      captionBottomFraction !== undefined || sideUi !== undefined,
    { message: "A safe-area constraint must reserve at least one area." },
  );

const hardDepthOrderingSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("depth-ordering"),
    foregroundEntityId: entityIdSchema,
    backgroundEntityId: entityIdSchema,
    minimumDepthSeparationM: finiteNumberSchema.min(0).max(100).default(0.05),
  })
  .strict()
  .refine(
    ({ foregroundEntityId, backgroundEntityId }) =>
      foregroundEntityId !== backgroundEntityId,
    { message: "Depth ordering requires two different entities." },
  );

const hardCameraClearanceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("camera-clearance"),
    minimumEntityDistanceM: finiteNumberSchema.min(0).max(10).default(0.05),
  })
  .strict();

export const shotHardConstraintSchema = z.discriminatedUnion("kind", [
  hardSpatialRelationshipSchema,
  hardFacingRelationshipSchema,
  hardSurfacePlacementSchema,
  hardContainmentSchema,
  hardActorBlockingSchema,
  hardVisibilitySchema,
  hardFramingSchema,
  hardSafeAreaSchema,
  hardDepthOrderingSchema,
  hardCameraClearanceSchema,
]);

const cameraHeightPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("camera-height"),
    tendency: z.enum(["low", "eye-level", "high"]),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const viewAnglePreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("view-angle"),
    tendency: z.enum(["frontal", "three-quarter", "side", "rear"]),
    side: z.enum(["left", "right", "either"]).default("either"),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const screenPlacementPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("screen-placement"),
    entityId: entityIdSchema,
    horizontal: z.enum(["left", "center", "right"]),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const lensPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("lens"),
    tendency: z.enum(["mild-wide", "normal", "mild-telephoto"]),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const headroomPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("headroom"),
    tendency: z.enum(["tight", "balanced", "generous"]),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const lookRoomPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("look-room"),
    entityId: entityIdSchema,
    tendency: z.enum(["compact", "balanced", "generous"]),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const environmentPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("environment-context"),
    tendency: z.enum(["minimal", "balanced", "wide"]),
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

const faceReadabilityPreferenceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.literal("face-readability"),
    actorId: entityIdSchema,
    weight: finiteNumberSchema.min(0.1).max(10).default(1),
  })
  .strict();

export const shotSoftPreferenceSchema = z.discriminatedUnion("kind", [
  cameraHeightPreferenceSchema,
  viewAnglePreferenceSchema,
  screenPlacementPreferenceSchema,
  lensPreferenceSchema,
  headroomPreferenceSchema,
  lookRoomPreferenceSchema,
  environmentPreferenceSchema,
  faceReadabilityPreferenceSchema,
]);

export const shotIntentPlanSchema = z
  .object({
    schemaVersion: z.literal(SHOT_INTENT_SCHEMA_VERSION),
    planId: entityIdSchema,
    operation: z.enum(["create", "modify"]),
    cameraId: entityIdSchema,
    primaryTargetIds: z
      .array(entityIdSchema)
      .min(1)
      .max(8)
      .refine(uniqueIds, "Primary target ids must be unique."),
    hardConstraints: z.array(shotHardConstraintSchema).min(1).max(128),
    softPreferences: z.array(shotSoftPreferenceSchema).max(64).default([]),
    candidateCount: z.number().int().min(1).max(5).default(3),
  })
  .strict()
  .superRefine((plan, context) => {
    const goalIds = [
      ...plan.hardConstraints.map(({ id }) => id),
      ...plan.softPreferences.map(({ id }) => id),
    ];
    if (!uniqueIds(goalIds)) {
      context.addIssue({
        code: "custom",
        message: "Shot intent constraint and preference ids must be unique.",
        path: ["hardConstraints"],
      });
    }
    const blockingPlanIds = plan.hardConstraints
      .filter((goal) => goal.kind === "actor-blocking")
      .map(({ plan: blockingPlan }) => blockingPlan.planId);
    if (!uniqueIds(blockingPlanIds)) {
      context.addIssue({
        code: "custom",
        message: "Static blocking plan ids must be unique within one shot plan.",
        path: ["hardConstraints"],
      });
    }
  });

const shotIntentPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("hard-constraint.set"), value: shotHardConstraintSchema }).strict(),
  z.object({ op: z.literal("hard-constraint.remove"), constraintId: entityIdSchema }).strict(),
  z.object({ op: z.literal("soft-preference.set"), value: shotSoftPreferenceSchema }).strict(),
  z.object({ op: z.literal("soft-preference.remove"), preferenceId: entityIdSchema }).strict(),
]);

export const shotIntentPatchSchema = z
  .object({
    schemaVersion: z.literal(SHOT_INTENT_PATCH_SCHEMA_VERSION),
    patchId: entityIdSchema,
    solveId: entityIdSchema,
    baseGeneration: z.number().int().nonnegative(),
    operations: z.array(shotIntentPatchOperationSchema).min(1).max(64),
  })
  .strict();

export type ShotHardConstraint = z.infer<typeof shotHardConstraintSchema>;
export type ShotSoftPreference = z.infer<typeof shotSoftPreferenceSchema>;
export type ShotIntentPlan = z.infer<typeof shotIntentPlanSchema>;
export type ShotIntentPatch = z.infer<typeof shotIntentPatchSchema>;

export const applyShotIntentPatch = (
  planInput: ShotIntentPlan,
  patchInput: ShotIntentPatch,
): ShotIntentPlan => {
  const plan = shotIntentPlanSchema.parse(planInput);
  const patch = shotIntentPatchSchema.parse(patchInput);
  const hardConstraints = [...plan.hardConstraints];
  const softPreferences = [...plan.softPreferences];
  for (const operation of patch.operations) {
    if (operation.op === "hard-constraint.set") {
      const index = hardConstraints.findIndex(({ id }) => id === operation.value.id);
      if (index === -1) hardConstraints.push(operation.value);
      else hardConstraints[index] = operation.value;
    } else if (operation.op === "hard-constraint.remove") {
      const index = hardConstraints.findIndex(({ id }) => id === operation.constraintId);
      if (index !== -1) hardConstraints.splice(index, 1);
    } else if (operation.op === "soft-preference.set") {
      const index = softPreferences.findIndex(({ id }) => id === operation.value.id);
      if (index === -1) softPreferences.push(operation.value);
      else softPreferences[index] = operation.value;
    } else {
      const index = softPreferences.findIndex(({ id }) => id === operation.preferenceId);
      if (index !== -1) softPreferences.splice(index, 1);
    }
  }
  return shotIntentPlanSchema.parse({
    ...plan,
    operation: "modify",
    hardConstraints,
    softPreferences,
  });
};
