import { describe, expect, it } from "vitest";
import {
  deriveActorAnatomyDimensions,
  resolveActorLimbPresenceUpdates,
} from "../src/domain/actor-anatomy";
import {
  actorVisibleFramingPoints,
  actorVisibleRigBounds,
} from "../src/domain/actor-visible-bounds";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  actorAnchorWorldPoint,
  resolveLegacyActorProjection,
  type ActorProjectionPrimitive,
  type ActorRigFrame,
} from "../src/domain/actor-projection";
import {
  addVectors,
  quaternionFromEulerDegrees,
  rotateVector,
  transformPoint,
} from "../src/domain/scene-math";
import { materializePose } from "../src/domain/presets/pose-presets";
import type { ActorEntity, SceneSpec, Vec3 } from "../src/domain/scene-schema";

const actorIn = (scene: SceneSpec): ActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is ActorEntity => entity.kind === "actor",
  );
  if (!actor) {
    throw new Error("Actor fixture is missing.");
  }
  return actor;
};

const componentBounds = (points: readonly Vec3[]): { min: Vec3; max: Vec3 } => ({
  min: [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.min(...points.map((point) => point[2])),
  ],
  max: [
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[2])),
  ],
});

const expectVecClose = (actual: Vec3, expected: Vec3): void => {
  for (let axis = 0; axis < 3; axis += 1) {
    expect(actual[axis]).toBeCloseTo(expected[axis], 9);
  }
};

const expectPointClose = (
  points: readonly Vec3[],
  expected: Vec3,
): void => {
  expect(
    points.some((point) =>
      point.every(
        (component, axis) =>
          Math.abs(component - expected[axis]) <= 1e-9,
      ),
    ),
  ).toBe(true);
};

const primitiveById = (
  primitives: readonly ActorProjectionPrimitive[],
  id: string,
): ActorProjectionPrimitive => {
  const primitive = primitives.find((candidate) => candidate.id === id);
  if (!primitive) throw new Error(`Missing primitive ${id}.`);
  return primitive;
};

const framePoint = (frame: ActorRigFrame, point: Vec3): Vec3 =>
  addVectors(frame.position, rotateVector(point, frame.rotation));

describe("actor visible rig bounds", () => {
  it("preserves standing support within one millimeter and includes both feet", () => {
    const actor = actorIn(createDefaultScene());

    const bounds = actorVisibleRigBounds(actor);

    expect(bounds).not.toHaveProperty("primitives");
    expect(Math.abs(bounds.supportOffsetM - 0.977)).toBeLessThanOrEqual(0.001);
    expect(bounds.primitiveIds).toEqual(
      expect.arrayContaining(["foot_l", "foot_r"]),
    );
    expect(Math.abs(bounds.minWorld[1])).toBeLessThanOrEqual(0.001);
  });

  it("omits absent limb descendants and derives a shorter visible support", () => {
    const actor = actorIn(createDefaultScene());
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      {
        upper_arm_r: "absent",
        lower_leg_l: "absent",
        lower_leg_r: "absent",
      },
    );

    const bounds = actorVisibleRigBounds(actor);

    expect(bounds.primitiveIds).not.toEqual(
      expect.arrayContaining([
        "shoulder_r",
        "upper_arm_r",
        "elbow_r",
        "forearm_r",
        "hand_r",
        "knee_l",
        "lower_leg_l",
        "foot_l",
        "knee_r",
        "lower_leg_r",
        "foot_r",
      ]),
    );
    expect(bounds.supportOffsetM).toBeLessThan(0.977);
  });

  it("matches neutral upper-leg profile endpoints to the joint-to-end span", () => {
    const actor = actorIn(createDefaultScene());
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      {
        upper_arm_l: "absent",
        upper_arm_r: "absent",
        lower_leg_l: "absent",
        lower_leg_r: "absent",
      },
    );
    const dimensions = deriveActorAnatomyDimensions(actor.body);
    const expectedSupportM =
      dimensions.upperLegLength - dimensions.hipOriginY;

    const bounds = actorVisibleRigBounds(actor);

    expect(bounds.supportOffsetM).toBeCloseTo(expectedSupportM, 9);
    expect(bounds.minLocal[1]).toBeCloseTo(-expectedSupportM, 9);
  });

  it("matches neutral lower-leg profile endpoint when the foot is absent", () => {
    const actor = actorIn(createDefaultScene());
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      {
        upper_arm_l: "absent",
        upper_arm_r: "absent",
        upper_leg_l: "absent",
        foot_r: "absent",
      },
    );
    const dimensions = deriveActorAnatomyDimensions(actor.body);
    const expectedSupportM =
      dimensions.upperLegLength +
      dimensions.lowerLegLength -
      dimensions.hipOriginY;

    const bounds = actorVisibleRigBounds(actor);

    expect(bounds.supportOffsetM).toBeCloseTo(expectedSupportM, 9);
    expect(bounds.minLocal[1]).toBeCloseTo(-expectedSupportM, 9);
  });

  it("includes exact actor-local extrema for every rotated limb profile ring", () => {
    const actor = actorIn(createDefaultScene());
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      {
        upper_arm_r: "absent",
        forearm_l: "absent",
        upper_leg_l: "absent",
        upper_leg_r: "absent",
      },
    );
    const rotation = quaternionFromEulerDegrees([0, 0, 45]);
    actor.pose.joints.upper_arm_l = rotation;
    const upper = primitiveById(
      resolveLegacyActorProjection(actor).primitives,
      "upper_arm_l",
    );
    if (upper.kind !== "profile") throw new Error("Expected upper-arm profile.");
    const ring = upper.points.reduce((widest, point) =>
      point.radius > widest.radius ? point : widest,
    );
    const basisX = rotateVector([1, 0, 0], upper.frame.rotation);
    const basisZ = rotateVector([0, 0, 1], upper.frame.rotation);
    const radiusZ = ring.radius * upper.depthScale;
    const denominator = Math.hypot(
      ring.radius * basisX[0],
      radiusZ * basisZ[0],
    );
    const ringOffset: Vec3 = [
      (ring.radius * ring.radius * basisX[0]) / denominator,
      0,
      (radiusZ * radiusZ * basisZ[0]) / denominator,
    ];
    const expectedMaxX = framePoint(upper.frame, [
      upper.center[0] + ringOffset[0],
      upper.center[1] + ring.y,
      upper.center[2] + ringOffset[2],
    ]);

    const bounds = actorVisibleRigBounds(actor);

    expectPointClose(bounds.localPoints, expectedMaxX);
  });

  it("adds affine world-extrema preimages for rotated ellipsoids under non-uniform scale", () => {
    const actor = actorIn(createDefaultScene());
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      {
        upper_arm_l: "absent",
        upper_arm_r: "absent",
        upper_leg_l: "absent",
        upper_leg_r: "absent",
      },
    );
    const transform = {
      positionM: [0.3, -0.2, 1.1] as Vec3,
      rotation: quaternionFromEulerDegrees([0, 0, 45]),
      scale: [5, 1, 1] as Vec3,
    };
    const ellipsoid = primitiveById(
      resolveLegacyActorProjection(actor).primitives,
      "face",
    );
    if (ellipsoid.kind !== "ellipsoid") {
      throw new Error("Expected face ellipsoid.");
    }
    const ellipsoidCenter = framePoint(ellipsoid.frame, [...ellipsoid.center]);
    const linearTransform = { ...transform, positionM: [0, 0, 0] as Vec3 };
    const primitiveAxes = ([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const).map((axis) => rotateVector([...axis], ellipsoid.frame.rotation));
    const worldAxes = primitiveAxes.map((axis) =>
      transformPoint(linearTransform, axis),
    );
    const gradient: Vec3 = worldAxes.map((axis) => axis[0]) as Vec3;
    const denominator = Math.hypot(
      ellipsoid.radii[0] * gradient[0],
      ellipsoid.radii[1] * gradient[1],
      ellipsoid.radii[2] * gradient[2],
    );
    const primitiveOffset: Vec3 = [
      (ellipsoid.radii[0] ** 2 * gradient[0]) / denominator,
      (ellipsoid.radii[1] ** 2 * gradient[1]) / denominator,
      (ellipsoid.radii[2] ** 2 * gradient[2]) / denominator,
    ];
    const localOffset = rotateVector(primitiveOffset, ellipsoid.frame.rotation);
    const expectedLocalMax: Vec3 = [
      ellipsoidCenter[0] + localOffset[0],
      ellipsoidCenter[1] + localOffset[1],
      ellipsoidCenter[2] + localOffset[2],
    ];
    const expectedLocalMin: Vec3 = [
      ellipsoidCenter[0] - localOffset[0],
      ellipsoidCenter[1] - localOffset[1],
      ellipsoidCenter[2] - localOffset[2],
    ];
    const expectedWorldMax = transformPoint(transform, expectedLocalMax);
    const expectedWorldMin = transformPoint(transform, expectedLocalMin);

    const bounds = actorVisibleRigBounds(actor, transform);

    expectPointClose(bounds.localPoints, expectedLocalMax);
    expectPointClose(bounds.localPoints, expectedLocalMin);
    expectPointClose(bounds.worldPoints, expectedWorldMax);
    expectPointClose(bounds.worldPoints, expectedWorldMin);
    expect(bounds.maxWorld[0]).toBeGreaterThanOrEqual(expectedWorldMax[0]);
    expect(bounds.minWorld[0]).toBeLessThanOrEqual(expectedWorldMin[0]);
  });

  it("keeps pose-aware local and transformed world bounds consistent", () => {
    const actor = actorIn(createDefaultScene());
    const neutralLocalPoints = actorVisibleRigBounds(actor).localPoints;
    actor.pose = materializePose(actor, "pose.kneeling-lean-v1");
    actor.transform = {
      positionM: [1.2, -0.4, 2.1],
      rotation: quaternionFromEulerDegrees([12, 35, -18]),
      scale: [1.3, 0.85, 0.7],
    };

    const bounds = actorVisibleRigBounds(actor);
    const expectedLocal = componentBounds(bounds.localPoints);
    const expectedWorld = componentBounds(bounds.worldPoints);

    expect(bounds.localPoints).toHaveLength(bounds.worldPoints.length);
    expect(bounds.localPoints.length).toBeGreaterThan(40);
    expect(bounds.localPoints).not.toEqual(neutralLocalPoints);
    bounds.localPoints.forEach((localPoint, index) => {
      expectVecClose(
        bounds.worldPoints[index] as Vec3,
        transformPoint(actor.transform, localPoint),
      );
    });
    expectVecClose(bounds.minLocal, expectedLocal.min);
    expectVecClose(bounds.maxLocal, expectedLocal.max);
    expectVecClose(bounds.minWorld, expectedWorld.min);
    expectVecClose(bounds.maxWorld, expectedWorld.max);
    expect(bounds.supportOffsetM).toBeCloseTo(
      actor.transform.positionM[1] - bounds.minWorld[1],
      9,
    );

    const framingPoints = actorVisibleFramingPoints(actor, 0.5);
    expect(framingPoints).toContainEqual(actorAnchorWorldPoint(actor, "face"));
    expect(framingPoints).toContainEqual(actorAnchorWorldPoint(actor, "head"));
    expect(framingPoints.length).toBeLessThan(bounds.worldPoints.length);
  });
});
