import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { validateIntentCoverage } from "../src/domain/intent-coverage";
import {
  INTENT_REPORT_SCHEMA_VERSION,
  type IntentReport,
} from "../src/domain/intent-report";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import { sceneSpecSchema } from "../src/domain/scene-schema";

const createSpatialScene = () => {
  const scene = createDefaultScene();
  scene.entities = scene.entities.filter(
    (entity) => entity.kind !== "environment",
  );
  scene.constraints = [];
  scene.spatialLayout = {
    floorY: 0,
    regions: [
      {
        id: "region_alpha",
        label: "Alpha",
        footprintXZ: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        heightM: 2.8,
        visible: true,
      },
    ],
    boundaries: [],
    openings: [],
    connections: [],
    memberships: [],
  };
  return sceneSpecSchema.parse(scene);
};

describe("spatial intent coverage", () => {
  it("accepts region evidence from an abstract connected-layout scene", () => {
    const scene = createSpatialScene();
    const report: IntentReport = {
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
      operation: "create",
      allowPartial: false,
      recognizedConstraints: [
        {
          id: "intent_region_alpha_1",
          kind: "spatial-region",
          required: true,
          targets: ["region_alpha"],
          evidence: [
            {
              type: "scene-property",
              path: "scene.spatialLayout.regions",
            },
          ],
        },
      ],
      unsupportedConstraints: [],
      unresolvedRelations: [],
      warnings: [],
      canApplySafely: true,
    };

    expect(() =>
      validateIntentCoverage(report, { after: scene }),
    ).not.toThrow();
  });

  it("accepts an allowlisted region-visibility patch operation", () => {
    const before = createSpatialScene();
    const patch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_region_visibility_1",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language" as const,
      preserveLock: false,
      operations: [
        {
          op: "spatial.region.visibility.set" as const,
          regionId: "region_alpha",
          visible: false,
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const report: IntentReport = {
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
      operation: "modify",
      allowPartial: false,
      recognizedConstraints: [
        {
          id: "intent_region_visibility_1",
          kind: "region-visibility",
          required: true,
          targets: ["region_alpha"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
      unsupportedConstraints: [],
      unresolvedRelations: [],
      warnings: [],
      canApplySafely: true,
    };

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });
});
