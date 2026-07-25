import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createDefaultScene } from "../src/domain/default-scene";
import { enforceGroundContacts } from "../src/domain/contact-constraints";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";

export class ScenePersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ScenePersistenceError";
    this.code = code;
  }
}

const isNodeErrorWithCode = (
  error: unknown,
  code: string,
): boolean =>
  error instanceof Error &&
  "code" in error &&
  error.code === code;

const writeQueues = new Map<string, Promise<void>>();

const enqueueWrite = (
  targetFile: string,
  operation: () => Promise<void>,
): Promise<void> => {
  const previous = writeQueues.get(targetFile) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  writeQueues.set(targetFile, pending);

  const release = (): void => {
    if (writeQueues.get(targetFile) === pending) {
      writeQueues.delete(targetFile);
    }
  };
  void pending.then(release, release);
  return pending;
};

export class ScenePersistence {
  private readonly runtimeDirectory: string;
  private readonly sceneFile: string;

  constructor(
    runtimeDirectory = path.resolve(process.cwd(), ".shubi-shot"),
  ) {
    this.runtimeDirectory = path.resolve(runtimeDirectory);
    this.sceneFile = path.join(
      this.runtimeDirectory,
      "current.scene.json",
    );
  }

  async load(): Promise<SceneSpec> {
    let source: string;
    try {
      source = await readFile(this.sceneFile, "utf8");
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return createDefaultScene();
      }
      throw new ScenePersistenceError(
        "PERSISTED_SCENE_READ_FAILED",
        "The persisted scene could not be read safely.",
        error,
      );
    }

    try {
      return enforceGroundContacts(
        sceneSpecSchema.parse(JSON.parse(source)),
      );
    } catch (error) {
      throw new ScenePersistenceError(
        "PERSISTED_SCENE_INVALID",
        "The persisted scene is invalid and was left untouched.",
        error,
      );
    }
  }

  persist(input: SceneSpec): Promise<void> {
    let serialized: string;
    try {
      const scene = sceneSpecSchema.parse(input);
      serialized = `${JSON.stringify(scene, null, 2)}\n`;
    } catch (error) {
      return Promise.reject(error);
    }

    return enqueueWrite(this.sceneFile, async () => {
      await mkdir(this.runtimeDirectory, { recursive: true });
      const temporaryFile = path.join(
        this.runtimeDirectory,
        `current.scene.${process.pid}.${randomUUID()}.tmp`,
      );

      try {
        await writeFile(temporaryFile, serialized, {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(temporaryFile, this.sceneFile);
      } catch (error) {
        try {
          await unlink(temporaryFile);
        } catch {
          // The unique temporary file is never authoritative. Preserve the
          // original write/rename failure even if best-effort cleanup fails.
        }
        throw error;
      }
    });
  }
}

const defaultScenePersistence = new ScenePersistence();

export const loadPersistedScene = (): Promise<SceneSpec> =>
  defaultScenePersistence.load();

export const persistScene = (scene: SceneSpec): Promise<void> =>
  defaultScenePersistence.persist(scene);
