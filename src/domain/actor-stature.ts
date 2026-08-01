import type { ActorBlueprintSnapshot } from "./actor-blueprint";
import {
  isLegacyActorEntity,
  type AnyActorEntity,
  type BlueprintActorEntity,
  type SceneSpec,
} from "./scene-schema";

export {
  MAX_ACTOR_HEIGHT_M,
  MIN_ACTOR_HEIGHT_M,
} from "./actor-stature-limits";

export const requireActorBlueprintSnapshot = (
  scene: Pick<SceneSpec, "actorBlueprints">,
  actor: BlueprintActorEntity,
): ActorBlueprintSnapshot => {
  const snapshot = scene.actorBlueprints.find(
    ({ blueprintId }) =>
      blueprintId === actor.blueprintInstance.blueprintId,
  );
  if (!snapshot) {
    throw new Error("ACTOR_BLUEPRINT_REFERENCE_INVALID");
  }
  return snapshot;
};

export const actorStatureHeightM = (
  scene: Pick<SceneSpec, "actorBlueprints">,
  actor: AnyActorEntity,
): number =>
  isLegacyActorEntity(actor)
    ? actor.body.heightM
    : requireActorBlueprintSnapshot(scene, actor).body.heightM *
      actor.blueprintInstance.heightScale;
