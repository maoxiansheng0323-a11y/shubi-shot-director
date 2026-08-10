import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BufferGeometry,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
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
  REFINED_PROFILE_ATTACHMENT_CALIBRATION,
  REFINED_SECTION_IDS,
  createRefinedGeometryCatalog,
  parseBuiltInRefinedMannequinManifest,
  parseRefinedMannequinManifest,
  refinedPrimitiveTransform,
  refinedSectionForPrimitive,
  validateRefinedMannequinFileBytes,
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
    publisher: "Blender Studio and community contributors",
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

const createRuntimeAsset = () => {
  const root = new Group();
  const material = new MeshBasicMaterial({ name: "refined_white" });
  const sources = new Map<string, BoxGeometry>();
  let triangleCount = 0;
  for (const sectionId of REFINED_SECTION_IDS) {
    const geometry = new BoxGeometry(1, 1, 1);
    triangleCount += (geometry.index?.count ?? 0) / 3;
    sources.set(sectionId, geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = sectionId;
    root.add(mesh);
  }
  const source = createManifest();
  const manifest = parseRefinedMannequinManifest({
    ...source,
    file: {
      ...source.file,
      triangleCount,
    },
  });
  return { root, material, sources, manifest };
};

const disposeRuntimeAsset = (
  root: Group,
  materials: readonly MeshBasicMaterial[],
) => {
  root.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
  for (const material of materials) material.dispose();
};

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

  it("accepts only the exact committed built-in manifest identity", async () => {
    const source = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          "public",
          "assets",
          "refined-white-mannequin-v1.json",
        ),
        "utf8",
      ),
    ) as ReturnType<typeof createManifest>;
    expect(parseBuiltInRefinedMannequinManifest(source)).toEqual(source);

    for (const changed of [
      {
        ...source,
        file: { ...source.file, sha256: "0".repeat(64) },
      },
      {
        ...source,
        file: { ...source.file, byteLength: source.file.byteLength + 1 },
      },
      {
        ...source,
        file: {
          ...source.file,
          triangleCount: source.file.triangleCount + 1,
        },
      },
      {
        ...source,
        source: { ...source.source, version: "1.4.2" },
      },
      {
        ...source,
        nodes: source.nodes.map((node, index) =>
          index === 0
            ? {
                ...node,
                bounds: {
                  ...node.bounds,
                  min: [-0.4, -0.5, -0.5],
                },
              }
            : node,
        ),
      },
    ]) {
      expect(() => parseBuiltInRefinedMannequinManifest(changed)).toThrow(
        "REFINED_MANNEQUIN_MANIFEST_INVALID",
      );
    }
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

  it("validates runtime bytes against the closed manifest length and SHA-256", async () => {
    const bytes = new Uint8Array([1, 3, 5, 7, 9]);
    const source = createManifest();
    const manifest = parseRefinedMannequinManifest({
      ...source,
      file: {
        ...source.file,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });

    await expect(
      validateRefinedMannequinFileBytes(bytes, manifest),
    ).resolves.toBeUndefined();
    await expect(
      validateRefinedMannequinFileBytes(bytes.subarray(0, 4), manifest),
    ).rejects.toThrow("REFINED_MANNEQUIN_ASSET_INVALID");
    await expect(
      validateRefinedMannequinFileBytes(
        bytes,
        parseRefinedMannequinManifest({
          ...manifest,
          file: { ...manifest.file, sha256: "0".repeat(64) },
        }),
      ),
    ).rejects.toThrow("REFINED_MANNEQUIN_ASSET_INVALID");
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

    const transform = refinedPrimitiveTransform(primitive);
    expect(transform).not.toBeNull();
    if (!transform) throw new Error("Expected refined upper-arm transform.");
    expect(transform.scale).toEqual([0.3, 0.8, 0.225]);
    expect(transform.rotation).not.toEqual([0, 0, 0, 1]);
    const calibration = REFINED_PROFILE_ATTACHMENT_CALIBRATION.upper_arm_l;
    if (!calibration) throw new Error("Expected upper-arm calibration.");
    const transformedEndpoint = (point: readonly number[]) =>
      new Vector3(
        point[0] * transform.scale[0],
        point[1] * transform.scale[1],
        point[2] * transform.scale[2],
      )
        .applyQuaternion(new Quaternion(...transform.rotation))
        .add(new Vector3(...transform.position));
    const proximal = transformedEndpoint(calibration.proximalCenter);
    const distal = transformedEndpoint(calibration.distalCenter);

    expect(proximal.toArray()).toEqual([
      expect.closeTo(0.1, 9),
      expect.closeTo(0.2, 9),
      expect.closeTo(0.3, 9),
    ]);
    expect(distal.x).toBeCloseTo(0.1, 9);
    expect(distal.z).toBeCloseTo(0.3, 9);
    expect(proximal.y - distal.y).toBeGreaterThan(0.72);
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
      rotation: [0, 0, 0, 1],
    });
  });

  it("anchors every calibrated profile section on its analytical proximal axis", () => {
    for (const [sectionId, calibration] of Object.entries(
      REFINED_PROFILE_ATTACHMENT_CALIBRATION,
    )) {
      if (!calibration) continue;
      for (const statureScale of [0.82, 1, 1.18]) {
        const primitive: ActorProjectionProfilePrimitive = {
          id: sectionId as ActorProjectionProfilePrimitive["id"],
          kind: "profile",
          frame: identityFrame,
          center: [0.04, -0.02, 0.03],
          points: [
            { y: -0.42 * statureScale, radius: 0.11 * statureScale },
            { y: 0, radius: 0.14 * statureScale },
          ],
          depthScale: 0.76,
          radialSegments: 12,
        };
        const transform = refinedPrimitiveTransform(primitive);
        if (!transform) throw new Error(`Missing transform for ${sectionId}.`);
        const rotation = new Quaternion(...transform.rotation);
        const mapped = (point: readonly number[]) =>
          new Vector3(
            point[0] * transform.scale[0],
            point[1] * transform.scale[1],
            point[2] * transform.scale[2],
          )
            .applyQuaternion(rotation)
            .add(new Vector3(...transform.position));
        const proximal = mapped(calibration.proximalCenter);
        const distal = mapped(calibration.distalCenter);

        expect(proximal.x).toBeCloseTo(primitive.center[0], 9);
        expect(proximal.y).toBeCloseTo(primitive.center[1], 9);
        expect(proximal.z).toBeCloseTo(primitive.center[2], 9);
        expect(distal.x).toBeCloseTo(primitive.center[0], 9);
        expect(distal.z).toBeCloseTo(primitive.center[2], 9);
        expect(distal.y).toBeLessThan(proximal.y - 0.35 * statureScale);
      }
    }
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

    expect(manifest.source.publisher).toBe(
      "Blender Studio and community contributors",
    );
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

  it("validates and clones exactly one geometry for every runtime section", () => {
    const { root, material, sources, manifest } = createRuntimeAsset();

    const catalog = createRefinedGeometryCatalog(root, manifest);
    expect(Object.keys(catalog)).toEqual(REFINED_SECTION_IDS);
    for (const sectionId of REFINED_SECTION_IDS) {
      expect(catalog[sectionId]).not.toBe(sources.get(sectionId));
      expect(catalog[sectionId].getAttribute("position").count).toBe(
        sources.get(sectionId)?.getAttribute("position").count,
      );
      catalog[sectionId].dispose();
    }
    disposeRuntimeAsset(root, [material]);
  });

  it.each([
    [
      "transformed node",
      ({ root }: ReturnType<typeof createRuntimeAsset>) => {
        root.children[0].position.x = 0.1;
      },
    ],
    [
      "multiple materials",
      ({ root }: ReturnType<typeof createRuntimeAsset>) => {
        (root.children[0] as Mesh).material = new MeshBasicMaterial();
      },
    ],
    [
      "empty geometry",
      ({ root }: ReturnType<typeof createRuntimeAsset>) => {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          "position",
          new Float32BufferAttribute([], 3),
        );
        (root.children[0] as Mesh).geometry = geometry;
      },
    ],
    [
      "non-normalized bounds",
      ({ root }: ReturnType<typeof createRuntimeAsset>) => {
        (root.children[0] as Mesh).geometry = new BoxGeometry(2, 1, 1);
      },
    ],
  ])("rejects runtime geometry with %s", (_label, mutate) => {
    const fixture = createRuntimeAsset();
    mutate(fixture);

    expect(() =>
      createRefinedGeometryCatalog(fixture.root, fixture.manifest),
    ).toThrow("REFINED_MANNEQUIN_ASSET_INVALID");
    const materials = new Set<MeshBasicMaterial>([fixture.material]);
    fixture.root.traverse((object) => {
      if (object instanceof Mesh) {
        const meshMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of meshMaterials) {
          if (material instanceof MeshBasicMaterial) materials.add(material);
        }
      }
    });
    disposeRuntimeAsset(fixture.root, [...materials]);
  });

  it("rejects runtime topology that disagrees with the manifest", () => {
    const fixture = createRuntimeAsset();
    const manifest = parseRefinedMannequinManifest({
      ...fixture.manifest,
      file: {
        ...fixture.manifest.file,
        triangleCount: fixture.manifest.file.triangleCount + 1,
      },
    });

    expect(() =>
      createRefinedGeometryCatalog(fixture.root, manifest),
    ).toThrow("REFINED_MANNEQUIN_ASSET_INVALID");
    disposeRuntimeAsset(fixture.root, [fixture.material]);
  });

  it("rejects missing, duplicate, unexpected, and non-mesh runtime nodes", () => {
    const createRoot = () => {
      const root = new Group();
      for (const sectionId of REFINED_SECTION_IDS) {
        const mesh = new Mesh(new BoxGeometry(1, 1, 1));
        mesh.name = sectionId;
        root.add(mesh);
      }
      return root;
    };
    const invalidRoots = [];

    const missing = createRoot();
    missing.remove(missing.children[0]);
    invalidRoots.push(missing);

    const duplicate = createRoot();
    const duplicateMesh = new Mesh(new BoxGeometry(1, 1, 1));
    duplicateMesh.name = REFINED_SECTION_IDS[0];
    duplicate.add(duplicateMesh);
    invalidRoots.push(duplicate);

    const unexpected = createRoot();
    const unexpectedMesh = new Mesh(new BoxGeometry(1, 1, 1));
    unexpectedMesh.name = "unexpected";
    unexpected.add(unexpectedMesh);
    invalidRoots.push(unexpected);

    const nonMesh = createRoot();
    nonMesh.children[0].name = "not_a_section";
    const group = new Group();
    group.name = REFINED_SECTION_IDS[0];
    nonMesh.add(group);
    invalidRoots.push(nonMesh);

    const validFixture = createRuntimeAsset();
    const runtimeManifest = validFixture.manifest;
    disposeRuntimeAsset(validFixture.root, [validFixture.material]);

    for (const root of invalidRoots) {
      expect(() =>
        createRefinedGeometryCatalog(root, runtimeManifest),
      ).toThrow(
        "REFINED_MANNEQUIN_ASSET_INVALID",
      );
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
    }
  });
});
