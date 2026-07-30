import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { actorAnchorWorldPoint } from "../src/domain/actor-projection";
import { rotateVector } from "../src/domain/scene-math";
import type {
  CameraEntity,
  SceneSpec,
  Vec3,
} from "../src/domain/scene-schema";
import {
  adjustShotFocalLength,
  deriveShotOrbitTarget,
  moveShotCameraByKey,
  orbitShotCamera,
  panShotCamera,
} from "../src/editor/shot-camera-navigation";

const activeCameraIn = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (!camera) {
    throw new Error("Shot camera fixture is missing an active camera.");
  }
  return camera;
};

const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const dot = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return value.map((component) => component / length) as Vec3;
};

describe("shot camera navigation", () => {
  it("pans in the image plane without changing camera direction", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const targetM: Vec3 = [0, 1, 0];
    const next = panShotCamera(camera, targetM, [100, -50], 720);
    const delta = subtract(next.positionM, camera.transform.positionM);
    const right = rotateVector([1, 0, 0], camera.transform.rotation);
    const up = rotateVector([0, 1, 0], camera.transform.rotation);

    expect(next.rotation).toEqual(camera.transform.rotation);
    expect(dot(delta, right)).toBeGreaterThan(0);
    expect(dot(delta, up)).toBeGreaterThan(0);
  });

  it("orbits at a fixed radius and keeps looking at the target", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const targetM: Vec3 = [0, 1, 0];
    const beforeRadius = Math.hypot(
      ...subtract(camera.transform.positionM, targetM),
    );
    const next = orbitShotCamera(camera, targetM, [120, -45]);
    const afterRadius = Math.hypot(...subtract(next.positionM, targetM));
    const forward = normalize(
      rotateVector([0, 0, -1], next.rotation),
    );
    const toTarget = normalize(subtract(targetM, next.positionM));

    expect(afterRadius).toBeCloseTo(beforeRadius, 8);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(forward[axis]).toBeCloseTo(toTarget[axis], 8);
    }
  });

  it("supports a full horizontal revolution without changing radius", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const targetM: Vec3 = [0, 1, 0];
    const oneRevolutionPx = (Math.PI * 2) / 0.005;
    const next = orbitShotCamera(
      camera,
      targetM,
      [oneRevolutionPx, 0],
    );

    for (let axis = 0; axis < 3; axis += 1) {
      expect(next.positionM[axis]).toBeCloseTo(
        camera.transform.positionM[axis],
        8,
      );
    }
  });

  it.each([
    ["ArrowUp", [0, 0, -1]],
    ["ArrowDown", [0, 0, 1]],
    ["ArrowLeft", [-1, 0, 0]],
    ["ArrowRight", [1, 0, 0]],
    ["PageUp", [0, 1, 0]],
    ["PageDown", [0, -1, 0]],
  ] as const)("moves %s in the approved direction", (key, direction) => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const next = moveShotCameraByKey(camera, key, {});
    const delta = subtract(next.positionM, camera.transform.positionM);
    const expectedDirection = key.startsWith("Page")
      ? ([...direction] as Vec3)
      : rotateVector([...direction], camera.transform.rotation);

    for (let axis = 0; axis < 3; axis += 1) {
      expect(delta[axis]).toBeCloseTo(expectedDirection[axis] * 0.1, 8);
    }
    expect(next.rotation).toEqual(camera.transform.rotation);
  });

  it("uses fast and precision keyboard modifiers with precision precedence", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const normal = moveShotCameraByKey(camera, "PageUp", {});
    const fast = moveShotCameraByKey(camera, "PageUp", {
      shiftKey: true,
    });
    const precise = moveShotCameraByKey(camera, "PageUp", {
      shiftKey: true,
      altKey: true,
    });

    expect(normal.positionM[1] - camera.transform.positionM[1]).toBeCloseTo(
      0.1,
      8,
    );
    expect(fast.positionM[1] - camera.transform.positionM[1]).toBeCloseTo(
      0.5,
      8,
    );
    expect(precise.positionM[1] - camera.transform.positionM[1]).toBeCloseTo(
      0.02,
      8,
    );
  });

  it("normalizes wheel direction, modifiers, and focal-length clamps", () => {
    expect(adjustShotFocalLength(35, -120, {})).toBe(35.5);
    expect(
      adjustShotFocalLength(35, -120, { shiftKey: true }),
    ).toBe(37);
    expect(
      adjustShotFocalLength(35, -120, {
        shiftKey: true,
        altKey: true,
      }),
    ).toBe(35.1);
    expect(
      adjustShotFocalLength(299.9, -1, { shiftKey: true }),
    ).toBe(300);
    expect(
      adjustShotFocalLength(12.1, 1, { shiftKey: true }),
    ).toBe(12);
    expect(adjustShotFocalLength(35, 0, {})).toBe(35);
  });

  it("prefers a framing keep-visible anchor for the orbit target", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (actor?.kind !== "actor") {
      throw new Error("Shot camera fixture is missing an actor.");
    }
    scene.compositionGoals = {
      framing: {
        mode: "full",
        targetEntityIds: [actor.id],
      },
    };
    scene.constraints.push({
      id: "constraint_visible_actor_1",
      type: "keep-visible",
      cameraId: camera.id,
      subjectEntityId: actor.id,
      anchor: "face",
      enabled: true,
    });

    expect(deriveShotOrbitTarget(scene, camera)).toEqual({
      targetM: actorAnchorWorldPoint(actor, "face"),
      source: "keep-visible-framing",
    });
  });

  it("falls back to a finite point on the camera-forward ray", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    scene.compositionGoals = undefined;
    scene.constraints = [];
    scene.entities = scene.entities.map((entity) =>
      entity.kind === "camera" ? entity : { ...entity, visible: false },
    );

    const target = deriveShotOrbitTarget(scene, camera);
    const offset = subtract(target.targetM, camera.transform.positionM);
    const forward = normalize(
      rotateVector([0, 0, -1], camera.transform.rotation),
    );

    expect(target.source).toBe("camera-forward");
    expect(Math.hypot(...offset)).toBeCloseTo(5, 8);
    expect(dot(normalize(offset), forward)).toBeCloseTo(1, 8);
  });
});
