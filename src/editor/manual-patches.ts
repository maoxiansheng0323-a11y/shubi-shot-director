import type {
  SceneOperation,
  ScenePatch,
} from "../domain/scene-patch";
import type {
  CameraEntity,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";

let patchSequence = 0;

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
): ScenePatch => ({
  schemaVersion: 1,
  patchId: nextPatchId(scope),
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source,
  operations,
});

export const createTransformPatch = (
  scene: SceneSpec,
  entityId: string,
  transform: TransformSpec,
): ScenePatch =>
  createOperationsPatch(scene, "transform", [
    {
      op: "entity.transform.set",
      entityId,
      value: transform,
    },
  ]);

export const createCameraLensPatch = (
  scene: SceneSpec,
  camera: CameraEntity,
  focalLengthMm: number,
): ScenePatch =>
  createOperationsPatch(scene, "lens", [
    {
      op: "camera.lens.set",
      entityId: camera.id,
      value: {
        ...camera.lens,
        focalLengthMm,
      },
    },
  ]);

export const createLockedPatch = (
  scene: SceneSpec,
  entityId: string,
  visible: boolean,
  locked: boolean,
): ScenePatch =>
  createOperationsPatch(scene, "flags", [
    {
      op: "entity.flags.set",
      entityId,
      visible,
      locked,
    },
  ]);
