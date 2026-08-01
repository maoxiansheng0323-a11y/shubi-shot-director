import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ScenePersistence,
  ScenePersistenceError,
} from "../server/scene-persistence";
import { resolveActorLimbPresenceUpdates } from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { snapTransformToContact } from "../src/domain/contact-constraints";
import {
  parseSceneFile,
  serializeSceneFile,
} from "../src/editor/scene-files";
import {
  isBlueprintActorEntity,
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { SCENE_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
  createLegacyV5BlueprintGroundContactScene,
} from "./helpers/actor-blueprint-fixtures";

const temporaryDirectories: string[] = [];

const createRuntimeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shubi-shot-persistence-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, ".shubi-shot");
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ScenePersistence", () => {
  it("reloads two independent instances from one embedded snapshot after the source file is gone", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const externalFile = path.join(
      path.dirname(runtimeDirectory),
      "generic-actor-blueprint.json",
    );
    const document = createGenericActorBlueprintDocument();
    await writeFile(externalFile, JSON.stringify(document), "utf8");

    const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
    scene.actorBlueprints = [createActorBlueprintSnapshot(document)];
    const first = createBlueprintActor({
      id: "actor_entity_blueprint_1",
      slot: "actor_female_1",
      variantId: "damaged",
    });
    first.transform.positionM = [-1, 0.81, 0.5];
    first.color = "#b4bdc8";
    const second = createBlueprintActor({
      id: "actor_entity_blueprint_2",
      slot: "actor_female_2",
      variantId: "repaired",
    });
    second.transform.positionM = [1.25, 0.92, -0.5];
    second.pose.joints.upper_arm_l = [0, 0, 0, 1];
    second.color = "#8894a2";
    second.lockMode = "workflow";
    scene.entities.push(first, second);

    const persistence = new ScenePersistence(runtimeDirectory);
    await persistence.persist(sceneSpecSchema.parse(scene));
    await unlink(externalFile);
    const reloaded = await new ScenePersistence(runtimeDirectory).load();
    const actors = reloaded.entities.filter(isBlueprintActorEntity);

    expect(reloaded.actorBlueprints).toHaveLength(1);
    expect(actors).toHaveLength(2);
    expect(actors.find(({ id }) => id === first.id)).toMatchObject(first);
    expect(actors.find(({ id }) => id === second.id)).toMatchObject(second);
    expect(JSON.stringify(reloaded)).not.toContain(externalFile);
  });

  it("serializes and reparses the exact canonical v6 legacy limb map", async () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor || actor.kind !== "actor") {
      throw new Error("Missing generic actor fixture.");
    }
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      { upper_arm_r: "absent", lower_leg_l: "absent" },
    );
    const expectedPresence = structuredClone(actor.body.limbPresence);

    const serialized = serializeSceneFile(scene);
    const reparsed = await parseSceneFile(new Blob([serialized]));
    const reparsedActor = reparsed.entities.find(
      (entity) => entity.kind === "actor",
    );

    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: SCENE_SCHEMA_VERSION,
    });
    expect(reparsedActor).toMatchObject({
      body: { limbPresence: expectedPresence },
    });
  });

  it("persists limb absences without mutating anatomy or creating locks", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const persistence = new ScenePersistence(runtimeDirectory);
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    if (!actor || actor.kind !== "actor") {
      throw new Error("Missing generic actor fixture.");
    }
    actor.body.limbPresence = resolveActorLimbPresenceUpdates(
      actor.body.limbPresence,
      { hand_l: "absent", foot_r: "absent" },
    );
    const before = structuredClone(scene);

    await persistence.persist(scene);
    const restored = await persistence.load();
    const restoredActor = restored.entities.find(
      (entity) => entity.kind === "actor",
    );

    expect(scene).toEqual(before);
    expect(restoredActor).toMatchObject({
      lockMode: "none",
      body: { limbPresence: actor.body.limbPresence },
    });
    expect(restored.entities.every(({ lockMode }) => lockMode === "none")).toBe(
      true,
    );
  });

  it("serializes concurrent writes and restarts from the final scene", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const persistence = new ScenePersistence(runtimeDirectory);
    const base = createDefaultScene();
    const scenes = Array.from({ length: 40 }, (_, index) => ({
      ...structuredClone(base),
      revision: index + 1,
      title: `Concurrent scene ${index + 1}${"x".repeat(index)}`,
    }));

    await Promise.all(scenes.map((scene) => persistence.persist(scene)));

    const restarted = new ScenePersistence(runtimeDirectory);
    const restored = await restarted.load();
    expect(restored.revision).toBe(40);
    expect(restored.title).toBe(scenes.at(-1)?.title);
    expect(await readdir(runtimeDirectory)).toEqual([
      "current.scene.json",
    ]);
  });

  it("does not damage the previous file when a later scene is invalid", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const persistence = new ScenePersistence(runtimeDirectory);
    const original = {
      ...createDefaultScene(),
      revision: 7,
      title: "Known good scene",
    };
    await persistence.persist(original);
    const invalid = {
      ...structuredClone(original),
      revision: 8,
      title: "",
    } as SceneSpec;

    await expect(persistence.persist(invalid)).rejects.toBeDefined();
    await expect(persistence.load()).resolves.toMatchObject({
      revision: 7,
      title: "Known good scene",
    });
  });

  it("reports corrupt persisted data without replacing it with defaults", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const persistence = new ScenePersistence(runtimeDirectory);
    const currentFile = path.join(
      runtimeDirectory,
      "current.scene.json",
    );
    const corruptSource = '{"schemaVersion":1,"sceneId":';
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(currentFile, corruptSource, "utf8");

    await expect(persistence.load()).rejects.toMatchObject({
      code: "PERSISTED_SCENE_INVALID",
    } satisfies Partial<ScenePersistenceError>);
    await expect(readFile(currentFile, "utf8")).resolves.toBe(
      corruptSource,
    );
  });

  it.each(["none", "workflow", "user"] as const)(
    "loads and rebases a persisted v5 Blueprint ground-contact scene with a %s lock",
    async (lockMode) => {
      const runtimeDirectory = await createRuntimeDirectory();
      const currentFile = path.join(
        runtimeDirectory,
        "current.scene.json",
      );
      await mkdir(runtimeDirectory, { recursive: true });
      await writeFile(
        currentFile,
        JSON.stringify(
          createLegacyV5BlueprintGroundContactScene(lockMode),
        ),
        "utf8",
      );

      const restored = await new ScenePersistence(runtimeDirectory).load();
      const actor = restored.entities.find(
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
        snapTransformToContact(restored, actor.id, actor.transform),
      );
    },
  );
});
