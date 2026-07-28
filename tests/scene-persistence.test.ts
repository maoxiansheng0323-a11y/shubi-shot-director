import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
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
import {
  parseSceneFile,
  serializeSceneFile,
} from "../src/editor/scene-files";
import type { SceneSpec } from "../src/domain/scene-schema";

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
  it("serializes and reparses the exact canonical v4 limb map", async () => {
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

    expect(JSON.parse(serialized)).toMatchObject({ schemaVersion: 4 });
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
});
