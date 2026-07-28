import type { SceneSpec } from "../domain/scene-schema";

export interface ShotCameraGestureSession {
  sceneId: string;
  baseRevision: number;
  cameraId: string;
  cancelled: boolean;
}

export type ShotCameraGestureDecision =
  | { status: "commit" }
  | {
      status: "conflict";
      code: "SHOT_CAMERA_REVISION_CONFLICT";
    }
  | { status: "blocked"; code: "SHOT_CAMERA_USER_LOCKED" };

export const createShotCameraGestureSession = (
  scene: SceneSpec,
  cameraId: string,
): ShotCameraGestureSession => ({
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  cameraId,
  cancelled: false,
});

export const decideShotCameraGesture = (
  session: ShotCameraGestureSession | null,
  scene: SceneSpec,
  cameraId: string,
): ShotCameraGestureDecision => {
  const camera = scene.entities.find(
    (entity) =>
      entity.kind === "camera" && entity.id === cameraId,
  );
  if (camera?.kind === "camera" && camera.lockMode === "user") {
    return { status: "blocked", code: "SHOT_CAMERA_USER_LOCKED" };
  }
  if (
    !session ||
    session.cancelled ||
    session.sceneId !== scene.sceneId ||
    session.baseRevision !== scene.revision ||
    session.cameraId !== cameraId ||
    scene.activeCameraId !== cameraId ||
    camera?.kind !== "camera"
  ) {
    return {
      status: "conflict",
      code: "SHOT_CAMERA_REVISION_CONFLICT",
    };
  }
  return { status: "commit" };
};
