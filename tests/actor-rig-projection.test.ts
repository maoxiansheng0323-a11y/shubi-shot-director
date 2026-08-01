import { describe, expect, it } from "vitest";
import {
  deriveActorAnatomyDimensions,
  resolveActorLimbPresenceUpdates,
} from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  resolveLegacyActorProjection as deriveActorRigProjection,
  type ActorRigFrame,
  type ActorRigPrimitive,
} from "../src/domain/actor-projection";
import {
  multiplyQuaternions,
  quaternionFromEulerDegrees,
  rotateVector,
} from "../src/domain/scene-math";
import {
  listPosePresets,
  materializePose,
} from "../src/domain/presets/pose-presets";
import type {
  ActorEntity,
  QuaternionTuple,
  SceneSpec,
} from "../src/domain/scene-schema";

const actorIn = (scene: SceneSpec): ActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is ActorEntity => entity.kind === "actor",
  );
  if (!actor) throw new Error("Actor fixture is missing.");
  return actor;
};

const primitiveById = (
  primitives: readonly ActorRigPrimitive[],
  id: string,
): ActorRigPrimitive => {
  const primitive = primitives.find((candidate) => candidate.id === id);
  if (!primitive) throw new Error(`Missing primitive ${id}.`);
  return primitive;
};

const primitiveCenter = (primitive: ActorRigPrimitive): readonly number[] => {
  const rotatedCenter = rotateVector(
    [...primitive.center],
    primitive.frame.rotation,
  );
  return primitive.frame.position.map(
    (component, axis) => component + rotatedCenter[axis],
  );
};

const framePoint = (
  frame: ActorRigFrame,
  point: readonly [number, number, number],
): readonly number[] => {
  const rotated = rotateVector([...point], frame.rotation);
  return frame.position.map(
    (component, axis) => component + rotated[axis],
  );
};

describe("shared actor rig projection", () => {
  it("places actor-relative left on positive X when the face points positive Z", () => {
    const actor = actorIn(createDefaultScene());
    actor.pose = materializePose(actor, "pose.standing-neutral-v1");

    const projection = deriveActorRigProjection(actor);
    const face = primitiveById(projection.primitives, "face");
    const shoulderL = primitiveById(projection.primitives, "shoulder_l");
    const shoulderR = primitiveById(projection.primitives, "shoulder_r");
    const hipL = primitiveById(projection.primitives, "hip_l");
    const hipR = primitiveById(projection.primitives, "hip_r");

    expect(face.center[2]).toBeGreaterThan(0);
    expect(shoulderL.frame.position[0]).toBeGreaterThan(0);
    expect(shoulderR.frame.position[0]).toBeLessThan(0);
    expect(hipL.frame.position[0]).toBeGreaterThan(0);
    expect(hipR.frame.position[0]).toBeLessThan(0);
  });

  it.each(listPosePresets())(
    "keeps the $label limb bends on their anatomical sides",
    (preset) => {
      const actor = actorIn(createDefaultScene());
      actor.pose = materializePose(actor, preset.id);

      const projection = deriveActorRigProjection(actor);
      const shoulderL = primitiveById(projection.primitives, "shoulder_l");
      const shoulderR = primitiveById(projection.primitives, "shoulder_r");
      const upperArmL = primitiveById(projection.primitives, "upper_arm_l");
      const upperArmR = primitiveById(projection.primitives, "upper_arm_r");
      const hipL = primitiveById(projection.primitives, "hip_l");
      const hipR = primitiveById(projection.primitives, "hip_r");
      const upperLegL = primitiveById(projection.primitives, "upper_leg_l");
      const upperLegR = primitiveById(projection.primitives, "upper_leg_r");
      const epsilon = 1e-12;

      expect(
        primitiveCenter(upperArmL)[0] - shoulderL.frame.position[0],
      ).toBeGreaterThanOrEqual(-epsilon);
      expect(
        primitiveCenter(upperArmR)[0] - shoulderR.frame.position[0],
      ).toBeLessThanOrEqual(epsilon);
      expect(
        primitiveCenter(upperLegL)[0] - hipL.frame.position[0],
      ).toBeGreaterThanOrEqual(-epsilon);
      expect(
        primitiveCenter(upperLegR)[0] - hipR.frame.position[0],
      ).toBeLessThanOrEqual(epsilon);
    },
  );

  it.each([
    [
      "middle-absent",
      { forearm_r: "absent", lower_leg_l: "absent" },
      ["forearm_r", "hand_r", "knee_l", "lower_leg_l", "foot_l"],
    ],
    [
      "upper-absent",
      { upper_arm_l: "absent", upper_leg_r: "absent" },
      [
        "shoulder_l",
        "upper_arm_l",
        "elbow_l",
        "forearm_l",
        "hand_l",
        "hip_r",
        "upper_leg_r",
        "knee_r",
        "lower_leg_r",
        "foot_r",
      ],
    ],
    [
      "terminal-absent",
      { hand_l: "absent", foot_r: "absent" },
      ["hand_l", "foot_r"],
    ],
  ] as const)(
    "prunes %s descendants from the renderer projection",
    (_label, updates, absentIds) => {
      const actor = actorIn(createDefaultScene());
      actor.body.limbPresence = resolveActorLimbPresenceUpdates(
        actor.body.limbPresence,
        updates,
      );

      const projection = deriveActorRigProjection(actor);

      expect(projection.primitives.map(({ id }) => id)).not.toEqual(
        expect.arrayContaining([...absentIds]),
      );
    },
  );

  it.each(["l", "r"] as const)(
    "shares the rotated elbow frame with the %s forearm",
    (side) => {
      const actor = actorIn(createDefaultScene());
      const middleId = `forearm_${side}` as const;
      const elbowId = `elbow_${side}` as const;
      const legacyJoints = actor.pose.joints as unknown as Record<
        string,
        QuaternionTuple | undefined
      >;
      delete legacyJoints[middleId];
      legacyJoints[elbowId] = quaternionFromEulerDegrees([-29, 11, 43]);

      const projection = deriveActorRigProjection(actor);
      const elbow = primitiveById(projection.primitives, elbowId);
      const forearm = primitiveById(projection.primitives, middleId);

      expect(elbow.frame.rotation).toEqual(forearm.frame.rotation);
    },
  );

  it.each(["l", "r"] as const)(
    "shares the rotated knee frame with the %s lower leg",
    (side) => {
      const actor = actorIn(createDefaultScene());
      const middleId = `lower_leg_${side}` as const;
      const kneeId = `knee_${side}` as const;
      const legacyJoints = actor.pose.joints as unknown as Record<
        string,
        QuaternionTuple | undefined
      >;
      delete legacyJoints[middleId];
      legacyJoints[kneeId] = quaternionFromEulerDegrees([-41, 7, 22]);

      const projection = deriveActorRigProjection(actor);
      const knee = primitiveById(projection.primitives, kneeId);
      const lowerLeg = primitiveById(projection.primitives, middleId);

      expect(knee.frame.rotation).toEqual(lowerLeg.frame.rotation);
    },
  );

  it("keeps the neck planted in the torso while the head rotates at the neck top", () => {
    const actor = actorIn(createDefaultScene());
    const neutral = deriveActorRigProjection(actor);
    actor.pose.joints.neck = quaternionFromEulerDegrees([0, 0, 90]);
    const rotated = deriveActorRigProjection(actor);
    const neutralTorso = primitiveById(neutral.primitives, "torso");
    const neutralNeck = primitiveById(neutral.primitives, "neck");
    const neutralHead = primitiveById(neutral.primitives, "head");
    const rotatedNeck = primitiveById(rotated.primitives, "neck");
    const rotatedHead = primitiveById(rotated.primitives, "head");
    if (
      neutralTorso.kind !== "profile" ||
      neutralNeck.kind !== "profile" ||
      rotatedNeck.kind !== "profile"
    ) {
      throw new Error("Expected torso and neck profiles.");
    }
    const torsoTop = framePoint(neutralTorso.frame, [
      neutralTorso.center[0],
      neutralTorso.center[1] + (neutralTorso.points.at(-1)?.y ?? 0),
      neutralTorso.center[2],
    ]);
    const neutralBase = framePoint(neutralNeck.frame, [
      neutralNeck.center[0],
      neutralNeck.center[1] + (neutralNeck.points[0]?.y ?? 0),
      neutralNeck.center[2],
    ]);
    const rotatedBase = framePoint(rotatedNeck.frame, [
      rotatedNeck.center[0],
      rotatedNeck.center[1] + (rotatedNeck.points[0]?.y ?? 0),
      rotatedNeck.center[2],
    ]);
    const neutralTop = framePoint(neutralNeck.frame, [
      neutralNeck.center[0],
      neutralNeck.center[1] + (neutralNeck.points.at(-1)?.y ?? 0),
      neutralNeck.center[2],
    ]);
    const rotatedTop = framePoint(rotatedNeck.frame, [
      rotatedNeck.center[0],
      rotatedNeck.center[1] + (rotatedNeck.points.at(-1)?.y ?? 0),
      rotatedNeck.center[2],
    ]);

    expect(neutralBase).toEqual(rotatedBase);
    expect(neutralTop).toEqual(rotatedTop);
    expect(neutralBase[1]).toBeLessThanOrEqual(torsoTop[1]);
    expect(neutralTop).toEqual(neutralHead.frame.position);
    expect(rotatedTop).toEqual(rotatedHead.frame.position);
    expect(rotatedHead.frame.position).toEqual(neutralHead.frame.position);
    expect(rotatedHead.frame.rotation).not.toEqual(neutralHead.frame.rotation);
  });

  it("keeps all joint indicators subordinate to adjacent profile endpoints", () => {
    const projection = deriveActorRigProjection(actorIn(createDefaultScene()));

    for (const side of ["l", "r"] as const) {
      const shoulder = primitiveById(projection.primitives, `shoulder_${side}`);
      const upperArm = primitiveById(projection.primitives, `upper_arm_${side}`);
      const forearm = primitiveById(projection.primitives, `forearm_${side}`);
      const elbow = primitiveById(projection.primitives, `elbow_${side}`);
      const hip = primitiveById(projection.primitives, `hip_${side}`);
      const upperLeg = primitiveById(projection.primitives, `upper_leg_${side}`);
      const lowerLeg = primitiveById(projection.primitives, `lower_leg_${side}`);
      const knee = primitiveById(projection.primitives, `knee_${side}`);
      if (
        shoulder.kind !== "sphere" ||
        upperArm.kind !== "profile" ||
        forearm.kind !== "profile" ||
        elbow.kind !== "sphere" ||
        hip.kind !== "sphere" ||
        upperLeg.kind !== "profile" ||
        lowerLeg.kind !== "profile" ||
        knee.kind !== "sphere"
      ) {
        throw new Error("Expected profile limbs with sphere joint indicators.");
      }
      const elbowEndpointRadius = Math.max(
        upperArm.points[0]?.radius ?? 0,
        forearm.points.at(-1)?.radius ?? 0,
      );
      const kneeEndpointRadius = Math.max(
        upperLeg.points[0]?.radius ?? 0,
        lowerLeg.points.at(-1)?.radius ?? 0,
      );
      const shoulderEndpointRadius = upperArm.points.at(-1)?.radius ?? 0;
      const hipEndpointRadius = upperLeg.points.at(-1)?.radius ?? 0;

      expect(shoulder.radius).toBeGreaterThan(0);
      expect(shoulder.radius).toBeLessThanOrEqual(shoulderEndpointRadius * 0.95);
      expect(hip.radius).toBeGreaterThan(0);
      expect(hip.radius).toBeLessThanOrEqual(hipEndpointRadius * 0.92);
      expect(elbow.radius).toBeGreaterThan(0);
      expect(elbow.radius).toBeLessThanOrEqual(elbowEndpointRadius * 0.88);
      expect(knee.radius).toBeGreaterThan(0);
      expect(knee.radius).toBeLessThanOrEqual(kneeEndpointRadius * 0.85);
    }
  });

  it("shares non-unit parent frames and humanoid masses for a shoulder-to-hand chain", () => {
    const actor = actorIn(createDefaultScene());
    const legacyJoints = actor.pose.joints as unknown as Record<
      string,
      QuaternionTuple | undefined
    >;
    delete legacyJoints.upper_arm_r;
    delete legacyJoints.forearm_r;
    legacyJoints.shoulder_r = quaternionFromEulerDegrees([17, -23, 31]);
    legacyJoints.elbow_r = quaternionFromEulerDegrees([-29, 11, 43]);
    const projection = deriveActorRigProjection(actor);
    const dimensions = deriveActorAnatomyDimensions(actor.body);
    const upper = primitiveById(projection.primitives, "upper_arm_r");
    const neck = primitiveById(projection.primitives, "neck");
    const torso = primitiveById(projection.primitives, "torso");
    const pelvis = primitiveById(projection.primitives, "pelvis");
    const head = primitiveById(projection.primitives, "head");
    const elbow = primitiveById(projection.primitives, "elbow_r");
    const middle = primitiveById(projection.primitives, "forearm_r");
    const hand = primitiveById(projection.primitives, "hand_r");

    if (upper.kind !== "profile") throw new Error("Upper arm is not a profile.");
    expect(upper.points[0]?.y).toBe(-dimensions.upperArmLength);
    expect(upper.points.at(-1)?.y).toBe(0);
    expect(upper.points.at(-1)?.radius).toBeGreaterThan(
      upper.points[0]?.radius ?? Number.POSITIVE_INFINITY,
    );
    expect(upper.radialSegments).toBe(12);
    expect(neck.kind).toBe("profile");
    if (torso.kind !== "profile" || pelvis.kind !== "profile") {
      throw new Error("Core body masses are not profiles.");
    }
    const torsoRadii = torso.points.map(({ radius }) => radius);
    expect(Math.max(...torsoRadii)).toBeGreaterThan(Math.min(...torsoRadii));
    expect(torso.depthScale).toBeLessThan(1);
    const pelvisRadii = pelvis.points.map(({ radius }) => radius);
    expect(Math.max(...pelvisRadii)).toBeGreaterThan(pelvisRadii.at(-1) ?? 0);
    if (head.kind !== "profile") throw new Error("Head is not a profile.");
    const headRadii = head.points.map(({ radius }) => radius);
    expect(head.points[0]?.radius).toBeLessThan(Math.max(...headRadii));
    expect(head.points.at(-1)?.radius).toBeLessThan(Math.max(...headRadii));
    expect(head.points.length).toBeGreaterThanOrEqual(5);
    expect(head.radialSegments).toBeGreaterThanOrEqual(20);
    expect(elbow.frame.position).not.toEqual([0, 0, 0]);
    expect(middle.frame.rotation).toEqual(
      multiplyQuaternions(
        upper.frame.rotation,
        legacyJoints.elbow_r as QuaternionTuple,
      ),
    );
    if (hand.kind !== "ellipsoid") throw new Error("Hand is not an ellipsoid.");
    expect(hand.radii).toEqual(dimensions.handSize.map((value) => value / 2));
  });
});
