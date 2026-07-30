import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  actorAnchorWorldPoint,
} from "../src/domain/actor-projection";
import { lookAtQuaternion } from "../src/domain/scene-math";
import { materializePose } from "../src/domain/presets/pose-presets";

describe("humanoid narrative anchors", () => {
  it("follows the pelvis pose when resolving a supine face", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!actor || actor.kind !== "actor") {
      throw new Error("Actor fixture is missing.");
    }

    actor.pose = materializePose(actor, "pose.lying-supine-v1");
    actor.transform.positionM = [
      0,
      actor.pose.preset.parameters.contactOffsetM as number,
      0,
    ];
    const face = actorAnchorWorldPoint(actor, "face");

    expect(face[1]).toBeGreaterThan(actor.transform.positionM[1]);
    expect(face[1]).toBeLessThan(0.4);
    expect(face[2]).toBeLessThan(-0.4);
  });

  it("uses the pose-aware face anchor for camera look-at patches", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    const camera = scene.entities.find(
      (entity) => entity.kind === "camera",
    );
    if (
      !actor ||
      actor.kind !== "actor" ||
      !camera ||
      camera.kind !== "camera"
    ) {
      throw new Error("Scene fixtures are missing.");
    }

    actor.pose = materializePose(actor, "pose.lying-supine-v1");
    const face = actorAnchorWorldPoint(actor, "face");
    const result = applyScenePatch(scene, {
      schemaVersion: 1,
      patchId: "patch_pose_aware_look",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "system",
      operations: [
        {
          op: "camera.look-at",
          entityId: camera.id,
          target: {
            type: "entity-anchor",
            entityId: actor.id,
            anchor: "face",
          },
        },
      ],
    });
    const updated = result.next.entities.find(
      (entity) => entity.id === camera.id,
    );

    expect(updated?.transform.rotation).toEqual(
      lookAtQuaternion(camera.transform.positionM, face),
    );
  });
});
