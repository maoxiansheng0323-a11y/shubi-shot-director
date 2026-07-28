import { z } from "zod";
import {
  ACTOR_LIMB_PART_IDS,
  type ActorLimbPartId,
} from "./actor-anatomy";
import { entityIdSchema } from "./shared-schemas";

export const INTENT_REPORT_SCHEMA_VERSION = 4 as const;

export const INTENT_CONSTRAINT_KINDS_V1 = [
  "environment",
  "entity-presence",
  "entity-removal",
  "actor-slot",
  "pose",
  "relationship",
  "contact",
  "position",
  "rotation",
  "scale",
  "visibility",
  "camera-height",
  "camera-angle",
  "camera-target",
  "focal-length",
  "framing",
  "output",
  "composition-safety",
] as const;

export const INTENT_CONSTRAINT_KINDS_V2 = [
  ...INTENT_CONSTRAINT_KINDS_V1,
  "spatial-region",
  "spatial-boundary",
  "spatial-opening",
  "spatial-connection",
  "entity-region-membership",
  "region-visibility",
] as const;

export const INTENT_CONSTRAINT_KINDS_V3 = [
  ...INTENT_CONSTRAINT_KINDS_V2,
  "lock-protection",
] as const;

export const INTENT_CONSTRAINT_KINDS_V4 = [
  ...INTENT_CONSTRAINT_KINDS_V3,
  "actor-limb-presence",
] as const;

export const INTENT_ISSUE_CODES_V1 = [
  "UNSUPPORTED_CONSTRAINT",
  "UNRESOLVED_RELATION",
  "UNAPPLIED_CONSTRAINT",
] as const;

export const INTENT_ISSUE_CODES_V2 = INTENT_ISSUE_CODES_V1;
export const INTENT_ISSUE_CODES_V3 = INTENT_ISSUE_CODES_V2;
export const INTENT_ISSUE_CODES_V4 = INTENT_ISSUE_CODES_V3;

export const INTENT_WARNING_CODES_V1 = [
  "PARTIAL_APPLICATION",
  "APPROXIMATE_PLACEMENT",
] as const;

export const INTENT_WARNING_CODES_V2 = INTENT_WARNING_CODES_V1;
export const INTENT_WARNING_CODES_V3 = INTENT_WARNING_CODES_V2;
export const INTENT_WARNING_CODES_V4 = INTENT_WARNING_CODES_V3;

export const ENTITY_EVIDENCE_PATHS_V1 = [
  "entity.kind",
  "entity.parentId",
  "entity.transform.positionM",
  "entity.transform.rotation",
  "entity.transform.scale",
  "entity.visible",
  "entity.locked",
  "actor.slot",
  "actor.pose",
  "camera.heightM",
  "camera.lens.focalLengthMm",
  "camera.lens.sensorWidthMm",
] as const;

export const ENTITY_EVIDENCE_PATHS_V2 = ENTITY_EVIDENCE_PATHS_V1;

export const ENTITY_EVIDENCE_PATHS_V3 = [
  "entity.kind",
  "entity.parentId",
  "entity.transform.positionM",
  "entity.transform.rotation",
  "entity.transform.scale",
  "entity.visible",
  "entity.lockMode",
  "actor.slot",
  "actor.pose",
  "camera.heightM",
  "camera.lens.focalLengthMm",
  "camera.lens.sensorWidthMm",
] as const;

export type ActorLimbEvidencePath =
  `entity.body.limbPresence.${ActorLimbPartId}`;

const actorLimbEvidencePath = (
  partId: ActorLimbPartId,
): ActorLimbEvidencePath =>
  `entity.body.limbPresence.${partId}`;

const [firstActorLimbPartId, ...remainingActorLimbPartIds] =
  ACTOR_LIMB_PART_IDS;

export const ACTOR_LIMB_EVIDENCE_PATHS: readonly [
  ActorLimbEvidencePath,
  ...ActorLimbEvidencePath[],
] = [
  actorLimbEvidencePath(firstActorLimbPartId),
  ...remainingActorLimbPartIds.map(
    (partId): ActorLimbEvidencePath =>
      actorLimbEvidencePath(partId),
  ),
];

export const ENTITY_EVIDENCE_PATHS_V4 = [
  ...ENTITY_EVIDENCE_PATHS_V3,
  ...ACTOR_LIMB_EVIDENCE_PATHS,
] as const;

export const SCENE_EVIDENCE_PATHS_V1 = [
  "scene.activeCameraId",
  "scene.output",
  "scene.compositionGoals",
  "scene.compositionGoals.framing",
  "scene.compositionGoals.captionZone",
  "scene.compositionGoals.sideUiZone",
  "scene.compositionGoals.criticalEntityIds",
] as const;

export const SCENE_EVIDENCE_PATHS_V2 = [
  ...SCENE_EVIDENCE_PATHS_V1,
  "scene.spatialLayout.regions",
  "scene.spatialLayout.boundaries",
  "scene.spatialLayout.openings",
  "scene.spatialLayout.connections",
  "scene.spatialLayout.memberships",
] as const;

export const SCENE_EVIDENCE_PATHS_V3 = SCENE_EVIDENCE_PATHS_V2;
export const SCENE_EVIDENCE_PATHS_V4 = SCENE_EVIDENCE_PATHS_V3;

const uniqueIds = (values: string[]): boolean =>
  new Set(values).size === values.length;

const genericIdArraySchema = z
  .array(entityIdSchema)
  .max(32)
  .refine(uniqueIds, "Generic ids must be unique.");

const intentEvidenceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("entity"),
      entityId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("entity-property"),
      entityId: entityIdSchema,
      path: z.enum(ENTITY_EVIDENCE_PATHS_V4),
    })
    .strict(),
  z
    .object({
      type: z.literal("scene-property"),
      path: z.enum(SCENE_EVIDENCE_PATHS_V4),
    })
    .strict(),
  z
    .object({
      type: z.literal("scene-constraint"),
      constraintId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("patch-operation"),
      operationIndex: z.number().int().nonnegative().max(255),
    })
    .strict(),
]);

const intentConstraintSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(INTENT_CONSTRAINT_KINDS_V4),
    required: z.boolean(),
    targets: genericIdArraySchema,
    evidence: z.array(intentEvidenceSchema).max(64),
  })
  .strict();

const intentIssueSchema = z
  .object({
    code: z.enum(INTENT_ISSUE_CODES_V4),
    targetIds: genericIdArraySchema.optional(),
  })
  .strict();

const intentWarningSchema = z
  .object({
    code: z.enum(INTENT_WARNING_CODES_V4),
    targetIds: genericIdArraySchema.optional(),
  })
  .strict();

export const intentReportSchema = z
  .object({
    schemaVersion: z.literal(INTENT_REPORT_SCHEMA_VERSION),
    operation: z.enum(["create", "modify"]),
    allowPartial: z.boolean(),
    recognizedConstraints: z.array(intentConstraintSchema).max(128),
    unsupportedConstraints: z.array(intentIssueSchema).max(128),
    unresolvedRelations: z.array(intentIssueSchema).max(128),
    warnings: z.array(intentWarningSchema).max(128),
    canApplySafely: z.boolean(),
  })
  .strict()
  .refine(
    (report) =>
      new Set(report.recognizedConstraints.map(({ id }) => id)).size ===
      report.recognizedConstraints.length,
    "Recognized constraint ids must be unique.",
  );

export type IntentEvidence = z.infer<typeof intentEvidenceSchema>;
export type IntentConstraint = z.infer<typeof intentConstraintSchema>;
export type IntentIssue = z.infer<typeof intentIssueSchema>;
export type IntentWarning = z.infer<typeof intentWarningSchema>;
export type IntentReport = z.infer<typeof intentReportSchema>;
