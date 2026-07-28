import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
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
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

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
  preserveLock = false,
): ScenePatch =>
  scenePatchSchema.parse({
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: "patch_relationship_test",
    sceneId: scene.sceneId,
    baseRevision: scene.revision,
    source: "system",
    preserveLock,
    operations,
  });

const prospectiveActorFromOperations = (
  actor: ActorEntity,
  operations: ScenePatch["operations"],
): ActorEntity => {
  const poseOperation = operations.find(
    (operation) =>
      operation.op === "actor.pose.set" && operation.entityId === actor.id,
  );
  const transformOperation = operations.find(
    (operation) =>
      operation.op === "entity.transform.set" &&
      operation.entityId === actor.id,
  );
  if (
    !poseOperation ||
    poseOperation.op !== "actor.pose.set" ||
    !transformOperation ||
    transformOperation.op !== "entity.transform.set"
  ) {
    throw new Error("Relationship operations are missing pose or transform data.");
  }
  return {
    ...structuredClone(actor),
    pose: structuredClone(poseOperation.value),
    transform: structuredClone(transformOperation.value),
  };
};

const expectAuthoredVisibleSupport = (
  actor: ActorEntity,
  supportY: number,
): void => {
  const zeroYTransform = {
    ...structuredClone(actor.transform),
    positionM: [
      actor.transform.positionM[0],
      0,
      actor.transform.positionM[2],
    ] as [number, number, number],
  };
  const expectedY =
    supportY + actorVisibleRigBounds(actor, zeroYTransform).supportOffsetM;
  expect(actor.transform.positionM[1]).toBeCloseTo(expectedY, 9);
};

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
    const inputPrimary = scene.entities.find(
      (entity): entity is ActorEntity =>
        entity.id === "actor_primary_1" && entity.kind === "actor",
    );
    const inputSecondary = scene.entities.find(
      (entity): entity is ActorEntity =>
        entity.id === "actor_secondary_1" && entity.kind === "actor",
    );
    if (!inputPrimary || !inputSecondary) {
      throw new Error("Relationship actor fixtures are missing.");
    }
    inputPrimary.transform.scale = [1.4, 0.8, 1.1];
    inputSecondary.transform.scale = [0.9, 1.3, 0.8];
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
    expectAuthoredVisibleSupport(
      prospectiveActorFromOperations(inputPrimary, operations),
      0,
    );
    expectAuthoredVisibleSupport(
      prospectiveActorFromOperations(inputSecondary, operations),
      0,
    );

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
    expect(actorVisibleRigBounds(primary).minWorld[1]).toBeCloseTo(0, 9);
    expect(actorVisibleRigBounds(secondary).minWorld[1]).toBeCloseTo(0, 9);
  });

  it("builds over-under blocking on a surface and protects the lower face", () => {
    const scene = createTwoActorScene();
    const inputPrimary = scene.entities.find(
      (entity): entity is ActorEntity =>
        entity.id === "actor_primary_1" && entity.kind === "actor",
    );
    const inputSecondary = scene.entities.find(
      (entity): entity is ActorEntity =>
        entity.id === "actor_secondary_1" && entity.kind === "actor",
    );
    if (!inputPrimary || !inputSecondary) {
      throw new Error("Relationship actor fixtures are missing.");
    }
    inputPrimary.transform.scale = [1.2, 0.85, 1.1];
    inputSecondary.transform.scale = [0.8, 1.35, 0.9];
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
    expectAuthoredVisibleSupport(
      prospectiveActorFromOperations(inputPrimary, operations),
      surfaceTop,
    );
    expectAuthoredVisibleSupport(
      prospectiveActorFromOperations(inputSecondary, operations),
      surfaceTop,
    );

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
    expect(actorVisibleRigBounds(primary).minWorld[1]).toBeCloseTo(
      surfaceTop,
      6,
    );
    expect(actorVisibleRigBounds(lower).minWorld[1]).toBeCloseTo(
      surfaceTop,
      6,
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

  it("builds and atomically applies corrections for workflow-locked actors", () => {
    const scene = createTwoActorScene();
    const primary = scene.entities.find(
      (entity) => entity.id === "actor_primary_1",
    );
    const secondary = scene.entities.find(
      (entity) => entity.id === "actor_secondary_1",
    );
    if (primary?.kind !== "actor" || secondary?.kind !== "actor") {
      throw new Error("Relationship actor fixtures are missing.");
    }
    primary.lockMode = "workflow";
    secondary.lockMode = "workflow";

    const operations = buildRelationshipOperations(
      scene,
      "relationship.face-to-face-v1",
      {
        primaryActorId: primary.id,
        secondaryActorId: secondary.id,
      },
    );
    const applied = applyScenePatch(
      scene,
      asPatch(scene, operations, true),
    );

    expect(
      applied.next.entities.filter(
        (entity) =>
          entity.id === primary.id || entity.id === secondary.id,
      ),
    ).toEqual([
      expect.objectContaining({
        id: primary.id,
        lockMode: "workflow",
      }),
      expect.objectContaining({
        id: secondary.id,
        lockMode: "workflow",
      }),
    ]);
  });

  it("continues to reject user-locked relationship actors", () => {
    const scene = createTwoActorScene();
    const primary = scene.entities.find(
      (entity) => entity.id === "actor_primary_1",
    );
    if (primary?.kind !== "actor") {
      throw new Error("Relationship actor fixture is missing.");
    }
    primary.lockMode = "user";

    expect(() =>
      buildRelationshipOperations(
        scene,
        "relationship.face-to-face-v1",
        {
          primaryActorId: primary.id,
          secondaryActorId: "actor_secondary_1",
        },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "ROLE_ACTOR_LOCKED" }),
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
