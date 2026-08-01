import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  ActorRigFrame,
  ActorProjectionEllipsoidPrimitive,
  ActorProjectionPrimitive,
  ActorProjectionProfilePrimitive,
} from "../src/domain/actor-projection";
import {
  BUILT_IN_REFINED_MANNEQUIN_URL,
  REFINED_MANNEQUIN_MAX_BYTES,
  REFINED_SECTION_IDS,
  parseRefinedMannequinManifest,
  refinedPrimitiveTransform,
  refinedSectionForPrimitive,
} from "../src/three/mannequin-asset";

const identityFrame: ActorRigFrame = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

interface GltfDocument {
  readonly asset: { readonly version: string };
  readonly accessors: readonly {
    readonly count: number;
    readonly min?: readonly number[];
    readonly max?: readonly number[];
  }[];
  readonly animations?: readonly unknown[];
  readonly cameras?: readonly unknown[];
  readonly images?: readonly unknown[];
  readonly materials?: readonly { readonly name?: string }[];
  readonly meshes?: readonly {
    readonly name?: string;
    readonly primitives: readonly {
      readonly indices?: number;
      readonly attributes: { readonly POSITION: number };
    }[];
  }[];
  readonly nodes?: readonly {
    readonly name?: string;
    readonly mesh?: number;
  }[];
  readonly skins?: readonly unknown[];
  readonly textures?: readonly unknown[];
}

const readGlbJson = (bytes: Buffer): GltfDocument => {
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.subarray(16, 20).toString("ascii")).toBe("JSON");
  return JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString("utf8"),
  ) as GltfDocument;
};

const createManifest = () => ({
  schemaVersion: 1,
  assetId: "refined-white-mannequin-v1",
  assetUrl: "/assets/refined-white-mannequin-v1.glb",
  license: "CC0-1.0",
  source: {
    publisher: "Blender Studio",
    asset: "Human Base Meshes",
    version: "1.4.1",
    sourceUrl: "https://www.blender.org/download/demo-files/#assets",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    downloadSha256: "8".repeat(64),
  },
  file: {
    sha256: "a".repeat(64),
    byteLength: 1_024_000,
    triangleCount: 18_000,
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
});

describe("built-in refined mannequin asset", () => {
  it("keeps one closed relative URL and sixteen stable section IDs", () => {
    expect(BUILT_IN_REFINED_MANNEQUIN_URL).toBe(
      "/assets/refined-white-mannequin-v1.glb",
    );
    expect(REFINED_SECTION_IDS).toEqual([
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
    ]);
    expect(REFINED_SECTION_IDS).toHaveLength(16);
    expect(new Set(REFINED_SECTION_IDS).size).toBe(16);
  });

  it("parses the strict CC0 built-in manifest", () => {
    expect(parseRefinedMannequinManifest(createManifest())).toEqual(
      createManifest(),
    );
  });

  it.each([
    ["remote", { assetUrl: "https://example.invalid/actor.glb" }],
    ["protocol relative", { assetUrl: "//example.invalid/actor.glb" }],
    ["traversal", { assetUrl: "/assets/../actor.glb" }],
    [
      "filesystem",
      {
        assetUrl: ["C:", "models", "actor.glb"].join(
          String.fromCharCode(92),
        ),
      },
    ],
    ["wrong license", { license: "MIT" }],
    ["extra material", { file: { materialCount: 2 } }],
    ["invalid hash", { file: { sha256: "invalid" } }],
    [
      "oversized file",
      { file: { byteLength: REFINED_MANNEQUIN_MAX_BYTES + 1 } },
    ],
  ])("rejects a %s manifest", (_label, override) => {
    const manifest = createManifest();
    const typedOverride = override as {
      assetUrl?: string;
      license?: string;
      file?: Partial<typeof manifest.file>;
    };
    const value = {
      ...manifest,
      ...typedOverride,
      file: {
        ...manifest.file,
        ...(typedOverride.file ?? {}),
      },
    };
    expect(() => parseRefinedMannequinManifest(value)).toThrow(
      "REFINED_MANNEQUIN_MANIFEST_INVALID",
    );
  });

  it("rejects missing, duplicate, and unexpected section nodes", () => {
    const manifest = createManifest();
    for (const nodes of [
      manifest.nodes.slice(1),
      [...manifest.nodes.slice(1), manifest.nodes[1]],
      [
        ...manifest.nodes.slice(1),
        {
          ...manifest.nodes[0],
          id: "tail",
          nodeName: "tail",
        },
      ],
    ]) {
      expect(() =>
        parseRefinedMannequinManifest({ ...manifest, nodes }),
      ).toThrow("REFINED_MANNEQUIN_MANIFEST_INVALID");
    }
  });

  it("maps only the sixteen supported analytical body primitives", () => {
    const supported = REFINED_SECTION_IDS.map((id) => ({
      id,
      kind:
        id.startsWith("hand_") || id.startsWith("foot_")
          ? "ellipsoid"
          : "profile",
      frame: identityFrame,
      center: [0, 0, 0],
      points: [
        { y: -0.5, radius: 0.5 },
        { y: 0.5, radius: 0.5 },
      ],
      depthScale: 1,
      radialSegments: 12,
      radii: [0.5, 0.5, 0.5],
      widthSegments: 12,
      heightSegments: 8,
    })) as unknown as ActorProjectionPrimitive[];

    expect(supported.map(refinedSectionForPrimitive)).toEqual(
      REFINED_SECTION_IDS,
    );

    const unsupported = [
      "face",
      "shoulder_l",
      "elbow_r",
      "hip_l",
      "knee_r",
      "module:socket:part",
    ].map((id) => ({
      id,
      kind: "sphere",
      frame: identityFrame,
      center: [0, 0, 0],
      radius: 0.1,
      widthSegments: 8,
      heightSegments: 6,
    })) as ActorProjectionPrimitive[];

    expect(unsupported.map(refinedSectionForPrimitive)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("maps normalized profile geometry to the authoritative local bounds", () => {
    const primitive: ActorProjectionProfilePrimitive = {
      id: "upper_arm_l",
      kind: "profile",
      frame: {
        position: [1, 2, 3],
        rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
      center: [0.1, 0.2, 0.3],
      points: [
        { y: -0.8, radius: 0.12 },
        { y: -0.2, radius: 0.15 },
        { y: 0, radius: 0.14 },
      ],
      depthScale: 0.75,
      radialSegments: 12,
    };

    expect(refinedPrimitiveTransform(primitive)).toEqual({
      position: [0.1, -0.2, 0.3],
      scale: [0.3, 0.8, 0.225],
    });
    expect(primitive.frame).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    });
  });

  it("maps normalized terminal geometry from full ellipsoid dimensions", () => {
    const primitive: ActorProjectionEllipsoidPrimitive = {
      id: "foot_r",
      kind: "ellipsoid",
      frame: identityFrame,
      center: [0.02, -0.04, 0.08],
      radii: [0.06, 0.04, 0.12],
      widthSegments: 16,
      heightSegments: 10,
    };

    expect(refinedPrimitiveTransform(primitive)).toEqual({
      position: [0.02, -0.04, 0.08],
      scale: [0.12, 0.08, 0.24],
    });
  });

  it("matches the committed GLB integrity, topology, and normalized bounds", async () => {
    const manifestSource = await readFile(
      path.join(
        repositoryRoot,
        "public",
        "assets",
        "refined-white-mannequin-v1.json",
      ),
      "utf8",
    );
    const bytes = await readFile(
      path.join(
        repositoryRoot,
        "public",
        "assets",
        "refined-white-mannequin-v1.glb",
      ),
    );
    const manifest = parseRefinedMannequinManifest(
      JSON.parse(manifestSource),
    );
    const gltf = readGlbJson(bytes);

    expect(bytes).toHaveLength(manifest.file.byteLength);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      manifest.file.sha256,
    );
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.materials?.map(({ name }) => name)).toEqual([
      "refined_white",
    ]);
    expect(gltf.nodes?.map(({ name }) => name)).toEqual(
      REFINED_SECTION_IDS,
    );
    expect(gltf.meshes).toHaveLength(REFINED_SECTION_IDS.length);
    expect(gltf.animations ?? []).toHaveLength(0);
    expect(gltf.skins ?? []).toHaveLength(0);
    expect(gltf.cameras ?? []).toHaveLength(0);
    expect(gltf.images ?? []).toHaveLength(0);
    expect(gltf.textures ?? []).toHaveLength(0);

    let triangleCount = 0;
    for (const [index, sectionId] of REFINED_SECTION_IDS.entries()) {
      const node = gltf.nodes?.[index];
      const mesh = gltf.meshes?.[index];
      expect(node).toMatchObject({ name: sectionId, mesh: index });
      expect(mesh?.name).toBe(`${sectionId}_mesh`);
      expect(mesh?.primitives).toHaveLength(1);
      const primitive = mesh?.primitives[0];
      if (!primitive) continue;
      const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
      const indexAccessor =
        primitive.indices === undefined
          ? undefined
          : gltf.accessors[primitive.indices];
      triangleCount += (indexAccessor?.count ?? positionAccessor?.count ?? 0) / 3;
      for (const [actual, expected] of [
        [positionAccessor?.min, [-0.5, -0.5, -0.5]],
        [positionAccessor?.max, [0.5, 0.5, 0.5]],
      ] as const) {
        expect(actual).toHaveLength(3);
        for (let axis = 0; axis < 3; axis += 1) {
          expect(actual?.[axis]).toBeCloseTo(expected[axis] ?? 0, 5);
        }
      }
    }
    expect(triangleCount).toBe(manifest.file.triangleCount);
  });
});
