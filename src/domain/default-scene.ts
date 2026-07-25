import { lookAtQuaternion } from "./scene-math";
import {
  identityQuaternion,
  sceneSpecSchema,
  type SceneSpec,
} from "./scene-schema";

export const createDefaultScene = (): SceneSpec =>
  sceneSpecSchema.parse({
    schemaVersion: 1,
    sceneId: "scene_starter",
    revision: 0,
    title: "Starter Graybox",
    coordinateSystem: {
      handedness: "right",
      upAxis: "+Y",
      cameraForwardAxis: "-Z",
      lengthUnit: "meter",
    },
    activeCameraId: "camera_shot_1",
    output: {
      aspect: {
        width: 16,
        height: 9,
      },
      resolutionPx: {
        width: 1920,
        height: 1080,
      },
    },
    entities: [
      {
        id: "environment_room_1",
        label: "Small room",
        parentId: null,
        kind: "environment",
        transform: {
          positionM: [0, 0, 0],
          rotation: identityQuaternion(),
          scale: [1, 1, 1],
        },
        visible: true,
        locked: true,
        preset: {
          registry: "builtin",
          id: "room.small-v1",
          version: 1,
          parameters: {
            widthM: 5,
            depthM: 4,
            heightM: 2.8,
            wallThicknessM: 0.08,
          },
        },
        color: "#7d8794",
      },
      {
        id: "actor_generic_1",
        label: "Generic actor",
        parentId: null,
        kind: "actor",
        slot: "actor_generic_1",
        transform: {
          positionM: [0, 0.977, 0],
          rotation: identityQuaternion(),
          scale: [1, 1, 1],
        },
        visible: true,
        locked: false,
        rig: {
          registry: "builtin",
          id: "rig.humanoid-v1",
          version: 1,
          parameters: {},
        },
        body: {
          heightM: 1.72,
          shoulderWidthM: 0.42,
          build: "average",
        },
        pose: {
          preset: {
            registry: "builtin",
            id: "pose.standing-neutral-v1",
            version: 1,
            parameters: {
              contactOffsetM: 0.977,
            },
          },
          joints: {},
        },
        color: "#c7ced8",
      },
      {
        id: "prop_block_1",
        label: "Blocking cube",
        parentId: null,
        kind: "prop",
        transform: {
          positionM: [-1.3, 0.35, -0.5],
          rotation: identityQuaternion(),
          scale: [1, 1, 1],
        },
        visible: true,
        locked: false,
        preset: {
          registry: "builtin",
          id: "prop.block-v1",
          version: 1,
          parameters: {},
        },
        geometry: {
          primitive: "box",
          sizeM: [0.8, 0.7, 0.8],
        },
        color: "#9ba6b2",
      },
      {
        id: "camera_shot_1",
        label: "Shot camera",
        parentId: null,
        kind: "camera",
        transform: {
          positionM: [4.2, 2.2, 5.8],
          rotation: lookAtQuaternion([4.2, 2.2, 5.8], [0, 1, 0]),
          scale: [1, 1, 1],
        },
        visible: true,
        locked: false,
        lens: {
          projection: "perspective",
          focalLengthMm: 45,
          sensorWidthMm: 36,
          nearM: 0.05,
          farM: 200,
        },
      },
    ],
    constraints: [
      {
        id: "constraint_ground_actor_1",
        type: "ground-contact",
        entityId: "actor_generic_1",
        surfaceEntityId: "environment_room_1",
        enabled: true,
      },
    ],
  });
