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
import { actorAnchorWorldPoint } from "../src/domain/humanoid-rig";
import {
  quaternionFromEulerDegrees,
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

  it("matches neutral upper-leg capsule outer endpoints to the joint-to-end span", () => {
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

  it("matches neutral lower-leg capsule outer endpoint when the foot is absent", () => {
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

  it("expands rotated limb cap centers on actor-local sphere axes", () => {
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
    const dimensions = deriveActorAnatomyDimensions(actor.body);
    const cylinderLength = Math.max(
      0.01,
      dimensions.upperArmLength - dimensions.armRadius * 2,
    );
    const topY =
      -dimensions.upperArmLength / 2 + cylinderLength / 2;
    const bottomY =
      -dimensions.upperArmLength / 2 - cylinderLength / 2;
    const rotatedTop = transformPoint(
      {
        positionM: [
          dimensions.shoulderOffsetX,
          dimensions.spineOriginY + dimensions.shoulderOriginY,
          0,
        ],
        rotation,
        scale: [1, 1, 1],
      },
      [0, topY, 0],
    );
    const radius = dimensions.armRadius;
    const rotatedBottom = transformPoint(
      {
        positionM: [
          dimensions.shoulderOffsetX,
          dimensions.spineOriginY + dimensions.shoulderOriginY,
          0,
        ],
        rotation,
        scale: [1, 1, 1],
      },
      [0, bottomY, 0],
    );

    const bounds = actorVisibleRigBounds(actor);

    for (const offset of [
      [radius, 0, 0],
      [-radius, 0, 0],
      [0, radius, 0],
      [0, -radius, 0],
      [0, 0, radius],
      [0, 0, -radius],
    ] as const) {
      expectPointClose(bounds.localPoints, [
        rotatedTop[0] + offset[0],
        rotatedTop[1] + offset[1],
        rotatedTop[2] + offset[2],
      ]);
    }
    expect(bounds.maxLocal[0]).toBeCloseTo(rotatedBottom[0] + radius, 9);
  });

  it("adds affine world-extrema preimages for non-uniformly scaled spheres", () => {
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
    const dimensions = deriveActorAnatomyDimensions(actor.body);
    const transform = {
      positionM: [0.3, -0.2, 1.1] as Vec3,
      rotation: quaternionFromEulerDegrees([0, 0, 45]),
      scale: [5, 1, 1] as Vec3,
    };
    const headCenter: Vec3 = [
      0,
      dimensions.spineOriginY + dimensions.headOriginY,
      0,
    ];
    const linearTransform = { ...transform, positionM: [0, 0, 0] as Vec3 };
    const columnX = transformPoint(linearTransform, [1, 0, 0]);
    const columnY = transformPoint(linearTransform, [0, 1, 0]);
    const columnZ = transformPoint(linearTransform, [0, 0, 1]);
    const gradient: Vec3 = [columnX[0], columnY[0], columnZ[0]];
    const gradientLength = Math.hypot(...gradient);
    const localOffset = gradient.map(
      (component) =>
        (component / gradientLength) * dimensions.headRadius,
    ) as Vec3;
    const expectedLocalMax: Vec3 = [
      headCenter[0] + localOffset[0],
      headCenter[1] + localOffset[1],
      headCenter[2] + localOffset[2],
    ];
    const expectedLocalMin: Vec3 = [
      headCenter[0] - localOffset[0],
      headCenter[1] - localOffset[1],
      headCenter[2] - localOffset[2],
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
