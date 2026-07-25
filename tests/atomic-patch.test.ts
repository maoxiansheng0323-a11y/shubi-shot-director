import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { createDefaultScene } from "../src/domain/default-scene";
import type { ScenePatch } from "../src/domain/scene-patch";

describe("atomic ScenePatch application", () => {
  it("rolls back every operation when any operation fails", () => {
    const session = new SceneSession(createDefaultScene());
    const before = session.snapshot();
    const patch: ScenePatch = {
      schemaVersion: 1,
      patchId: "patch_atomic_failure",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      operations: [
        {
          op: "scene.title.set",
          value: "Generic revised shot",
        },
        {
          op: "entity.transform.translate",
          entityId: "actor_generic_missing",
          deltaM: [0.25, 0, 0],
          referenceSpace: "world",
        },
      ],
    };

    expect(() => session.applyPatch(patch)).toThrow();
    expect(session.snapshot()).toEqual(before);
    expect(session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it("applies a compound edit once and rejects its stale replay", () => {
    const session = new SceneSession(createDefaultScene());
    const before = session.snapshot();
    const camera = before.entities.find(
      (entity) => entity.id === before.activeCameraId,
    );
    if (!camera || camera.kind !== "camera") {
      throw new Error("Default shot camera is missing.");
    }
    const patch: ScenePatch = {
      schemaVersion: 1,
      patchId: "patch_atomic_compound",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      operations: [
        {
          op: "entity.transform.translate",
          entityId: "actor_generic_1",
          deltaM: [-0.25, 0, 0],
          referenceSpace: "world",
        },
        {
          op: "camera.lens.set",
          entityId: camera.id,
          value: {
            ...camera.lens,
            focalLengthMm: 70,
          },
        },
      ],
    };

    const after = session.applyPatch(patch);
    expect(after.sceneId).toBe(before.sceneId);
    expect(after.revision).toBe(before.revision + 1);
    expect(
      after.entities.find((entity) => entity.id === "actor_generic_1")
        ?.transform.positionM,
    ).toEqual([-0.25, 0.977, 0]);
    expect(
      after.entities.find((entity) => entity.id === camera.id),
    ).toMatchObject({
      kind: "camera",
      lens: { focalLengthMm: 70 },
    });

    const accepted = session.snapshot();
    expect(() => session.applyPatch(patch)).toThrowError(
      expect.objectContaining({ code: "STALE_REVISION" }),
    );
    expect(session.snapshot()).toEqual(accepted);
    expect(session.historyStatus()).toEqual({
      canUndo: true,
      canRedo: false,
    });
  });
});
