import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { scenePatchSchema } from "../src/domain/scene-patch";
import {
  createActorLimbPresencePatch,
  createCameraLensPatch,
  createLockModePatch,
  nextManualLockMode,
  createTransformPatch,
  transformsEqual,
} from "../src/editor/manual-patches";

describe("manual editor patches", () => {
  it("creates one authoritative actor limb presence operation", () => {
    const scene = createDefaultScene();
    const patch = scenePatchSchema.parse(
      createActorLimbPresencePatch(scene, "actor_generic_1", {
        lower_leg_l: "absent",
      }),
    );

    expect(patch.schemaVersion).toBe(4);
    expect(patch.baseRevision).toBe(scene.revision);
    expect(patch.source).toBe("manual");
    expect(patch.preserveLock).toBe(false);
    expect(patch.operations).toEqual([
      {
        op: "actor.limb-presence.set",
        actorId: "actor_generic_1",
        updates: { lower_leg_l: "absent" },
      },
    ]);
  });

  it("creates one-operation transform patches against the current revision", () => {
    const scene = createDefaultScene();
    const entity = scene.entities.find(
      (candidate) => candidate.lockMode === "none",
    );
    expect(entity).toBeDefined();
    if (!entity) {
      return;
    }

    const transform = {
      ...entity.transform,
      positionM: [1, 2, 3] as [number, number, number],
    };
    const patch = scenePatchSchema.parse(
      createTransformPatch(scene, entity.id, transform),
    );

    expect(patch.baseRevision).toBe(scene.revision);
    expect(patch.source).toBe("manual");
    expect(patch.preserveLock).toBe(false);
    expect(patch.operations).toEqual([
      {
        op: "entity.transform.set",
        entityId: entity.id,
        value: transform,
      },
    ]);
  });

  it("preserves camera lens fields when changing focal length", () => {
    const scene = createDefaultScene();
    const camera = scene.entities.find(
      (entity) => entity.kind === "camera",
    );
    expect(camera?.kind).toBe("camera");
    if (camera?.kind !== "camera") {
      return;
    }

    const patch = createCameraLensPatch(scene, camera, 62);
    expect(patch.preserveLock).toBe(false);
    expect(patch.operations[0]).toEqual({
      op: "camera.lens.set",
      entityId: camera.id,
      value: {
        ...camera.lens,
        focalLengthMm: 62,
      },
    });
  });

  it("explicitly preserves workflow locks for shot camera gestures", () => {
    const scene = createDefaultScene();
    const camera = scene.entities.find(
      (entity) => entity.kind === "camera",
    );
    expect(camera?.kind).toBe("camera");
    if (camera?.kind !== "camera") {
      return;
    }
    camera.lockMode = "workflow";
    const transform = {
      ...camera.transform,
      positionM: [1, 2, 3] as [number, number, number],
    };

    expect(
      createTransformPatch(scene, camera.id, transform, {
        preserveLock: true,
      }),
    ).toMatchObject({
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      preserveLock: true,
    });
    expect(
      createCameraLensPatch(scene, camera, 50, {
        preserveLock: true,
      }),
    ).toMatchObject({
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      preserveLock: true,
    });
  });

  it("creates explicit user protection and unlock flag patches", () => {
    const scene = createDefaultScene();
    const entity = scene.entities[0];
    const protectedPatch = scenePatchSchema.parse(
      createLockModePatch(scene, entity.id, "user"),
    );
    const unlockedPatch = scenePatchSchema.parse(
      createLockModePatch(scene, entity.id, "none"),
    );

    expect(protectedPatch.preserveLock).toBe(false);
    expect(protectedPatch.operations).toEqual([
      {
        op: "entity.flags.set",
        entityId: entity.id,
        lockMode: "user",
      },
    ]);
    expect(unlockedPatch.operations).toEqual([
      {
        op: "entity.flags.set",
        entityId: entity.id,
        lockMode: "none",
      },
    ]);
  });

  it("uses user protection for an unlocked click and unlocks either lock kind", () => {
    expect(nextManualLockMode("none")).toBe("user");
    expect(nextManualLockMode("workflow")).toBe("none");
    expect(nextManualLockMode("user")).toBe("none");
  });

  it("compares transform values with tolerance", () => {
    const scene = createDefaultScene();
    const entity = scene.entities[0];

    expect(transformsEqual(entity.transform, entity.transform)).toBe(true);
    expect(
      transformsEqual(entity.transform, {
        ...entity.transform,
        positionM: [
          entity.transform.positionM[0] + 0.01,
          entity.transform.positionM[1],
          entity.transform.positionM[2],
        ],
      }),
    ).toBe(false);
  });
});
