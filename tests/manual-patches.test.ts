import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { scenePatchSchema } from "../src/domain/scene-patch";
import {
  createCameraLensPatch,
  createLockedPatch,
  createTransformPatch,
  transformsEqual,
} from "../src/editor/manual-patches";

describe("manual editor patches", () => {
  it("creates one-operation transform patches against the current revision", () => {
    const scene = createDefaultScene();
    const entity = scene.entities.find((candidate) => !candidate.locked);
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
    expect(patch.operations[0]).toEqual({
      op: "camera.lens.set",
      entityId: camera.id,
      value: {
        ...camera.lens,
        focalLengthMm: 62,
      },
    });
  });

  it("creates flag patches and compares transform values with tolerance", () => {
    const scene = createDefaultScene();
    const entity = scene.entities[0];
    const patch = scenePatchSchema.parse(
      createLockedPatch(scene, entity.id, entity.visible, true),
    );

    expect(patch.operations[0]).toMatchObject({
      op: "entity.flags.set",
      entityId: entity.id,
      locked: true,
    });
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
