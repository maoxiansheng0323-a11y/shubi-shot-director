import { describe, expect, it, vi } from "vitest";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { SceneSession } from "../server/scene-session";
import type { ActorLimbPresenceUpdates } from "../src/domain/actor-anatomy";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  scenePatchSchema,
  type ScenePatch,
} from "../src/domain/scene-patch";
import type {
  ActorEntity,
  SceneSpec,
} from "../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

const limbPatchInput = (operation: unknown) => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: "patch_actor_limb_presence",
  sceneId: "scene_starter",
  baseRevision: 0,
  source: "natural-language",
  preserveLock: false,
  operations: [operation],
});

const requireActor = (
  scene: SceneSpec,
  actorId = "actor_generic_1",
): ActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is ActorEntity =>
      entity.kind === "actor" && entity.id === actorId,
  );
  if (!actor) {
    throw new Error(`Missing generic actor fixture: ${actorId}`);
  }
  return actor;
};

const limbPatch = (
  scene: SceneSpec,
  updates: ActorLimbPresenceUpdates,
  options: {
    actorId?: string;
    preserveLock?: boolean;
    patchId?: string;
  } = {},
): ScenePatch => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: options.patchId ?? "patch_actor_limb_presence_apply",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  preserveLock: options.preserveLock ?? false,
  operations: [
    {
      op: "actor.limb-presence.set",
      actorId: options.actorId ?? "actor_generic_1",
      updates,
    },
  ],
});

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

describe("actor limb presence ScenePatch schema", () => {
  it("accepts the strict actorId and canonical updates operation", () => {
    const result = scenePatchSchema.safeParse(
      limbPatchInput({
        op: "actor.limb-presence.set",
        actorId: "actor_generic_1",
        updates: {
          upper_arm_r: "absent",
          lower_leg_l: "absent",
          lower_leg_r: "absent",
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it.each([
    ["empty updates", {}],
    ["unknown part", { elbow_r: "absent" }],
    ["unknown mode", { hand_r: "missing" }],
  ])("rejects %s", (_label, updates) => {
    expect(
      scenePatchSchema.safeParse(
        limbPatchInput({
          op: "actor.limb-presence.set",
          actorId: "actor_generic_1",
          updates,
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects entityId as a substitute for actorId", () => {
    expect(
      scenePatchSchema.safeParse(
        limbPatchInput({
          op: "actor.limb-presence.set",
          entityId: "actor_generic_1",
          updates: { hand_r: "absent" },
        }),
      ).success,
    ).toBe(false);
  });

  it.each([
    ["a single explicit undefined", { hand_r: undefined }],
    [
      "an explicit undefined mixed with a valid mode",
      { hand_r: "absent", foot_l: undefined },
    ],
  ])("rejects %s update", (_label, updates) => {
    expect(
      scenePatchSchema.safeParse(
        limbPatchInput({
          op: "actor.limb-presence.set",
          actorId: "actor_generic_1",
          updates,
        }),
      ).success,
    ).toBe(false);
  });
});

describe("atomic actor limb presence application", () => {
  it("closes absent parents over every downstream arm and leg part", () => {
    const scene = createDefaultScene();

    const applied = applyScenePatch(
      scene,
      limbPatch(scene, {
        upper_arm_r: "absent",
        lower_leg_l: "absent",
        lower_leg_r: "absent",
      }),
    );

    expect(requireActor(applied.next).body.limbPresence).toMatchObject({
      upper_arm_r: "absent",
      forearm_r: "absent",
      hand_r: "absent",
      lower_leg_l: "absent",
      foot_l: "absent",
      lower_leg_r: "absent",
      foot_r: "absent",
    });
  });

  it("restores every required ancestor when a removed hand becomes present", () => {
    const scene = createDefaultScene();
    const removed = applyScenePatch(
      scene,
      limbPatch(scene, { upper_arm_r: "absent" }),
    ).next;
    expect(requireActor(removed).body.limbPresence).toMatchObject({
      upper_arm_r: "absent",
      forearm_r: "absent",
      hand_r: "absent",
    });

    const restored = applyScenePatch(
      removed,
      limbPatch(
        removed,
        { hand_r: "present" },
        { patchId: "patch_restore_right_hand" },
      ),
    ).next;

    expect(requireActor(restored).body.limbPresence).toMatchObject({
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
    });
  });

  it("keeps descendants absent for a parent-only restore", () => {
    const scene = createDefaultScene();
    const removed = applyScenePatch(
      scene,
      limbPatch(scene, { upper_arm_r: "absent" }),
    ).next;

    const restoredParent = applyScenePatch(
      removed,
      limbPatch(
        removed,
        { upper_arm_r: "present" },
        { patchId: "patch_restore_parent_only" },
      ),
    ).next;

    expect(requireActor(restoredParent).body.limbPresence).toMatchObject({
      upper_arm_r: "present",
      forearm_r: "absent",
      hand_r: "absent",
    });
  });

  it("does not change ancestors when only a child becomes absent", () => {
    const scene = createDefaultScene();

    const applied = applyScenePatch(
      scene,
      limbPatch(scene, { hand_r: "absent" }),
    );

    expect(requireActor(applied.next).body.limbPresence).toMatchObject({
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "absent",
    });
  });

  it("rejects explicit parent-absent and descendant-present conflicts atomically", () => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          limbPatch(scene, {
            upper_arm_r: "absent",
            hand_r: "present",
          }),
        ),
      "LIMB_HIERARCHY_CONFLICT",
    );
    expect(scene).toEqual(before);
  });

  it.each([
    ["missing actor", "actor_generic_missing"],
    ["prop target", "prop_block_1"],
  ])("rejects a %s with the actor target code", (_label, actorId) => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          limbPatch(scene, { hand_r: "absent" }, { actorId }),
        ),
      "ACTOR_LIMB_TARGET_INVALID",
    );
    expect(scene).toEqual(before);
  });

  it("edits a workflow lock only while preserving its exact lock mode", () => {
    const scene = createDefaultScene();
    requireActor(scene).lockMode = "workflow";

    const applied = applyScenePatch(
      scene,
      limbPatch(
        scene,
        { hand_r: "absent" },
        { preserveLock: true },
      ),
    );

    expect(requireActor(applied.next)).toMatchObject({
      lockMode: "workflow",
      body: { limbPresence: { hand_r: "absent" } },
    });
  });

  it("rejects a user lock without mutation", () => {
    const scene = createDefaultScene();
    requireActor(scene).lockMode = "user";
    const before = structuredClone(scene);

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          limbPatch(
            scene,
            { hand_r: "absent" },
            { preserveLock: true },
          ),
        ),
      "USER_LOCKED",
    );
    expect(scene).toEqual(before);
  });

  it("runs contact enforcement after a limb operation", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    actor.transform.positionM[1] = 3;
    actor.lockMode = "workflow";

    const applied = applyScenePatch(
      scene,
      limbPatch(
        scene,
        { hand_l: "absent" },
        { preserveLock: true, patchId: "patch_limb_contact" },
      ),
    );

    const updatedActor = requireActor(applied.next);
    expect(updatedActor).toMatchObject({
      lockMode: "workflow",
      body: { limbPresence: { hand_l: "absent" } },
    });
    expect(updatedActor.transform.positionM[0]).toBe(0);
    expect(updatedActor.transform.positionM[2]).toBe(0);
    expect(
      Math.abs(actorVisibleRigBounds(updatedActor).minWorld[1]),
    ).toBeLessThanOrEqual(0.001);
  });

  it("rolls back anatomy when post-operation contact validation fails", () => {
    const scene = createDefaultScene();
    const floor = scene.entities.find(
      (entity) => entity.id === "environment_room_1",
    );
    if (!floor) {
      throw new Error("Missing generic floor fixture.");
    }
    floor.transform.rotation = [0.3826834324, 0, 0, 0.9238795325];
    const before = structuredClone(scene);

    expectDomainCode(
      () =>
        applyScenePatch(
          scene,
          limbPatch(scene, { hand_l: "absent" }),
        ),
      "SURFACE_NOT_HORIZONTAL",
    );
    expect(scene).toEqual(before);
  });

  it("rolls back anatomy when final SceneSpec validation fails", () => {
    const scene = createDefaultScene();
    const duplicateSlotActor = structuredClone(requireActor(scene));
    duplicateSlotActor.id = "actor_duplicate_slot_1";
    const before = structuredClone(scene);
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_limb_final_validation",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: "actor_generic_1",
          updates: { hand_l: "absent" },
        },
        { op: "entity.add", value: duplicateSlotActor },
      ],
    };

    expect(() => applyScenePatch(scene, patch)).toThrow();
    expect(scene).toEqual(before);
  });

  it("commits one revision and one exact undo-redo anatomy step", () => {
    const scene = createDefaultScene();
    const session = new SceneSession(scene);
    const listener = vi.fn();
    session.subscribe(listener);
    const beforePresence = structuredClone(
      requireActor(session.snapshot()).body.limbPresence,
    );

    const changed = session.applyPatch(
      limbPatch(session.snapshot(), {
        upper_arm_r: "absent",
        lower_leg_l: "absent",
      }),
    );
    const changedPresence = structuredClone(
      requireActor(changed).body.limbPresence,
    );

    expect(changed.revision).toBe(scene.revision + 1);
    expect(changedPresence).not.toEqual(beforePresence);
    expect(changedPresence).toMatchObject({
      upper_arm_r: "absent",
      forearm_r: "absent",
      hand_r: "absent",
      lower_leg_l: "absent",
      foot_l: "absent",
    });
    expect(session.historyStatus()).toEqual({
      canUndo: true,
      canRedo: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(requireActor(session.undo() as SceneSpec).body.limbPresence).toEqual(
      beforePresence,
    );
    expect(session.undo()).toBeNull();
    expect(requireActor(session.redo() as SceneSpec).body.limbPresence).toEqual(
      changedPresence,
    );
    expect(session.redo()).toBeNull();
  });

  it("rolls back title, anatomy, revision, locks, contacts, history, and listeners", () => {
    const scene = createDefaultScene();
    const sceneActor = requireActor(scene);
    sceneActor.lockMode = "workflow";
    sceneActor.transform.positionM[1] = 3.5;
    const sceneContact = scene.constraints.find(
      (constraint) =>
        constraint.type === "ground-contact" &&
        constraint.entityId === sceneActor.id,
    );
    if (!sceneContact) {
      throw new Error("Missing generic ground-contact fixture.");
    }
    sceneContact.enabled = false;
    const session = new SceneSession(scene);
    const accepted = session.applyPatch({
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_history_seed",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "system",
      preserveLock: true,
      operations: [{ op: "scene.title.set", value: "Accepted title" }],
    });
    session.undo();
    const before = session.snapshot();
    const historyBefore = session.historyStatus();
    const beforeActor = requireActor(before);
    const beforePresence = structuredClone(beforeActor.body.limbPresence);
    const beforeTransform = structuredClone(beforeActor.transform);
    const beforeContact = before.constraints.find(
      (constraint) => constraint.id === sceneContact.id,
    );
    if (!beforeContact || beforeContact.type !== "ground-contact") {
      throw new Error("Missing session ground-contact fixture.");
    }
    expect(beforeContact.enabled).toBe(false);

    const contactEnabledClone = structuredClone(before);
    const enabledCloneContact = contactEnabledClone.constraints.find(
      (constraint) => constraint.id === beforeContact.id,
    );
    if (!enabledCloneContact || enabledCloneContact.type !== "ground-contact") {
      throw new Error("Missing enabled-clone contact fixture.");
    }
    enabledCloneContact.enabled = true;
    const contactCorrectedPrefix = applyScenePatch(contactEnabledClone, {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_limb_contact_prefix",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: true,
      operations: [
        { op: "scene.title.set", value: "Contact-corrected prefix" },
        {
          op: "actor.limb-presence.set",
          actorId: beforeActor.id,
          updates: { hand_l: "absent" },
        },
      ],
    }).next;
    expect(requireActor(contactCorrectedPrefix).transform).not.toEqual(
      beforeTransform,
    );
    expect(requireActor(contactCorrectedPrefix).body.limbPresence.hand_l).toBe(
      "absent",
    );
    const listener = vi.fn();
    session.subscribe(listener);

    expectDomainCode(
      () =>
        session.applyPatch({
          schemaVersion: PATCH_SCHEMA_VERSION,
          patchId: "patch_atomic_limb_failure",
          sceneId: before.sceneId,
          baseRevision: before.revision,
          source: "natural-language",
          preserveLock: true,
          operations: [
            {
              op: "constraint.set",
              value: { ...beforeContact, enabled: true },
            },
            { op: "scene.title.set", value: "Must roll back" },
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
        }),
      "ACTOR_LIMB_TARGET_INVALID",
    );

    expect(session.snapshot()).toEqual(before);
    expect(session.historyStatus()).toEqual(historyBefore);
    expect(listener).not.toHaveBeenCalled();
    expect(requireActor(session.snapshot())).toMatchObject({
      lockMode: "workflow",
      transform: beforeTransform,
      body: { limbPresence: beforePresence },
    });
    expect(session.snapshot().constraints).toEqual(before.constraints);
    expect(session.redo()).toMatchObject({
      title: accepted.title,
      revision: before.revision + 1,
    });
  });
});
