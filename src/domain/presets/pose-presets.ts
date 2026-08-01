import { quaternionFromEulerDegrees } from "../scene-math";
import { canonicalPuppetJointIds } from "../actor-joints";
import {
  isLegacyActorEntity,
  poseSchema,
  type AnyActorEntity,
  type PoseSpec,
  type QuaternionTuple,
  type Vec3,
} from "../scene-schema";

export const canonicalHumanoidJointIds = canonicalPuppetJointIds;
export const POSE_CONTACT_OFFSET_DECIMAL_PLACES = 5;

export type CanonicalHumanoidJointId =
  (typeof canonicalHumanoidJointIds)[number];

export interface PosePresetDefinition {
  readonly id: string;
  readonly version: 1;
  readonly label: string;
  readonly contactOffsetHeightRatio: number;
  readonly joints: Readonly<
    Record<CanonicalHumanoidJointId, QuaternionTuple>
  >;
}

export class PosePresetError extends Error {
  readonly code: "INVALID_ACTOR" | "POSE_PRESET_NOT_FOUND";

  constructor(
    code: "INVALID_ACTOR" | "POSE_PRESET_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "PosePresetError";
    this.code = code;
  }
}

type JointEulerMap = Partial<
  Record<CanonicalHumanoidJointId, Vec3>
>;

const identityEuler = (): Vec3 => [0, 0, 0];

const materializeJointDefinition = (
  overrides: JointEulerMap,
): Readonly<Record<CanonicalHumanoidJointId, QuaternionTuple>> => {
  const joints = Object.fromEntries(
    canonicalHumanoidJointIds.map((jointId) => [
      jointId,
      Object.freeze(
        quaternionFromEulerDegrees(
          overrides[jointId] ?? identityEuler(),
        ),
      ),
    ]),
  ) as Record<CanonicalHumanoidJointId, QuaternionTuple>;

  return Object.freeze(joints);
};

const definePose = (
  id: string,
  label: string,
  contactOffsetHeightRatio: number,
  joints: JointEulerMap,
): PosePresetDefinition =>
  Object.freeze({
    id,
    version: 1 as const,
    label,
    contactOffsetHeightRatio,
    joints: materializeJointDefinition(joints),
  });

const posePresets = Object.freeze([
  definePose(
    "pose.standing-neutral-v1",
    "Standing neutral",
    0.568,
    {
      upper_arm_l: [0, 0, 4],
      upper_arm_r: [0, 0, -4],
      forearm_l: [0, 0, 3],
      forearm_r: [0, 0, -3],
    },
  ),
  definePose(
    "pose.kneeling-lean-v1",
    "Kneeling lean",
    0.27,
    {
      spine: [22, 0, 0],
      neck: [-12, 0, 0],
      upper_arm_l: [-18, 0, 16],
      upper_arm_r: [-18, 0, -16],
      forearm_l: [-36, 0, 0],
      forearm_r: [-36, 0, 0],
      upper_leg_l: [-58, 0, 8],
      upper_leg_r: [-58, 0, -8],
      lower_leg_l: [112, 0, 0],
      lower_leg_r: [112, 0, 0],
    },
  ),
  definePose(
    "pose.seated-v1",
    "Seated",
    0.065,
    {
      spine: [4, 0, 0],
      upper_arm_l: [0, 0, 7],
      upper_arm_r: [0, 0, -7],
      upper_leg_l: [-88, 0, 5],
      upper_leg_r: [-88, 0, -5],
      lower_leg_l: [88, 0, 0],
      lower_leg_r: [88, 0, 0],
    },
  ),
  definePose(
    "pose.lying-supine-v1",
    "Lying supine",
    0.085,
    {
      pelvis: [-90, 0, 0],
      neck: [7, 0, 0],
      upper_arm_l: [0, 0, 38],
      upper_arm_r: [0, 0, -38],
      forearm_l: [0, 0, 8],
      forearm_r: [0, 0, -8],
      upper_leg_l: [4, 0, 4],
      upper_leg_r: [4, 0, -4],
      lower_leg_l: [-7, 0, 0],
      lower_leg_r: [-7, 0, 0],
    },
  ),
  definePose(
    "pose.leaning-forward-v1",
    "Leaning forward",
    0.568,
    {
      spine: [28, 0, 0],
      neck: [-18, 0, 0],
      upper_arm_l: [-12, 0, 7],
      upper_arm_r: [-12, 0, -7],
      forearm_l: [-18, 0, 0],
      forearm_r: [-18, 0, 0],
      upper_leg_l: [-7, 0, 2],
      upper_leg_r: [-7, 0, -2],
      lower_leg_l: [9, 0, 0],
      lower_leg_r: [9, 0, 0],
    },
  ),
  definePose(
    "pose.reaching-right-v1",
    "Right-arm reach",
    0.568,
    {
      spine: [6, -8, 0],
      neck: [-3, 12, 0],
      upper_arm_l: [8, 0, 12],
      forearm_l: [-18, 0, 0],
      hand_l: [0, -6, 4],
      upper_arm_r: [-82, -8, -14],
      forearm_r: [-16, 0, -6],
      hand_r: [0, 14, -10],
    },
  ),
  definePose(
    "pose.walking-step-v1",
    "Walking step",
    0.54,
    {
      pelvis: [0, 8, 0],
      spine: [4, -6, 0],
      neck: [-3, 4, 0],
      upper_arm_l: [24, 0, 8],
      forearm_l: [-24, 0, 0],
      hand_l: [0, 0, 6],
      upper_arm_r: [-24, 0, -8],
      forearm_r: [-32, 0, 0],
      hand_r: [0, 0, -6],
      upper_leg_l: [-30, 0, 4],
      lower_leg_l: [18, 0, 0],
      foot_l: [-10, 0, 0],
      upper_leg_r: [24, 0, -4],
      lower_leg_r: [44, 0, 0],
      foot_r: [-20, 0, 0],
    },
  ),
  definePose(
    "pose.crouching-v1",
    "Crouching",
    0.32,
    {
      pelvis: [8, 0, 0],
      spine: [22, 0, 0],
      neck: [-12, 0, 0],
      upper_arm_l: [-42, 0, 12],
      forearm_l: [-28, 0, 0],
      hand_l: [0, 0, 8],
      upper_arm_r: [-42, 0, -12],
      forearm_r: [-28, 0, 0],
      hand_r: [0, 0, -8],
      upper_leg_l: [-68, 0, 7],
      lower_leg_l: [112, 0, 0],
      foot_l: [-38, 0, 0],
      upper_leg_r: [-68, 0, -7],
      lower_leg_r: [112, 0, 0],
      foot_r: [-38, 0, 0],
    },
  ),
] satisfies readonly PosePresetDefinition[]);

const poseAliases = new Map<string, PosePresetDefinition>();

for (const preset of posePresets) {
  poseAliases.set(preset.id, preset);
  poseAliases.set(
    preset.id.replace(/^pose\./, "").replace(/-v1$/, ""),
    preset,
  );
}

const contactOffsetScale =
  10 ** POSE_CONTACT_OFFSET_DECIMAL_PLACES;

const roundMeters = (value: number): number =>
  Math.round(value * contactOffsetScale) / contactOffsetScale;

export const listPosePresets = (): readonly PosePresetDefinition[] =>
  posePresets;

export const materializePose = (
  actor: AnyActorEntity,
  presetId: string,
  blueprintHeightM?: number,
): PoseSpec => {
  const heightM = isLegacyActorEntity(actor)
    ? actor.body.heightM
    : blueprintHeightM;
  if (
    actor?.kind !== "actor" ||
    !Number.isFinite(heightM) ||
    (heightM ?? 0) <= 0 ||
    !Number.isFinite(actor.transform?.scale?.[1]) ||
    actor.transform.scale[1] <= 0
  ) {
    throw new PosePresetError(
      "INVALID_ACTOR",
      "A valid actor is required to materialize a pose.",
    );
  }

  const preset = poseAliases.get(presetId);
  if (!preset) {
    throw new PosePresetError(
      "POSE_PRESET_NOT_FOUND",
      "The requested pose preset is not available.",
    );
  }

  const joints = Object.fromEntries(
    canonicalHumanoidJointIds.map((jointId) => [
      jointId,
      [...preset.joints[jointId]] as QuaternionTuple,
    ]),
  );

  return poseSchema.parse({
    preset: {
      registry: "builtin",
      id: preset.id,
      version: preset.version,
      parameters: {
        contactOffsetM: roundMeters(
          (heightM as number) *
            preset.contactOffsetHeightRatio,
        ),
      },
    },
    joints,
  });
};
