import { Euler, MathUtils, Quaternion } from "three";
import {
  canonicalPuppetJointIds,
  type CanonicalPuppetJointId,
} from "./actor-joints";
import type { PoseSpec, QuaternionTuple, Vec3 } from "./scene-schema";

export interface JointAxisRange {
  readonly minDeg: number;
  readonly maxDeg: number;
}

export interface CanonicalJointConstraint {
  readonly x: JointAxisRange;
  readonly y: JointAxisRange;
  readonly z: JointAxisRange;
  readonly preferredBend?: "negative-x" | "positive-x";
}

const range = (minDeg: number, maxDeg: number): JointAxisRange => ({
  minDeg,
  maxDeg,
});

const symmetric = (maximumDeg: number): JointAxisRange =>
  range(-maximumDeg, maximumDeg);

export const canonicalJointConstraints: Readonly<
  Record<CanonicalPuppetJointId, CanonicalJointConstraint>
> = {
  pelvis: { x: range(-100, 70), y: symmetric(90), z: symmetric(75) },
  spine: { x: symmetric(55), y: symmetric(60), z: symmetric(45) },
  neck: { x: symmetric(65), y: symmetric(85), z: symmetric(55) },
  upper_arm_l: { x: range(-170, 120), y: symmetric(130), z: symmetric(130) },
  forearm_l: {
    x: range(-150, 15),
    y: symmetric(35),
    z: symmetric(35),
    preferredBend: "negative-x",
  },
  hand_l: { x: symmetric(80), y: symmetric(55), z: symmetric(65) },
  upper_arm_r: { x: range(-170, 120), y: symmetric(130), z: symmetric(130) },
  forearm_r: {
    x: range(-150, 15),
    y: symmetric(35),
    z: symmetric(35),
    preferredBend: "negative-x",
  },
  hand_r: { x: symmetric(80), y: symmetric(55), z: symmetric(65) },
  upper_leg_l: { x: range(-130, 80), y: symmetric(75), z: symmetric(75) },
  lower_leg_l: {
    x: range(-12, 145),
    y: symmetric(25),
    z: symmetric(25),
    preferredBend: "positive-x",
  },
  foot_l: { x: range(-65, 65), y: symmetric(45), z: symmetric(45) },
  upper_leg_r: { x: range(-130, 80), y: symmetric(75), z: symmetric(75) },
  lower_leg_r: {
    x: range(-12, 145),
    y: symmetric(25),
    z: symmetric(25),
    preferredBend: "positive-x",
  },
  foot_r: { x: range(-65, 65), y: symmetric(45), z: symmetric(45) },
};

const normalizeDegrees = (value: number): number => {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 1e-9 ? 0 : normalized;
};

export const jointEulerDegrees = (
  quaternion: QuaternionTuple,
): Vec3 => {
  const euler = new Euler().setFromQuaternion(
    new Quaternion(...quaternion).normalize(),
    "XYZ",
  );
  return [
    normalizeDegrees(MathUtils.radToDeg(euler.x)),
    normalizeDegrees(MathUtils.radToDeg(euler.y)),
    normalizeDegrees(MathUtils.radToDeg(euler.z)),
  ];
};

export interface JointLimitViolation {
  readonly jointId: CanonicalPuppetJointId;
  readonly axis: "x" | "y" | "z";
  readonly angleDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
  readonly code: "JOINT_LIMIT_EXCEEDED" | "JOINT_BEND_REVERSED";
}

export const diagnoseJointLimits = (
  pose: PoseSpec,
  epsilonDeg = 0.25,
): JointLimitViolation[] => {
  const violations: JointLimitViolation[] = [];
  for (const jointId of canonicalPuppetJointIds) {
    const angles = jointEulerDegrees(pose.joints[jointId]);
    const definition = canonicalJointConstraints[jointId];
    const axes = ["x", "y", "z"] as const;
    for (const [axisIndex, axis] of axes.entries()) {
      const angleDeg = angles[axisIndex];
      const limits = definition[axis];
      if (
        angleDeg < limits.minDeg - epsilonDeg ||
        angleDeg > limits.maxDeg + epsilonDeg
      ) {
        violations.push({
          jointId,
          axis,
          angleDeg,
          minDeg: limits.minDeg,
          maxDeg: limits.maxDeg,
          code:
            axis === "x" && definition.preferredBend !== undefined
              ? "JOINT_BEND_REVERSED"
              : "JOINT_LIMIT_EXCEEDED",
        });
      }
    }
  }
  return violations;
};
