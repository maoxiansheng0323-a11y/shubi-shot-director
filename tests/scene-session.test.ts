import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { SceneDomainError } from "../src/domain/apply-scene-patch";
import { SceneSession } from "../server/scene-session";
import { resolveActorLimbPresenceUpdates } from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { snapTransformToContact } from "../src/domain/contact-constraints";
import { parseScenePatchInput } from "../src/domain/scene-migrations";
import { sceneSpecSchema, type SceneSpec } from "../src/domain/scene-schema";
import { buildRelationshipOperations } from "../src/domain/presets";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";
import {
  normalizePatchSubmissionInput,
  parsePatchSubmission,
} from "../src/domain/scene-submission";
import {
  createPatchIntentReport,
  createPatchSubmission,
  createStructuredTwoActorScene,
} from "./helpers/structured-fixtures";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
  createLegacyV5BlueprintGroundContactPatch,
  createLegacyV5BlueprintGroundContactScene,
  createLegacyV5NonBlueprintGroundContactScene,
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
      schemaVersion: PATCH_SCHEMA_VERSION,
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
    expect(removed.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(removed.actorBlueprints).toEqual([snapshot]);
    expect(
      removed.entities.some(
        ({ id }) => id === first.id || id === second.id,
      ),
    ).toBe(false);

    const undone = session.undo();
    expect(undone?.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(undone?.actorBlueprints).toEqual([snapshot]);
    const redone = session.redo();
    expect(redone?.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(redone?.actorBlueprints).toEqual([snapshot]);
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

  it.each(["none", "workflow", "user"] as const)(
    "replaces a v5 Blueprint ground-contact scene without lock failure for %s actors",
    (lockMode) => {
      const session = new SceneSession(createDefaultScene());
      const replaced = session.replaceScene(
        createLegacyV5BlueprintGroundContactScene(lockMode),
      );
      const actor = replaced.entities.find(
        (entity) => entity.id === "actor_entity_blueprint_1",
      );

      expect(actor).toMatchObject({
        kind: "actor",
        lockMode,
        transform: {
          positionM: [0, expect.any(Number), 0],
        },
      });
      if (!actor || actor.kind !== "actor") {
        throw new Error("Migrated Blueprint actor is missing.");
      }
      expect(actor.transform.positionM[1]).not.toBeCloseTo(0.4536, 4);
      expect(actor.transform).toEqual(
        snapTransformToContact(replaced, actor.id, actor.transform),
      );
    },
  );

  it.each(["workflow", "user"] as const)(
    "submits raw and officially parsed v5 Blueprint contact input identically for a %s lock",
    (lockMode) => {
      const initial = createDefaultScene();
      const fixture = createLegacyV5BlueprintGroundContactPatch(
        initial,
        lockMode,
      );
      const rawSubmission = {
        intentReport: createPatchIntentReport({ recognizedConstraints: [] }),
        patch: fixture.patch,
      };
      const rawSession = new SceneSession(initial);
      const outcomes = [
        {
          scene: rawSession.submitPatch(rawSubmission),
          history: rawSession.historyStatus(),
        },
        ...[
          parsePatchSubmission(rawSubmission),
          normalizePatchSubmissionInput(rawSubmission),
        ].map((parsed) => {
          const session = new SceneSession(initial);
          return {
            scene: session.submitParsedPatch(parsed),
            history: session.historyStatus(),
          };
        }),
      ];

      expect(outcomes[1]).toEqual(outcomes[0]);
      expect(outcomes[2]).toEqual(outcomes[0]);
      const submitted = outcomes[0]?.scene;
      if (submitted === undefined) {
        throw new Error("Raw v5 Patch outcome is missing.");
      }
      const actor = submitted.entities.find(
        (entity) => entity.id === fixture.actorId,
      );
      expect(actor).toMatchObject({
        kind: "actor",
        lockMode,
      });
      if (!actor || actor.kind !== "actor") {
        throw new Error("Migrated Blueprint actor is missing.");
      }
      expect(submitted.revision).toBe(initial.revision + 1);
      expect(actor.transform.positionM[1]).not.toBeCloseTo(
        fixture.legacyTransform.positionM[1],
        4,
      );
      expect(actor.transform).toEqual(
        snapTransformToContact(submitted, actor.id, actor.transform),
      );
      expect(outcomes[0]?.history).toEqual({
        canUndo: true,
        canRedo: false,
      });
    },
  );

  it("rejects native v6 Blueprint provenance spoofing under a user lock", () => {
    const initial = createDefaultScene();
    const fixture = createLegacyV5BlueprintGroundContactPatch(initial, "user");
    const parsedV5 = normalizePatchSubmissionInput({
      intentReport: createPatchIntentReport({ recognizedConstraints: [] }),
      patch: fixture.patch,
    });
    const rawV6Submission = structuredClone(parsedV5.submission);
    expect(rawV6Submission.patch.schemaVersion).toBe(PATCH_SCHEMA_VERSION);

    const rawV6Session = new SceneSession(initial);
    expect(() => rawV6Session.submitPatch(rawV6Submission)).toThrowError(
      expect.objectContaining({ code: "USER_LOCKED" }),
    );
    expect(rawV6Session.snapshot()).toEqual(initial);
    expect(rawV6Session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });

    const spoofedWrapper = {
      submission: rawV6Submission,
      patchSourceSchemaVersion: 5 as const,
    };
    const rawWrapperSession = new SceneSession(initial);
    expect(() => rawWrapperSession.submitPatch(spoofedWrapper)).toThrowError(
      ZodError,
    );
    expect(rawWrapperSession.snapshot()).toEqual(initial);
    expect(rawWrapperSession.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });

    const parsedWrapperSession = new SceneSession(initial);
    expect(() =>
      parsedWrapperSession.submitParsedPatch(
        spoofedWrapper as ReturnType<typeof parsePatchSubmission>,
      ),
    ).toThrowError(TypeError);
    expect(parsedWrapperSession.snapshot()).toEqual(initial);
    expect(parsedWrapperSession.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it("rejects a stateful schemaVersion getter without mutating session state", () => {
    const initial = createDefaultScene();
    const fixture = createLegacyV5BlueprintGroundContactPatch(initial, "user");
    const rawPatch = parseScenePatchInput(fixture.patch);
    let schemaVersionReads = 0;
    Object.defineProperty(rawPatch, "schemaVersion", {
      configurable: true,
      enumerable: true,
      get: () => {
        schemaVersionReads += 1;
        return schemaVersionReads === 1 ? PATCH_SCHEMA_VERSION : 5;
      },
    });
    const session = new SceneSession(initial);

    expect(() =>
      session.submitPatch({
        intentReport: createPatchIntentReport({ recognizedConstraints: [] }),
        patch: rawPatch,
      }),
    ).toThrowError(expect.objectContaining({ code: "USER_LOCKED" }));
    expect(schemaVersionReads).toBe(1);
    expect(session.snapshot()).toEqual(initial);
    expect(session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it("revalidates modify operation policy before submitting a normalized wrapper", () => {
    const initial = createDefaultScene();
    const rawSubmission = createPatchSubmission(initial);
    rawSubmission.intentReport = createPatchIntentReport({
      operation: "create",
    });
    const normalized = normalizePatchSubmissionInput(rawSubmission);
    const rawSession = new SceneSession(initial);

    expect(() => rawSession.submitPatch(rawSubmission)).toThrowError(
      expect.objectContaining({ code: "INTENT_REPORT_INVALID" }),
    );
    expect(rawSession.snapshot()).toEqual(initial);
    expect(rawSession.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });

    const parsedSession = new SceneSession(initial);
    expect(() => parsedSession.submitParsedPatch(normalized)).toThrowError(
      expect.objectContaining({ code: "INTENT_REPORT_INVALID" }),
    );
    expect(parsedSession.snapshot()).toEqual(initial);
    expect(parsedSession.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it.each(["workflow", "user"] as const)(
    "rejects replacing a v5 non-Blueprint contact scene under an ordinary %s lock",
    (lockMode) => {
      const initial = createDefaultScene();
      const session = new SceneSession(initial);
      const legacyScene = createLegacyV5NonBlueprintGroundContactScene(lockMode);
      const before = structuredClone(legacyScene);

      expect(() => session.replaceScene(legacyScene)).toThrowError(
        expect.objectContaining({
          code: lockMode === "workflow" ? "WORKFLOW_LOCKED" : "USER_LOCKED",
        }),
      );
      expect(legacyScene).toEqual(before);
      expect(session.snapshot()).toEqual(initial);
      expect(session.historyStatus()).toEqual({
        canUndo: false,
        canRedo: false,
      });
    },
  );
});
