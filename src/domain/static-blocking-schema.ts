import { z } from "zod";
import { entityIdSchema, finiteNumberSchema } from "./schema-primitives";

export const STATIC_BLOCKING_SCHEMA_VERSION = 1 as const;
export const BODY_CONTACT_TOLERANCE_M = 0.012;

export const actorBodySiteIds = [
  "pelvis",
  "upper-back",
  "chest",
  "head",
  "hand-l",
  "hand-r",
  "knee-l",
  "knee-r",
  "foot-l",
  "foot-r",
] as const;
export const actorBodySiteSchema = z.enum(actorBodySiteIds);
export type ActorBodySite = z.infer<typeof actorBodySiteSchema>;

export const contactSurfaceFaceIds = [
  "top",
  "bottom",
  "left",
  "right",
  "front",
  "back",
] as const;
export const contactSurfaceFaceSchema = z.enum(contactSurfaceFaceIds);
export type ContactSurfaceFace = z.infer<typeof contactSurfaceFaceSchema>;

export const relaxedLimbIds = ["arm-l", "arm-r"] as const;
export const relaxedLimbSchema = z.enum(relaxedLimbIds);
export type RelaxedLimb = z.infer<typeof relaxedLimbSchema>;

export const blockingContactSchema = z
  .object({
    constraintId: entityIdSchema,
    bodySite: actorBodySiteSchema,
    surfaceEntityId: entityIdSchema.nullable(),
    surfaceFace: contactSurfaceFaceSchema,
    role: z.enum(["contact", "support"]),
  })
  .strict()
  .refine(
    (contact) =>
      contact.surfaceEntityId !== null || contact.surfaceFace === "top",
    "Implicit world ground only exposes its top surface.",
  );

export const blockingRelaxedLimbSchema = z
  .object({
    constraintId: entityIdSchema,
    limb: relaxedLimbSchema,
    restSurface: z
      .object({
        surfaceEntityId: entityIdSchema.nullable(),
        surfaceFace: contactSurfaceFaceSchema,
      })
      .strict()
      .refine(
        (surface) =>
          surface.surfaceEntityId !== null || surface.surfaceFace === "top",
        "Implicit world ground only exposes its top surface.",
      )
      .optional(),
  })
  .strict();

export const staticBlockingPlanSchema = z
  .object({
    schemaVersion: z.literal(STATIC_BLOCKING_SCHEMA_VERSION),
    planId: entityIdSchema,
    actorId: entityIdSchema,
    seedPose: z
      .object({
        registry: z.literal("builtin"),
        id: z.string().min(3).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
        version: z.literal(1),
      })
      .strict()
      .optional(),
    trunk: z
      .object({
        lean: z
          .object({
            direction: z.enum(["forward", "backward"]),
            angleDeg: finiteNumberSchema.min(0).max(100),
          })
          .strict()
          .optional(),
        sideBendDeg: finiteNumberSchema.min(-60).max(60).optional(),
        twistDeg: finiteNumberSchema.min(-75).max(75).optional(),
      })
      .strict()
      .refine(
        (trunk) =>
          trunk.lean !== undefined ||
          trunk.sideBendDeg !== undefined ||
          trunk.twistDeg !== undefined,
        "A trunk goal must configure at least one axis.",
      )
      .optional(),
    legPosture: z.literal("bent-resting").optional(),
    contacts: z.array(blockingContactSchema).max(8).default([]),
    relaxedLimbs: z.array(blockingRelaxedLimbSchema).max(2).default([]),
  })
  .strict()
  .superRefine((plan, context) => {
    const constraintIds = [
      ...plan.contacts.map(({ constraintId }) => constraintId),
      ...plan.relaxedLimbs.map(({ constraintId }) => constraintId),
    ];
    if (new Set(constraintIds).size !== constraintIds.length) {
      context.addIssue({
        code: "custom",
        message: "Static blocking constraint IDs must be unique.",
        path: ["contacts"],
      });
    }
    if (
      new Set(plan.contacts.map(({ bodySite }) => bodySite)).size !==
      plan.contacts.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A blocking plan cannot target one body site twice.",
        path: ["contacts"],
      });
    }
    if (
      new Set(plan.relaxedLimbs.map(({ limb }) => limb)).size !==
      plan.relaxedLimbs.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A blocking plan cannot relax one limb twice.",
        path: ["relaxedLimbs"],
      });
    }
    if (
      plan.seedPose === undefined &&
      plan.trunk === undefined &&
      plan.legPosture === undefined &&
      plan.contacts.length === 0 &&
      plan.relaxedLimbs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A static blocking plan must configure at least one goal.",
        path: [],
      });
    }
  });

export type StaticBlockingPlan = z.infer<typeof staticBlockingPlanSchema>;
