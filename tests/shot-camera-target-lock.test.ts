import { describe, expect, it } from "vitest";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { createDefaultScene } from "../src/domain/default-scene";
import { quaternionFromEulerDegrees, transformPoint } from "../src/domain/scene-math";
import type { SceneSpec, Vec3 } from "../src/domain/scene-schema";
import {
  listShotOrbitTargets,
  reconcileShotOrbitTargetId,
  resolveShotOrbitTargetCenter,
} from "../src/editor/shot-camera-target-lock";

const midpoint = (minimum: Vec3, maximum: Vec3): Vec3 => [
  (minimum[0] + maximum[0]) / 2,
  (minimum[1] + maximum[1]) / 2,
  (minimum[2] + maximum[2]) / 2,
];

const expectVectorClose = (actual: Vec3, expected: Vec3): void => {
  for (let axis = 0; axis < 3; axis += 1) {
    expect(actual[axis]).toBeCloseTo(expected[axis], 8);
  }
};

describe("shot camera explicit target lock", () => {
  it("lists visible actors and props in stable scene entity order", () => {
    const scene = createDefaultScene();

    expect(listShotOrbitTargets(scene)).toEqual([
      {
        entityId: "actor_generic_1",
        label: "Generic actor",
        kind: "actor",
      },
      {
        entityId: "prop_block_1",
        label: "Blocking cube",
        kind: "prop",
      },
    ]);

    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!prop) throw new Error("Missing generic prop fixture.");
    prop.visible = false;
    expect(listShotOrbitTargets(scene).map(({ entityId }) => entityId)).toEqual([
      "actor_generic_1",
    ]);
  });

  it("uses a generic kind label only when a human-readable label is missing", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!actor || !prop) throw new Error("Missing generic target fixtures.");
    (actor as { label: string }).label = "   ";
    (prop as { label: string }).label = "";

    expect(listShotOrbitTargets(scene).map(({ label }) => label)).toEqual([
      "Actor",
      "Prop",
    ]);
  });

  it("resolves an actor target from the current visible rig bounds", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (actor?.kind !== "actor") throw new Error("Missing generic actor fixture.");
    const bounds = actorVisibleRigBounds(scene, actor);

    const center = resolveShotOrbitTargetCenter(scene, actor.id);

    expect(center).not.toBeNull();
    expectVectorClose(center!, midpoint(bounds.minWorld, bounds.maxWorld));
  });

  it("resolves a prop target from all eight fully transformed geometry corners", () => {
    const scene = createDefaultScene();
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (prop?.kind !== "prop") throw new Error("Missing generic prop fixture.");
    prop.transform.positionM = [2, -1, 4];
    prop.transform.rotation = quaternionFromEulerDegrees([27, 41, -13]);
    prop.transform.scale = [2, 0.5, 3];
    const [width, height, depth] = prop.geometry.sizeM;
    const corners: Vec3[] = [];
    for (const x of [-width / 2, width / 2]) {
      for (const y of [-height / 2, height / 2]) {
        for (const z of [-depth / 2, depth / 2]) {
          corners.push(transformPoint(prop.transform, [x, y, z]));
        }
      }
    }
    const minimum: Vec3 = [
      Math.min(...corners.map((point) => point[0])),
      Math.min(...corners.map((point) => point[1])),
      Math.min(...corners.map((point) => point[2])),
    ];
    const maximum: Vec3 = [
      Math.max(...corners.map((point) => point[0])),
      Math.max(...corners.map((point) => point[1])),
      Math.max(...corners.map((point) => point[2])),
    ];

    const center = resolveShotOrbitTargetCenter(scene, prop.id);

    expect(center).not.toBeNull();
    expectVectorClose(center!, midpoint(minimum, maximum));
  });

  it("keeps an extreme finite prop target center finite", () => {
    const scene = createDefaultScene();
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (prop?.kind !== "prop") {
      throw new Error("Missing generic prop fixture.");
    }
    prop.transform.positionM = [1e308, -1e308, 1e308];

    const center = resolveShotOrbitTargetCenter(scene, prop.id);

    expect(center).not.toBeNull();
    expect(center?.every(Number.isFinite)).toBe(true);
    expect(center).toEqual(prop.transform.positionM);
  });

  it("rejects hidden, removed, unsupported, and non-finite targets", () => {
    const hiddenScene = createDefaultScene();
    const hiddenActor = hiddenScene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!hiddenActor) throw new Error("Missing generic actor fixture.");
    hiddenActor.visible = false;
    expect(resolveShotOrbitTargetCenter(hiddenScene, hiddenActor.id)).toBeNull();

    const invalidScene = createDefaultScene();
    const invalidProp = invalidScene.entities.find(
      (entity) => entity.kind === "prop",
    );
    if (invalidProp?.kind !== "prop") throw new Error("Missing generic prop fixture.");
    invalidProp.transform.positionM[0] = Number.NaN;
    expect(resolveShotOrbitTargetCenter(invalidScene, invalidProp.id)).toBeNull();
    expect(resolveShotOrbitTargetCenter(invalidScene, "missing_target")).toBeNull();
    expect(resolveShotOrbitTargetCenter(invalidScene, "environment_room_1")).toBeNull();
    expect(resolveShotOrbitTargetCenter(invalidScene, "camera_shot_1")).toBeNull();
  });

  it("preserves only a still-valid target in the same scene and camera context", () => {
    const scene = createDefaultScene();
    const previous = {
      sceneId: scene.sceneId,
      activeCameraId: scene.activeCameraId,
      entityId: "actor_generic_1",
    };

    expect(reconcileShotOrbitTargetId(scene, scene.activeCameraId, previous)).toBe(
      "actor_generic_1",
    );
    expect(
      reconcileShotOrbitTargetId(
        { ...scene, sceneId: "scene_replacement" },
        scene.activeCameraId,
        previous,
      ),
    ).toBeNull();
    expect(reconcileShotOrbitTargetId(scene, "camera_replacement", previous)).toBeNull();

    const hiddenScene = structuredClone(scene) as SceneSpec;
    const actor = hiddenScene.entities.find(
      (entity) => entity.id === previous.entityId,
    );
    if (!actor) throw new Error("Missing generic actor fixture.");
    actor.visible = false;
    expect(
      reconcileShotOrbitTargetId(hiddenScene, hiddenScene.activeCameraId, previous),
    ).toBeNull();
  });
});
