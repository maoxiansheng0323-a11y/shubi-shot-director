import { z } from "zod";

export const canonicalPuppetJointIds = [
  "pelvis",
  "spine",
  "neck",
  "upper_arm_l",
  "forearm_l",
  "hand_l",
  "upper_arm_r",
  "forearm_r",
  "hand_r",
  "upper_leg_l",
  "lower_leg_l",
  "foot_l",
  "upper_leg_r",
  "lower_leg_r",
  "foot_r",
] as const;

export const canonicalPuppetJointIdSchema = z.enum(
  canonicalPuppetJointIds,
);

export type CanonicalPuppetJointId =
  (typeof canonicalPuppetJointIds)[number];

export const mapCanonicalPuppetJoints = <Value>(
  createValue: (jointId: CanonicalPuppetJointId) => Value,
): Record<CanonicalPuppetJointId, Value> =>
  Object.fromEntries(
    canonicalPuppetJointIds.map((jointId) => [
      jointId,
      createValue(jointId),
    ]),
  ) as Record<CanonicalPuppetJointId, Value>;

export const createIdentityPuppetJointMap = (): Record<
  CanonicalPuppetJointId,
  [number, number, number, number]
> => mapCanonicalPuppetJoints(() => [0, 0, 0, 1]);

export const CUSTOM_POSE_PRESET_ID = "pose.custom-v1" as const;
