import { z } from "zod";
import type { BufferGeometry, Object3D } from "three";
import type {
  ActorProjectionEllipsoidPrimitive,
  ActorProjectionPrimitive,
  ActorProjectionProfilePrimitive,
} from "../domain/actor-projection";
import type { Vec3 } from "../domain/scene-schema";

export const BUILT_IN_REFINED_MANNEQUIN_URL =
  "/assets/refined-white-mannequin-v1.glb" as const;

export const REFINED_MANNEQUIN_MAX_BYTES = 2 * 1024 * 1024;

export const REFINED_SECTION_IDS = [
  "pelvis",
  "torso",
  "neck",
  "head",
  "upper_arm_l",
  "forearm_l",
  "hand_l",
  "upper_arm_r",
  "forearm_r",
  "hand_r",
  "upper_leg_l",
  "lower_leg_l",
  "foot_l",
  "upper_leg_r",
  "lower_leg_r",
  "foot_r",
] as const;

export type RefinedSectionId = (typeof REFINED_SECTION_IDS)[number];

export type RefinedGeometryCatalog = Readonly<
  Record<RefinedSectionId, BufferGeometry>
>;

const profileSectionIds = new Set<RefinedSectionId>([
  "pelvis",
  "torso",
  "neck",
  "head",
  "upper_arm_l",
  "forearm_l",
  "upper_arm_r",
  "forearm_r",
  "upper_leg_l",
  "lower_leg_l",
  "upper_leg_r",
  "lower_leg_r",
]);

const ellipsoidSectionIds = new Set<RefinedSectionId>([
  "hand_l",
  "hand_r",
  "foot_l",
  "foot_r",
]);

const vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

const refinedNodeSchema = z
  .object({
    id: z.enum(REFINED_SECTION_IDS),
    nodeName: z.string().min(1).max(64),
    bounds: z
      .object({
        min: vec3Schema,
        max: vec3Schema,
      })
      .strict(),
  })
  .strict();

const refinedMannequinManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    assetId: z.literal("refined-white-mannequin-v1"),
    assetUrl: z.literal(BUILT_IN_REFINED_MANNEQUIN_URL),
    license: z.literal("CC0-1.0"),
    source: z
      .object({
        publisher: z.literal("Blender Studio"),
        asset: z.literal("Human Base Meshes"),
        version: z.string().min(1).max(32),
        sourceUrl: z.url(),
        licenseUrl: z.url(),
        downloadSha256: sha256Schema,
      })
      .strict(),
    file: z
      .object({
        sha256: sha256Schema,
        byteLength: z.number().int().positive().max(REFINED_MANNEQUIN_MAX_BYTES),
        triangleCount: z.number().int().positive().max(500_000),
        materialCount: z.literal(1),
      })
      .strict(),
    nodes: z.array(refinedNodeSchema).length(REFINED_SECTION_IDS.length),
  })
  .strict()
  .superRefine(({ nodes }, context) => {
    const expected = new Set<string>(REFINED_SECTION_IDS);
    const seen = new Set<string>();
    for (const [index, node] of nodes.entries()) {
      if (
        seen.has(node.id) ||
        !expected.has(node.id) ||
        node.nodeName !== node.id
      ) {
        context.addIssue({
          code: "custom",
          message: "REFINED_MANNEQUIN_NODE_INVALID",
          path: ["nodes", index],
        });
      }
      seen.add(node.id);
    }
    for (const id of REFINED_SECTION_IDS) {
      if (!seen.has(id)) {
        context.addIssue({
          code: "custom",
          message: "REFINED_MANNEQUIN_NODE_MISSING",
          path: ["nodes"],
        });
      }
    }
  });

export type RefinedMannequinManifest = z.infer<
  typeof refinedMannequinManifestSchema
>;

export const parseRefinedMannequinManifest = (
  value: unknown,
): RefinedMannequinManifest => {
  const parsed = refinedMannequinManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("REFINED_MANNEQUIN_MANIFEST_INVALID");
  }
  return parsed.data;
};

const isRefinedSectionId = (value: string): value is RefinedSectionId =>
  (REFINED_SECTION_IDS as readonly string[]).includes(value);

export const createRefinedGeometryCatalog = (
  root: Object3D,
): RefinedGeometryCatalog => {
  const sourceGeometries = new Map<RefinedSectionId, BufferGeometry>();
  let invalid = false;
  root.traverse((object) => {
    const candidate = object as Object3D & {
      readonly isMesh?: boolean;
      readonly geometry?: BufferGeometry & {
        readonly isBufferGeometry?: boolean;
      };
    };
    if (candidate.isMesh === true) {
      if (
        !isRefinedSectionId(candidate.name) ||
        candidate.geometry?.isBufferGeometry !== true ||
        sourceGeometries.has(candidate.name)
      ) {
        invalid = true;
        return;
      }
      sourceGeometries.set(candidate.name, candidate.geometry);
      return;
    }
    if (isRefinedSectionId(candidate.name)) invalid = true;
  });
  if (
    invalid ||
    sourceGeometries.size !== REFINED_SECTION_IDS.length ||
    REFINED_SECTION_IDS.some((id) => !sourceGeometries.has(id))
  ) {
    throw new Error("REFINED_MANNEQUIN_ASSET_INVALID");
  }

  const catalog = {} as Record<RefinedSectionId, BufferGeometry>;
  try {
    for (const id of REFINED_SECTION_IDS) {
      const geometry = sourceGeometries.get(id);
      if (!geometry) throw new Error("REFINED_MANNEQUIN_ASSET_INVALID");
      catalog[id] = geometry.clone();
    }
  } catch {
    for (const geometry of Object.values(catalog)) geometry.dispose();
    throw new Error("REFINED_MANNEQUIN_ASSET_INVALID");
  }
  return Object.freeze(catalog);
};

export const refinedSectionForPrimitive = (
  primitive: ActorProjectionPrimitive,
): RefinedSectionId | null => {
  if (!isRefinedSectionId(primitive.id)) return null;
  if (
    (primitive.kind === "profile" && profileSectionIds.has(primitive.id)) ||
    (primitive.kind === "ellipsoid" && ellipsoidSectionIds.has(primitive.id))
  ) {
    return primitive.id;
  }
  return null;
};

export interface RefinedPrimitiveTransform {
  readonly position: Vec3;
  readonly scale: Vec3;
}

const stableNumber = (value: number): number =>
  Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;

const profileTransform = (
  primitive: ActorProjectionProfilePrimitive,
): RefinedPrimitiveTransform | null => {
  if (primitive.points.length === 0) return null;
  const minimumY = Math.min(...primitive.points.map(({ y }) => y));
  const maximumY = Math.max(...primitive.points.map(({ y }) => y));
  const maximumRadius = Math.max(
    ...primitive.points.map(({ radius }) => radius),
  );
  const height = maximumY - minimumY;
  if (height <= 0 || maximumRadius <= 0) return null;
  return {
    position: [
      primitive.center[0],
      stableNumber(primitive.center[1] + (minimumY + maximumY) / 2),
      primitive.center[2],
    ],
    scale: [
      stableNumber(maximumRadius * 2),
      stableNumber(height),
      stableNumber(maximumRadius * primitive.depthScale * 2),
    ],
  };
};

const ellipsoidTransform = (
  primitive: ActorProjectionEllipsoidPrimitive,
): RefinedPrimitiveTransform | null => {
  if (primitive.radii.some((radius) => radius <= 0)) return null;
  return {
    position: [...primitive.center],
    scale: primitive.radii.map((radius) => stableNumber(radius * 2)) as Vec3,
  };
};

export const refinedPrimitiveTransform = (
  primitive: ActorProjectionPrimitive,
): RefinedPrimitiveTransform | null => {
  const section = refinedSectionForPrimitive(primitive);
  if (!section) return null;
  if (primitive.kind === "profile") return profileTransform(primitive);
  if (primitive.kind === "ellipsoid") return ellipsoidTransform(primitive);
  return null;
};
