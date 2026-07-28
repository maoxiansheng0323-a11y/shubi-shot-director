import type { SceneSpec, TransformSpec } from "../domain/scene-schema";
import type { EditorStoreState } from "./editor-store";
import {
  createCameraLensPatch,
  createTransformPatch,
  transformsEqual,
} from "./manual-patches";
import {
  decideShotCameraGesture,
  type ShotCameraGestureSession,
} from "./shot-camera-session";

export type ShotCameraCommandState = Pick<
  EditorStoreState,
  "scene" | "applyPatch"
>;

const currentGestureCamera = (
  state: ShotCameraCommandState,
  session: ShotCameraGestureSession,
) => {
  const scene = state.scene;
  if (
    !scene ||
    decideShotCameraGesture(session, scene, session.cameraId).status !==
      "commit"
  ) {
    return null;
  }
  const camera = scene.entities.find(
    (entity) =>
      entity.kind === "camera" && entity.id === session.cameraId,
  );
  return camera?.kind === "camera" ? { scene, camera } : null;
};

export const commitShotCameraTransform = async (
  getState: () => ShotCameraCommandState,
  session: ShotCameraGestureSession,
  transform: TransformSpec,
): Promise<SceneSpec | void> => {
  const state = getState();
  const current = currentGestureCamera(state, session);
  if (!current || transformsEqual(current.camera.transform, transform)) {
    return;
  }
  return state.applyPatch(
    createTransformPatch(current.scene, current.camera.id, transform, {
      preserveLock: true,
    }),
  );
};

export const commitShotCameraFocalLength = async (
  getState: () => ShotCameraCommandState,
  session: ShotCameraGestureSession,
  focalLengthMm: number,
): Promise<SceneSpec | void> => {
  const state = getState();
  const current = currentGestureCamera(state, session);
  if (
    !current ||
    Math.abs(current.camera.lens.focalLengthMm - focalLengthMm) < 1e-8
  ) {
    return;
  }
  return state.applyPatch(
    createCameraLensPatch(
      current.scene,
      current.camera,
      focalLengthMm,
      { preserveLock: true },
    ),
  );
};
