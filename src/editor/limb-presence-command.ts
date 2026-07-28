import type {
  ActorLimbPartId,
  ActorLimbPresenceMode,
} from "../domain/actor-anatomy";
import type { ScenePatch } from "../domain/scene-patch";
import type { SceneSpec } from "../domain/scene-schema";
import { createActorLimbPresencePatch } from "./manual-patches";

export interface ActorLimbPresenceCommandState {
  scene: SceneSpec | null;
  applyPatch: (patch: ScenePatch) => Promise<SceneSpec>;
}

export const applyActorLimbPresenceCommand = async (
  getState: () => ActorLimbPresenceCommandState,
  actorId: string,
  partId: ActorLimbPartId,
  mode: ActorLimbPresenceMode,
): Promise<SceneSpec | null> => {
  const state = getState();
  const currentScene = state.scene;
  const actor = currentScene?.entities.find(
    (entity) => entity.id === actorId,
  );
  if (
    !currentScene ||
    actor?.kind !== "actor" ||
    actor.lockMode !== "none"
  ) {
    return null;
  }

  return state.applyPatch(
    createActorLimbPresencePatch(currentScene, actor.id, {
      [partId]: mode,
    }),
  );
};
