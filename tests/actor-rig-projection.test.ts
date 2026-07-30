import { describe, expect, it } from "vitest";
import {
  deriveActorAnatomyDimensions,
  resolveActorLimbPresenceUpdates,
} from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  resolveLegacyActorProjection as deriveActorRigProjection,
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
import type { ActorEntity, SceneSpec } from "../src/domain/scene-schema";

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
      delete actor.pose.joints[middleId];
      actor.pose.joints[elbowId] = quaternionFromEulerDegrees([-29, 11, 43]);

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
      delete actor.pose.joints[middleId];
      actor.pose.joints[kneeId] = quaternionFromEulerDegrees([-41, 7, 22]);

      const projection = deriveActorRigProjection(actor);
      const knee = primitiveById(projection.primitives, kneeId);
      const lowerLeg = primitiveById(projection.primitives, middleId);

      expect(knee.frame.rotation).toEqual(lowerLeg.frame.rotation);
    },
  );

  it("shares non-unit parent frames and geometry for a shoulder-to-hand chain", () => {
    const actor = actorIn(createDefaultScene());
    delete actor.pose.joints.upper_arm_r;
    delete actor.pose.joints.forearm_r;
    actor.pose.joints.shoulder_r = quaternionFromEulerDegrees([17, -23, 31]);
    actor.pose.joints.elbow_r = quaternionFromEulerDegrees([-29, 11, 43]);
    const projection = deriveActorRigProjection(actor);
    const dimensions = deriveActorAnatomyDimensions(actor.body);
    const upper = primitiveById(projection.primitives, "upper_arm_r");
    const head = primitiveById(projection.primitives, "head");
    const elbow = primitiveById(projection.primitives, "elbow_r");
    const middle = primitiveById(projection.primitives, "forearm_r");
    const hand = primitiveById(projection.primitives, "hand_r");

    if (upper.kind !== "capsule") throw new Error("Upper arm is not a capsule.");
    expect(upper.length).toBe(dimensions.upperArmLength);
    expect(upper.radius).toBe(dimensions.armRadius);
    expect(upper.capSegments).toBe(6);
    expect(upper.radialSegments).toBe(12);
    if (head.kind !== "sphere") throw new Error("Head is not a sphere.");
    expect(head.widthSegments).toBe(20);
    expect(head.heightSegments).toBe(14);
    expect(elbow.frame.position).not.toEqual([0, 0, 0]);
    expect(middle.frame.rotation).toEqual(
      multiplyQuaternions(upper.frame.rotation, actor.pose.joints.elbow_r),
    );
    if (hand.kind !== "box") throw new Error("Hand is not a box.");
    expect(hand.size).toEqual(dimensions.handSize);
  });
});
