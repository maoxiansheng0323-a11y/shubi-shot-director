import { describe, expect, it, vi } from "vitest";
import { SceneSession } from "../server/scene-session";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { createDefaultScene } from "../src/domain/default-scene";
import { materializePose } from "../src/domain/presets/pose-presets";
import type {
  SceneOperation,
  ScenePatch,
} from "../src/domain/scene-patch";
import type {
  SceneEntity,
  SceneSpec,
} from "../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

const requireEntity = (
  scene: SceneSpec,
  entityId: string,
): SceneEntity => {
  const entity = scene.entities.find(
    (candidate) => candidate.id === entityId,
  );
  if (!entity) {
    throw new Error(`Missing test entity: ${entityId}`);
  }
  return entity;
};

const patchFor = (
  scene: SceneSpec,
  operations: SceneOperation[],
  preserveLock: boolean,
  patchId = "patch_lock_preservation",
): ScenePatch => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId,
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  preserveLock,
  operations,
});

const translate = (
  scene: SceneSpec,
  entityId: string,
  preserveLock: boolean,
): ScenePatch =>
  patchFor(
    scene,
    [
      {
        op: "entity.transform.translate",
        entityId,
        deltaM: [0.25, 0, 0],
        referenceSpace: "world",
      },
    ],
    preserveLock,
    "patch_lock_translation",
  );

const expectDomainCode = (
  callback: () => unknown,
  code: string,
): void => {
  try {
    callback();
    throw new Error("Expected a SceneDomainError.");
  } catch (error) {
    expect(error).toBeInstanceOf(SceneDomainError);
    expect((error as SceneDomainError).code).toBe(code);
  }
};

const expectGroundedActorState = (
  scene: SceneSpec,
  entityId: string,
  lockMode: "none" | "workflow" | "user",
  expectedXZ: readonly [number, number],
): void => {
  const entity = requireEntity(scene, entityId);
  if (entity.kind !== "actor") {
    throw new Error(`Expected an actor fixture: ${entityId}`);
  }
  expect(entity.lockMode).toBe(lockMode);
  expect(entity.transform.positionM[0]).toBeCloseTo(expectedXZ[0], 9);
  expect(entity.transform.positionM[2]).toBeCloseTo(expectedXZ[1], 9);
  expect(actorVisibleRigBounds(entity).minWorld[1]).toBeCloseTo(0, 9);
};

describe("workflow-lock preservation", () => {
  it("does not recompute contact for a pure lock transition", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");

    const applied = applyScenePatch(
      scene,
      patchFor(
        scene,
        [
          {
            op: "entity.flags.set",
            entityId: actor.id,
            lockMode: "workflow",
          },
        ],
        false,
        "patch_pure_lock_transition",
      ),
    );

    expect(requireEntity(applied.next, actor.id)).toMatchObject({
      lockMode: "workflow",
      transform: { positionM: [0, 0.977, 0] },
    });
  });

  it("changes a workflow-locked entity and preserves its exact lock", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "workflow";
    const before = structuredClone(scene);

    const applied = applyScenePatch(
      scene,
      translate(scene, actor.id, true),
    );

    expect(scene).toEqual(before);
    expect(applied.next.revision).toBe(scene.revision + 1);
    expectGroundedActorState(
      applied.next,
      actor.id,
      "workflow",
      [0.25, 0],
    );
  });

  it("rejects a user-locked direct target without scene mutation", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "user";
    const before = structuredClone(scene);

    expectDomainCode(
      () => applyScenePatch(scene, translate(scene, actor.id, true)),
      "USER_LOCKED",
    );
    expect(scene).toEqual(before);
  });

  it("keeps strict patches blocked by workflow locks", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "workflow";
    const before = structuredClone(scene);

    expectDomainCode(
      () => applyScenePatch(scene, translate(scene, actor.id, false)),
      "WORKFLOW_LOCKED",
    );
    expect(scene).toEqual(before);
  });

  it("threads preservation through all direct mutable operation families", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    const prop = requireEntity(scene, "prop_block_1");
    const camera = requireEntity(scene, "camera_shot_1");
    if (actor.kind !== "actor" || camera.kind !== "camera") {
      throw new Error("Default actor or camera fixture is invalid.");
    }
    actor.lockMode = "workflow";
    prop.lockMode = "workflow";
    camera.lockMode = "workflow";

    const operations: SceneOperation[] = [
      {
        op: "entity.transform.set",
        entityId: prop.id,
        value: {
          ...structuredClone(prop.transform),
          positionM: [-1.1, 0.35, -0.5],
        },
      },
      {
        op: "entity.transform.translate",
        entityId: actor.id,
        deltaM: [0.2, 0, 0],
        referenceSpace: "world",
      },
      {
        op: "entity.transform.rotate",
        entityId: actor.id,
        deltaRotation: [0, 0, 0, 1],
        referenceSpace: "local",
      },
      {
        op: "entity.flags.set",
        entityId: actor.id,
        visible: false,
      },
      {
        op: "entity.preset.parameters.set",
        entityId: prop.id,
        value: { variant: "generic-test" },
      },
      {
        op: "actor.pose.set",
        entityId: actor.id,
        value: materializePose(actor, "pose.seated-v1"),
      },
      {
        op: "actor.limb-presence.set",
        actorId: actor.id,
        updates: { hand_r: "absent" },
      },
      {
        op: "camera.lens.set",
        entityId: camera.id,
        value: {
          ...structuredClone(camera.lens),
          focalLengthMm: 60,
        },
      },
      {
        op: "camera.look-at",
        entityId: camera.id,
        target: { type: "point", pointM: [0, 1, 0] },
      },
    ];

    const applied = applyScenePatch(
      scene,
      patchFor(
        scene,
        operations,
        true,
        "patch_lock_direct_families",
      ),
    );

    expect(
      applied.next.entities.map(({ id, lockMode }) => [id, lockMode]),
    ).toEqual(scene.entities.map(({ id, lockMode }) => [id, lockMode]));
    expect(requireEntity(applied.next, actor.id)).toMatchObject({
      visible: false,
      lockMode: "workflow",
      pose: { preset: { id: "pose.seated-v1" } },
      body: { limbPresence: { hand_r: "absent" } },
    });
    expect(requireEntity(applied.next, prop.id)).toMatchObject({
      lockMode: "workflow",
      preset: { parameters: { variant: "generic-test" } },
    });
    expect(requireEntity(applied.next, camera.id)).toMatchObject({
      lockMode: "workflow",
      lens: { focalLengthMm: 60 },
    });
  });

  it("allows an explicit strict user-lock transition as one atomic patch", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "user";

    const applied = applyScenePatch(
      scene,
      patchFor(
        scene,
        [
          {
            op: "entity.flags.set",
            entityId: actor.id,
            lockMode: "none",
          },
          {
            op: "entity.transform.translate",
            entityId: actor.id,
            deltaM: [0.5, 0, 0],
            referenceSpace: "world",
          },
          {
            op: "entity.flags.set",
            entityId: actor.id,
            lockMode: "user",
          },
        ],
        false,
        "patch_explicit_user_transition",
      ),
    );

    expectGroundedActorState(
      applied.next,
      actor.id,
      "user",
      [0.5, 0],
    );
    expect(applied.next.revision).toBe(scene.revision + 1);
  });

  it.each(["workflow", "user"] as const)(
    "rejects removal of a pre-existing %s lock under preservation",
    (lockMode) => {
      const scene = createDefaultScene();
      const prop = requireEntity(scene, "prop_block_1");
      prop.lockMode = lockMode;
      const before = structuredClone(scene);

      expectDomainCode(
        () =>
          applyScenePatch(
            scene,
            patchFor(
              scene,
              [{ op: "entity.remove", entityId: prop.id }],
              true,
              `patch_remove_${lockMode}_lock`,
            ),
          ),
        "LOCK_PRESERVATION_CONFLICT",
      );
      expect(scene).toEqual(before);
    },
  );

  it("rejects every attempted lock-mode change under preservation", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "workflow";
    const before = structuredClone(scene);

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          patchFor(
            scene,
            [
              {
                op: "entity.flags.set",
                entityId: actor.id,
                lockMode: "none",
              },
              {
                op: "entity.flags.set",
                entityId: actor.id,
                lockMode: "workflow",
              },
            ],
            true,
            "patch_transient_lock_change",
          ),
        ),
      "LOCK_PRESERVATION_CONFLICT",
    );
    expect(scene).toEqual(before);
  });

  it("rejects adding an entity that is already locked", () => {
    const scene = createDefaultScene();
    const added = structuredClone(
      requireEntity(scene, "prop_block_1"),
    );
    added.id = "prop_added_locked_1";
    added.lockMode = "workflow";
    const before = structuredClone(scene);

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          patchFor(
            scene,
            [{ op: "entity.add", value: added }],
            true,
            "patch_add_locked_entity",
          ),
        ),
      "LOCK_PRESERVATION_CONFLICT",
    );
    expect(scene).toEqual(before);
  });

  it("applies indirect contact movement to workflow locks only under preservation", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "workflow";
    const moveFloor: SceneOperation = {
      op: "entity.transform.translate",
      entityId: "environment_room_1",
      deltaM: [0, 0.5, 0],
      referenceSpace: "world",
    };

    const applied = applyScenePatch(
      scene,
      patchFor(
        scene,
        [moveFloor],
        true,
        "patch_contact_workflow_preserved",
      ),
    );
    expect(
      Math.abs(
        requireEntity(applied.next, actor.id).transform.positionM[1] -
          1.477,
      ),
    ).toBeLessThanOrEqual(0.001);
    expect(requireEntity(applied.next, actor.id).lockMode).toBe(
      "workflow",
    );

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          patchFor(
            scene,
            [moveFloor],
            false,
            "patch_contact_workflow_strict",
          ),
        ),
      "WORKFLOW_LOCKED",
    );
  });

  it("rejects indirect contact movement of a user lock atomically", () => {
    const scene = createDefaultScene();
    const actor = requireEntity(scene, "actor_generic_1");
    actor.lockMode = "user";
    const session = new SceneSession(scene);
    const before = session.snapshot();
    const historyBefore = session.historyStatus();

    expectDomainCode(
      () =>
        session.applyPatch(
          patchFor(
            before,
            [
              {
                op: "scene.title.set",
                value: "Must roll back",
              },
              {
                op: "entity.transform.translate",
                entityId: "environment_room_1",
                deltaM: [0, 0.5, 0],
                referenceSpace: "world",
              },
            ],
            true,
            "patch_contact_user_atomic",
          ),
        ),
      "USER_LOCKED",
    );
    expect(session.snapshot()).toEqual(before);
    expect(session.historyStatus()).toEqual(historyBefore);
  });

  it("rolls back operations, revision, history branches, and all lock modes", () => {
    const scene = createDefaultScene();
    requireEntity(scene, "actor_generic_1").lockMode = "workflow";
    const session = new SceneSession(scene);
    const first = session.applyPatch(
      patchFor(
        session.snapshot(),
        [{ op: "scene.title.set", value: "First accepted title" }],
        true,
        "patch_history_first",
      ),
    );
    session.applyPatch(
      patchFor(
        first,
        [{ op: "scene.title.set", value: "Second accepted title" }],
        true,
        "patch_history_second",
      ),
    );
    session.undo();
    const authoritative = session.snapshot();
    const historyBefore = session.historyStatus();

    expectDomainCode(
      () =>
        session.applyPatch(
          patchFor(
            authoritative,
            [
              {
                op: "entity.transform.translate",
                entityId: "actor_generic_1",
                deltaM: [0.25, 0, 0],
                referenceSpace: "world",
              },
              {
                op: "entity.transform.translate",
                entityId: "actor_generic_missing",
                deltaM: [1, 0, 0],
                referenceSpace: "world",
              },
            ],
            true,
            "patch_history_atomic_failure",
          ),
        ),
      "ENTITY_NOT_FOUND",
    );

    expect(session.snapshot()).toEqual(authoritative);
    expect(session.historyStatus()).toEqual(historyBefore);
    expect(session.undo()).toMatchObject({
      title: scene.title,
      revision: authoritative.revision + 1,
      entities: expect.arrayContaining([
        expect.objectContaining({
          id: "actor_generic_1",
          lockMode: "workflow",
        }),
      ]),
    });
    expect(session.redo()).toMatchObject({
      title: "First accepted title",
      revision: authoritative.revision + 2,
      entities: expect.arrayContaining([
        expect.objectContaining({
          id: "actor_generic_1",
          lockMode: "workflow",
        }),
      ]),
    });
  });

  it("commits one visible revision and one undo/redo step", () => {
    const scene = createDefaultScene();
    requireEntity(scene, "actor_generic_1").lockMode = "workflow";
    const session = new SceneSession(scene);
    const listener = vi.fn();
    session.subscribe(listener);

    const changed = session.applyPatch(
      translate(session.snapshot(), "actor_generic_1", true),
    );

    expect(changed.revision).toBe(scene.revision + 1);
    expect(session.historyStatus()).toEqual({
      canUndo: true,
      canRedo: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      reason: "patch",
      scene: {
        revision: scene.revision + 1,
        entities: expect.arrayContaining([
          expect.objectContaining({
            id: "actor_generic_1",
            lockMode: "workflow",
          }),
        ]),
      },
    });

    const undone = session.undo();
    expect(undone?.revision).toBe(scene.revision + 2);
    expect(
      requireEntity(undone as SceneSpec, "actor_generic_1"),
    ).toMatchObject({
      lockMode: "workflow",
      transform: { positionM: [0, 0.977, 0] },
    });
    expect(session.undo()).toBeNull();

    const redone = session.redo();
    expect(redone?.revision).toBe(scene.revision + 3);
    expectGroundedActorState(
      redone as SceneSpec,
      "actor_generic_1",
      "workflow",
      [0.25, 0],
    );
    expect(session.redo()).toBeNull();
  });
});
