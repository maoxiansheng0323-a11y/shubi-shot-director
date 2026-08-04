import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { actorAnchorWorldPoint } from "../src/domain/actor-projection";
import { lookAtQuaternion, rotateVector } from "../src/domain/scene-math";
import type {
  CameraEntity,
  TransformSpec,
  SceneSpec,
  Vec3,
} from "../src/domain/scene-schema";
import { sceneSpecSchema } from "../src/domain/scene-schema";
import {
  adjustShotFocalLength,
  deriveShotOrbitTarget,
  deriveShotPanReferenceDistance,
  moveShotCameraByKey,
  orbitShotCamera,
  panShotCamera,
  rotateShotCameraFree,
  SHOT_ORBIT_MAX_PITCH,
  SHOT_ORBIT_RADIANS_PER_PIXEL,
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

const expectQuaternionEquivalent = (
  actual: TransformSpec["rotation"],
  expected: TransformSpec["rotation"],
): void => {
  const dotProduct = actual.reduce(
    (sum, component, index) => sum + component * expected[index],
    0,
  );
  expect(Math.abs(dotProduct)).toBeCloseTo(1, 8);
};

describe("shot camera navigation", () => {
  it("pans in the image plane without changing camera direction", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const next = panShotCamera(camera, 5, [100, -50], 720);
    const delta = subtract(next.positionM, camera.transform.positionM);
    const right = rotateVector([1, 0, 0], camera.transform.rotation);
    const up = rotateVector([0, 1, 0], camera.transform.rotation);

    expect(next.rotation).toEqual(camera.transform.rotation);
    expect(dot(delta, right)).toBeGreaterThan(0);
    expect(dot(delta, up)).toBeGreaterThan(0);
  });

  it("derives a finite positive pan distance from an explicit target", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    camera.transform.positionM = [3, 4, 0];

    const explicitDistance = deriveShotPanReferenceDistance(
      scene,
      camera,
      [0, 0, 0],
    );
    const fallbackDistance = deriveShotPanReferenceDistance(
      scene,
      camera,
      [Number.NaN, 0, 0],
    );

    expect(explicitDistance).toBe(5);
    expect(Number.isFinite(fallbackDistance)).toBe(true);
    expect(fallbackDistance).toBeGreaterThan(0);
  });

  it("keeps free pan depth independent of framing and keep-visible semantics", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (actor?.kind !== "actor") {
      throw new Error("Shot camera fixture is missing an actor.");
    }
    const baseline = deriveShotPanReferenceDistance(
      scene,
      camera,
      null,
    );

    scene.compositionGoals = {
      framing: {
        mode: "medium",
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

    expect(
      deriveShotPanReferenceDistance(scene, camera, null),
    ).toBeCloseTo(baseline, 8);
  });

  it("handles the schema entity limit without aggregating visible actor points", () => {
    const scene = createDefaultScene();
    const actorTemplate = scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (actorTemplate?.kind !== "actor") {
      throw new Error("Shot camera fixture is missing an actor.");
    }
    const actors = Array.from({ length: 253 }, (_, index) => {
      const actor = structuredClone(actorTemplate);
      actor.id = `actor_generic_${index + 1}`;
      actor.slot = `actor_generic_${index + 1}`;
      return actor;
    });
    scene.entities = [
      ...scene.entities.filter((entity) => entity.kind !== "actor"),
      ...actors,
    ];
    const parsed = sceneSpecSchema.parse(scene);
    const camera = activeCameraIn(parsed);
    let distanceM = Number.NaN;

    expect(() => {
      distanceM = deriveShotPanReferenceDistance(parsed, camera, null);
    }).not.toThrow();
    expect(Number.isFinite(distanceM)).toBe(true);
    expect(distanceM).toBeGreaterThan(0);
  });

  it("keeps free pan distance finite for extreme finite scene depth", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const prop = scene.entities.find(
      (entity) => entity.kind === "prop",
    );
    if (prop?.kind !== "prop") {
      throw new Error("Shot camera fixture is missing a prop.");
    }
    for (const entity of scene.entities) {
      if (entity.kind !== "camera") {
        entity.visible = entity.id === prop.id;
      }
    }
    camera.transform.positionM = [0, 0, 0];
    camera.transform.rotation = lookAtQuaternion(
      camera.transform.positionM,
      [0, 0, -1],
    );
    prop.transform.positionM = [0, 0, -1e308];

    const distanceM = deriveShotPanReferenceDistance(
      scene,
      camera,
      null,
    );

    expect(Number.isFinite(distanceM)).toBe(true);
    expect(distanceM).toBeGreaterThan(0);
  });

  it("clamps an underflowed positive depth midpoint to the minimum distance", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const environment = scene.entities.find(
      (entity) => entity.kind === "environment",
    );
    if (environment?.kind !== "environment") {
      throw new Error("Shot camera fixture is missing an environment.");
    }
    for (const entity of scene.entities) {
      if (entity.kind !== "camera") {
        entity.visible = entity.id === environment.id;
      }
    }
    camera.transform.positionM = [0, 0, 0];
    camera.transform.rotation = lookAtQuaternion(
      camera.transform.positionM,
      [0, 0, -1],
    );
    environment.transform.positionM = [0, 0, -Number.MIN_VALUE];

    expect(
      deriveShotPanReferenceDistance(scene, camera, null),
    ).toBe(0.1);
  });

  it("keeps the legacy pan target overload compatible until the controller migrates", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const targetM: Vec3 = [0, 1, 0];
    const distanceM = Math.hypot(
      ...subtract(camera.transform.positionM, targetM),
    );

    expect(panShotCamera(camera, targetM, [32, -18], 720)).toEqual(
      panShotCamera(camera, distanceM, [32, -18], 720),
    );
  });

  it("rotates freely without changing position or scale", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const before = structuredClone(camera.transform);

    const next = rotateShotCameraFree(camera, [90, -25]);

    expect(next.positionM).toEqual(before.positionM);
    expect(next.scale).toEqual(before.scale);
    expect(camera.transform).toEqual(before);
  });

  it("applies horizontal yaw from the original camera forward", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    camera.transform.rotation = lookAtQuaternion([0, 0, 0], [0, 0, -1]);

    const next = rotateShotCameraFree(camera, [100, 0]);
    const forward = rotateVector([0, 0, -1], next.rotation);

    expect(forward[0]).toBeGreaterThan(0);
    expect(forward[1]).toBeCloseTo(0, 8);
    expect(forward[2]).toBeCloseTo(
      -Math.cos(100 * SHOT_ORBIT_RADIANS_PER_PIXEL),
      8,
    );
  });

  it("clamps vertical pitch before the camera reaches a pole", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    camera.transform.rotation = lookAtQuaternion([0, 0, 0], [0, 0, -1]);

    const next = rotateShotCameraFree(camera, [0, -100_000]);
    const forward = rotateVector([0, 0, -1], next.rotation);
    const pitch = Math.asin(forward[1]);

    expect(pitch).toBeCloseTo(SHOT_ORBIT_MAX_PITCH, 8);
    expect(Math.abs(forward[1])).toBeLessThan(1);
  });

  it("rebuilds a normalized look quaternion without roll", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const next = rotateShotCameraFree(camera, [173, -91]);
    const right = rotateVector([1, 0, 0], next.rotation);
    const quaternionLength = Math.hypot(...next.rotation);

    expect(quaternionLength).toBeCloseTo(1, 8);
    expect(right[1]).toBeCloseTo(0, 8);
  });

  it("is independent of pointer-event frequency when given total delta", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const replay = (events: readonly (readonly [number, number])[]) => {
      let result = camera.transform;
      for (const totalDelta of events) {
        result = rotateShotCameraFree(camera, totalDelta);
      }
      return result;
    };

    const sparse = replay([[240, -75]]);
    const dense = replay([
      [40, -10],
      [80, -25],
      [120, -35],
      [180, -55],
      [240, -75],
    ]);

    expect(sparse.positionM).toEqual(dense.positionM);
    expectQuaternionEquivalent(sparse.rotation, dense.rotation);
  });

  it("returns to the original direction after one horizontal revolution", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);
    const oneRevolutionPx =
      (Math.PI * 2) / SHOT_ORBIT_RADIANS_PER_PIXEL;

    const next = rotateShotCameraFree(camera, [oneRevolutionPx, 0]);
    const beforeForward = rotateVector(
      [0, 0, -1],
      camera.transform.rotation,
    );
    const afterForward = rotateVector([0, 0, -1], next.rotation);

    for (let axis = 0; axis < 3; axis += 1) {
      expect(afterForward[axis]).toBeCloseTo(beforeForward[axis], 8);
    }
  });

  it("rotates from camera transform alone without scene semantics", () => {
    const scene = createDefaultScene();
    const camera = activeCameraIn(scene);

    expect(() => rotateShotCameraFree(camera, [10, 20])).not.toThrow();
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
