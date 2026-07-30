import { applyScenePatch } from "../../src/domain/apply-scene-patch";
import { createDefaultScene } from "../../src/domain/default-scene";
import { actorAnchorWorldPoint } from "../../src/domain/actor-projection";
import { buildRelationshipOperations } from "../../src/domain/presets";
import { lookAtQuaternion } from "../../src/domain/scene-math";
import {
  INTENT_REPORT_SCHEMA_VERSION,
  type IntentReport,
} from "../../src/domain/intent-report";
import {
  scenePatchSchema,
  type ScenePatch,
} from "../../src/domain/scene-patch";
import {
  sceneSpecSchema,
  type ActorEntity,
  type CameraEntity,
  type SceneSpec,
} from "../../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../../src/domain/schema-versions";

export const createStructuredScene = (): SceneSpec => createDefaultScene();

const requireActor = (scene: SceneSpec, actorId: string): ActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is ActorEntity =>
      entity.kind === "actor" && entity.id === actorId,
  );
  if (!actor) {
    throw new Error(`Structured fixture is missing actor ${actorId}.`);
  }
  return actor;
};

const requireActiveCamera = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (!camera) {
    throw new Error("Structured fixture is missing its active camera.");
  }
  return camera;
};

export const createStructuredShotScene = (): SceneSpec => {
  const base = createDefaultScene();
  const environment = structuredClone(
    base.entities.find((entity) => entity.kind === "environment"),
  );
  const actor = structuredClone(
    base.entities.find((entity) => entity.kind === "actor"),
  );
  const camera = structuredClone(
    base.entities.find((entity) => entity.kind === "camera"),
  );
  if (
    !environment ||
    environment.kind !== "environment" ||
    !actor ||
    actor.kind !== "actor" ||
    !camera ||
    camera.kind !== "camera"
  ) {
    throw new Error("Starter scene is missing a structured shot fixture part.");
  }

  environment.label = "Compact generic room";
  environment.preset.parameters = {
    ...environment.preset.parameters,
    widthM: 3.4,
    depthM: 2.8,
    heightM: 2.5,
  };
  actor.label = "Generic actor 1";
  const cameraPosition: [number, number, number] = [0, 0.68, 2.8];
  camera.transform.positionM = cameraPosition;
  camera.transform.rotation = lookAtQuaternion(cameraPosition, [
    0,
    actor.transform.positionM[1] + actor.body.heightM * 0.25,
    0,
  ]);
  camera.lens.focalLengthMm = 55;

  return sceneSpecSchema.parse({
    ...base,
    sceneId: "scene_structured_shot",
    revision: 0,
    title: "Structured generic shot",
    entities: [environment, actor, camera],
    constraints: [
      {
        id: "constraint_ground_actor_1",
        type: "ground-contact",
        entityId: actor.id,
        surfaceEntityId: environment.id,
        enabled: true,
      },
      {
        id: "constraint_visible_actor_1",
        type: "keep-visible",
        cameraId: camera.id,
        subjectEntityId: actor.id,
        anchor: "face",
        enabled: true,
      },
    ],
  });
};

export const createStructuredTwoActorScene = (): SceneSpec => {
  const base = createDefaultScene();
  const environment = structuredClone(
    base.entities.find((entity) => entity.kind === "environment"),
  );
  const actorTemplate = structuredClone(
    base.entities.find((entity) => entity.kind === "actor"),
  );
  const platform = structuredClone(
    base.entities.find((entity) => entity.kind === "prop"),
  );
  const camera = structuredClone(
    base.entities.find((entity) => entity.kind === "camera"),
  );
  if (
    !environment ||
    environment.kind !== "environment" ||
    !actorTemplate ||
    actorTemplate.kind !== "actor" ||
    !platform ||
    platform.kind !== "prop" ||
    !camera ||
    camera.kind !== "camera"
  ) {
    throw new Error(
      "Starter scene is missing a structured relationship fixture part.",
    );
  }

  environment.label = "Generic graybox room";
  environment.preset.parameters = {
    ...environment.preset.parameters,
    widthM: 5,
    depthM: 8,
    heightM: 2.8,
  };
  platform.id = "prop_platform_1";
  platform.label = "Low support platform";
  platform.transform.positionM = [0, 0.04, 0];
  platform.preset = {
    registry: "builtin",
    id: "prop.platform-low-v1",
    version: 1,
    parameters: {},
  };
  platform.geometry = {
    primitive: "box",
    sizeM: [2, 0.08, 1.2],
  };
  const platformTopM = 0.08;
  const primary: ActorEntity = {
    ...structuredClone(actorTemplate),
    id: "actor_generic_1",
    label: "Generic actor 1",
    slot: "actor_generic_1",
    transform: {
      ...structuredClone(actorTemplate.transform),
      positionM: [
        -0.45,
        platformTopM +
          (actorTemplate.pose.preset.parameters.contactOffsetM as number),
        0,
      ],
    },
  };
  const secondary: ActorEntity = {
    ...structuredClone(actorTemplate),
    id: "actor_generic_2",
    label: "Generic actor 2",
    slot: "actor_generic_2",
    transform: {
      ...structuredClone(actorTemplate.transform),
      positionM: [
        0.45,
        platformTopM +
          (actorTemplate.pose.preset.parameters.contactOffsetM as number),
        0,
      ],
    },
  };
  const cameraPosition: [number, number, number] = [0, 1.55, 7];
  camera.transform.positionM = cameraPosition;
  camera.transform.rotation = lookAtQuaternion(cameraPosition, [0, 1.3, 0]);
  camera.lens.focalLengthMm = 28;

  return sceneSpecSchema.parse({
    ...base,
    sceneId: "scene_structured_relationship",
    revision: 0,
    title: "Structured generic relationship shot",
    entities: [environment, primary, secondary, platform, camera],
    constraints: [
      {
        id: "constraint_ground_actor_1",
        type: "ground-contact",
        entityId: primary.id,
        surfaceEntityId: platform.id,
        enabled: true,
      },
      {
        id: "constraint_ground_actor_2",
        type: "ground-contact",
        entityId: secondary.id,
        surfaceEntityId: platform.id,
        enabled: true,
      },
    ],
  });
};

export const createStructuredRelationshipScene = (
  presetId:
    | "relationship.face-to-face-v1"
    | "relationship.over-under-focus-lower-v1" =
    "relationship.over-under-focus-lower-v1",
): SceneSpec => {
  const scene = createStructuredTwoActorScene();
  const patch = scenePatchSchema.parse({
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: `patch_structured_${presetId.replaceAll(".", "_")}`,
    sceneId: scene.sceneId,
    baseRevision: scene.revision,
    source: "system",
    preserveLock: false,
    operations: buildRelationshipOperations(scene, presetId, {
      primaryActorId: "actor_generic_1",
      secondaryActorId: "actor_generic_2",
      surfaceEntityId: "prop_platform_1",
    }),
  });
  const materialized = applyScenePatch(scene, patch).next;

  if (presetId === "relationship.over-under-focus-lower-v1") {
    const lower = requireActor(materialized, "actor_generic_2");
    const camera = requireActiveCamera(materialized);
    const cameraPosition: [number, number, number] = [1.2, 0.85, 2.8];
    camera.transform.positionM = cameraPosition;
    camera.transform.rotation = lookAtQuaternion(
      cameraPosition,
      actorAnchorWorldPoint(lower, "face"),
    );
    camera.lens.focalLengthMm = 55;
  }

  return sceneSpecSchema.parse({
    ...materialized,
    revision: 0,
  });
};

export const createIntentReport = (
  overrides: Partial<IntentReport> = {},
): IntentReport => ({
  schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
  operation: "create",
  allowPartial: false,
  recognizedConstraints: [
    {
      id: "intent_camera_height_1",
      kind: "camera-height",
      required: true,
      targets: ["camera_shot_1"],
      evidence: [
        {
          type: "entity-property",
          entityId: "camera_shot_1",
          path: "camera.heightM",
        },
      ],
    },
  ],
  unsupportedConstraints: [],
  unresolvedRelations: [],
  warnings: [],
  canApplySafely: true,
  ...overrides,
});

export const createPatchIntentReport = (
  overrides: Partial<IntentReport> = {},
): IntentReport =>
  createIntentReport({
    operation: "modify",
    recognizedConstraints: [
      {
        id: "intent_output_change_1",
        kind: "output",
        required: true,
        targets: [],
        evidence: [{ type: "patch-operation", operationIndex: 1 }],
      },
    ],
    ...overrides,
  });

export const createStructuredPatch = (
  scene: SceneSpec = createStructuredScene(),
): ScenePatch => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: "patch_structured_1",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  preserveLock: false,
  operations: [
    {
      op: "scene.title.set",
      value: "Revised generic shot",
    },
    {
      op: "scene.output.set",
      value: {
        aspect: { width: 16, height: 9 },
        resolutionPx: { width: 1280, height: 720 },
      },
    },
  ],
});

export const createSceneSubmission = () => {
  const scene = createStructuredScene();
  return {
    intentReport: createIntentReport(),
    scene,
  };
};

export const createPatchSubmission = (
  scene: SceneSpec = createStructuredScene(),
) => ({
  intentReport: createPatchIntentReport(),
  patch: createStructuredPatch(scene),
});
