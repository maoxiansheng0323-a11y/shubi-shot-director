import { describe, expect, it } from "vitest";
import { SceneDomainError } from "../src/domain/apply-scene-patch";
import { SceneSession } from "../server/scene-session";
import { resolveActorLimbPresenceUpdates } from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { sceneSpecSchema, type SceneSpec } from "../src/domain/scene-schema";
import { buildRelationshipOperations } from "../src/domain/presets";
import { createStructuredTwoActorScene } from "./helpers/structured-fixtures";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

describe("SceneSession history", () => {
  it("keeps an unused snapshot through removal, undo, and redo", () => {
    const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const first = createBlueprintActor({
      id: "actor_entity_blueprint_1",
      slot: "actor_female_1",
    });
    const second = createBlueprintActor({
      id: "actor_entity_blueprint_2",
      slot: "actor_female_2",
      variantId: "repaired",
    });
    scene.actorBlueprints = [snapshot];
    scene.entities.push(first, second);
    const session = new SceneSession(sceneSpecSchema.parse(scene));

    const removed = session.applyPatch({
      schemaVersion: 5,
      patchId: "patch_remove_blueprint_instances",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      preserveLock: true,
      operations: [
        { op: "entity.remove", entityId: first.id },
        { op: "entity.remove", entityId: second.id },
      ],
    });
    expect(removed.actorBlueprints).toEqual([snapshot]);
    expect(
      removed.entities.some(
        ({ id }) => id === first.id || id === second.id,
      ),
    ).toBe(false);

    expect(session.undo()?.actorBlueprints).toEqual([snapshot]);
    expect(session.redo()?.actorBlueprints).toEqual([snapshot]);
  });

  it("undoes and redoes a patch while keeping revisions monotonic", () => {
    const session = new SceneSession(createDefaultScene());
    session.applyPatch({
      schemaVersion: 1,
      patchId: "patch_title",
      sceneId: "scene_starter",
      baseRevision: 0,
      source: "manual",
      operations: [
        {
          op: "scene.title.set",
          value: "Changed title",
        },
      ],
    });
    expect(session.snapshot().title).toBe("Changed title");
    expect(session.snapshot().revision).toBe(1);

    expect(session.undo()?.title).toBe("Starter Graybox");
    expect(session.snapshot().revision).toBe(2);

    expect(session.redo()?.title).toBe("Changed title");
    expect(session.snapshot().revision).toBe(3);
  });

  it("treats a multi-actor relationship as one undoable revision", () => {
    const initial = createStructuredTwoActorScene();
    const session = new SceneSession(initial);
    const operations = buildRelationshipOperations(
      session.snapshot(),
      "relationship.over-under-focus-lower-v1",
      {
        primaryActorId: "actor_generic_1",
        secondaryActorId: "actor_generic_2",
        surfaceEntityId: "prop_platform_1",
      },
    );

    const changed = session.applyPatch({
      schemaVersion: 1,
      patchId: "patch_relationship_history",
      sceneId: initial.sceneId,
      baseRevision: initial.revision,
      source: "manual",
      operations,
    });
    expect(changed.revision).toBe(initial.revision + 1);
    expect(
      changed.entities.find(
        (entity) => entity.id === "actor_generic_2",
      ),
    ).toMatchObject({
      kind: "actor",
      pose: {
        preset: { id: "pose.lying-supine-v1" },
      },
    });

    const undone = session.undo();
    expect(undone?.revision).toBe(initial.revision + 2);
    expect(undone?.entities).toEqual(initial.entities);
    expect(undone?.constraints).toEqual(initial.constraints);

    const redone = session.redo();
    expect(redone?.revision).toBe(initial.revision + 3);
    expect(redone?.entities).toEqual(changed.entities);
    expect(redone?.constraints).toEqual(changed.constraints);
  });

  it("undoes and redoes whole-scene replacements across scene ids", () => {
    const initial = createDefaultScene();
    const session = new SceneSession(initial);
    const replacement = {
      ...structuredClone(initial),
      sceneId: "scene_replacement",
      revision: 0,
      title: "Replacement scene",
    };

    const replaced = session.replaceScene(replacement);
    expect(replaced).toMatchObject({
      sceneId: "scene_replacement",
      revision: 1,
      title: "Replacement scene",
    });
    expect(session.historyStatus()).toEqual({
      canUndo: true,
      canRedo: false,
    });

    const undone = session.undo();
    expect(undone).toMatchObject({
      sceneId: initial.sceneId,
      revision: 2,
      title: initial.title,
    });

    const redone = session.redo();
    expect(redone).toMatchObject({
      sceneId: "scene_replacement",
      revision: 3,
      title: "Replacement scene",
    });
  });

  it("preserves saved limb absences through replace, undo, and redo", () => {
    const initial = createDefaultScene();
    const saved = structuredClone(initial);
    saved.sceneId = "scene_saved_limb_presence";
    const savedActor = saved.entities.find(
      (entity) => entity.kind === "actor",
    );
    if (!savedActor || savedActor.kind !== "actor") {
      throw new Error("Missing generic saved actor fixture.");
    }
    savedActor.body.limbPresence = resolveActorLimbPresenceUpdates(
      savedActor.body.limbPresence,
      { upper_arm_r: "absent", lower_leg_l: "absent" },
    );
    const savedPresence = structuredClone(savedActor.body.limbPresence);
    const session = new SceneSession(initial);

    const replaced = session.replaceScene(saved);
    expect(
      replaced.entities.find((entity) => entity.kind === "actor"),
    ).toMatchObject({ body: { limbPresence: savedPresence } });
    expect(session.snapshot()).toEqual(replaced);

    const undone = session.undo();
    expect(
      undone?.entities.find((entity) => entity.kind === "actor"),
    ).toMatchObject({
      body: {
        limbPresence: {
          upper_arm_r: "present",
          lower_leg_l: "present",
        },
      },
    });

    const redone = session.redo();
    expect(
      redone?.entities.find((entity) => entity.kind === "actor"),
    ).toMatchObject({ body: { limbPresence: savedPresence } });
  });

  it("keeps replacement revisions monotonic so stale patches cannot hit an ABA scene", () => {
    const initial = createDefaultScene();
    const session = new SceneSession(initial);
    const firstB = session.replaceScene({
      ...structuredClone(initial),
      sceneId: "scene_b",
      revision: 0,
      title: "Scene B first instance",
    });
    const delayedPatch = {
      schemaVersion: 1 as const,
      patchId: "patch_delayed_scene_b",
      sceneId: firstB.sceneId,
      baseRevision: firstB.revision,
      source: "natural-language" as const,
      operations: [
        {
          op: "scene.title.set" as const,
          value: "Delayed stale edit",
        },
      ],
    };

    expect(session.replaceScene(initial).revision).toBe(2);
    const secondB = session.replaceScene({
      ...structuredClone(firstB),
      title: "Scene B second instance",
    });
    expect(secondB.revision).toBe(3);

    expect(() => session.applyPatch(delayedPatch)).toThrowError(
      SceneDomainError,
    );
    expect(session.snapshot()).toMatchObject({
      sceneId: "scene_b",
      revision: 3,
      title: "Scene B second instance",
    });
  });
});
