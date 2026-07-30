import { describe, expect, it, vi } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { createActorLimbPresencePatch } from "../src/editor/manual-patches";
import {
  applyActorLimbPresenceCommand,
  type ActorLimbPresenceCommandState,
} from "../src/editor/limb-presence-command";
import type { SceneSpec } from "../src/domain/scene-schema";

const actorId = "actor_generic_1";

const stateFor = (
  scene: SceneSpec | null,
  applyPatch: ActorLimbPresenceCommandState["applyPatch"],
): ActorLimbPresenceCommandState => ({ scene, applyPatch });

describe("authoritative limb presence command", () => {
  it("reads the latest scene revision each time a stable callback is invoked", async () => {
    let currentScene: SceneSpec = createDefaultScene();
    const submitted = [] as Array<ReturnType<typeof createActorLimbPresencePatch>>;
    const getState = () =>
      stateFor(currentScene, async (patch) => {
        submitted.push(patch);
        currentScene = applyScenePatch(currentScene, patch).next;
        return currentScene;
      });

    const stableCallback = (partId: "upper_arm_l" | "hand_l", mode: "absent") =>
      applyActorLimbPresenceCommand(getState, actorId, partId, mode);

    await stableCallback("upper_arm_l", "absent");
    currentScene = {
      ...structuredClone(currentScene),
      sceneId: "scene_replacement_latest",
      revision: 7,
    };
    await stableCallback("hand_l", "absent");

    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toMatchObject({
      sceneId: "scene_starter",
      baseRevision: 0,
    });
    expect(submitted[1]).toMatchObject({
      sceneId: "scene_replacement_latest",
      baseRevision: 7,
    });
  });

  it.each(["workflow", "user"] as const)(
    "does not submit a patch for a %s locked actor",
    async (lockMode) => {
      const scene = createDefaultScene();
      const actor = scene.entities.find(
        (entity) => entity.id === actorId && entity.kind === "actor",
      );
      if (!actor || actor.kind !== "actor") throw new Error("Actor missing.");
      actor.lockMode = lockMode;
      const applyPatch = vi.fn();

      await applyActorLimbPresenceCommand(
        () => stateFor(scene, applyPatch),
        actorId,
        "upper_arm_l",
        "absent",
      );

      expect(applyPatch).not.toHaveBeenCalled();
    },
  );

  it("does not submit a patch after the actor disappears", async () => {
    const applyPatch = vi.fn();
    await applyActorLimbPresenceCommand(
      () => stateFor(createDefaultScene(), applyPatch),
      "actor_missing_1",
      "upper_arm_l",
      "absent",
    );
    expect(applyPatch).not.toHaveBeenCalled();
  });
});
