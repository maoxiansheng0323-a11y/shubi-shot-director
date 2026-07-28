import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  createShotCameraGestureSession,
  decideShotCameraGesture,
} from "../src/editor/shot-camera-session";

describe("shot camera gesture session", () => {
  it("accepts the exact active camera at the captured revision", () => {
    const scene = createDefaultScene();
    const camera = scene.entities.find(
      (entity) => entity.kind === "camera",
    );
    if (camera?.kind !== "camera") {
      throw new Error("Session fixture is missing a camera.");
    }
    camera.lockMode = "workflow";
    const session = createShotCameraGestureSession(scene, camera.id);

    expect(decideShotCameraGesture(session, scene, camera.id)).toEqual({
      status: "commit",
    });
  });

  it.each([
    "revision",
    "scene",
    "camera",
    "active-camera",
    "cancelled",
  ] as const)("rejects a %s conflict", (conflict) => {
    const scene = createDefaultScene();
    const camera = scene.entities.find(
      (entity) => entity.kind === "camera",
    );
    if (camera?.kind !== "camera") {
      throw new Error("Session fixture is missing a camera.");
    }
    const session = createShotCameraGestureSession(scene, camera.id);
    const current = structuredClone(scene);
    let cameraId = camera.id;
    if (conflict === "revision") {
      current.revision += 1;
    } else if (conflict === "scene") {
      current.sceneId = "scene_replacement";
    } else if (conflict === "camera") {
      cameraId = "camera_other";
    } else if (conflict === "active-camera") {
      current.activeCameraId = "camera_other";
    } else {
      session.cancelled = true;
    }

    expect(
      decideShotCameraGesture(session, current, cameraId),
    ).toEqual({
      status: "conflict",
      code: "SHOT_CAMERA_REVISION_CONFLICT",
    });
  });

  it("blocks a user-protected camera before commit", () => {
    const scene = createDefaultScene();
    const camera = scene.entities.find(
      (entity) => entity.kind === "camera",
    );
    if (camera?.kind !== "camera") {
      throw new Error("Session fixture is missing a camera.");
    }
    const session = createShotCameraGestureSession(scene, camera.id);
    camera.lockMode = "user";

    expect(decideShotCameraGesture(session, scene, camera.id)).toEqual({
      status: "blocked",
      code: "SHOT_CAMERA_USER_LOCKED",
    });
  });
});
