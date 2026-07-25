import { describe, expect, it } from "vitest";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import { sceneSpecSchema } from "../src/domain/scene-schema";

describe("SceneSpec", () => {
  it("accepts the generic starter scene", () => {
    const scene = createDefaultScene();
    expect(sceneSpecSchema.parse(scene).activeCameraId).toBe("camera_shot_1");
  });

  it("rejects duplicate actor slots", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor || actor.kind !== "actor") {
      throw new Error("Starter actor is missing.");
    }
    scene.entities.push({
      ...structuredClone(actor),
      id: "actor_duplicate",
    });
    expect(() => sceneSpecSchema.parse(scene)).toThrow();
  });

  it("rejects duplicate or kind-invalid constraints", () => {
    const duplicate = createDefaultScene();
    duplicate.constraints.push(structuredClone(duplicate.constraints[0]));
    expect(() => sceneSpecSchema.parse(duplicate)).toThrow();

    const wrongKinds = createDefaultScene();
    wrongKinds.constraints = [
      {
        id: "constraint_wrong_kinds",
        type: "keep-visible",
        cameraId: "actor_generic_1",
        subjectEntityId: "camera_shot_1",
        anchor: "face",
        enabled: true,
      },
    ];
    expect(() => sceneSpecSchema.parse(wrongKinds)).toThrow();
  });
});

describe("ScenePatch", () => {
  it("applies an incremental world-space translation", () => {
    const scene = createDefaultScene();
    const applied = applyScenePatch(scene, {
      schemaVersion: 1,
      patchId: "patch_move_actor",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      operations: [
        {
          op: "entity.transform.translate",
          entityId: "actor_generic_1",
          deltaM: [1, 0, -0.5],
          referenceSpace: "world",
        },
      ],
    });

    const actor = applied.next.entities.find(
      (entity) => entity.id === "actor_generic_1",
    );
    expect(actor?.transform.positionM).toEqual([1, 0.977, -0.5]);
    expect(applied.next.revision).toBe(1);
  });

  it("rejects stale revisions without changing the original", () => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);
    expect(() =>
      applyScenePatch(scene, {
        schemaVersion: 1,
        patchId: "patch_stale",
        sceneId: scene.sceneId,
        baseRevision: 99,
        source: "natural-language",
        operations: [
          {
            op: "entity.transform.rotate",
            entityId: "actor_generic_1",
            deltaRotation: quaternionFromEulerDegrees([0, 10, 0]),
            referenceSpace: "world",
          },
        ],
      }),
    ).toThrowError(SceneDomainError);
    expect(scene).toEqual(before);
  });

  it("adds, replaces, and removes allowlisted constraints atomically", () => {
    const scene = createDefaultScene();
    const added = applyScenePatch(scene, {
      schemaVersion: 1,
      patchId: "patch_add_visibility",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      operations: [
        {
          op: "constraint.set",
          value: {
            id: "constraint_visible_actor_1",
            type: "keep-visible",
            cameraId: scene.activeCameraId,
            subjectEntityId: "actor_generic_1",
            anchor: "face",
            enabled: true,
          },
        },
      ],
    });
    expect(
      added.next.constraints.find(
        (constraint) => constraint.id === "constraint_visible_actor_1",
      ),
    ).toMatchObject({ enabled: true, anchor: "face" });

    const replaced = applyScenePatch(added.next, {
      schemaVersion: 1,
      patchId: "patch_disable_visibility",
      sceneId: scene.sceneId,
      baseRevision: added.next.revision,
      source: "manual",
      operations: [
        {
          op: "constraint.set",
          value: {
            id: "constraint_visible_actor_1",
            type: "keep-visible",
            cameraId: scene.activeCameraId,
            subjectEntityId: "actor_generic_1",
            anchor: "face",
            enabled: false,
          },
        },
      ],
    });
    expect(
      replaced.next.constraints.find(
        (constraint) => constraint.id === "constraint_visible_actor_1",
      ),
    ).toMatchObject({ enabled: false });

    const removed = applyScenePatch(replaced.next, {
      schemaVersion: 1,
      patchId: "patch_remove_visibility",
      sceneId: scene.sceneId,
      baseRevision: replaced.next.revision,
      source: "manual",
      operations: [
        {
          op: "constraint.remove",
          constraintId: "constraint_visible_actor_1",
        },
      ],
    });
    expect(
      removed.next.constraints.some(
        (constraint) => constraint.id === "constraint_visible_actor_1",
      ),
    ).toBe(false);
    expect(scene.constraints).toHaveLength(1);
  });
});
