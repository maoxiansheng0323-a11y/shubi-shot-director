import {
  createActorBlueprintSnapshot,
  type ActorBlueprintDocument,
} from "../../src/domain/actor-blueprint";
import { createDefaultScene } from "../../src/domain/default-scene";
import type { EntityLockMode } from "../../src/domain/entity-lock";
import { createIdentityPuppetJointMap } from "../../src/domain/actor-joints";
import { identityQuaternion } from "../../src/domain/scene-schema";
import type {
  ActorSlot,
  BlueprintActorEntity,
  SceneSpec,
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
    heightScale: 1,
    limbPresenceOverrides: {},
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
    joints: createIdentityPuppetJointMap(),
  },
  color: "#c7ced8",
});

export const createLegacyV5BlueprintGroundContactScene = (
  lockMode: EntityLockMode = "none",
): Record<string, unknown> => {
  const scene = structuredClone(createDefaultScene()) as unknown as Record<
    string,
    unknown
  >;
  const actor = createBlueprintActor();
  actor.lockMode = lockMode;
  actor.transform.positionM[1] = 0.4536;
  actor.pose.preset.parameters.contactOffsetM = 0.4536;

  const legacyActor = structuredClone(actor) as unknown as Record<
    string,
    unknown
  >;
  const instance = legacyActor.blueprintInstance as Record<string, unknown>;
  delete instance.heightScale;
  delete instance.limbPresenceOverrides;

  scene.schemaVersion = 5;
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(createGenericActorBlueprintDocument()),
  ];
  scene.entities = [
    ...(scene.entities as Array<Record<string, unknown>>).filter(
      (entity) => entity.kind !== "actor",
    ),
    legacyActor,
  ];
  scene.constraints = [
    {
      id: "constraint_ground_actor_blueprint_v5",
      type: "ground-contact",
      entityId: actor.id,
      surfaceEntityId: "environment_room_1",
      enabled: true,
    },
  ];
  return scene;
};

export const createLegacyV5BlueprintGroundContactPatch = (
  scene: SceneSpec,
  lockMode: Exclude<EntityLockMode, "none">,
) => {
  const snapshot = createActorBlueprintSnapshot(
    createGenericActorBlueprintDocument(),
  );
  const actor = createBlueprintActor({
    id: `actor_entity_blueprint_v5_${lockMode}`,
  });
  actor.lockMode = lockMode;
  actor.transform.positionM = [0.65, 0.4536, -0.35];
  actor.pose.preset.parameters.contactOffsetM = 0.4536;

  const legacyTransform = structuredClone(actor.transform);
  const legacyActor = structuredClone(actor) as unknown as Record<
    string,
    unknown
  >;
  const instance = legacyActor.blueprintInstance as Record<string, unknown>;
  delete instance.heightScale;
  delete instance.limbPresenceOverrides;

  return {
    actorId: actor.id,
    legacyTransform,
    patch: {
      schemaVersion: 5,
      patchId: `patch_v5_blueprint_ground_contact_${lockMode}`,
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      preserveLock: false,
      operations: [
        { op: "actor.blueprint.register", snapshot },
        { op: "entity.add", value: legacyActor },
        {
          op: "constraint.set",
          value: {
            id: `constraint_ground_actor_blueprint_v5_${lockMode}`,
            type: "ground-contact",
            entityId: actor.id,
            surfaceEntityId: "environment_room_1",
            enabled: true,
          },
        },
      ],
    },
  };
};

export const createLegacyV5NonBlueprintGroundContactScene = (
  lockMode: Exclude<EntityLockMode, "none">,
): Record<string, unknown> => {
  const scene = structuredClone(createDefaultScene()) as unknown as Record<
    string,
    unknown
  >;
  scene.schemaVersion = 5;
  const actor = (scene.entities as Array<Record<string, unknown>>).find(
    (entity) => entity.kind === "actor",
  );
  if (actor === undefined) {
    throw new Error("Legacy actor fixture is missing.");
  }
  actor.lockMode = lockMode;
  const transform = actor.transform as {
    positionM: [number, number, number];
  };
  transform.positionM[1] = 0.1234;
  return scene;
};
