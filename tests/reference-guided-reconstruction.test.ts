import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { analyzeComposition } from "../src/domain/composition-safety";
import { parseSceneSubmission } from "../src/domain/scene-submission";

const exampleUrl = new URL(
  "../examples/reference-guided-reconstruction.scene-submission.json",
  import.meta.url,
);
const workflowUrl = new URL(
  "../.agents/skills/shubi-shot-director/references/reference-guided-reconstruction.md",
  import.meta.url,
);
const skillUrl = new URL(
  "../.agents/skills/shubi-shot-director/SKILL.md",
  import.meta.url,
);

const propIdsWithPrefix = (
  ids: readonly string[],
  prefix: string,
): string[] => ids.filter((id) => id.startsWith(prefix));

describe("reference-guided reconstruction workflow", () => {
  it("ships a generic, dense, editable small-interior reconstruction", async () => {
    const source = await readFile(exampleUrl, "utf8");
    const submission = parseSceneSubmission(JSON.parse(source));
    const { scene } = submission;
    const layout = scene.spatialLayout;
    const props = scene.entities.filter((entity) => entity.kind === "prop");
    const propIds = props.map(({ id }) => id);

    expect(scene.sceneId).toBe("scene_generic_reconstruction_1");
    expect(scene.output).toEqual({
      aspect: { width: 16, height: 9 },
      resolutionPx: { width: 1920, height: 1080 },
    });
    expect(layout?.regions).toHaveLength(1);
    expect(layout?.boundaries).toHaveLength(4);
    expect(layout?.openings.map(({ id }) => id)).toEqual([
      "opening_studio_entrance",
      "opening_studio_window",
    ]);
    expect(layout?.connections).toEqual([]);
    expect(props).toHaveLength(44);
    expect(props.every(({ parentId }) => parentId === null)).toBe(true);
    expect(
      new Set(props.map(({ geometry }) => geometry.primitive)),
    ).toEqual(new Set(["box", "capsule", "cylinder", "plane"]));
    expect(propIdsWithPrefix(propIds, "prop_sleep_").length).toBeGreaterThanOrEqual(8);
    expect(propIdsWithPrefix(propIds, "prop_work_").length).toBeGreaterThanOrEqual(12);
    expect(propIdsWithPrefix(propIds, "prop_service_").length).toBeGreaterThanOrEqual(8);
    expect(propIdsWithPrefix(propIds, "prop_entry_").length).toBeGreaterThanOrEqual(6);
    expect(propIdsWithPrefix(propIds, "prop_floor_").length).toBeGreaterThanOrEqual(3);
    expect(layout?.memberships).toHaveLength(scene.entities.length);
    expect(new Set(layout?.memberships.map(({ entityId }) => entityId))).toEqual(
      new Set(scene.entities.map(({ id }) => id)),
    );
    expect(submission.intentReport.unsupportedConstraints).toEqual([]);
    expect(submission.intentReport.unresolvedRelations).toEqual([]);
    expect(
      submission.intentReport.recognizedConstraints.some(
        ({ kind }) => kind === "spatial-opening",
      ),
    ).toBe(true);
    expect(
      submission.intentReport.recognizedConstraints.filter(
        ({ kind }) => kind === "relationship",
      ),
    ).toHaveLength(4);
    const composition = analyzeComposition(scene);
    expect(composition.topologySafe.status).toBe("unchecked");
    expect(composition.cameraCollisionSafe.status).toBe("pass");
    expect(source).not.toMatch(
      /(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:users|home)\/|file:\/\/)/iu,
    );
    expect(source).not.toMatch(
      /(?:"(?:prompt|profile|sourcePath|sourceFile|externalPath)"\s*:)/iu,
    );
  });

  it("requires Host-only reference reasoning and keeps camera choice manual", async () => {
    const [workflow, skill] = await Promise.all([
      readFile(workflowUrl, "utf8"),
      readFile(skillUrl, "utf8"),
    ]);

    expect(skill).toContain("reference-guided-reconstruction.md");
    expect(workflow).toContain("Host Codex");
    expect(workflow).toContain("not runtime input");
    expect(workflow).toContain("certain");
    expect(workflow).toContain("inferred");
    expect(workflow).toContain("unresolved");
    expect(workflow).toContain("parentId: null");
    expect(workflow).toMatch(/automatic camera\s+selection/iu);
    expect(workflow).toContain("The user, not an automatic candidate system");
    expect(workflow).toContain("1920 --height 1080");
  });
});
