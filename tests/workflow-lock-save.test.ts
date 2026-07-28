import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { scenePatchSchema } from "../src/domain/scene-patch";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createWorkflowLockCheckpointPatch,
  validateWorkflowLockCheckpointAcceptance,
} from "../src/domain/workflow-lock-patch";
import { serializeSceneFile } from "../src/editor/scene-files";

const createMaximumEntityScene = (): SceneSpec => {
  const scene = createDefaultScene();
  const camera = scene.entities.find((entity) => entity.kind === "camera");
  const prop = scene.entities.find((entity) => entity.kind === "prop");
  if (camera?.kind !== "camera" || prop?.kind !== "prop") {
    throw new Error("Default scene is missing checkpoint fixtures.");
  }

  return sceneSpecSchema.parse({
    ...structuredClone(scene),
    constraints: [],
    entities: [
      structuredClone(camera),
      ...Array.from({ length: 255 }, (_, index) => ({
        ...structuredClone(prop),
        id: `prop_checkpoint_${index + 1}`,
        label: `Checkpoint prop ${index + 1}`,
      })),
    ],
  });
};

const checkpointAcceptanceFixture = (): {
  before: SceneSpec;
  patch: NonNullable<
    ReturnType<typeof createWorkflowLockCheckpointPatch>
  >;
  accepted: SceneSpec;
} => {
  const before = createDefaultScene();
  before.revision = 8;
  before.entities[1]!.lockMode = "workflow";
  before.entities[2]!.lockMode = "user";
  const patch = createWorkflowLockCheckpointPatch(
    before,
    "system_save_8",
    "system",
  );
  if (!patch) {
    throw new Error("Checkpoint acceptance fixture did not create a patch.");
  }
  return {
    before,
    patch,
    accepted: applyScenePatch(before, patch).next,
  };
};

describe("workflow lock save checkpoint", () => {
  it("returns null when every entity already has a workflow or user lock", () => {
    const scene = createDefaultScene();
    scene.entities.forEach((entity, index) => {
      entity.lockMode = index % 2 === 0 ? "workflow" : "user";
    });

    expect(
      createWorkflowLockCheckpointPatch(
        scene,
        "system_save_0",
        "system",
      ),
    ).toBeNull();
  });

  it("creates one canonical operation for each unlocked entity in scene order", () => {
    const scene = createDefaultScene();
    scene.revision = 12;
    scene.entities[1]!.lockMode = "workflow";
    scene.entities[2]!.lockMode = "user";

    const patch = scenePatchSchema.parse(
      createWorkflowLockCheckpointPatch(
        scene,
        "system_save_12",
        "system",
      ),
    );

    expect(patch).toMatchObject({
      schemaVersion: 4,
      patchId: "system_save_12",
      sceneId: scene.sceneId,
      baseRevision: 12,
      source: "system",
      preserveLock: false,
    });
    expect(patch.operations).toEqual([
      {
        op: "entity.flags.set",
        entityId: scene.entities[0]!.id,
        lockMode: "workflow",
      },
      {
        op: "entity.flags.set",
        entityId: scene.entities[3]!.id,
        lockMode: "workflow",
      },
    ]);
  });

  it("supports one valid checkpoint containing the maximum 256 entities", () => {
    const scene = createMaximumEntityScene();

    const patch = scenePatchSchema.parse(
      createWorkflowLockCheckpointPatch(
        scene,
        "system_save_0",
        "system",
      ),
    );

    expect(patch.operations).toHaveLength(256);
    expect(
      patch.operations.map((operation) =>
        "entityId" in operation ? operation.entityId : null,
      ),
    ).toEqual(scene.entities.map((entity) => entity.id));
  });

  it("does not mutate the scene or share mutable operation data", () => {
    const scene = createDefaultScene();
    const original = structuredClone(scene);
    const first = createWorkflowLockCheckpointPatch(
      scene,
      "manual_save_0",
      "manual",
    );
    const second = createWorkflowLockCheckpointPatch(
      scene,
      "manual_save_0",
      "manual",
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      return;
    }

    const firstOperation = first.operations[0];
    if (firstOperation?.op !== "entity.flags.set") {
      throw new Error("Checkpoint operation is not an entity flag update.");
    }
    firstOperation.lockMode = "none";

    expect(scene).toEqual(original);
    expect(second.operations[0]).toEqual({
      op: "entity.flags.set",
      entityId: scene.entities[0]!.id,
      lockMode: "workflow",
    });
  });

  it("applies all new locks in exactly one revision and one undo step", () => {
    const scene = createDefaultScene();
    scene.entities[1]!.lockMode = "workflow";
    scene.entities[2]!.lockMode = "user";
    const startingModes = scene.entities.map((entity) => entity.lockMode);
    const session = new SceneSession(scene);
    const patch = createWorkflowLockCheckpointPatch(
      session.snapshot(),
      "system_save_0",
      "system",
    );
    expect(patch).not.toBeNull();
    if (!patch) {
      return;
    }

    const accepted = session.applyPatch(patch);

    expect(accepted.revision).toBe(scene.revision + 1);
    expect(accepted.entities.map((entity) => entity.lockMode)).toEqual([
      "workflow",
      "workflow",
      "user",
      "workflow",
    ]);
    expect(session.historyStatus()).toEqual({
      canUndo: true,
      canRedo: false,
    });
    const undone = session.undo();
    expect(undone?.entities.map((entity) => entity.lockMode)).toEqual(
      startingModes,
    );
    expect(session.undo()).toBeNull();
  });

  it("keeps mere serialization side-effect free", () => {
    const scene = createDefaultScene();
    const serialized = serializeSceneFile(scene);

    expect(
      scene.entities.every((entity) => entity.lockMode === "none"),
    ).toBe(true);
    expect(
      sceneSpecSchema
        .parse(JSON.parse(serialized) as unknown)
        .entities.every((entity) => entity.lockMode === "none"),
    ).toBe(true);
  });
});

describe("workflow lock checkpoint acceptance", () => {
  it("returns the canonical accepted scene for the exact deterministic result", () => {
    const { before, patch, accepted } = checkpointAcceptanceFixture();
    const originals = structuredClone({ before, patch, accepted });

    expect(
      validateWorkflowLockCheckpointAcceptance(
        before,
        patch,
        accepted,
      ),
    ).toEqual(accepted);
    expect({ before, patch, accepted }).toEqual(originals);
  });

  it.each([
    [
      "wrong scene id",
      (accepted: SceneSpec) => {
        accepted.sceneId = "scene_wrong_checkpoint";
      },
    ],
    [
      "same revision",
      (accepted: SceneSpec) => {
        accepted.revision -= 1;
      },
    ],
    [
      "jumped revision",
      (accepted: SceneSpec) => {
        accepted.revision += 1;
      },
    ],
    [
      "remaining unlocked entity",
      (accepted: SceneSpec) => {
        accepted.entities[0]!.lockMode = "none";
      },
    ],
    [
      "changed workflow lock",
      (accepted: SceneSpec) => {
        accepted.entities[1]!.lockMode = "user";
      },
    ],
    [
      "changed user lock",
      (accepted: SceneSpec) => {
        accepted.entities[2]!.lockMode = "workflow";
      },
    ],
    [
      "changed unrelated transform",
      (accepted: SceneSpec) => {
        accepted.entities[3]!.transform.positionM[0] += 0.25;
      },
    ],
    [
      "reordered entities",
      (accepted: SceneSpec) => {
        accepted.entities = [
          accepted.entities[1]!,
          accepted.entities[0]!,
          ...accepted.entities.slice(2),
        ];
      },
    ],
    [
      "removed entity",
      (accepted: SceneSpec) => {
        accepted.entities.splice(2, 1);
      },
    ],
  ])("rejects a schema-valid response with %s", (_name, mutate) => {
    const { before, patch, accepted } = checkpointAcceptanceFixture();
    mutate(accepted);

    expect(() =>
      validateWorkflowLockCheckpointAcceptance(
        before,
        patch,
        accepted,
      ),
    ).toThrowError(
      "The workflow lock checkpoint response is invalid.",
    );
  });
});
