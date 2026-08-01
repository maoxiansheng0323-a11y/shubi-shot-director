import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import {
  createActorBlueprintSnapshot,
  type ActorBlueprintSnapshot,
} from "../src/domain/actor-blueprint";
import { createDefaultScene } from "../src/domain/default-scene";
import { parseScenePatchInput } from "../src/domain/scene-migrations";
import type { SceneOperation, ScenePatch } from "../src/domain/scene-patch";
import {
  isBlueprintActorEntity,
  type BlueprintActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const patchFor = (
  scene: SceneSpec,
  operations: SceneOperation[],
  patchId = "patch_actor_blueprint_test",
): ScenePatch => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId,
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  preserveLock: true,
  operations,
});

const registerOperation = (
  snapshot: ActorBlueprintSnapshot,
): SceneOperation =>
  ({
    op: "actor.blueprint.register",
    snapshot,
  }) as unknown as SceneOperation;

const variantOperation = (
  actorId: string,
  variantId: string,
): SceneOperation =>
  ({
    op: "actor.variant.set",
    actorId,
    variantId,
  }) as unknown as SceneOperation;

const expectDomainCode = (
  callback: () => unknown,
  code: string,
): void => {
  try {
    callback();
    throw new Error("Expected SceneDomainError.");
  } catch (error) {
    expect(error).toBeInstanceOf(SceneDomainError);
    expect(error).toMatchObject({ code });
  }
};

const createRegisteredScene = (
  constraintsEnabled: boolean,
): {
  scene: SceneSpec;
  actor: BlueprintActorEntity;
  snapshot: ActorBlueprintSnapshot;
} => {
  const source = createDefaultScene();
  if (!constraintsEnabled) source.constraints = [];
  const snapshot = createActorBlueprintSnapshot(
    createGenericActorBlueprintDocument(),
  );
  const actor = createBlueprintActor();
  const scene = applyScenePatch(
    source,
    patchFor(
      source,
      [registerOperation(snapshot), { op: "entity.add", value: actor }],
      "patch_register_fixture",
    ),
  ).next;
  const persistedActor = scene.entities.find(
    (entity) => entity.id === actor.id,
  );
  if (!isBlueprintActorEntity(persistedActor)) {
    throw new Error("Blueprint actor fixture is missing.");
  }
  return { scene, actor: persistedActor, snapshot };
};

describe("Actor Blueprint Patch operations", () => {
  it("registers one snapshot and adds an instance in one revision", () => {
    const before = createDefaultScene();
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const actor = createBlueprintActor();
    const applied = applyScenePatch(
      before,
      patchFor(before, [
        registerOperation(snapshot),
        { op: "entity.add", value: actor },
      ]),
    );

    expect(PATCH_SCHEMA_VERSION).toBe(6);
    expect(applied.next.revision).toBe(before.revision + 1);
    expect(applied.next.actorBlueprints).toEqual([snapshot]);
    expect(applied.next.entities).toContainEqual(actor);
    expect(before.actorBlueprints).toEqual([]);
  });

  it("migrates v4 patches without admitting v5 Blueprint operations", () => {
    const before = createDefaultScene();
    const legacyPatch = {
      schemaVersion: 4,
      patchId: "patch_v4_title",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "manual",
      preserveLock: false,
      operations: [{ op: "scene.title.set", value: "Migrated title" }],
    };
    expect(parseScenePatchInput(legacyPatch)).toEqual({
      ...legacyPatch,
      schemaVersion: 6,
    });

    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    expect(() =>
      parseScenePatchInput({
        ...legacyPatch,
        operations: [registerOperation(snapshot)],
      }),
    ).toThrow();
  });

  it("reuses an existing snapshot for the same ID and hash", () => {
    const fixture = createRegisteredScene(false);
    const second = createBlueprintActor({
      id: "actor_entity_blueprint_2",
      slot: "actor_female_2",
      blueprintId: fixture.snapshot.blueprintId,
      variantId: "repaired",
    });
    const next = applyScenePatch(
      fixture.scene,
      patchFor(fixture.scene, [
        registerOperation(structuredClone(fixture.snapshot)),
        { op: "entity.add", value: second },
      ]),
    ).next;

    expect(next.actorBlueprints).toEqual([fixture.snapshot]);
    expect(next.entities).toContainEqual(second);
  });

  it("does not create a revision or history entry for deduplication alone", () => {
    const fixture = createRegisteredScene(false);
    const session = new SceneSession(fixture.scene);
    const before = session.snapshot();
    const next = session.applyPatch(
      patchFor(fixture.scene, [
        registerOperation(structuredClone(fixture.snapshot)),
      ]),
    );

    expect(next).toEqual(before);
    expect(session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it("reuses the existing generic ID when equivalent content proposes another ID", () => {
    const fixture = createRegisteredScene(false);
    const equivalentDocument = createGenericActorBlueprintDocument();
    equivalentDocument.blueprintId = "actor_blueprint_2";
    const equivalent = createActorBlueprintSnapshot(equivalentDocument);
    const second = createBlueprintActor({
      id: "actor_entity_blueprint_2",
      slot: "actor_female_2",
      blueprintId: fixture.snapshot.blueprintId,
      variantId: "repaired",
    });
    const next = applyScenePatch(
      fixture.scene,
      patchFor(fixture.scene, [
        registerOperation(equivalent),
        { op: "entity.add", value: second },
      ]),
    ).next;

    expect(next.actorBlueprints).toEqual([fixture.snapshot]);
    expect(next.actorBlueprints[0]?.blueprintId).toBe("actor_blueprint_1");
    expect(next.entities).toContainEqual(second);
  });

  it("uses deterministic registration conflict errors", () => {
    const fixture = createRegisteredScene(false);
    const changedDocument = createGenericActorBlueprintDocument();
    changedDocument.blueprintVersion += 1;
    const conflicting = createActorBlueprintSnapshot(changedDocument);

    expectDomainCode(
      () =>
        applyScenePatch(
          fixture.scene,
          patchFor(fixture.scene, [registerOperation(conflicting)]),
        ),
      "ACTOR_BLUEPRINT_ID_CONFLICT",
    );

    const equivalentDocument = createGenericActorBlueprintDocument();
    equivalentDocument.blueprintId = "actor_blueprint_2";
    const equivalent = createActorBlueprintSnapshot(equivalentDocument);
    expectDomainCode(
      () =>
        applyScenePatch(
          createDefaultScene(),
          patchFor(createDefaultScene(), [
            registerOperation(fixture.snapshot),
            registerOperation(equivalent),
          ]),
        ),
      "ACTOR_BLUEPRINT_HASH_DUPLICATE",
    );
  });

  it("checks scene identity before snapshot hash integrity", () => {
    const before = createDefaultScene();
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    snapshot.contentSha256 = "0".repeat(64);
    const wrongScene = patchFor(before, [registerOperation(snapshot)]);
    wrongScene.sceneId = "scene_other_1";
    expectDomainCode(
      () => applyScenePatch(before, wrongScene),
      "SCENE_ID_MISMATCH",
    );

    const stale = patchFor(before, [registerOperation(snapshot)]);
    stale.baseRevision += 1;
    expectDomainCode(
      () => applyScenePatch(before, stale),
      "STALE_REVISION",
    );
  });

  it("rejects unresolved actor references and rolls back every operation", () => {
    const before = createDefaultScene();
    const original = structuredClone(before);
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const missing = createBlueprintActor({
      blueprintId: "actor_blueprint_99",
    });

    expectDomainCode(
      () =>
        applyScenePatch(
          before,
          patchFor(before, [
            registerOperation(snapshot),
            { op: "entity.add", value: missing },
          ]),
        ),
      "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    );
    expect(before).toEqual(original);
  });

  it("keeps an unused snapshot after removing its last actor", () => {
    const fixture = createRegisteredScene(false);
    const next = applyScenePatch(
      fixture.scene,
      patchFor(fixture.scene, [
        { op: "entity.remove", entityId: fixture.actor.id },
      ]),
    ).next;

    expect(next.entities.some(({ id }) => id === fixture.actor.id)).toBe(false);
    expect(next.actorBlueprints).toEqual([fixture.snapshot]);
  });

  it("changes only the selected variant when contact is disabled", () => {
    const fixture = createRegisteredScene(false);
    const beforeActor = structuredClone(fixture.actor);
    const next = applyScenePatch(
      fixture.scene,
      patchFor(fixture.scene, [
        variantOperation(fixture.actor.id, "repaired"),
      ]),
    ).next;
    const afterActor = next.entities.find(
      (entity) => entity.id === fixture.actor.id,
    );
    if (!isBlueprintActorEntity(afterActor)) {
      throw new Error("Blueprint actor result is missing.");
    }

    expect(afterActor.blueprintInstance.variantId).toBe("repaired");
    expect(afterActor.pose).toEqual(beforeActor.pose);
    expect(afterActor.transform).toEqual(beforeActor.transform);
    expect(afterActor.parentId).toBe(beforeActor.parentId);
  });

  it("allows only contact-owned Y translation and round-trips through history", () => {
    const fixture = createRegisteredScene(true);
    const beforeActor = structuredClone(fixture.actor);
    const session = new SceneSession(fixture.scene);
    const changed = session.applyPatch(
      patchFor(fixture.scene, [
        variantOperation(fixture.actor.id, "repaired"),
      ]),
    );
    const changedActor = changed.entities.find(
      (entity) => entity.id === fixture.actor.id,
    );
    if (!isBlueprintActorEntity(changedActor)) {
      throw new Error("Changed blueprint actor is missing.");
    }

    expect(changedActor.pose).toEqual(beforeActor.pose);
    expect(changedActor.transform.rotation).toEqual(
      beforeActor.transform.rotation,
    );
    expect(changedActor.transform.scale).toEqual(beforeActor.transform.scale);
    expect(changedActor.transform.positionM[0]).toBe(
      beforeActor.transform.positionM[0],
    );
    expect(changedActor.transform.positionM[2]).toBe(
      beforeActor.transform.positionM[2],
    );

    const undone = session.undo();
    const undoneActor = undone?.entities.find(
      (entity) => entity.id === fixture.actor.id,
    );
    expect(
      isBlueprintActorEntity(undoneActor)
        ? undoneActor.blueprintInstance.variantId
        : null,
    ).toBe("damaged");
    expect(isBlueprintActorEntity(undoneActor) ? undoneActor.transform : null)
      .toEqual(beforeActor.transform);

    const redone = session.redo();
    const redoneActor = redone?.entities.find(
      (entity) => entity.id === fixture.actor.id,
    );
    expect(
      isBlueprintActorEntity(redoneActor)
        ? redoneActor.blueprintInstance.variantId
        : null,
    ).toBe("repaired");
    expect(isBlueprintActorEntity(redoneActor) ? redoneActor.transform : null)
      .toEqual(changedActor.transform);
  });

  it("honors workflow and user locks for variant selection", () => {
    const fixture = createRegisteredScene(false);
    fixture.actor.lockMode = "workflow";
    expect(() =>
      applyScenePatch(
        fixture.scene,
        patchFor(fixture.scene, [
          variantOperation(fixture.actor.id, "repaired"),
        ]),
      ),
    ).not.toThrow();

    fixture.actor.lockMode = "user";
    expectDomainCode(
      () =>
        applyScenePatch(
          fixture.scene,
          patchFor(fixture.scene, [
            variantOperation(fixture.actor.id, "repaired"),
          ]),
        ),
      "USER_LOCKED",
    );
  });
});
