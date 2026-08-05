import { describe, expect, it, vi } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import {
  createStudioActorJointPatch,
  createStudioEntityTransformPatch,
  commitStudioEntityTransform,
} from "../src/editor/studio-entity-commands";
import type { ScenePatch } from "../src/domain/scene-patch";

describe("studio entity transform commands", () => {
  it("creates one transform operation and preserves workflow lock", () => {
    const scene = createDefaultScene();
    const prop = scene.entities.find((entity) => entity.id === "prop_block_1")!;
    prop.lockMode = "workflow";
    const nextTransform = {
      ...prop.transform,
      positionM: [2, 0.35, 1] as [number, number, number],
    };
    const patch = createStudioEntityTransformPatch(scene, prop.id, nextTransform);
    expect(patch).toMatchObject({
      preserveLock: true,
      operations: [
        { op: "entity.transform.set", entityId: prop.id, value: nextTransform },
      ],
    });
  });

  it("commits once and never retries an absolute draft after failure", async () => {
    const scene = createDefaultScene();
    const prop = scene.entities.find((entity) => entity.id === "prop_block_1")!;
    const applyPatch = vi.fn<(patch: ScenePatch) => Promise<never>>().mockRejectedValue(
      new Error("rejected"),
    );
    await expect(
      commitStudioEntityTransform(
        () => ({ scene, applyPatch }),
        prop.id,
        { ...prop.transform, positionM: [1, 0.35, 1] },
      ),
    ).resolves.toBeNull();
    expect(applyPatch).toHaveBeenCalledTimes(1);

    const accepted = applyScenePatch(
      scene,
      createStudioEntityTransformPatch(
        scene,
        prop.id,
        { ...prop.transform, positionM: [1, 0.35, 1] },
      ),
    ).next;
    expect(accepted.revision).toBe(scene.revision + 1);
  });

  it("creates one joint patch and preserves a workflow lock", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.id === "actor_generic_1")!;
    actor.lockMode = "workflow";
    const patch = createStudioActorJointPatch(
      scene,
      actor.id,
      "upper_arm_r",
      [0, 0.2, 0, 0.98],
    );
    expect(patch).toMatchObject({
      preserveLock: true,
      operations: [
        {
          op: "actor.pose.joints.set",
          actorId: actor.id,
          updates: { upper_arm_r: [0, 0.2, 0, 0.98] },
        },
      ],
    });
  });
});
