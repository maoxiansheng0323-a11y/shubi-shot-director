import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("refined mannequin browser renderer", () => {
  it("loads only the closed built-in asset and validates its geometry catalog", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "src", "three", "RefinedMannequin.tsx"),
      "utf8",
    ).catch(() => "");

    expect(source).toContain(
      "useGLTF(BUILT_IN_REFINED_MANNEQUIN_URL)",
    );
    expect(source).toContain("createRefinedGeometryCatalog(scene)");
    expect(source).toContain("refinedSectionForPrimitive(primitive)");
    expect(source).toContain("refinedPrimitiveTransform(primitive)");
  });

  it("keeps complete procedural loading and error fallbacks", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "src", "three", "RefinedMannequin.tsx"),
      "utf8",
    ).catch(() => "");

    expect(source).toMatch(/<Suspense\s+fallback=\{fallback\}>/u);
    expect(source).toContain("RefinedMannequinBoundary");
    expect(source).toContain("renderProcedural(primitive)");
    expect(source).toContain("REFINED_MANNEQUIN_FALLBACK");
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
