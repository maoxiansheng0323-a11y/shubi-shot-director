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
import { createDefaultScene } from "../src/domain/default-scene";
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
