import { z } from "zod";
import type { BufferGeometry, Object3D } from "three";
import {
  BUILT_IN_REFINED_MANNEQUIN_MANIFEST_URL,
  BUILT_IN_REFINED_MANNEQUIN_URL,
} from "../domain/built-in-asset-paths";
import type {
  ActorProjectionEllipsoidPrimitive,
  ActorProjectionPrimitive,
  ActorProjectionProfilePrimitive,
} from "../domain/actor-projection";
import type { Vec3 } from "../domain/scene-schema";

export {
  BUILT_IN_REFINED_MANNEQUIN_MANIFEST_URL,
  BUILT_IN_REFINED_MANNEQUIN_URL,
};

export const REFINED_MANNEQUIN_MAX_BYTES = 2 * 1024 * 1024;

export const BUILT_IN_REFINED_MANNEQUIN_FILE_SHA256 =
  "1bd1bf8650a0e2b0d35e8544bca4d21a99069bcf2bd4b26974cf1b5ac1857b94" as const;
export const BUILT_IN_REFINED_MANNEQUIN_FILE_BYTE_LENGTH = 603_548;
export const BUILT_IN_REFINED_MANNEQUIN_TRIANGLE_COUNT = 35_904;
export const BUILT_IN_REFINED_MANNEQUIN_SOURCE_SHA256 =
  "811f43accbb31a88266d932f8f5563b2d13586fca0ba2693aad1f5fe582b3515" as const;

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
        publisher: z.literal(
          "Blender Studio and community contributors",
        ),
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

const builtInRefinedMannequinManifest = {
  schemaVersion: 1,
  assetId: "refined-white-mannequin-v1",
  assetUrl: BUILT_IN_REFINED_MANNEQUIN_URL,
  license: "CC0-1.0",
  source: {
    publisher: "Blender Studio and community contributors",
    asset: "Human Base Meshes",
    version: "1.4.1",
    sourceUrl: "https://www.blender.org/download/demo-files/#assets",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    downloadSha256: BUILT_IN_REFINED_MANNEQUIN_SOURCE_SHA256,
  },
  file: {
    sha256: BUILT_IN_REFINED_MANNEQUIN_FILE_SHA256,
    byteLength: BUILT_IN_REFINED_MANNEQUIN_FILE_BYTE_LENGTH,
    triangleCount: BUILT_IN_REFINED_MANNEQUIN_TRIANGLE_COUNT,
    materialCount: 1,
  },
  nodes: REFINED_SECTION_IDS.map((id) => ({
    id,
    nodeName: id,
    bounds: {
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
  })),
};

export const parseBuiltInRefinedMannequinManifest = (
  value: unknown,
): RefinedMannequinManifest => {
  const manifest = parseRefinedMannequinManifest(value);
  if (
    JSON.stringify(manifest) !==
    JSON.stringify(builtInRefinedMannequinManifest)
  ) {
    throw new Error("REFINED_MANNEQUIN_MANIFEST_INVALID");
  }
  return manifest;
};

export const validateRefinedMannequinFileBytes = async (
  bytes: Uint8Array,
  manifest: RefinedMannequinManifest,
): Promise<void> => {
  if (bytes.byteLength !== manifest.file.byteLength) {
    throw new Error("REFINED_MANNEQUIN_ASSET_INVALID");
  }
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", digestInput),
  );
  const sha256 = Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (sha256 !== manifest.file.sha256) {
    throw new Error("REFINED_MANNEQUIN_ASSET_INVALID");
  }
};

const isRefinedSectionId = (value: string): value is RefinedSectionId =>
  (REFINED_SECTION_IDS as readonly string[]).includes(value);

export const createRefinedGeometryCatalog = (
  root: Object3D,
  manifest: RefinedMannequinManifest,
): RefinedGeometryCatalog => {
  const sourceGeometries = new Map<RefinedSectionId, BufferGeometry>();
  const materials = new Set<object>();
  let triangleCount = 0;
  let invalid = false;
  const expectedBounds = new Map(
    manifest.nodes.map((node) => [node.id, node.bounds] as const),
  );
  root.traverse((object) => {
    const candidate = object as Object3D & {
      readonly isMesh?: boolean;
      readonly isSkinnedMesh?: boolean;
      readonly isCamera?: boolean;
      readonly isLight?: boolean;
      readonly geometry?: BufferGeometry & {
        readonly isBufferGeometry?: boolean;
      };
      readonly material?:
        | { readonly isMaterial?: boolean }
        | { readonly isMaterial?: boolean }[];
    };
    const transformValues = [
      object.position.x,
      object.position.y,
      object.position.z,
      object.quaternion.x,
      object.quaternion.y,
      object.quaternion.z,
      object.quaternion.w,
      object.scale.x,
      object.scale.y,
      object.scale.z,
    ];
    if (
      !transformValues.every(Number.isFinite) ||
      object.position.lengthSq() > 1e-12 ||
      Math.abs(object.quaternion.x) > 1e-6 ||
      Math.abs(object.quaternion.y) > 1e-6 ||
      Math.abs(object.quaternion.z) > 1e-6 ||
      Math.abs(object.quaternion.w - 1) > 1e-6 ||
      Math.abs(object.scale.x - 1) > 1e-6 ||
      Math.abs(object.scale.y - 1) > 1e-6 ||
      Math.abs(object.scale.z - 1) > 1e-6 ||
      candidate.isSkinnedMesh === true ||
      candidate.isCamera === true ||
      candidate.isLight === true
    ) {
      invalid = true;
    }
    if (candidate.isMesh === true) {
      if (
        !isRefinedSectionId(candidate.name) ||
        candidate.geometry?.isBufferGeometry !== true ||
        sourceGeometries.has(candidate.name) ||
        Array.isArray(candidate.material) ||
        candidate.material?.isMaterial !== true
      ) {
        invalid = true;
        return;
      }
      const geometry = candidate.geometry;
      const position = geometry.getAttribute("position");
      const index = geometry.getIndex();
      if (
        !position ||
        position.itemSize !== 3 ||
        position.count <= 0 ||
        !index ||
        index.count <= 0 ||
        index.count % 3 !== 0
      ) {
        invalid = true;
        return;
      }
      const minimum = [Infinity, Infinity, Infinity];
      const maximum = [-Infinity, -Infinity, -Infinity];
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
        const values = [
          position.getX(vertexIndex),
          position.getY(vertexIndex),
          position.getZ(vertexIndex),
        ];
        if (!values.every(Number.isFinite)) {
          invalid = true;
          return;
        }
        for (let axis = 0; axis < 3; axis += 1) {
          const value = values[axis] ?? 0;
          minimum[axis] = Math.min(minimum[axis] ?? Infinity, value);
          maximum[axis] = Math.max(maximum[axis] ?? -Infinity, value);
        }
      }
      const bounds = expectedBounds.get(candidate.name);
      if (
        !bounds ||
        minimum.some(
          (value, axis) =>
            Math.abs(value - (bounds.min[axis] ?? 0)) > 1e-5,
        ) ||
        maximum.some(
          (value, axis) =>
            Math.abs(value - (bounds.max[axis] ?? 0)) > 1e-5,
        )
      ) {
        invalid = true;
        return;
      }
      materials.add(candidate.material);
      triangleCount += index.count / 3;
      sourceGeometries.set(candidate.name, geometry);
      return;
    }
    if (isRefinedSectionId(candidate.name)) invalid = true;
  });
  if (
    invalid ||
    sourceGeometries.size !== REFINED_SECTION_IDS.length ||
    REFINED_SECTION_IDS.some((id) => !sourceGeometries.has(id)) ||
    materials.size !== manifest.file.materialCount ||
    triangleCount !== manifest.file.triangleCount
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
