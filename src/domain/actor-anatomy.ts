import { z } from "zod";

export const ACTOR_LIMB_PRESENCE_MODES = ["present", "absent"] as const;
export const actorLimbPresenceModeSchema = z.enum(
  ACTOR_LIMB_PRESENCE_MODES,
);
export type ActorLimbPresenceMode = z.infer<
  typeof actorLimbPresenceModeSchema
>;

export const ACTOR_LIMB_CHAINS = {
  leftArm: ["upper_arm_l", "forearm_l", "hand_l"],
  rightArm: ["upper_arm_r", "forearm_r", "hand_r"],
  leftLeg: ["upper_leg_l", "lower_leg_l", "foot_l"],
  rightLeg: ["upper_leg_r", "lower_leg_r", "foot_r"],
} as const;

export const ACTOR_LIMB_PART_IDS = [
  ...ACTOR_LIMB_CHAINS.leftArm,
  ...ACTOR_LIMB_CHAINS.rightArm,
  ...ACTOR_LIMB_CHAINS.leftLeg,
  ...ACTOR_LIMB_CHAINS.rightLeg,
] as const;
export type ActorLimbPartId = (typeof ACTOR_LIMB_PART_IDS)[number];

const actorLimbPresenceShape = {
  upper_arm_l: actorLimbPresenceModeSchema,
  forearm_l: actorLimbPresenceModeSchema,
  hand_l: actorLimbPresenceModeSchema,
  upper_arm_r: actorLimbPresenceModeSchema,
  forearm_r: actorLimbPresenceModeSchema,
  hand_r: actorLimbPresenceModeSchema,
  upper_leg_l: actorLimbPresenceModeSchema,
  lower_leg_l: actorLimbPresenceModeSchema,
  foot_l: actorLimbPresenceModeSchema,
  upper_leg_r: actorLimbPresenceModeSchema,
  lower_leg_r: actorLimbPresenceModeSchema,
  foot_r: actorLimbPresenceModeSchema,
} as const;

const limbChains = Object.values(ACTOR_LIMB_CHAINS);

export const actorLimbPresenceSchema = z
  .object(actorLimbPresenceShape)
  .strict()
  .superRefine((presence, context) => {
    for (const chain of limbChains) {
      for (let parentIndex = 0; parentIndex < chain.length - 1; parentIndex += 1) {
        const parentId = chain[parentIndex];
        if (presence[parentId] !== "absent") continue;
        for (
          let descendantIndex = parentIndex + 1;
          descendantIndex < chain.length;
          descendantIndex += 1
        ) {
          const descendantId = chain[descendantIndex];
          if (presence[descendantId] === "present") {
            context.addIssue({
              code: "custom",
              message: "An absent limb parent cannot have a present descendant.",
              path: [descendantId],
            });
          }
        }
      }
    }
  });

export type ActorLimbPresence = z.infer<typeof actorLimbPresenceSchema>;
export type ActorLimbPresenceUpdates = Partial<ActorLimbPresence>;

export const actorLimbPresenceUpdatesSchema = z
  .object(actorLimbPresenceShape)
  .partial()
  .strict();

export const createAllPresentLimbPresence = (): ActorLimbPresence => ({
  upper_arm_l: "present",
  forearm_l: "present",
  hand_l: "present",
  upper_arm_r: "present",
  forearm_r: "present",
  hand_r: "present",
  upper_leg_l: "present",
  lower_leg_l: "present",
  foot_l: "present",
  upper_leg_r: "present",
  lower_leg_r: "present",
  foot_r: "present",
});

export class ActorLimbPresenceError extends Error {
  readonly code = "LIMB_HIERARCHY_CONFLICT" as const;

  constructor() {
    super("Actor limb presence updates conflict with the limb hierarchy.");
    this.name = "ActorLimbPresenceError";
  }
}

export const resolveActorLimbPresenceUpdates = (
  current: ActorLimbPresence,
  updates: ActorLimbPresenceUpdates,
): ActorLimbPresence => {
  const parsedCurrent = actorLimbPresenceSchema.parse(current);
  const parsedUpdates = actorLimbPresenceUpdatesSchema.parse(updates);

  for (const chain of limbChains) {
    for (let parentIndex = 0; parentIndex < chain.length - 1; parentIndex += 1) {
      const parentId = chain[parentIndex];
      if (parsedUpdates[parentId] !== "absent") continue;
      for (
        let descendantIndex = parentIndex + 1;
        descendantIndex < chain.length;
        descendantIndex += 1
      ) {
        if (parsedUpdates[chain[descendantIndex]] === "present") {
          throw new ActorLimbPresenceError();
        }
      }
    }
  }

  const resolved: ActorLimbPresence = {
    ...parsedCurrent,
    ...parsedUpdates,
  };

  for (const chain of limbChains) {
    for (const [partIndex, partId] of chain.entries()) {
      if (parsedUpdates[partId] === "absent") {
        for (let index = partIndex; index < chain.length; index += 1) {
          resolved[chain[index]] = "absent";
        }
      }
    }
  }

  for (const chain of limbChains) {
    for (const [partIndex, partId] of chain.entries()) {
      if (parsedUpdates[partId] === "present") {
        for (let index = 0; index <= partIndex; index += 1) {
          resolved[chain[index]] = "present";
        }
      }
    }
  }

  return actorLimbPresenceSchema.parse(resolved);
};

type ActorBodyDimensionsInput = {
  heightM: number;
  shoulderWidthM: number;
  build: "slim" | "average" | "broad";
};

type Vec3Dimensions = readonly [number, number, number];

export interface ActorBlueprintAnatomyInput {
  body: ActorBodyDimensionsInput;
  proportions: {
    torsoLengthHeightRatio: number;
    torsoDepthHeightRatio: number;
    pelvisWidthShoulderRatio: number;
    pelvisHeightHeightRatio: number;
    headRadiusHeightRatio: number;
    upperArmLengthHeightRatio: number;
    forearmLengthHeightRatio: number;
    upperLegLengthHeightRatio: number;
    lowerLegLengthHeightRatio: number;
    handSizeHeightRatios: Vec3Dimensions;
    handOffsetHeightRatios: Vec3Dimensions;
    footSizeHeightRatios: Vec3Dimensions;
    footOffsetHeightRatios: Vec3Dimensions;
    torsoRadiusShoulderRatio: number;
    armRadiusHeightRatio: number;
    legRadiusHeightRatio: number;
  };
  skeleton: {
    spineOriginHeightRatio: number;
    headOriginAboveTorsoHeightRatio: number;
    shoulderOffsetShoulderRatio: number;
    shoulderOriginTorsoRatio: number;
    hipOffsetPelvisRatio: number;
    hipOriginHeightRatio: number;
  };
}

export interface ActorAnatomyDimensions {
  heightM: number;
  shoulderWidthM: number;
  spineOriginY: number;
  torsoLength: number;
  torsoRadius: number;
  torsoCapsuleLength: number;
  pelvisWidth: number;
  pelvisHeight: number;
  pelvisDepth: number;
  torsoDepth: number;
  headOriginY: number;
  upperArmLength: number;
  forearmLength: number;
  upperLegLength: number;
  lowerLegLength: number;
  headRadius: number;
  faceRadius: number;
  faceOffset: Vec3Dimensions;
  armRadius: number;
  forearmRadius: number;
  shoulderRadius: number;
  elbowRadius: number;
  legRadius: number;
  lowerLegRadius: number;
  hipRadius: number;
  kneeRadius: number;
  shoulderOffsetX: number;
  shoulderOriginY: number;
  hipOffsetX: number;
  hipOriginY: number;
  handSize: Vec3Dimensions;
  handOffset: Vec3Dimensions;
  footSize: Vec3Dimensions;
  footOffset: Vec3Dimensions;
}

const buildScaleFor = (
  build: ActorBodyDimensionsInput["build"],
): number => build === "broad" ? 1.12 : build === "slim" ? 0.9 : 1;

const scaleVec3 = (
  ratios: Vec3Dimensions,
  scalar: number,
): Vec3Dimensions => [
  ratios[0] * scalar,
  ratios[1] * scalar,
  ratios[2] * scalar,
];

export const scaleActorAnatomyDimensions = (
  dimensions: ActorAnatomyDimensions,
  scalar: number,
): ActorAnatomyDimensions =>
  Object.fromEntries(
    Object.entries(dimensions).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? scaleVec3(value as unknown as Vec3Dimensions, scalar)
        : value * scalar,
    ]),
  ) as unknown as ActorAnatomyDimensions;

export const deriveActorAnatomyDimensions = (
  body: ActorBodyDimensionsInput,
): ActorAnatomyDimensions => {
  const { heightM, shoulderWidthM } = body;
  const buildScale = buildScaleFor(body.build);
  const torsoLength = heightM * 0.31;
  const pelvisWidth = shoulderWidthM * 0.72;
  const torsoDepth = heightM * 0.115 * buildScale;
  const headRadius = heightM * 0.075;
  const armRadius = heightM * 0.035 * buildScale;
  const legRadius = heightM * 0.045 * buildScale;

  return {
    heightM,
    shoulderWidthM,
    spineOriginY: heightM * 0.035,
    torsoLength,
    torsoRadius: shoulderWidthM * 0.28,
    torsoCapsuleLength: Math.max(0.02, torsoLength - shoulderWidthM * 0.48),
    pelvisWidth,
    pelvisHeight: heightM * 0.12,
    pelvisDepth: torsoDepth * 0.86,
    torsoDepth,
    headOriginY: torsoLength + heightM * 0.055,
    upperArmLength: heightM * 0.19,
    forearmLength: heightM * 0.17,
    upperLegLength: heightM * 0.245,
    lowerLegLength: heightM * 0.235,
    headRadius,
    faceRadius: headRadius * 0.34,
    faceOffset: [0, -headRadius * 0.05, headRadius * 0.84],
    armRadius,
    forearmRadius: armRadius * 0.82,
    shoulderRadius: armRadius * 1.28,
    elbowRadius: armRadius * 1.08,
    legRadius,
    lowerLegRadius: legRadius * 0.82,
    hipRadius: legRadius * 1.3,
    kneeRadius: legRadius * 1.08,
    shoulderOffsetX: shoulderWidthM * 0.52,
    shoulderOriginY: torsoLength * 0.78,
    hipOffsetX: pelvisWidth * 0.31,
    hipOriginY: -heightM * 0.035,
    handSize: [heightM * 0.055, heightM * 0.085, heightM * 0.035],
    handOffset: [0, -heightM * 0.035, 0.012],
    footSize: [heightM * 0.075, heightM * 0.055, heightM * 0.16],
    footOffset: [0, -heightM * 0.025, heightM * 0.055],
  };
};

export const deriveBlueprintActorAnatomyDimensions = ({
  body,
  proportions,
  skeleton,
}: ActorBlueprintAnatomyInput): ActorAnatomyDimensions => {
  const { heightM, shoulderWidthM } = body;
  const buildScale = buildScaleFor(body.build);
  const torsoLength =
    heightM * proportions.torsoLengthHeightRatio;
  const pelvisWidth =
    shoulderWidthM * proportions.pelvisWidthShoulderRatio;
  const torsoDepth =
    heightM * proportions.torsoDepthHeightRatio * buildScale;
  const headRadius =
    heightM * proportions.headRadiusHeightRatio;
  const armRadius =
    heightM * proportions.armRadiusHeightRatio * buildScale;
  const legRadius =
    heightM * proportions.legRadiusHeightRatio * buildScale;

  return {
    heightM,
    shoulderWidthM,
    spineOriginY:
      heightM * skeleton.spineOriginHeightRatio,
    torsoLength,
    torsoRadius:
      shoulderWidthM * proportions.torsoRadiusShoulderRatio,
    torsoCapsuleLength: Math.max(
      0.02,
      torsoLength - shoulderWidthM * 0.48,
    ),
    pelvisWidth,
    pelvisHeight:
      heightM * proportions.pelvisHeightHeightRatio,
    pelvisDepth: torsoDepth * 0.86,
    torsoDepth,
    headOriginY:
      torsoLength +
      heightM * skeleton.headOriginAboveTorsoHeightRatio,
    upperArmLength:
      heightM * proportions.upperArmLengthHeightRatio,
    forearmLength:
      heightM * proportions.forearmLengthHeightRatio,
    upperLegLength:
      heightM * proportions.upperLegLengthHeightRatio,
    lowerLegLength:
      heightM * proportions.lowerLegLengthHeightRatio,
    headRadius,
    faceRadius: headRadius * 0.34,
    faceOffset: [0, -headRadius * 0.05, headRadius * 0.84],
    armRadius,
    forearmRadius: armRadius * 0.82,
    shoulderRadius: armRadius * 1.28,
    elbowRadius: armRadius * 1.08,
    legRadius,
    lowerLegRadius: legRadius * 0.82,
    hipRadius: legRadius * 1.3,
    kneeRadius: legRadius * 1.08,
    shoulderOffsetX:
      shoulderWidthM * skeleton.shoulderOffsetShoulderRatio,
    shoulderOriginY:
      torsoLength * skeleton.shoulderOriginTorsoRatio,
    hipOffsetX:
      pelvisWidth * skeleton.hipOffsetPelvisRatio,
    hipOriginY:
      heightM * skeleton.hipOriginHeightRatio,
    handSize: scaleVec3(
      proportions.handSizeHeightRatios,
      heightM,
    ),
    handOffset: scaleVec3(
      proportions.handOffsetHeightRatios,
      heightM,
    ),
    footSize: scaleVec3(
      proportions.footSizeHeightRatios,
      heightM,
    ),
    footOffset: scaleVec3(
      proportions.footOffsetHeightRatios,
      heightM,
    ),
  };
};
