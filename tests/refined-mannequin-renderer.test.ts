import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import {
  REFINED_SECTION_IDS,
  parseRefinedMannequinManifest,
} from "../src/three/mannequin-asset";
import { createRefinedMannequinResource } from "../src/three/refined-mannequin-resource";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("refined mannequin browser renderer", () => {
  it("loads only the closed built-in asset through the non-throwing resource", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "src", "three", "RefinedMannequin.tsx"),
      "utf8",
    ).catch(() => "");

    expect(source).toContain("new GLTFLoader()");
    expect(source).toContain("createRefinedMannequinResource");
    expect(source).toContain(
      "sceneClient.getBuiltInRefinedMannequinManifest",
    );
    expect(source).toContain(
      "sceneClient.getBuiltInRefinedMannequinBytes",
    );
    expect(source).toContain("parseBuiltInRefinedMannequinManifest");
    expect(source).toContain("validateRefinedMannequinFileBytes");
    expect(source).toContain("refinedMannequinLoader.parseAsync");
    expect(source).toContain("refinedSectionForPrimitive(primitive)");
    expect(source).toContain("refinedPrimitiveTransform(primitive)");
    expect(source).not.toContain("useGLTF");
    expect(source).not.toContain("fetch(");
  });

  it("keeps complete procedural loading and render-error fallbacks", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "src", "three", "RefinedMannequin.tsx"),
      "utf8",
    ).catch(() => "");

    expect(source).toContain("RefinedMannequinBoundary");
    expect(source).toContain("renderProcedural(primitive)");
    expect(source).toContain("REFINED_MANNEQUIN_FALLBACK");
    expect(source).not.toContain("<Suspense");
  });

  it("absorbs a failed asset load into one stable fallback result", async () => {
    let loadCount = 0;
    let warningCount = 0;
    const resource = createRefinedMannequinResource({
      loadAsset: async () => {
        loadCount += 1;
        throw new Error("EXPECTED_ASSET_LOAD_FAILURE");
      },
      onFallback: () => {
        warningCount += 1;
      },
    });

    expect(resource.getSnapshot()).toEqual({ status: "loading" });
    const [first, second] = await Promise.all([
      resource.load(),
      resource.load(),
    ]);

    expect(first).toEqual({ status: "fallback" });
    expect(second).toBe(first);
    expect(resource.getSnapshot()).toBe(first);
    expect(loadCount).toBe(1);
    expect(warningCount).toBe(1);
  });

  it("validates one loaded scene into the complete geometry catalog", async () => {
    const scene = new Group();
    const sourceGeometries: BoxGeometry[] = [];
    const material = new MeshBasicMaterial({ name: "refined_white" });
    let triangleCount = 0;
    for (const sectionId of REFINED_SECTION_IDS) {
      const geometry = new BoxGeometry(1, 1, 1);
      triangleCount += (geometry.index?.count ?? 0) / 3;
      sourceGeometries.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.name = sectionId;
      scene.add(mesh);
    }
    const manifest = parseRefinedMannequinManifest({
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
        byteLength: 1024,
        triangleCount,
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
    let loadCount = 0;
    const resource = createRefinedMannequinResource({
      loadAsset: async () => {
        loadCount += 1;
        return { scene, manifest };
      },
      onFallback: () => {
        throw new Error("A valid asset must not select fallback.");
      },
    });

    const result = await resource.load();

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(Object.keys(result.catalog)).toEqual(REFINED_SECTION_IDS);
      for (const geometry of Object.values(result.catalog)) {
        geometry.dispose();
      }
    }
    expect(resource.getSnapshot()).toBe(result);
    expect(loadCount).toBe(1);
    for (const geometry of sourceGeometries) geometry.dispose();
    material.dispose();
  });

  it("renders cloned geometry without mutating loader-owned nodes or material", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "src", "three", "RefinedMannequin.tsx"),
      "utf8",
    ).catch(() => "");

    expect(source).toContain("geometry: catalog[sectionId]");
    expect(source).not.toMatch(/\.material\s*=/u);
    expect(source).not.toMatch(/\.geometry\s*=/u);
  });
});
