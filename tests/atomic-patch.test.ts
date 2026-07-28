import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { createDefaultScene } from "../src/domain/default-scene";
import type { ScenePatch } from "../src/domain/scene-patch";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

describe("atomic ScenePatch application", () => {
  it("rolls back every operation when any operation fails", () => {
    const session = new SceneSession(createDefaultScene());
    const before = session.snapshot();
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_atomic_failure",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "scene.title.set",
          value: "Generic revised shot",
        },
        {
          op: "actor.limb-presence.set",
          actorId: "actor_generic_1",
          updates: { hand_l: "absent" },
        },
        {
          op: "actor.limb-presence.set",
          actorId: "actor_generic_missing",
          updates: { foot_r: "absent" },
        },
      ],
    };

    expect(() => session.applyPatch(patch)).toThrowError(
      expect.objectContaining({ code: "ACTOR_LIMB_TARGET_INVALID" }),
    );
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
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_atomic_compound",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
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
    const actor = after.entities.find(
      (entity) => entity.id === "actor_generic_1",
    );
    if (!actor || actor.kind !== "actor") {
      throw new Error("Default shot actor is missing.");
    }
    expect(actor.transform.positionM[0]).toBeCloseTo(-0.25, 9);
    expect(actor.transform.positionM[2]).toBeCloseTo(0, 9);
    expect(actorVisibleRigBounds(actor).minWorld[1]).toBeCloseTo(0, 9);
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
