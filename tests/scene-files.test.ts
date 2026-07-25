import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  parseSceneFile,
  SceneFileError,
  serializeSceneFile,
} from "../src/editor/scene-files";
import { createStructuredRelationshipScene } from "./helpers/structured-fixtures";

describe("SceneSpec files", () => {
  it("round-trips a valid scene", async () => {
    const original = createDefaultScene();
    const serialized = serializeSceneFile(original);
    const parsed = await parseSceneFile(
      new Blob([serialized], { type: "application/json" }),
    );
    expect(parsed).toEqual(original);
  });

  it("round-trips materialized relationship poses and constraints", async () => {
    const original = createStructuredRelationshipScene();
    const parsed = await parseSceneFile(
      new Blob([serializeSceneFile(original)], {
        type: "application/json",
      }),
    );

    expect(parsed.entities).toEqual(original.entities);
    expect(parsed.constraints).toEqual(original.constraints);
    expect(
      parsed.entities.find(
        (entity) => entity.id === "actor_generic_2",
      ),
    ).toMatchObject({
      kind: "actor",
      pose: { preset: { id: "pose.lying-supine-v1" } },
    });
  });

  it("rejects invalid JSON before any server request", async () => {
    await expect(
      parseSceneFile(new Blob(["{not-json"], { type: "application/json" })),
    ).rejects.toMatchObject({
      code: "SCENE_FILE_INVALID_JSON",
    } satisfies Partial<SceneFileError>);
  });

  it("rejects a structurally invalid scene", async () => {
    await expect(
      parseSceneFile(
        new Blob([JSON.stringify({ schemaVersion: 1 })], {
          type: "application/json",
        }),
      ),
    ).rejects.toMatchObject({
      code: "SCENE_FILE_INVALID",
    } satisfies Partial<SceneFileError>);
  });
});
