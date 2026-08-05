import type {
  SceneOperation,
  ScenePatch,
} from "../domain/scene-patch";
import type {
  CameraEntity,
  QuaternionTuple,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";
import type { ActorLimbPresenceUpdates } from "../domain/actor-anatomy";
import type { CanonicalPuppetJointId } from "../domain/actor-joints";
import type { EntityLockMode } from "../domain/entity-lock";
import { PATCH_SCHEMA_VERSION } from "../domain/schema-versions";

let patchSequence = 0;

export interface ManualPatchOptions {
  preserveLock?: boolean;
}

export const nextManualLockMode = (
  current: EntityLockMode,
): EntityLockMode => (current === "none" ? "user" : "none");

const nextPatchId = (scope: string): string => {
  patchSequence = (patchSequence + 1) % 1_679_616;
  return `manual_${scope}_${Date.now().toString(36)}_${patchSequence.toString(36)}`;
};

const sameNumbers = (
  left: readonly number[],
  right: readonly number[],
  epsilon = 1e-6,
): boolean =>
  left.length === right.length &&
  left.every((value, index) => Math.abs(value - right[index]) <= epsilon);

export const transformsEqual = (
  left: TransformSpec,
  right: TransformSpec,
): boolean =>
  sameNumbers(left.positionM, right.positionM) &&
  sameNumbers(left.rotation, right.rotation) &&
  sameNumbers(left.scale, right.scale);

export const createOperationsPatch = (
  scene: SceneSpec,
  scope: string,
  operations: SceneOperation[],
  source: ScenePatch["source"] = "manual",
  preserveLock = false,
): ScenePatch => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: nextPatchId(scope),
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source,
  preserveLock,
  operations,
});

export const createTransformPatch = (
  scene: SceneSpec,
  entityId: string,
  transform: TransformSpec,
  options: ManualPatchOptions = {},
): ScenePatch =>
  createOperationsPatch(
    scene,
    "transform",
    [
      {
        op: "entity.transform.set",
        entityId,
        value: transform,
      },
    ],
    "manual",
    options.preserveLock ?? false,
  );

export const createCameraLensPatch = (
  scene: SceneSpec,
  camera: CameraEntity,
  focalLengthMm: number,
  options: ManualPatchOptions = {},
): ScenePatch =>
  createOperationsPatch(
    scene,
    "lens",
    [
      {
        op: "camera.lens.set",
        entityId: camera.id,
        value: {
          ...camera.lens,
          focalLengthMm,
        },
      },
    ],
    "manual",
    options.preserveLock ?? false,
  );

export const createActiveCameraPatch = (
  scene: SceneSpec,
  cameraId: string,
): ScenePatch | null => {
  const camera = scene.entities.find((entity) => entity.id === cameraId);
  if (camera?.kind !== "camera" || scene.activeCameraId === cameraId) {
    return null;
  }
  return createOperationsPatch(scene, "active_camera", [
    {
      op: "scene.active-camera.set",
      cameraId,
    },
  ]);
};

export const createLockModePatch = (
  scene: SceneSpec,
  entityId: string,
  lockMode: EntityLockMode,
): ScenePatch =>
  createOperationsPatch(scene, "flags", [
    {
      op: "entity.flags.set",
      entityId,
      lockMode,
    },
  ]);

export const createActorLimbPresencePatch = (
  scene: SceneSpec,
  actorId: string,
  updates: ActorLimbPresenceUpdates,
): ScenePatch =>
  createOperationsPatch(scene, "limb_presence", [
    {
      op: "actor.limb-presence.set",
      actorId,
      updates,
    },
  ]);

export const createActorHeightPatch = (
  scene: SceneSpec,
  actorId: string,
  heightM: number,
): ScenePatch =>
  createOperationsPatch(scene, "actor_height", [
    {
      op: "actor.height.set",
      actorId,
      heightM,
    },
  ]);

export const createActorJointPatch = (
  scene: SceneSpec,
  actorId: string,
  jointId: CanonicalPuppetJointId,
  rotation: QuaternionTuple,
  options: ManualPatchOptions = {},
): ScenePatch =>
  createOperationsPatch(
    scene,
    "actor_joint",
    [
      {
        op: "actor.pose.joints.set",
        actorId,
        updates: { [jointId]: rotation },
      },
    ],
    "manual",
    options.preserveLock ?? false,
  );

export const createActorVariantPatch = (
  scene: SceneSpec,
  actorId: string,
  variantId: string,
): ScenePatch =>
  createOperationsPatch(scene, "actor_variant", [
    {
      op: "actor.variant.set",
      actorId,
      variantId,
    },
  ]);
