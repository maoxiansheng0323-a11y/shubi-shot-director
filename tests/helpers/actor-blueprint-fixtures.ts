import type { ActorBlueprintDocument } from "../../src/domain/actor-blueprint";
import { identityQuaternion } from "../../src/domain/scene-schema";
import type {
  ActorSlot,
  BlueprintActorEntity,
} from "../../src/domain/scene-schema";

const localTransform = (
  positionM: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
  rotation: [number, number, number, number] = [0, 0, 0, 1],
) => ({
  positionM,
  rotation,
  scale,
});

const createGenericModules = (): ActorBlueprintDocument["modules"] => [
  {
    moduleId: "shoulder_socket_l",
    mount: "shoulder_l",
    visible: true,
    parts: [
      {
        partId: "socket",
        primitive: "sphere",
        transform: localTransform(),
        radiusM: 0.07,
      },
    ],
  },
  {
    moduleId: "shoulder_socket_r",
    mount: "shoulder_r",
    visible: true,
    parts: [
      {
        partId: "socket",
        primitive: "sphere",
        transform: localTransform(),
        radiusM: 0.07,
      },
    ],
  },
  {
    moduleId: "shoulder_terminals_r",
    mount: "shoulder_r",
    visible: false,
    parts: [
      {
        partId: "terminal_a",
        primitive: "cylinder",
        transform: localTransform(
          [-0.085, -0.035, 0.015],
          [1, 1, 1],
          [0, 0, 0.7071067811865475, 0.7071067811865476],
        ),
        radiusM: 0.009,
        lengthM: 0.055,
      },
      {
        partId: "terminal_b",
        primitive: "cylinder",
        transform: localTransform(
          [-0.085, 0, 0.015],
          [1, 1, 1],
          [0, 0, 0.7071067811865475, 0.7071067811865476],
        ),
        radiusM: 0.009,
        lengthM: 0.055,
      },
      {
        partId: "terminal_c",
        primitive: "cylinder",
        transform: localTransform(
          [-0.085, 0.035, 0.015],
          [1, 1, 1],
          [0, 0, 0.7071067811865475, 0.7071067811865476],
        ),
        radiusM: 0.009,
        lengthM: 0.055,
      },
    ],
  },
  {
    moduleId: "knee_interface_l",
    mount: "knee_l",
    visible: true,
    parts: [
      {
        partId: "seal",
        primitive: "box",
        transform: localTransform(),
        sizeM: [0.11, 0.035, 0.11],
      },
    ],
  },
  {
    moduleId: "knee_interface_r",
    mount: "knee_r",
    visible: true,
    parts: [
      {
        partId: "seal",
        primitive: "box",
        transform: localTransform(),
        sizeM: [0.11, 0.035, 0.11],
      },
    ],
  },
];

export const createGenericActorBlueprintDocument =
  (): ActorBlueprintDocument => ({
    schemaVersion: 1,
    blueprintId: "actor_blueprint_1",
    blueprintVersion: 1,
    body: {
      heightM: 1.62,
      shoulderWidthM: 0.38,
      build: "slim",
    },
    proportions: {
      torsoLengthHeightRatio: 0.31,
      torsoDepthHeightRatio: 0.115,
      pelvisWidthShoulderRatio: 0.72,
      pelvisHeightHeightRatio: 0.12,
      headRadiusHeightRatio: 0.075,
      upperArmLengthHeightRatio: 0.19,
      forearmLengthHeightRatio: 0.17,
      upperLegLengthHeightRatio: 0.245,
      lowerLegLengthHeightRatio: 0.235,
      handSizeHeightRatios: [0.055, 0.085, 0.035],
      handOffsetHeightRatios: [0, -0.035, 0.012],
      footSizeHeightRatios: [0.075, 0.055, 0.16],
      footOffsetHeightRatios: [0, -0.025, 0.055],
      torsoRadiusShoulderRatio: 0.28,
      armRadiusHeightRatio: 0.035,
      legRadiusHeightRatio: 0.045,
    },
    skeleton: {
      spineOriginHeightRatio: 0.035,
      headOriginAboveTorsoHeightRatio: 0.055,
      shoulderOffsetShoulderRatio: 0.52,
      shoulderOriginTorsoRatio: 0.78,
      hipOffsetPelvisRatio: 0.31,
      hipOriginHeightRatio: -0.035,
    },
    limbPresence: {
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
    },
    modules: createGenericModules(),
    variants: [
      {
        variantId: "damaged",
        limbPresence: {
          upper_arm_r: "absent",
          lower_leg_l: "absent",
          lower_leg_r: "absent",
        },
        moduleVisibility: {
          shoulder_terminals_r: true,
        },
      },
      {
        variantId: "repaired",
        limbPresence: {
          upper_arm_r: "present",
          forearm_r: "present",
          hand_r: "present",
          lower_leg_l: "absent",
          lower_leg_r: "absent",
        },
        moduleVisibility: {
          shoulder_terminals_r: false,
        },
      },
    ],
  });

export const createBlueprintActor = ({
  id = "actor_entity_blueprint_1",
  slot = "actor_female_1",
  blueprintId = "actor_blueprint_1",
  variantId = "damaged",
}: {
  id?: string;
  slot?: ActorSlot;
  blueprintId?: string;
  variantId?: string;
} = {}): BlueprintActorEntity => ({
  id,
  label: "Generic blueprint actor",
  parentId: null,
  kind: "actor",
  slot,
  transform: {
    positionM: [0, 0.81, 0],
    rotation: identityQuaternion(),
    scale: [1, 1, 1],
  },
  visible: true,
  lockMode: "none",
  blueprintInstance: {
    blueprintId,
    variantId,
  },
  pose: {
    preset: {
      registry: "builtin",
      id: "pose.standing-neutral-v1",
      version: 1,
      parameters: {
        contactOffsetM: 0.81,
      },
    },
    joints: {},
  },
  color: "#c7ced8",
});
