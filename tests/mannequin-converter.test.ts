import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const converterPath = path.join(
  repositoryRoot,
  "scripts",
  "assets",
  "build-refined-mannequin.py",
);

describe("refined mannequin converter", () => {
  it("keeps the audited source collections and sixteen output sections explicit", async () => {
    const source = await readFile(converterPath, "utf8").catch(() => "");

    expect(source).toContain(
      'FEMALE_COLLECTION = "Body Female - Primitve (Realistic)"',
    );
    expect(source).toContain(
      'MALE_COLLECTION = "Body Male - Primitve (Realistic)"',
    );
    for (const sectionId of [
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
    ]) {
      expect(source).toContain(`"${sectionId}"`);
    }
  });

  it("locks neutralization, one subdivision level, and terminal grouping", async () => {
    const source = await readFile(converterPath, "utf8").catch(() => "");

    expect(source).toContain(
      '"GEO-breasts_primitive_female_realistic"',
    );
    expect(source).toContain("SUBDIVISION_LEVEL = 1");
    expect(source).toMatch(/finger[\s\S]*hand/iu);
    expect(source).toMatch(/(?:toe|teo)[\s\S]*foot/iu);
    expect(source).toContain("average_source_mesh");
    expect(source).toContain("normalize_section");
  });

  it("exports a closed GLB without authoring-only payloads", async () => {
    const source = await readFile(converterPath, "utf8").catch(() => "");

    expect(source).toContain('export_format="GLB"');
    expect(source).toContain("export_animations=False");
    expect(source).toContain("export_cameras=False");
    expect(source).toContain("export_lights=False");
    expect(source).toContain("export_extras=False");
    expect(source).toContain("use_selection=True");
    expect(source).toContain('parser.add_argument("--source", required=True)');
    expect(source).toContain('parser.add_argument("--output", required=True)');
  });
});
