import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  parseSceneFile,
  SceneFileError,
  serializeSceneFile,
} from "../src/editor/scene-files";
import { createStructuredRelationshipScene } from "./helpers/structured-fixtures";

const copyWithoutProperty = (
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> => {
  const copy = { ...value };
  delete copy[property];
  return copy;
};

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

  it("migrates a legacy v1 single-room file to canonical v4", async () => {
    const current = createDefaultScene();
    const legacy: Record<string, unknown> = {
      ...current,
      schemaVersion: 1,
      entities: current.entities.map((entity) => {
        const legacyEntity = copyWithoutProperty(
          entity as unknown as Record<string, unknown>,
          "lockMode",
        );
        if (entity.kind === "actor") {
          legacyEntity.body = copyWithoutProperty(
            entity.body as unknown as Record<string, unknown>,
            "limbPresence",
          );
        }
        return {
          ...legacyEntity,
          locked: false,
        };
      }),
    };
    delete legacy.spatialLayout;

    const parsed = await parseSceneFile(
      new Blob([JSON.stringify(legacy)], {
        type: "application/json",
      }),
    );

    expect(parsed.schemaVersion).toBe(4);
    expect(parsed.spatialLayout).toBeNull();
    expect(parsed.sceneId).toBe(current.sceneId);
    expect(parsed.entities).toEqual(current.entities);
    expect(parsed.constraints).toEqual(current.constraints);
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
