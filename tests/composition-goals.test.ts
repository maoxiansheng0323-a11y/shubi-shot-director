import { describe, expect, it } from "vitest";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  sceneOperationSchema,
  scenePatchSchema,
} from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";

describe("optional SceneSpec composition goals", () => {
  it("keeps legacy schemaVersion 1 scenes valid without adding a field", () => {
    const scene = createDefaultScene();
    const parsed = sceneSpecSchema.parse(scene);

    expect(parsed.schemaVersion).toBe(1);
    expect("compositionGoals" in parsed).toBe(false);
  });

  it("accepts generic actor framing, reserved zones, and critical props", () => {
    const scene = createDefaultScene();
    scene.compositionGoals = {
      framing: {
        mode: "full",
        targetEntityIds: ["actor_generic_1"],
      },
      captionZone: {
        bottomFraction: 0.24,
      },
      sideUiZone: {
        side: "right",
        widthFraction: 0.2,
      },
      criticalEntityIds: ["actor_generic_1", "prop_block_1"],
    };

    expect(sceneSpecSchema.parse(scene).compositionGoals).toEqual(
      scene.compositionGoals,
    );
  });

  it("rejects missing targets and actor/whole-prop kind mismatches", () => {
    const missing = createDefaultScene();
    missing.compositionGoals = {
      criticalEntityIds: ["prop_missing_1"],
    };
    expect(() => sceneSpecSchema.parse(missing)).toThrow();

    const wrongActorMode = createDefaultScene();
    wrongActorMode.compositionGoals = {
      framing: {
        mode: "full",
        targetEntityIds: ["prop_block_1"],
      },
    };
    expect(() => sceneSpecSchema.parse(wrongActorMode)).toThrow();

    const wrongPropMode = createDefaultScene();
    wrongPropMode.compositionGoals = {
      framing: {
        mode: "whole-prop",
        targetEntityIds: ["actor_generic_1"],
      },
    };
    expect(() => sceneSpecSchema.parse(wrongPropMode)).toThrow();
  });
});

describe("composition goal patch operation", () => {
  it("sets and clears composition goals through one allowlisted operation", () => {
    const scene = createDefaultScene();
    const setOperation = sceneOperationSchema.parse({
      op: "scene.composition-goals.set",
      value: {
        framing: {
          mode: "whole-prop",
          targetEntityIds: ["prop_block_1"],
        },
        captionZone: {
          bottomFraction: 0.25,
        },
        criticalEntityIds: ["prop_block_1"],
      },
    });
    if (setOperation.op !== "scene.composition-goals.set") {
      throw new Error("Composition goal operation did not validate.");
    }
    const setPatch = scenePatchSchema.parse({
      schemaVersion: 1,
      patchId: "patch_set_composition",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      operations: [setOperation],
    });

    const setResult = applyScenePatch(scene, setPatch);
    expect(setResult.next.compositionGoals).toEqual(setOperation.value);
    expect(setResult.next.revision).toBe(1);

    const clearResult = applyScenePatch(setResult.next, {
      schemaVersion: 1,
      patchId: "patch_clear_composition",
      sceneId: scene.sceneId,
      baseRevision: setResult.next.revision,
      source: "manual",
      operations: [
        {
          op: "scene.composition-goals.set",
          value: null,
        },
      ],
    });
    expect("compositionGoals" in clearResult.next).toBe(false);
    expect(clearResult.next.revision).toBe(2);
  });

  it("prevents removing an entity referenced by composition goals", () => {
    const scene = createDefaultScene();
    scene.compositionGoals = {
      criticalEntityIds: ["prop_block_1"],
    };

    expect(() =>
      applyScenePatch(scene, {
        schemaVersion: 1,
        patchId: "patch_remove_critical",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "manual",
        operations: [
          {
            op: "entity.remove",
            entityId: "prop_block_1",
          },
        ],
      }),
    ).toThrowError(SceneDomainError);
  });
});
