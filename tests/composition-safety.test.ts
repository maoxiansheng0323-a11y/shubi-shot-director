import { describe, expect, it } from "vitest";
import { resolveActorLimbPresenceUpdates } from "../src/domain/actor-anatomy";
import {
  analyzeComposition,
  COMPOSITION_SAFE_NDC_LIMIT,
} from "../src/domain/composition-safety";
import { createDefaultScene } from "../src/domain/default-scene";
import { actorAnchorWorldPoint } from "../src/domain/humanoid-rig";
import {
  lookAtQuaternion,
  quaternionFromEulerDegrees,
} from "../src/domain/scene-math";
import type {
  ActorEntity,
  CameraEntity,
  SceneSpec,
} from "../src/domain/scene-schema";

const getActor = (scene: SceneSpec): ActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is ActorEntity => entity.kind === "actor",
  );
  if (!actor) {
    throw new Error("Test scene is missing an actor.");
  }
  return actor;
};

const getCamera = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.id === scene.activeCameraId && entity.kind === "camera",
  );
  if (!camera) {
    throw new Error("Test scene is missing its active camera.");
  }
  return camera;
};

const aimCameraAtFace = (
  camera: CameraEntity,
  actor: ActorEntity,
): void => {
  camera.transform.rotation = lookAtQuaternion(
    camera.transform.positionM,
    actorAnchorWorldPoint(actor, "face"),
  );
};

const spreadArms = (actor: ActorEntity): void => {
  actor.pose.joints.upper_arm_l = quaternionFromEulerDegrees([0, 0, 90]);
  actor.pose.joints.upper_arm_r = quaternionFromEulerDegrees([0, 0, -90]);
  actor.pose.joints.forearm_l = [0, 0, 0, 1];
  actor.pose.joints.forearm_r = [0, 0, 0, 1];
};

const removeBothArms = (actor: ActorEntity): void => {
  actor.body.limbPresence = resolveActorLimbPresenceUpdates(
    actor.body.limbPresence,
    { upper_arm_l: "absent", upper_arm_r: "absent" },
  );
};

const createAlignedScene = (): SceneSpec => {
  const scene = createDefaultScene();
  const actor = getActor(scene);
  const camera = getCamera(scene);
  const face = actorAnchorWorldPoint(actor, "face");

  actor.transform.positionM[2] = 0;
  actor.transform.rotation = [0, 0, 0, 1];
  camera.transform.positionM = [0, face[1], 3];
  aimCameraAtFace(camera, actor);

  for (const entity of scene.entities) {
    if (entity.kind === "prop") {
      entity.visible = false;
    }
  }

  scene.constraints.push({
    id: "constraint_keep_face",
    type: "keep-visible",
    cameraId: camera.id,
    subjectEntityId: actor.id,
    anchor: "face",
    enabled: true,
  });
  return scene;
};

describe("analyzeComposition", () => {
  it("returns six honest category results without mutating SceneSpec", () => {
    const scene = createAlignedScene();
    const before = structuredClone(scene);

    const report = analyzeComposition(scene);

    expect(report.status).toBe("safe");
    expect(report.overallStatus).toBe("check");
    expect(report.anchorSafe).toMatchObject({
      status: "pass",
      required: true,
      approximate: false,
    });
    expect(report.framingSafe.status).toBe("unchecked");
    expect(report.captionSafe.status).toBe("unchecked");
    expect(report.occlusionSafe).toMatchObject({
      status: "pass",
      required: true,
      approximate: true,
    });
    expect(report.topologySafe.status).toBe("pass");
    expect(report.cameraCollisionSafe.status).toBe("pass");
    expect(report.issues).toEqual([]);
    expect(scene).toEqual(before);
  });

  it("reports an anchor outside the active camera frame", () => {
    const scene = createAlignedScene();
    getActor(scene).transform.positionM[0] = 4;

    const report = analyzeComposition(scene);

    expect(report.anchorSafe.status).toBe("fail");
    expect(report.anchorSafe.issueCodes).toContain("ANCHOR_OUT_OF_FRAME");
  });

  it("reports an anchor inside the frame but outside the safety margin", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    const camera = getCamera(scene);
    const faceDepth = Math.abs(
      actorAnchorWorldPoint(actor, "face")[2] -
        camera.transform.positionM[2],
    );
    const horizontalHalfTangent =
      camera.lens.sensorWidthMm / (2 * camera.lens.focalLengthMm);
    actor.transform.positionM[0] =
      faceDepth *
      horizontalHalfTangent *
      (COMPOSITION_SAFE_NDC_LIMIT + 0.1);

    const report = analyzeComposition(scene);

    expect(report.anchorSafe.issueCodes).toContain("ANCHOR_NEAR_SAFE_EDGE");
    expect(report.anchorSafe.issueCodes).not.toContain("ANCHOR_OUT_OF_FRAME");
  });

  it("ignores keep-visible constraints for non-active cameras", () => {
    const scene = createDefaultScene();
    const activeCamera = getCamera(scene);
    const otherCamera: CameraEntity = {
      ...structuredClone(activeCamera),
      id: "camera_other_1",
      transform: {
        ...structuredClone(activeCamera.transform),
        rotation: [0, 1, 0, 0],
      },
    };
    scene.entities.push(otherCamera);
    scene.constraints.push({
      id: "constraint_other_camera",
      type: "keep-visible",
      cameraId: otherCamera.id,
      subjectEntityId: getActor(scene).id,
      anchor: "face",
      enabled: true,
    });

    const report = analyzeComposition(scene);

    expect(report.activeCameraId).toBe(activeCamera.id);
    expect(report.anchorSafe).toMatchObject({
      required: false,
      status: "unchecked",
    });
  });

  it("reports an anchor before the camera near clipping plane", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    const camera = getCamera(scene);
    actor.transform.positionM[2] = 2.5;
    camera.lens.nearM = 1;

    const report = analyzeComposition(scene);

    expect(report.anchorSafe.issueCodes).toContain(
      "ANCHOR_BEFORE_NEAR_CLIP",
    );
  });

  it("reports actor/prop occlusion ratio as approximate", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!prop || prop.kind !== "prop") {
      throw new Error("Test scene is missing a prop.");
    }
    const face = actorAnchorWorldPoint(actor, "face");
    prop.visible = true;
    prop.transform.positionM = [0, face[1], 1.5];

    const report = analyzeComposition(scene);
    const occlusion = report.issues.find(
      (entry) => entry.code === "ANCHOR_OCCLUDED_APPROXIMATE",
    );

    expect(report.occlusionSafe).toMatchObject({
      status: "check",
      approximate: true,
    });
    expect(occlusion).toMatchObject({
      approximate: true,
      cameraId: scene.activeCameraId,
      subjectEntityId: actor.id,
      occluderEntityId: prop.id,
      relatedEntityIds: [scene.activeCameraId, actor.id, prop.id],
    });
    expect(occlusion?.occlusionRatio).toBeGreaterThan(0);
    expect(occlusion?.evidence).toContain("approximate projected occlusion");
  });

  it("checks caption overlap even when the face anchor is safe", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    scene.compositionGoals = {
      captionZone: { bottomFraction: 0.3 },
      criticalEntityIds: [actor.id],
    };

    const report = analyzeComposition(scene);

    expect(report.anchorSafe.status).toBe("pass");
    expect(report.captionSafe).toMatchObject({
      required: true,
      status: "check",
      approximate: true,
    });
    expect(report.captionSafe.issueCodes).toContain(
      "SUBJECT_OVERLAPS_CAPTION_ZONE",
    );
  });

  it("fails full-body framing when only the face region fits", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    const camera = getCamera(scene);
    camera.lens.focalLengthMm = 100;
    camera.transform.positionM[2] = 0.8;
    aimCameraAtFace(camera, actor);
    scene.compositionGoals = {
      framing: {
        mode: "full",
        targetEntityIds: [actor.id],
      },
    };

    const report = analyzeComposition(scene);

    expect(report.anchorSafe.status).toBe("pass");
    expect(report.framingSafe.status).toBe("fail");
    expect(report.framingSafe.issueCodes).toContain(
      "FRAMING_BOUNDS_OUT_OF_FRAME",
    );
  });

  it("does not let absent arms enlarge visible actor framing bounds", () => {
    const presentScene = createAlignedScene();
    const presentActor = getActor(presentScene);
    const presentCamera = getCamera(presentScene);
    spreadArms(presentActor);
    presentActor.transform.scale = [4, 1, 1];
    presentCamera.transform.positionM = [0, actorAnchorWorldPoint(presentActor, "face")[1], 13];
    presentCamera.lens.focalLengthMm = 75;
    aimCameraAtFace(presentCamera, presentActor);
    presentScene.compositionGoals = {
      framing: { mode: "full", targetEntityIds: [presentActor.id] },
    };

    const absentScene = structuredClone(presentScene);
    const absentActor = getActor(absentScene);
    removeBothArms(absentActor);

    expect(analyzeComposition(presentScene).framingSafe.issueCodes).toContain(
      "FRAMING_BOUNDS_OUT_OF_FRAME",
    );
    expect(analyzeComposition(absentScene).framingSafe.issueCodes).not.toContain(
      "FRAMING_BOUNDS_OUT_OF_FRAME",
    );
  });

  it("does not create an occlusion proxy from absent arms", () => {
    const presentScene = createAlignedScene();
    const subject = getActor(presentScene);
    const occluder: ActorEntity = {
      ...structuredClone(subject),
      id: "actor_generic_2",
      slot: "actor_generic_2",
      transform: {
        ...structuredClone(subject.transform),
        positionM: [0.95, subject.transform.positionM[1], 1.5],
      },
    };
    spreadArms(occluder);
    presentScene.entities.push(occluder);

    const absentScene = structuredClone(presentScene);
    const absentOccluder = absentScene.entities.find(
      (entity): entity is ActorEntity => entity.id === occluder.id && entity.kind === "actor",
    );
    if (!absentOccluder) {
      throw new Error("Occluder fixture is missing.");
    }
    removeBothArms(absentOccluder);

    expect(analyzeComposition(presentScene).occlusionSafe.issueCodes).toContain(
      "ANCHOR_OCCLUDED_APPROXIMATE",
    );
    expect(analyzeComposition(absentScene).occlusionSafe.issueCodes).not.toContain(
      "ANCHOR_OCCLUDED_APPROXIMATE",
    );
  });

  it("reports only cameras inside the visible actor AABB proxy", () => {
    const presentScene = createAlignedScene();
    const presentActor = getActor(presentScene);
    const presentCamera = getCamera(presentScene);
    spreadArms(presentActor);
    presentActor.transform.scale = [2, 1, 1];
    presentCamera.transform.positionM = [1.4, 1.45, 0];
    aimCameraAtFace(presentCamera, presentActor);

    const absentScene = structuredClone(presentScene);
    const absentActor = getActor(absentScene);
    removeBothArms(absentActor);

    const presentReport = analyzeComposition(presentScene);
    const absentReport = analyzeComposition(absentScene);

    expect(presentReport.cameraCollisionSafe).toMatchObject({
      status: "fail",
      approximate: true,
    });
    expect(presentReport.cameraCollisionSafe.issueCodes).toContain(
      "CAMERA_INSIDE_ACTOR_PROXY",
    );
    expect(absentReport.cameraCollisionSafe.issueCodes).not.toContain(
      "CAMERA_INSIDE_ACTOR_PROXY",
    );
  });

  it("checks a configured side UI zone", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    actor.transform.positionM[0] = -0.9;
    scene.compositionGoals = {
      sideUiZone: {
        side: "left",
        widthFraction: 0.3,
      },
      criticalEntityIds: [actor.id],
    };

    const report = analyzeComposition(scene);

    expect(report.captionSafe.issueCodes).toContain(
      "SUBJECT_OVERLAPS_SIDE_UI_ZONE",
    );
  });

  it("fails topology when the active-camera sightline crosses a wall", () => {
    const scene = createAlignedScene();
    const actor = getActor(scene);
    const camera = getCamera(scene);
    camera.transform.positionM = [0, actorAnchorWorldPoint(actor, "face")[1], -3];
    aimCameraAtFace(camera, actor);

    const report = analyzeComposition(scene);

    expect(report.topologySafe.status).toBe("fail");
    expect(report.topologySafe.issueCodes).toContain(
      "SIGHTLINE_INTERSECTS_WALL",
    );
  });

  it("fails camera collision for room walls and visible props", () => {
    const wallScene = createAlignedScene();
    const wallCamera = getCamera(wallScene);
    wallCamera.transform.positionM = [0, 1, -2];
    aimCameraAtFace(wallCamera, getActor(wallScene));

    expect(
      analyzeComposition(wallScene).cameraCollisionSafe.issueCodes,
    ).toContain("CAMERA_COLLIDES_WALL");

    const propScene = createAlignedScene();
    const propCamera = getCamera(propScene);
    const prop = propScene.entities.find((entity) => entity.kind === "prop");
    if (!prop || prop.kind !== "prop") {
      throw new Error("Test scene is missing a prop.");
    }
    prop.visible = true;
    prop.transform.positionM = [...propCamera.transform.positionM];

    expect(
      analyzeComposition(propScene).cameraCollisionSafe.issueCodes,
    ).toContain("CAMERA_INSIDE_PROP");
  });

  it("reports a missing active camera defensively", () => {
    const scene = createAlignedScene();
    scene.activeCameraId = "camera_missing";

    const report = analyzeComposition(scene);

    expect(report.cameraCollisionSafe).toMatchObject({
      status: "fail",
      issueCodes: ["ACTIVE_CAMERA_MISSING"],
    });
    expect(report.issues[0]).toMatchObject({
      code: "ACTIVE_CAMERA_MISSING",
      cameraId: "camera_missing",
      relatedEntityIds: ["camera_missing"],
      approximate: false,
    });
  });
});
