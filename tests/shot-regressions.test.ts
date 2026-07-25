import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { analyzeComposition } from "../src/domain/composition-safety";
import { surfaceTopY } from "../src/domain/contact-constraints";
import { buildRelationshipOperations } from "../src/domain/presets";
import { scenePatchSchema } from "../src/domain/scene-patch";
import {
  sceneSpecSchema,
  type ActorEntity,
  type CameraEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { serializeSceneFile } from "../src/editor/scene-files";
import {
  createSceneSubmission,
  createStructuredRelationshipScene,
  createStructuredShotScene,
  createStructuredTwoActorScene,
} from "./helpers/structured-fixtures";

const CONTACT_TOLERANCE_M = 1e-6;
const FRAME_FAILURE_CODES = new Set([
  "ANCHOR_BEHIND_CAMERA",
  "ANCHOR_OUT_OF_FRAME",
  "FRAMING_BOUNDS_OUT_OF_FRAME",
]);

const actorsIn = (scene: SceneSpec): ActorEntity[] =>
  scene.entities.filter(
    (entity): entity is ActorEntity => entity.kind === "actor",
  );

const activeCameraIn = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (!camera) {
    throw new Error("Regression scene is missing its active camera.");
  }
  return camera;
};

const expectGroundContactsWithinTolerance = (scene: SceneSpec): void => {
  for (const actor of actorsIn(scene)) {
    const constraints = scene.constraints.filter(
      (constraint) =>
        constraint.type === "ground-contact" &&
        constraint.enabled &&
        constraint.entityId === actor.id,
    );
    expect(constraints).toHaveLength(1);

    const constraint = constraints[0];
    if (!constraint || constraint.type !== "ground-contact") {
      throw new Error("Actor is missing its ground-contact constraint.");
    }
    const contactOffsetM = actor.pose.preset.parameters.contactOffsetM;
    expect(typeof contactOffsetM).toBe("number");
    if (typeof contactOffsetM !== "number") {
      throw new Error("Actor pose is missing its contact offset.");
    }

    const surfaceY =
      constraint.surfaceEntityId === null
        ? 0
        : surfaceTopY(scene, constraint.surfaceEntityId);
    const expectedY = surfaceY + contactOffsetM * actor.transform.scale[1];
    const contactErrorM = Math.abs(
      actor.transform.positionM[1] - expectedY,
    );
    expect(contactErrorM).toBeLessThanOrEqual(CONTACT_TOLERANCE_M);
  }
};

const expectSavedSceneIsGeneric = (scene: SceneSpec): void => {
  const serialized = serializeSceneFile(scene);

  expect(sceneSpecSchema.parse(JSON.parse(serialized))).toEqual(scene);
  expect(
    actorsIn(scene).every((actor) =>
      /^actor_(male|female|generic)_[1-9][0-9]*$/u.test(actor.slot),
    ),
  ).toBe(true);
};

const expectNoFrameFailures = (
  scene: SceneSpec,
  expectedStatus?: "safe" | "warning",
): void => {
  const report = analyzeComposition(scene);
  const failureCodes = report.issues
    .map((issue) => issue.code)
    .filter((code) => FRAME_FAILURE_CODES.has(code));

  expect(failureCodes).toEqual([]);
  if (expectedStatus) {
    expect(report.status).toBe(expectedStatus);
  }
};

const expectOnlyEntitiesChanged = (
  before: SceneSpec,
  after: SceneSpec,
  changedEntityIds: ReadonlySet<string>,
): void => {
  for (const beforeEntity of before.entities) {
    const afterEntity = after.entities.find(
      (entity) => entity.id === beforeEntity.id,
    );
    expect(afterEntity).toBeDefined();
    if (!changedEntityIds.has(beforeEntity.id)) {
      expect(afterEntity).toEqual(beforeEntity);
    }
  }
};

describe("structured shot regression matrix", () => {
  it("validates one generic actor in a compact low-angle shot", () => {
    const scene = createStructuredShotScene();
    const camera = activeCameraIn(scene);
    const room = scene.entities.find(
      (entity) => entity.kind === "environment",
    );

    expect(sceneSpecSchema.parse(scene)).toEqual(scene);
    expect(actorsIn(scene).map((actor) => actor.slot)).toEqual([
      "actor_generic_1",
    ]);
    expect(room?.kind).toBe("environment");
    expect(
      room?.kind === "environment"
        ? room.preset.parameters.widthM
        : undefined,
    ).toBe(3.4);
    expect(camera.transform.positionM).toEqual([0, 0.68, 2.8]);
    expect(camera.lens.focalLengthMm).toBe(55);

    expectGroundContactsWithinTolerance(scene);
    expectSavedSceneIsGeneric(scene);
    expectNoFrameFailures(scene, "safe");
  });

  it("keeps accepted IntentReport data outside serialized SceneSpec", () => {
    const marker = "intent_host_only_serialization_marker_1";
    const initial = createStructuredShotScene();
    const session = new SceneSession(initial);
    const submission = createSceneSubmission();
    const recognized = submission.intentReport.recognizedConstraints[0];
    if (!recognized) {
      throw new Error("Structured submission fixture is missing intent data.");
    }
    submission.intentReport = {
      ...submission.intentReport,
      recognizedConstraints: [{ ...recognized, id: marker }],
    };

    expect(JSON.stringify(submission)).toContain(marker);
    expect(JSON.stringify(submission.intentReport)).toContain(marker);

    const acceptedScene = session.submitScene(submission);
    const serializedScene = serializeSceneFile(acceptedScene);

    expect(serializedScene).not.toContain(marker);
    expect(serializedScene).not.toContain("intentReport");
    expect(sceneSpecSchema.parse(JSON.parse(serializedScene))).toEqual(
      acceptedScene,
    );
  });

  it("materializes a face-to-face relationship from structured roles", () => {
    const initial = createStructuredTwoActorScene();
    const patch = scenePatchSchema.parse({
      schemaVersion: 1,
      patchId: "patch_structured_face_to_face",
      sceneId: initial.sceneId,
      baseRevision: initial.revision,
      source: "system",
      operations: buildRelationshipOperations(
        initial,
        "relationship.face-to-face-v1",
        {
          primaryActorId: "actor_generic_1",
          secondaryActorId: "actor_generic_2",
          surfaceEntityId: "prop_platform_1",
        },
      ),
    });
    const scene = applyScenePatch(initial, patch).next;
    const actors = actorsIn(scene);

    expect(scene.sceneId).toBe(initial.sceneId);
    expect(scene.revision).toBe(initial.revision + 1);
    expect(actors.map((actor) => actor.slot)).toEqual([
      "actor_generic_1",
      "actor_generic_2",
    ]);
    expect(actors.map((actor) => actor.pose.preset.id)).toEqual([
      "pose.standing-neutral-v1",
      "pose.standing-neutral-v1",
    ]);
    expect(actors[0]?.transform.rotation).not.toEqual(
      actors[1]?.transform.rotation,
    );
    expect(activeCameraIn(scene).lens.focalLengthMm).toBe(28);

    expectGroundContactsWithinTolerance(scene);
    expectSavedSceneIsGeneric(scene);
    expectNoFrameFailures(scene, "safe");
  });

  it("keeps the lower actor face safe in a structured over-under shot", () => {
    const scene = createStructuredRelationshipScene();
    const camera = activeCameraIn(scene);
    const actors = actorsIn(scene);
    const upper = actors.find((actor) => actor.id === "actor_generic_1");
    const lower = actors.find((actor) => actor.id === "actor_generic_2");

    expect(sceneSpecSchema.parse(scene)).toEqual(scene);
    expect(upper?.pose.preset.id).toBe("pose.kneeling-lean-v1");
    expect(lower?.pose.preset.id).toBe("pose.lying-supine-v1");
    expect(
      scene.entities.some((entity) => entity.id === "prop_platform_1"),
    ).toBe(true);
    expect(scene.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "keep-visible",
          cameraId: scene.activeCameraId,
          subjectEntityId: "actor_generic_2",
          anchor: "face",
          enabled: true,
        }),
      ]),
    );
    expect(camera.transform.positionM).toEqual([1.2, 0.85, 2.8]);
    expect(camera.lens.focalLengthMm).toBe(55);

    expectGroundContactsWithinTolerance(scene);
    expectSavedSceneIsGeneric(scene);
    expectNoFrameFailures(scene, "safe");
  });

  it("applies host-authored structured patches as minimal increments", () => {
    const initial = createStructuredShotScene();
    const initialEntityIds = initial.entities.map((entity) => entity.id);
    const movePatch = scenePatchSchema.parse({
      schemaVersion: 1,
      patchId: "patch_structured_actor_move",
      sceneId: initial.sceneId,
      baseRevision: initial.revision,
      source: "natural-language",
      operations: [
        {
          op: "entity.transform.translate",
          entityId: "actor_generic_1",
          deltaM: [0, 0, -0.25],
          referenceSpace: "world",
        },
      ],
    });

    expect(movePatch.operations).toEqual([
      {
        op: "entity.transform.translate",
        entityId: "actor_generic_1",
        deltaM: [0, 0, -0.25],
        referenceSpace: "world",
      },
    ]);
    const afterMove = applyScenePatch(initial, movePatch).next;
    expect(afterMove.sceneId).toBe(initial.sceneId);
    expect(afterMove.revision).toBe(initial.revision + 1);
    expect(afterMove.entities.map((entity) => entity.id)).toEqual(
      initialEntityIds,
    );
    expectOnlyEntitiesChanged(
      initial,
      afterMove,
      new Set(["actor_generic_1"]),
    );

    const currentCamera = activeCameraIn(afterMove);
    const cameraPatch = scenePatchSchema.parse({
      schemaVersion: 1,
      patchId: "patch_structured_camera_adjustment",
      sceneId: afterMove.sceneId,
      baseRevision: afterMove.revision,
      source: "natural-language",
      operations: [
        {
          op: "entity.transform.translate",
          entityId: currentCamera.id,
          deltaM: [0, -0.12, 0],
          referenceSpace: "world",
        },
        {
          op: "camera.lens.set",
          entityId: currentCamera.id,
          value: {
            ...currentCamera.lens,
            focalLengthMm: 70,
          },
        },
      ],
    });
    expect(cameraPatch.operations.map((operation) => operation.op)).toEqual([
      "entity.transform.translate",
      "camera.lens.set",
    ]);

    const final = applyScenePatch(afterMove, cameraPatch).next;
    expect(final.sceneId).toBe(initial.sceneId);
    expect(final.revision).toBe(afterMove.revision + 1);
    expect(final.entities.map((entity) => entity.id)).toEqual(
      initialEntityIds,
    );
    expectOnlyEntitiesChanged(
      afterMove,
      final,
      new Set([currentCamera.id]),
    );
    expect(activeCameraIn(final).lens.focalLengthMm).toBe(70);
    expectGroundContactsWithinTolerance(final);
  });
});
