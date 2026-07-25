import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  buildRelationshipOperations,
  listRelationshipPresets,
  RelationshipPresetError,
} from "../src/domain/presets/relationship-presets";
import {
  scenePatchSchema,
  type ScenePatch,
} from "../src/domain/scene-patch";
import {
  sceneSpecSchema,
  type ActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";

const createTwoActorScene = (): SceneSpec => {
  const base = createDefaultScene();
  const first = base.entities.find(
    (entity) => entity.kind === "actor",
  );
  if (!first || first.kind !== "actor") {
    throw new Error("Test scene requires an actor.");
  }
  const primary: ActorEntity = {
    ...structuredClone(first),
    id: "actor_primary_1",
    label: "Primary actor",
    slot: "actor_generic_1",
    transform: {
      ...structuredClone(first.transform),
      positionM: [-0.6, first.transform.positionM[1], 0],
    },
  };
  const secondary: ActorEntity = {
    ...structuredClone(first),
    id: "actor_secondary_1",
    label: "Secondary actor",
    slot: "actor_generic_2",
    transform: {
      ...structuredClone(first.transform),
      positionM: [0.6, first.transform.positionM[1], 0],
    },
  };

  return sceneSpecSchema.parse({
    ...base,
    entities: [
      ...base.entities.filter((entity) => entity.kind !== "actor"),
      primary,
      secondary,
    ],
    constraints: [],
  });
};

const asPatch = (
  scene: SceneSpec,
  operations: ScenePatch["operations"],
): ScenePatch =>
  scenePatchSchema.parse({
    schemaVersion: 1,
    patchId: "patch_relationship_test",
    sceneId: scene.sceneId,
    baseRevision: scene.revision,
    source: "system",
    operations,
  });

describe("relationship presets", () => {
  it("lists generic relationship definitions", () => {
    expect(
      listRelationshipPresets().map((preset) => preset.id),
    ).toEqual([
      "relationship.face-to-face-v1",
      "relationship.over-under-focus-lower-v1",
    ]);
  });

  it("builds a face-to-face pose and transform for both roles", () => {
    const scene = createTwoActorScene();
    const before = structuredClone(scene);
    const operations = buildRelationshipOperations(
      scene,
      "relationship.face-to-face-v1",
      {
        primaryActorId: "actor_primary_1",
        secondaryActorId: "actor_secondary_1",
      },
    );

    expect(scene).toEqual(before);
    expect(
      operations.filter((operation) => operation.op === "actor.pose.set"),
    ).toHaveLength(2);
    expect(
      operations.filter(
        (operation) => operation.op === "entity.transform.set",
      ),
    ).toHaveLength(2);
    expect(
      operations.filter((operation) => operation.op === "constraint.set"),
    ).toHaveLength(2);

    const result = applyScenePatch(scene, asPatch(scene, operations));
    const primary = result.next.entities.find(
      (entity) => entity.id === "actor_primary_1",
    );
    const secondary = result.next.entities.find(
      (entity) => entity.id === "actor_secondary_1",
    );
    expect(primary?.kind).toBe("actor");
    expect(secondary?.kind).toBe("actor");
    if (primary?.kind !== "actor" || secondary?.kind !== "actor") {
      return;
    }
    expect(primary.pose.preset.id).toBe("pose.standing-neutral-v1");
    expect(secondary.pose.preset.id).toBe(
      "pose.standing-neutral-v1",
    );
    expect(primary.transform.positionM[1]).toBeCloseTo(
      primary.pose.preset.parameters.contactOffsetM as number,
      5,
    );
    expect(secondary.transform.positionM[1]).toBeCloseTo(
      secondary.pose.preset.parameters.contactOffsetM as number,
      5,
    );
  });

  it("builds over-under blocking on a surface and protects the lower face", () => {
    const scene = createTwoActorScene();
    const surface = scene.entities.find(
      (entity) => entity.id === "prop_block_1",
    );
    expect(surface?.kind).toBe("prop");
    if (surface?.kind !== "prop") {
      return;
    }
    const surfaceTop =
      surface.transform.positionM[1] +
      (surface.geometry.sizeM[1] * surface.transform.scale[1]) / 2;

    const operations = buildRelationshipOperations(
      scene,
      "relationship.over-under-focus-lower-v1",
      {
        primaryActorId: "actor_primary_1",
        secondaryActorId: "actor_secondary_1",
        surfaceEntityId: surface.id,
      },
    );
    expect(() => asPatch(scene, operations)).not.toThrow();

    const result = applyScenePatch(scene, asPatch(scene, operations));
    const primary = result.next.entities.find(
      (entity) => entity.id === "actor_primary_1",
    );
    const lower = result.next.entities.find(
      (entity) => entity.id === "actor_secondary_1",
    );
    expect(primary?.kind).toBe("actor");
    expect(lower?.kind).toBe("actor");
    if (primary?.kind !== "actor" || lower?.kind !== "actor") {
      return;
    }
    expect(primary.pose.preset.id).toBe("pose.kneeling-lean-v1");
    expect(lower.pose.preset.id).toBe("pose.lying-supine-v1");
    expect(primary.transform.positionM[1]).toBeCloseTo(
      surfaceTop +
        (primary.pose.preset.parameters.contactOffsetM as number),
      5,
    );
    expect(lower.transform.positionM[1]).toBeCloseTo(
      surfaceTop +
        (lower.pose.preset.parameters.contactOffsetM as number),
      5,
    );
    expect(result.next.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ground-contact",
          entityId: primary.id,
          surfaceEntityId: surface.id,
        }),
        expect.objectContaining({
          type: "ground-contact",
          entityId: lower.id,
          surfaceEntityId: surface.id,
        }),
        expect.objectContaining({
          type: "keep-visible",
          cameraId: scene.activeCameraId,
          subjectEntityId: lower.id,
          anchor: "face",
        }),
      ]),
    );
  });

  it("returns stable role and preset errors without echoing input", () => {
    const scene = createTwoActorScene();

    expect(() =>
      buildRelationshipOperations(scene, "untrusted-relationship", {
        primaryActorId: "actor_primary_1",
        secondaryActorId: "actor_secondary_1",
      }),
    ).toThrowError(
      "The requested relationship preset is not available.",
    );

    try {
      buildRelationshipOperations(
        scene,
        "relationship.face-to-face-v1",
        {
          primaryActorId: "missing-private-id",
          secondaryActorId: "actor_secondary_1",
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RelationshipPresetError);
      expect((error as RelationshipPresetError).code).toBe(
        "ROLE_ACTOR_NOT_FOUND",
      );
      expect((error as Error).message).toBe(
        "A relationship role does not reference an actor.",
      );
    }

    const unsupportedScene = createTwoActorScene();
    const unsupportedSurface = unsupportedScene.entities.find(
      (entity) => entity.id === "prop_block_1",
    );
    if (!unsupportedSurface || unsupportedSurface.kind !== "prop") {
      throw new Error("Relationship fixture is missing its support prop.");
    }
    unsupportedSurface.geometry.primitive = "cylinder";
    expect(() =>
      buildRelationshipOperations(
        unsupportedScene,
        "relationship.over-under-focus-lower-v1",
        {
          primaryActorId: "actor_primary_1",
          secondaryActorId: "actor_secondary_1",
          surfaceEntityId: unsupportedSurface.id,
        },
      ),
    ).toThrowError(RelationshipPresetError);
    try {
      buildRelationshipOperations(
        unsupportedScene,
        "relationship.over-under-focus-lower-v1",
        {
          primaryActorId: "actor_primary_1",
          secondaryActorId: "actor_secondary_1",
          surfaceEntityId: unsupportedSurface.id,
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RelationshipPresetError);
      expect((error as RelationshipPresetError).code).toBe(
        "SURFACE_UNSUPPORTED",
      );
    }
  });
});
