import { z } from "zod";
import { createAllPresentLimbPresence } from "./actor-anatomy";
import {
  entityLockModeSchema,
  legacyLockedToMode,
  type EntityLockMode,
} from "./entity-lock";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "./schema-versions";
import {
  ENTITY_EVIDENCE_PATHS_V1,
  ENTITY_EVIDENCE_PATHS_V2,
  ENTITY_EVIDENCE_PATHS_V3,
  ENTITY_EVIDENCE_PATHS_V4,
  INTENT_CONSTRAINT_KINDS_V1,
  INTENT_CONSTRAINT_KINDS_V2,
  INTENT_CONSTRAINT_KINDS_V3,
  INTENT_CONSTRAINT_KINDS_V4,
  INTENT_REPORT_SCHEMA_VERSION,
  SCENE_EVIDENCE_PATHS_V1,
  SCENE_EVIDENCE_PATHS_V2,
  SCENE_EVIDENCE_PATHS_V3,
  SCENE_EVIDENCE_PATHS_V4,
  intentReportSchema,
  type IntentReport,
} from "./intent-report";
import {
  scenePatchSchema,
  type ScenePatch,
} from "./scene-patch";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "./scene-schema";

const plainRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const validateLegacyActorBody = (
  entity: Record<string, unknown>,
  context: z.RefinementCtx,
): void => {
  const body = plainRecord(entity.body);
  if (
    entity.kind === "actor" &&
    body !== undefined &&
    "limbPresence" in body
  ) {
    context.addIssue({
      code: "custom",
      message: "Legacy actor bodies cannot contain limbPresence.",
      path: ["body", "limbPresence"],
    });
  }
};

const addAllPresentActorAnatomy = (
  entity: Record<string, unknown>,
): Record<string, unknown> => {
  if (entity.kind !== "actor") return { ...entity };
  const body = plainRecord(entity.body);
  return {
    ...entity,
    body: {
      ...body,
      limbPresence: createAllPresentLimbPresence(),
    },
  };
};

const legacySceneEntityEnvelopeSchema = z
  .object({
    locked: z.boolean(),
  })
  .passthrough()
  .superRefine((entity, context) => {
    if ("lockMode" in entity) {
      context.addIssue({
        code: "custom",
        message: "Legacy scene entities cannot contain lockMode.",
        path: ["lockMode"],
      });
    }
    validateLegacyActorBody(entity, context);
  });

type LegacySceneEntity = z.infer<typeof legacySceneEntityEnvelopeSchema>;

const migrateLegacyEntity = (
  entity: LegacySceneEntity,
): Record<string, unknown> & { lockMode: EntityLockMode } => {
  const canonicalEntity: Record<string, unknown> = { ...entity };
  delete canonicalEntity.locked;
  return addAllPresentActorAnatomy({
    ...canonicalEntity,
    lockMode: legacyLockedToMode(entity.locked),
  }) as Record<string, unknown> & { lockMode: EntityLockMode };
};

const legacySceneEntityV3EnvelopeSchema = z
  .object({
    lockMode: entityLockModeSchema,
  })
  .passthrough()
  .superRefine((entity, context) => {
    if ("locked" in entity) {
      context.addIssue({
        code: "custom",
        message: "SceneSpec v3 entities cannot contain locked.",
        path: ["locked"],
      });
    }
    validateLegacyActorBody(entity, context);
  });

const legacySceneSpecV1EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    spatialLayout: z.never().optional(),
    entities: z.array(legacySceneEntityEnvelopeSchema),
  })
  .passthrough();

const legacySceneSpecV2EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    entities: z.array(legacySceneEntityEnvelopeSchema),
  })
  .passthrough();

const legacySceneSpecV3EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(3),
    entities: z.array(legacySceneEntityV3EnvelopeSchema),
  })
  .passthrough();

const legacySceneEntityV4EnvelopeSchema = z
  .object({
    lockMode: entityLockModeSchema,
  })
  .passthrough()
  .superRefine((entity, context) => {
    if ("locked" in entity) {
      context.addIssue({
        code: "custom",
        message: "SceneSpec v4 entities cannot contain locked.",
        path: ["locked"],
      });
    }
    if (entity.kind === "actor" && "blueprintInstance" in entity) {
      context.addIssue({
        code: "custom",
        message: "SceneSpec v4 cannot contain blueprint actors.",
        path: ["blueprintInstance"],
      });
    }
  });

const legacySceneSpecV4EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(4),
    actorBlueprints: z.never().optional(),
    entities: z.array(legacySceneEntityV4EnvelopeSchema),
  })
  .passthrough();

const legacyScenePatchOperationSchema = z
  .object({
    op: z.string(),
  })
  .passthrough();

const legacyScenePatchEnvelopeShape = {
  operations: z.array(legacyScenePatchOperationSchema).min(1).max(128),
};

const legacyScenePatchV3EnvelopeShape = {
  operations: z.array(legacyScenePatchOperationSchema).min(1).max(256),
};

const validateLegacyPatchLockShape = (
  patch: {
    operations: Array<{ op: string } & Record<string, unknown>>;
  } & Record<string, unknown>,
  context: z.RefinementCtx,
): void => {
  if ("preserveLock" in patch) {
    context.addIssue({
      code: "custom",
      message: "Legacy scene patches cannot contain preserveLock.",
      path: ["preserveLock"],
    });
  }

  for (const [operationIndex, operation] of patch.operations.entries()) {
    if (operation.op === "entity.flags.set") {
      for (const field of ["visible", "locked"] as const) {
        if (typeof operation[field] === "boolean") {
          continue;
        }
        context.addIssue({
          code: "custom",
          message: `Legacy entity flags operation requires boolean ${field}.`,
          path: ["operations", operationIndex, field],
        });
      }
      if ("lockMode" in operation) {
        context.addIssue({
          code: "custom",
          message: "Legacy entity flags operations cannot contain lockMode.",
          path: ["operations", operationIndex, "lockMode"],
        });
      }
    }

    if (operation.op === "entity.add") {
      const result = legacySceneEntityEnvelopeSchema.safeParse(
        operation.value,
      );
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({
            ...issue,
            path: ["operations", operationIndex, "value", ...issue.path],
          });
        }
      }
    }
  }
};

const legacyScenePatchV1EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...legacyScenePatchEnvelopeShape,
  })
  .passthrough()
  .superRefine((patch, context) => {
    validateLegacyPatchLockShape(patch, context);
    for (const [operationIndex, operation] of patch.operations.entries()) {
      if (operation.op.startsWith("spatial.")) {
        context.addIssue({
          code: "custom",
          message: "ScenePatch v1 cannot contain spatial operations.",
          path: ["operations", operationIndex, "op"],
        });
      }
    }
  });

const legacyScenePatchV2EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    ...legacyScenePatchEnvelopeShape,
  })
  .passthrough()
  .superRefine(validateLegacyPatchLockShape);

const legacyScenePatchV3EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(3),
    preserveLock: z.boolean(),
    ...legacyScenePatchV3EnvelopeShape,
  })
  .passthrough()
  .superRefine((patch, context) => {
    for (const [operationIndex, operation] of patch.operations.entries()) {
      if (operation.op === "actor.limb-presence.set") {
        context.addIssue({
          code: "custom",
          message: "ScenePatch v3 cannot contain actor limb presence operations.",
          path: ["operations", operationIndex, "op"],
        });
      }
      if (operation.op === "entity.flags.set" && "locked" in operation) {
        context.addIssue({
          code: "custom",
          message: "ScenePatch v3 entity flags cannot contain locked.",
          path: ["operations", operationIndex, "locked"],
        });
      }
      if (operation.op === "entity.add") {
        const result = legacySceneEntityV3EnvelopeSchema.safeParse(
          operation.value,
        );
        if (!result.success) {
          for (const issue of result.error.issues) {
            context.addIssue({
              ...issue,
              path: ["operations", operationIndex, "value", ...issue.path],
            });
          }
        }
      }
    }
  });

const legacyScenePatchV4EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(4),
    preserveLock: z.boolean(),
    ...legacyScenePatchV3EnvelopeShape,
  })
  .passthrough()
  .superRefine((patch, context) => {
    for (const [operationIndex, operation] of patch.operations.entries()) {
      if (
        operation.op === "actor.blueprint.register" ||
        operation.op === "actor.variant.set"
      ) {
        context.addIssue({
          code: "custom",
          message: "ScenePatch v4 cannot contain Actor Blueprint operations.",
          path: ["operations", operationIndex, "op"],
        });
      }
      if (
        operation.op === "entity.add" &&
        plainRecord(operation.value)?.blueprintInstance !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "ScenePatch v4 cannot add blueprint actors.",
          path: ["operations", operationIndex, "value", "blueprintInstance"],
        });
      }
    }
  });

const legacyIntentEvidenceV1Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity") }).passthrough(),
  z
    .object({
      type: z.literal("entity-property"),
      path: z.enum(ENTITY_EVIDENCE_PATHS_V1),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("scene-property"),
      path: z.enum(SCENE_EVIDENCE_PATHS_V1),
    })
    .passthrough(),
  z.object({ type: z.literal("scene-constraint") }).passthrough(),
  z
    .object({
      type: z.literal("patch-operation"),
      operationIndex: z.number().int().nonnegative().max(127),
    })
    .passthrough(),
]);

const legacyIntentEvidenceV2Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity") }).passthrough(),
  z
    .object({
      type: z.literal("entity-property"),
      path: z.enum(ENTITY_EVIDENCE_PATHS_V2),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("scene-property"),
      path: z.enum(SCENE_EVIDENCE_PATHS_V2),
    })
    .passthrough(),
  z.object({ type: z.literal("scene-constraint") }).passthrough(),
  z
    .object({
      type: z.literal("patch-operation"),
      operationIndex: z.number().int().nonnegative().max(127),
    })
    .passthrough(),
]);

const legacyIntentEvidenceV3Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity") }).passthrough(),
  z
    .object({
      type: z.literal("entity-property"),
      path: z.enum(ENTITY_EVIDENCE_PATHS_V3),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("scene-property"),
      path: z.enum(SCENE_EVIDENCE_PATHS_V3),
    })
    .passthrough(),
  z.object({ type: z.literal("scene-constraint") }).passthrough(),
  z
    .object({
      type: z.literal("patch-operation"),
      operationIndex: z.number().int().nonnegative().max(255),
    })
    .passthrough(),
]);

const legacyIntentEvidenceV4Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity") }).passthrough(),
  z
    .object({
      type: z.literal("entity-property"),
      path: z.enum(ENTITY_EVIDENCE_PATHS_V4),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("scene-property"),
      path: z.enum(SCENE_EVIDENCE_PATHS_V4),
    })
    .passthrough(),
  z.object({ type: z.literal("scene-constraint") }).passthrough(),
  z
    .object({
      type: z.literal("patch-operation"),
      operationIndex: z.number().int().nonnegative().max(255),
    })
    .passthrough(),
]);

const legacyIntentReportV1EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    recognizedConstraints: z.array(
      z
        .object({
          kind: z.enum(INTENT_CONSTRAINT_KINDS_V1),
          evidence: z.array(legacyIntentEvidenceV1Schema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const legacyIntentReportV2EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    recognizedConstraints: z.array(
      z
        .object({
          kind: z.enum(INTENT_CONSTRAINT_KINDS_V2),
          evidence: z.array(legacyIntentEvidenceV2Schema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const legacyIntentReportV3EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(3),
    recognizedConstraints: z.array(
      z
        .object({
          kind: z.enum(INTENT_CONSTRAINT_KINDS_V3),
          evidence: z.array(legacyIntentEvidenceV3Schema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const legacyIntentReportV4EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(4),
    recognizedConstraints: z.array(
      z
        .object({
          kind: z.enum(INTENT_CONSTRAINT_KINDS_V4),
          evidence: z.array(legacyIntentEvidenceV4Schema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const migrateLegacyIntentEvidence = (
  evidence:
    | z.infer<typeof legacyIntentEvidenceV1Schema>
    | z.infer<typeof legacyIntentEvidenceV2Schema>,
): Record<string, unknown> =>
  evidence.type === "entity-property" && evidence.path === "entity.locked"
    ? { ...evidence, path: "entity.lockMode" }
    : evidence;

export const parseSceneSpecInput = (input: unknown): SceneSpec => {
  const current = sceneSpecSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const v4 = legacySceneSpecV4EnvelopeSchema.safeParse(input);
  if (v4.success) {
    return sceneSpecSchema.parse({
      ...v4.data,
      schemaVersion: SCENE_SCHEMA_VERSION,
      actorBlueprints: [],
    });
  }

  const v1 = legacySceneSpecV1EnvelopeSchema.safeParse(input);
  if (v1.success) {
    return sceneSpecSchema.parse({
      ...v1.data,
      schemaVersion: SCENE_SCHEMA_VERSION,
      spatialLayout: null,
      actorBlueprints: [],
      entities: v1.data.entities.map(migrateLegacyEntity),
    });
  }

  const v2 = legacySceneSpecV2EnvelopeSchema.safeParse(input);
  if (v2.success) {
    return sceneSpecSchema.parse({
      ...v2.data,
      schemaVersion: SCENE_SCHEMA_VERSION,
      actorBlueprints: [],
      entities: v2.data.entities.map(migrateLegacyEntity),
    });
  }

  const v3 = legacySceneSpecV3EnvelopeSchema.parse(input);
  return sceneSpecSchema.parse({
    ...v3,
    schemaVersion: SCENE_SCHEMA_VERSION,
    actorBlueprints: [],
    entities: v3.entities.map((entity) =>
      addAllPresentActorAnatomy(entity),
    ),
  });
};

export const parseScenePatchInput = (input: unknown): ScenePatch => {
  const current = scenePatchSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const migrateV1OrV2 = (
    legacy:
      | z.infer<typeof legacyScenePatchV1EnvelopeSchema>
      | z.infer<typeof legacyScenePatchV2EnvelopeSchema>,
  ): ScenePatch =>
    scenePatchSchema.parse({
      ...legacy,
      schemaVersion: PATCH_SCHEMA_VERSION,
      preserveLock: false,
      operations: legacy.operations.map((operation) => {
      if (operation.op === "entity.add") {
        return {
          ...operation,
          value: migrateLegacyEntity(
            legacySceneEntityEnvelopeSchema.parse(operation.value),
          ),
        };
      }
      if (operation.op !== "entity.flags.set") {
        return operation;
      }

      const { locked, ...canonicalOperation } = operation;
      return {
        ...canonicalOperation,
        lockMode:
          typeof locked === "boolean"
            ? legacyLockedToMode(locked)
            : locked,
      };
      }),
    });

  const v1 = legacyScenePatchV1EnvelopeSchema.safeParse(input);
  if (v1.success) return migrateV1OrV2(v1.data);
  const v2 = legacyScenePatchV2EnvelopeSchema.safeParse(input);
  if (v2.success) return migrateV1OrV2(v2.data);

  const v3 = legacyScenePatchV3EnvelopeSchema.safeParse(input);
  if (v3.success) {
    return scenePatchSchema.parse({
      ...v3.data,
      schemaVersion: PATCH_SCHEMA_VERSION,
      operations: v3.data.operations.map((operation) =>
        operation.op === "entity.add"
          ? {
              ...operation,
              value: addAllPresentActorAnatomy(
                legacySceneEntityV3EnvelopeSchema.parse(operation.value),
              ),
            }
          : operation,
      ),
    });
  }

  const v4 = legacyScenePatchV4EnvelopeSchema.parse(input);
  return scenePatchSchema.parse({
    ...v4,
    schemaVersion: PATCH_SCHEMA_VERSION,
  });
};

export const parseIntentReportInput = (input: unknown): IntentReport => {
  const current = intentReportSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const migrateV1OrV2 = (
    legacy:
      | z.infer<typeof legacyIntentReportV1EnvelopeSchema>
      | z.infer<typeof legacyIntentReportV2EnvelopeSchema>,
  ): IntentReport =>
    intentReportSchema.parse({
      ...legacy,
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
      recognizedConstraints: legacy.recognizedConstraints.map(
        (constraint) => ({
          ...constraint,
          evidence: constraint.evidence.map(migrateLegacyIntentEvidence),
        }),
      ),
    });

  const v1 = legacyIntentReportV1EnvelopeSchema.safeParse(input);
  if (v1.success) return migrateV1OrV2(v1.data);
  const v2 = legacyIntentReportV2EnvelopeSchema.safeParse(input);
  if (v2.success) return migrateV1OrV2(v2.data);

  const v3 = legacyIntentReportV3EnvelopeSchema.safeParse(input);
  if (v3.success) {
    return intentReportSchema.parse({
      ...v3.data,
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
    });
  }

  const v4 = legacyIntentReportV4EnvelopeSchema.parse(input);
  return intentReportSchema.parse({
    ...v4,
    schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
  });
};
