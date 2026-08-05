import type { ScenePatch } from "../domain/scene-patch";
import type {
  QuaternionTuple,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";
import type { CanonicalPuppetJointId } from "../domain/actor-joints";
import {
  createActorJointPatch,
  createTransformPatch,
  transformsEqual,
} from "./manual-patches";

export interface StudioEntityCommandState {
  scene: SceneSpec | null;
  applyPatch: (patch: ScenePatch) => Promise<SceneSpec>;
}

export const createStudioEntityTransformPatch = (
  scene: SceneSpec,
  entityId: string,
  transform: TransformSpec,
): ScenePatch | null => {
  const entity = scene.entities.find((candidate) => candidate.id === entityId);
  if (
    !entity ||
    entity.kind === "environment" ||
    entity.lockMode === "user" ||
    transformsEqual(entity.transform, transform)
  ) {
    return null;
  }
  return createTransformPatch(scene, entityId, transform, {
    preserveLock: entity.lockMode === "workflow",
  });
};

export const commitStudioEntityTransform = async (
  getState: () => StudioEntityCommandState,
  entityId: string,
  transform: TransformSpec,
): Promise<SceneSpec | null> => {
  const state = getState();
  if (!state.scene) return null;
  const patch = createStudioEntityTransformPatch(state.scene, entityId, transform);
  if (!patch) return null;
  try {
    return await state.applyPatch(patch);
  } catch {
    return null;
  }
};

export const createStudioActorJointPatch = (
  scene: SceneSpec,
  actorId: string,
  jointId: CanonicalPuppetJointId,
  rotation: QuaternionTuple,
): ScenePatch | null => {
  const actor = scene.entities.find((candidate) => candidate.id === actorId);
  if (actor?.kind !== "actor" || actor.lockMode === "user") return null;
  const current = actor.pose.joints[jointId];
  if (current && current.every((value, index) => Math.abs(value - rotation[index]) <= 1e-6)) {
    return null;
  }
  return createActorJointPatch(scene, actorId, jointId, rotation, {
    preserveLock: actor.lockMode === "workflow",
  });
};

export const commitStudioActorJoint = async (
  getState: () => StudioEntityCommandState,
  actorId: string,
  jointId: CanonicalPuppetJointId,
  rotation: QuaternionTuple,
): Promise<SceneSpec | null> => {
  const state = getState();
  if (!state.scene) return null;
  const patch = createStudioActorJointPatch(
    state.scene,
    actorId,
    jointId,
    rotation,
  );
  if (!patch) return null;
  try {
    return await state.applyPatch(patch);
  } catch {
    return null;
  }
};
