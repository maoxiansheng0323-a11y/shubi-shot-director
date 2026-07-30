import { describe, expect, it, vi } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import type { ScenePatch } from "../src/domain/scene-patch";
import type {
  CameraEntity,
  SceneSpec,
  TransformSpec,
} from "../src/domain/scene-schema";
import {
  commitShotCameraFocalLength,
  commitShotCameraTransform,
  type ShotCameraCommandState,
} from "../src/editor/shot-camera-commands";
import { createShotCameraGestureSession } from "../src/editor/shot-camera-session";

const requireCamera = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (!camera) {
    throw new Error("Shot camera command fixture is missing its camera.");
  }
  return camera;
};

const createHarness = (initialScene = createDefaultScene()) => {
  let scene: SceneSpec = initialScene;
  const applyPatch = vi.fn(async (patch: ScenePatch) => {
    scene = applyScenePatch(scene, patch).next;
    return scene;
  });
  const getState = (): ShotCameraCommandState => ({ scene, applyPatch });
  return {
    applyPatch,
    getScene: () => scene,
    getState,
    setScene: (next: SceneSpec) => {
      scene = next;
    },
  };
};

describe("shot camera commands", () => {
  it("commits one transform patch and restores a workflow lock", async () => {
    const scene = createDefaultScene();
    const camera = requireCamera(scene);
    camera.lockMode = "workflow";
    const harness = createHarness(scene);
    const session = createShotCameraGestureSession(scene, camera.id);
    const transform: TransformSpec = {
      ...camera.transform,
      positionM: [1, 2, 3],
    };

    const accepted = await commitShotCameraTransform(
      harness.getState,
      session,
      transform,
    );

    expect(harness.applyPatch).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({ preserveLock: true }),
    );
    expect(requireCamera(accepted ?? harness.getScene()).transform).toEqual(
      transform,
    );
    expect(requireCamera(accepted ?? harness.getScene()).lockMode).toBe(
      "workflow",
    );
  });

  it.each([
    "no-op",
    "stale-revision",
    "changed-scene",
    "changed-active-camera",
    "user-lock",
  ] as const)("rejects a %s transform without applying a Patch", async (caseName) => {
    const scene = createDefaultScene();
    const camera = requireCamera(scene);
    camera.lockMode = "workflow";
    const session = createShotCameraGestureSession(scene, camera.id);
    const harness = createHarness(scene);
    const transform: TransformSpec = {
      ...camera.transform,
      positionM: [1, 2, 3],
    };
    const current = structuredClone(scene);
    if (caseName === "no-op") {
      transform.positionM = [...camera.transform.positionM];
    } else if (caseName === "stale-revision") {
      current.revision += 1;
      harness.setScene(current);
    } else if (caseName === "changed-scene") {
      current.sceneId = "scene_replacement";
      harness.setScene(current);
    } else if (caseName === "changed-active-camera") {
      current.activeCameraId = "camera_replacement";
      harness.setScene(current);
    } else {
      requireCamera(current).lockMode = "user";
      harness.setScene(current);
    }

    await commitShotCameraTransform(harness.getState, session, transform);

    expect(harness.applyPatch).not.toHaveBeenCalled();
  });

  it("commits focal length while preserving a workflow lock", async () => {
    const scene = createDefaultScene();
    const camera = requireCamera(scene);
    camera.lockMode = "workflow";
    const harness = createHarness(scene);
    const session = createShotCameraGestureSession(scene, camera.id);

    const accepted = await commitShotCameraFocalLength(
      harness.getState,
      session,
      62,
    );

    expect(harness.applyPatch).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({ preserveLock: true }),
    );
    expect(requireCamera(accepted ?? harness.getScene()).lens.focalLengthMm).toBe(
      62,
    );
    expect(requireCamera(accepted ?? harness.getScene()).lockMode).toBe(
      "workflow",
    );
  });

  it("skips an exact focal-length no-op", async () => {
    const scene = createDefaultScene();
    const camera = requireCamera(scene);
    const harness = createHarness(scene);
    const session = createShotCameraGestureSession(scene, camera.id);

    await commitShotCameraFocalLength(
      harness.getState,
      session,
      camera.lens.focalLengthMm,
    );

    expect(harness.applyPatch).not.toHaveBeenCalled();
  });
});
