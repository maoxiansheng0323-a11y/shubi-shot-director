import { z } from "zod";
import {
  ACTOR_LIMB_CHAINS,
  ACTOR_LIMB_PART_IDS,
  actorLimbPresenceModeSchema,
  actorLimbPresenceSchema,
  resolveActorLimbPresenceUpdates,
  type ActorLimbPartId,
  type ActorLimbPresence,
  type ActorLimbPresenceUpdates,
} from "./actor-anatomy";
import { canonicalJsonSha256 } from "./canonical-json-sha256";

export const ACTOR_BLUEPRINT_SCHEMA_VERSION = 1 as const;
export const ACTOR_BLUEPRINT_MAX_MODULES = 64;
export const ACTOR_BLUEPRINT_MAX_PARTS_PER_MODULE = 32;
export const ACTOR_BLUEPRINT_MAX_VARIANTS = 32;
export const ACTOR_BLUEPRINT_MAX_SCENE_SNAPSHOTS = 64;
export const ACTOR_BLUEPRINT_MAX_INPUT_BYTES = 1024 * 1024;

export const ACTOR_BLUEPRINT_MOUNT_IDS = [
  "shoulder_l",
  "shoulder_r",
  "elbow_l",
  "elbow_r",
  "wrist_l",
  "wrist_r",
  "hip_l",
  "hip_r",
  "knee_l",
  "knee_r",
] as const;

export const ACTOR_BLUEPRINT_PRIMITIVES = [
  "box",
  "sphere",
  "cylinder",
] as const;

export const ACTOR_BLUEPRINT_ERROR_CODES = {
  fileInvalid: "ACTOR_BLUEPRINT_FILE_INVALID",
  variantInvalid: "ACTOR_BLUEPRINT_VARIANT_INVALID",
  hashMismatch: "ACTOR_BLUEPRINT_HASH_MISMATCH",
} as const;

export type ActorBlueprintErrorCode =
  (typeof ACTOR_BLUEPRINT_ERROR_CODES)[keyof typeof ACTOR_BLUEPRINT_ERROR_CODES];

export class ActorBlueprintError extends Error {
  constructor(readonly code: ActorBlueprintErrorCode) {
    super(code);
    this.name = "ActorBlueprintError";
  }
}

const finiteRange = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum);

const rangedVec3 = (minimum: number, maximum: number) =>
  z.tuple([
    finiteRange(minimum, maximum),
    finiteRange(minimum, maximum),
    finiteRange(minimum, maximum),
  ]);

const positiveScaleSchema = rangedVec3(0.01, 100);
const modulePositionSchema = rangedVec3(-10, 10);
const moduleQuaternionSchema = z
  .tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ])
  .refine(
    ([x, y, z, w]) =>
      Math.abs(Math.sqrt(x * x + y * y + z * z + w * w) - 1) < 0.001,
    ACTOR_BLUEPRINT_ERROR_CODES.fileInvalid,
  );

const localTransformSchema = z
  .object({
    positionM: modulePositionSchema,
    rotation: moduleQuaternionSchema,
    scale: positiveScaleSchema,
  })
  .strict();

export const actorBlueprintIdSchema = z
  .string()
  .max(48)
  .regex(/^actor_blueprint_[1-9][0-9]*$/);

export const actorBlueprintSlugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]{0,39}$/);

export const actorBlueprintMountIdSchema = z.enum(ACTOR_BLUEPRINT_MOUNT_IDS);

const actorBlueprintBodySchema = z
  .object({
    heightM: finiteRange(1, 2.4),
    shoulderWidthM: finiteRange(0.25, 0.8),
    build: z.enum(["slim", "average", "broad"]),
  })
  .strict();

const actorBlueprintProportionsSchema = z
  .object({
    torsoLengthHeightRatio: finiteRange(0.2, 0.45),
    torsoDepthHeightRatio: finiteRange(0.06, 0.2),
    pelvisWidthShoulderRatio: finiteRange(0.5, 1),
    pelvisHeightHeightRatio: finiteRange(0.06, 0.2),
    headRadiusHeightRatio: finiteRange(0.05, 0.12),
    upperArmLengthHeightRatio: finiteRange(0.12, 0.3),
    forearmLengthHeightRatio: finiteRange(0.1, 0.27),
    upperLegLengthHeightRatio: finiteRange(0.18, 0.35),
    lowerLegLengthHeightRatio: finiteRange(0.16, 0.33),
    handSizeHeightRatios: rangedVec3(0.015, 0.15),
    handOffsetHeightRatios: rangedVec3(-0.15, 0.15),
    footSizeHeightRatios: rangedVec3(0.02, 0.25),
    footOffsetHeightRatios: rangedVec3(-0.2, 0.2),
    torsoRadiusShoulderRatio: finiteRange(0.15, 0.5),
    armRadiusHeightRatio: finiteRange(0.015, 0.08),
    legRadiusHeightRatio: finiteRange(0.02, 0.1),
  })
  .strict();

const actorBlueprintSkeletonSchema = z
  .object({
    spineOriginHeightRatio: finiteRange(-0.05, 0.1),
    headOriginAboveTorsoHeightRatio: finiteRange(0.01, 0.12),
    shoulderOffsetShoulderRatio: finiteRange(0.35, 0.75),
    shoulderOriginTorsoRatio: finiteRange(0.5, 1),
    hipOffsetPelvisRatio: finiteRange(0.15, 0.5),
    hipOriginHeightRatio: finiteRange(-0.1, 0.05),
  })
  .strict();

const actorBlueprintModulePartSchema = z.discriminatedUnion("primitive", [
  z
    .object({
      partId: actorBlueprintSlugSchema,
      primitive: z.literal("box"),
      transform: localTransformSchema,
      sizeM: rangedVec3(0.001, 5),
    })
    .strict(),
  z
    .object({
      partId: actorBlueprintSlugSchema,
      primitive: z.literal("sphere"),
      transform: localTransformSchema,
      radiusM: finiteRange(0.001, 2),
    })
    .strict(),
  z
    .object({
      partId: actorBlueprintSlugSchema,
      primitive: z.literal("cylinder"),
      transform: localTransformSchema,
      radiusM: finiteRange(0.001, 2),
      lengthM: finiteRange(0.001, 5),
    })
    .strict(),
]);

const actorBlueprintModuleSchema = z
  .object({
    moduleId: actorBlueprintSlugSchema,
    mount: actorBlueprintMountIdSchema,
    visible: z.boolean(),
    parts: z
      .array(actorBlueprintModulePartSchema)
      .min(1)
      .max(ACTOR_BLUEPRINT_MAX_PARTS_PER_MODULE),
  })
  .strict();

const actorLimbPresenceDeltaSchema = z
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
  .strict();

const actorBlueprintVariantSchema = z
  .object({
    variantId: actorBlueprintSlugSchema,
    limbPresence: actorLimbPresenceDeltaSchema,
    moduleVisibility: z.record(actorBlueprintSlugSchema, z.boolean()),
  })
  .strict();

const actorBlueprintDocumentShape = {
  schemaVersion: z.literal(ACTOR_BLUEPRINT_SCHEMA_VERSION),
  blueprintId: actorBlueprintIdSchema,
  blueprintVersion: z.number().int().min(1).max(2_147_483_647),
  body: actorBlueprintBodySchema,
  proportions: actorBlueprintProportionsSchema,
  skeleton: actorBlueprintSkeletonSchema,
  limbPresence: actorLimbPresenceSchema,
  modules: z
    .array(actorBlueprintModuleSchema)
    .max(ACTOR_BLUEPRINT_MAX_MODULES),
  variants: z
    .array(actorBlueprintVariantSchema)
    .min(1)
    .max(ACTOR_BLUEPRINT_MAX_VARIANTS),
} as const;

type ActorBlueprintDocumentShape = z.infer<
  z.ZodObject<typeof actorBlueprintDocumentShape>
>;

const limbChains = Object.values(ACTOR_LIMB_CHAINS);

const resolveLimbPresence = (
  base: ActorLimbPresence,
  delta: Partial<ActorLimbPresence>,
): ActorLimbPresence => {
  const effective: ActorLimbPresence = { ...base, ...delta };

  for (const chain of limbChains) {
    for (const [partIndex, partId] of chain.entries()) {
      if (delta[partId] !== "present") continue;
      for (let ancestorIndex = 0; ancestorIndex < partIndex; ancestorIndex += 1) {
        if (effective[chain[ancestorIndex]] === "absent") {
          throw new ActorBlueprintError(
            ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid,
          );
        }
      }
    }
  }

  for (const chain of limbChains) {
    for (const [partIndex, partId] of chain.entries()) {
      if (delta[partId] !== "absent") continue;
      for (let index = partIndex; index < chain.length; index += 1) {
        effective[chain[index]] = "absent";
      }
    }
  }

  const parsed = actorLimbPresenceSchema.safeParse(effective);
  if (!parsed.success) {
    throw new ActorBlueprintError(ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid);
  }
  return parsed.data;
};

const addIssue = (
  context: z.RefinementCtx,
  code: ActorBlueprintErrorCode,
  path: PropertyKey[] = [],
) => {
  context.addIssue({
    code: "custom",
    message: code,
    path,
  });
};

const validateDocumentSemantics = (
  document: ActorBlueprintDocumentShape,
  context: z.RefinementCtx,
) => {
  const moduleIds = new Set<string>();
  document.modules.forEach((module, moduleIndex) => {
    if (moduleIds.has(module.moduleId)) {
      addIssue(context, ACTOR_BLUEPRINT_ERROR_CODES.fileInvalid, [
        "modules",
        moduleIndex,
        "moduleId",
      ]);
    }
    moduleIds.add(module.moduleId);

    const partIds = new Set<string>();
    module.parts.forEach((part, partIndex) => {
      if (partIds.has(part.partId)) {
        addIssue(context, ACTOR_BLUEPRINT_ERROR_CODES.fileInvalid, [
          "modules",
          moduleIndex,
          "parts",
          partIndex,
          "partId",
        ]);
      }
      partIds.add(part.partId);
    });
  });

  const variantIds = new Set<string>();
  document.variants.forEach((variant, variantIndex) => {
    if (variantIds.has(variant.variantId)) {
      addIssue(context, ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid, [
        "variants",
        variantIndex,
        "variantId",
      ]);
    }
    variantIds.add(variant.variantId);

    for (const moduleId of Object.keys(variant.moduleVisibility)) {
      if (!moduleIds.has(moduleId)) {
        addIssue(context, ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid, [
          "variants",
          variantIndex,
          "moduleVisibility",
          moduleId,
        ]);
      }
    }

    try {
      resolveLimbPresence(document.limbPresence, variant.limbPresence);
    } catch {
      addIssue(context, ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid, [
        "variants",
        variantIndex,
        "limbPresence",
      ]);
    }
  });
};

export const actorBlueprintDocumentSchema = z
  .object(actorBlueprintDocumentShape)
  .strict()
  .superRefine(validateDocumentSemantics);

export type ActorBlueprintDocument = z.infer<
  typeof actorBlueprintDocumentSchema
>;

const hashableBlueprintContent = (
  document: ActorBlueprintDocument | ActorBlueprintSnapshot,
) => ({
  schemaVersion: document.schemaVersion,
  blueprintVersion: document.blueprintVersion,
  body: document.body,
  proportions: document.proportions,
  skeleton: document.skeleton,
  limbPresence: document.limbPresence,
  modules: document.modules,
  variants: document.variants,
});

const actorBlueprintSnapshotShape = {
  ...actorBlueprintDocumentShape,
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
} as const;

export const actorBlueprintSnapshotStructureSchema = z
  .object(actorBlueprintSnapshotShape)
  .strict()
  .superRefine(validateDocumentSemantics);

export const actorBlueprintSnapshotSchema =
  actorBlueprintSnapshotStructureSchema
  .superRefine((snapshot, context) => {
    if (
      canonicalJsonSha256(hashableBlueprintContent(snapshot)) !==
      snapshot.contentSha256
    ) {
      addIssue(context, ACTOR_BLUEPRINT_ERROR_CODES.hashMismatch, [
        "contentSha256",
      ]);
    }
  });

export type ActorBlueprintSnapshot = z.infer<
  typeof actorBlueprintSnapshotSchema
>;

export interface ResolvedActorBlueprintVariant {
  limbPresence: ActorLimbPresence;
  moduleVisibility: Record<string, boolean>;
}

export const createActorBlueprintSnapshot = (
  input: ActorBlueprintDocument,
): ActorBlueprintSnapshot => {
  const document = actorBlueprintDocumentSchema.parse(input);
  return actorBlueprintSnapshotSchema.parse({
    ...document,
    contentSha256: canonicalJsonSha256(hashableBlueprintContent(document)),
  });
};

export const resolveActorBlueprintVariant = (
  snapshotInput: ActorBlueprintSnapshot,
  variantId: string,
): ResolvedActorBlueprintVariant => {
  const snapshot = actorBlueprintSnapshotSchema.parse(snapshotInput);
  const variant = snapshot.variants.find(
    (candidate) => candidate.variantId === variantId,
  );
  if (!variant) {
    throw new ActorBlueprintError(ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid);
  }

  return {
    limbPresence: resolveLimbPresence(
      snapshot.limbPresence,
      variant.limbPresence,
    ),
    moduleVisibility: Object.fromEntries(
      snapshot.modules.map((module) => [
        module.moduleId,
        variant.moduleVisibility[module.moduleId] ?? module.visible,
      ]),
    ),
  };
};

export const resolveActorBlueprintInstance = (
  snapshot: ActorBlueprintSnapshot,
  variantId: string,
  overrides: ActorLimbPresenceUpdates,
): ResolvedActorBlueprintVariant => {
  const variant = resolveActorBlueprintVariant(snapshot, variantId);
  return {
    ...variant,
    limbPresence: resolveActorLimbPresenceUpdates(
      variant.limbPresence,
      overrides,
    ),
  };
};

export const actorBlueprintLimbPresenceOverrides = (
  variantBase: ActorLimbPresence,
  desired: ActorLimbPresence,
): ActorLimbPresenceUpdates => {
  const overrides: ActorLimbPresenceUpdates = {};
  for (const partId of ACTOR_LIMB_PART_IDS) {
    if (desired[partId] !== variantBase[partId]) {
      overrides[partId] = desired[partId];
    }
  }
  return overrides;
};

export type ActorBlueprintModule = ActorBlueprintDocument["modules"][number];
export type ActorBlueprintModulePart = ActorBlueprintModule["parts"][number];
export type ActorBlueprintVariant = ActorBlueprintDocument["variants"][number];
export type ActorBlueprintMountId =
  (typeof ACTOR_BLUEPRINT_MOUNT_IDS)[number];
export type ActorBlueprintPrimitive =
  (typeof ACTOR_BLUEPRINT_PRIMITIVES)[number];
export type ActorBlueprintLimbDelta = Partial<
  Record<ActorLimbPartId, "present" | "absent">
>;
