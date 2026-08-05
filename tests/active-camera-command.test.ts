import { describe, expect, it, vi } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import type { ScenePatch } from "../src/domain/scene-patch";
import type { CameraEntity, SceneSpec } from "../src/domain/scene-schema";
import {
  activateShotCamera,
  type ActiveCameraCommandState,
} from "../src/editor/active-camera-command";

const addCamera = (
  scene: SceneSpec,
  id = "camera_shot_2",
  lockMode: CameraEntity["lockMode"] = "none",
): CameraEntity => {
  const source = scene.entities.find(
    (entity): entity is CameraEntity => entity.kind === "camera",
  );
  if (!source) throw new Error("Camera fixture is missing.");
  const camera: CameraEntity = {
    ...structuredClone(source),
    id,
    label: "Second shot camera",
    lockMode,
  };
  scene.entities.push(camera);
  return camera;
};

const createHarness = (initialScene: SceneSpec | null) => {
  let scene = initialScene;
  const applyPatch = vi.fn(async (patch: ScenePatch) => {
    if (!scene) throw new Error("Scene fixture is missing.");
    scene = applyScenePatch(scene, patch).next;
    return scene;
  });
  const getState = (): ActiveCameraCommandState => ({ scene, applyPatch });
  return { applyPatch, getState, getScene: () => scene };
};

describe("active shot camera command", () => {
  it("submits one active-camera operation from the latest authoritative scene", async () => {
    const scene = createDefaultScene();
    const camera = addCamera(scene);
    scene.revision = 8;
    const harness = createHarness(scene);

    const accepted = await activateShotCamera(harness.getState, camera.id);

    expect(harness.applyPatch).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: scene.sceneId,
        baseRevision: 8,
        operations: [
          {
            op: "scene.active-camera.set",
            cameraId: camera.id,
          },
        ],
      }),
    );
    expect(accepted?.activeCameraId).toBe(camera.id);
  });

  it("returns null without submitting for current, missing, or non-camera IDs", async () => {
    const scene = createDefaultScene();
    const harness = createHarness(scene);

    await expect(
      activateShotCamera(harness.getState, scene.activeCameraId),
    ).resolves.toBeNull();
    await expect(
      activateShotCamera(harness.getState, "camera_missing_1"),
    ).resolves.toBeNull();
    await expect(
      activateShotCamera(harness.getState, "actor_generic_1"),
    ).resolves.toBeNull();

    expect(harness.applyPatch).not.toHaveBeenCalled();
  });

  it("activates a user-protected camera without mutating its camera data", async () => {
    const scene = createDefaultScene();
    const camera = addCamera(scene, "camera_protected_1", "user");
    const before = structuredClone(camera);
    const harness = createHarness(scene);

    const accepted = await activateShotCamera(harness.getState, camera.id);

    const activated = accepted?.entities.find(
      (entity) => entity.id === camera.id,
    );
    expect(accepted?.activeCameraId).toBe(camera.id);
    expect(activated).toEqual(before);
    expect(harness.applyPatch).toHaveBeenCalledTimes(1);
  });

  it("returns null after one failed submission and never retries", async () => {
    const scene = createDefaultScene();
    const camera = addCamera(scene);
    const failure = new Error("active camera rejected");
    const applyPatch = vi.fn().mockRejectedValue(failure);
    const getState = (): ActiveCameraCommandState => ({ scene, applyPatch });

    await expect(activateShotCamera(getState, camera.id)).resolves.toBeNull();
    expect(applyPatch).toHaveBeenCalledTimes(1);
  });

  it("returns null when no authoritative scene is loaded", async () => {
    const harness = createHarness(null);

    await expect(
      activateShotCamera(harness.getState, "camera_shot_2"),
    ).resolves.toBeNull();
    expect(harness.applyPatch).not.toHaveBeenCalled();
  });
});
