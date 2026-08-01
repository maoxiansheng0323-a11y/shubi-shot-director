import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createActorBlueprintSnapshot,
  type ActorBlueprintSnapshot,
} from "../src/domain/actor-blueprint";
import { createDefaultScene } from "../src/domain/default-scene";
import { parseSceneSpecInput } from "../src/domain/scene-migrations";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { SCENE_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const sceneWithSnapshot = (
  snapshot: ActorBlueprintSnapshot = createActorBlueprintSnapshot(
    createGenericActorBlueprintDocument(),
  ),
): SceneSpec => {
  const scene = createDefaultScene();
  scene.actorBlueprints = [snapshot];
  return scene;
};

const legacyInput = (version: 1 | 2 | 3 | 4): Record<string, unknown> => {
  const scene = structuredClone(createDefaultScene()) as unknown as Record<
    string,
    unknown
  >;
  delete scene.actorBlueprints;
  scene.schemaVersion = version;
  const entities = scene.entities as Array<Record<string, unknown>>;

  if (version <= 3) {
    for (const entity of entities) {
      if (entity.kind === "actor") {
        delete (entity.body as Record<string, unknown>).limbPresence;
      }
    }
  }

  if (version <= 2) {
    for (const entity of entities) {
      entity.locked = entity.lockMode !== "none";
      delete entity.lockMode;
    }
  }

  if (version === 1) {
    delete scene.spatialLayout;
  }
  return scene;
};

describe("SceneSpec v6 Actor Blueprint snapshots", () => {
  it("stores one snapshot for two independently authored actor instances", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const scene = sceneWithSnapshot(snapshot);
    const first = createBlueprintActor({
      id: "actor_entity_blueprint_1",
      slot: "actor_female_1",
      blueprintId: snapshot.blueprintId,
      variantId: "damaged",
    });
    const second = createBlueprintActor({
      id: "actor_entity_blueprint_2",
      slot: "actor_female_2",
      blueprintId: snapshot.blueprintId,
      variantId: "repaired",
    });
    second.transform.positionM = [2, 0.81, -1];
    second.pose.joints.upper_arm_l = [0, 0, 0, 1];
    second.color = "#929aa6";
    second.lockMode = "workflow";
    scene.entities.push(first, second);

    const parsed = sceneSpecSchema.parse(scene);
    const blueprintActors = parsed.entities.filter(isBlueprintActorEntity);

    expect(SCENE_SCHEMA_VERSION).toBe(6);
    expect(parsed.actorBlueprints).toEqual([snapshot]);
    expect(blueprintActors).toHaveLength(2);
    expect(blueprintActors[0]).toMatchObject(first);
    expect(blueprintActors[1]).toMatchObject(second);
    expect(blueprintActors[0]?.blueprintInstance.variantId).toBe("damaged");
    expect(blueprintActors[1]?.blueprintInstance.variantId).toBe("repaired");
  });

  it("keeps legacy and blueprint actor fields mutually exclusive", () => {
    const scene = sceneWithSnapshot();
    const blueprintActor = createBlueprintActor();
    scene.entities.push(blueprintActor);

    const mixedBlueprint = structuredClone(scene) as unknown as {
      entities: Array<Record<string, unknown>>;
    };
    Object.assign(
      mixedBlueprint.entities.find(
        ({ id }) => id === blueprintActor.id,
      )!,
      {
        rig: {
          registry: "builtin",
          id: "rig.humanoid-v1",
          version: 1,
          parameters: {},
        },
        body: {
          heightM: 1.62,
          shoulderWidthM: 0.38,
          build: "slim",
          limbPresence: createGenericActorBlueprintDocument().limbPresence,
        },
      },
    );
    expect(() => sceneSpecSchema.parse(mixedBlueprint)).toThrow();

    const mixedLegacy = structuredClone(createDefaultScene()) as unknown as {
      entities: Array<Record<string, unknown>>;
    };
    const legacy = mixedLegacy.entities.find(
      ({ kind }) => kind === "actor",
    )!;
    legacy.blueprintInstance = {
      blueprintId: "actor_blueprint_1",
      variantId: "damaged",
    };
    expect(() => sceneSpecSchema.parse(mixedLegacy)).toThrow();
  });

  it("rejects duplicate snapshot IDs and duplicate content hashes", () => {
    const first = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const changedDocument = createGenericActorBlueprintDocument();
    changedDocument.blueprintVersion = 2;
    const sameIdDifferentHash = createActorBlueprintSnapshot(changedDocument);
    const duplicateId = sceneWithSnapshot(first);
    duplicateId.actorBlueprints.push(sameIdDifferentHash);
    expect(() => sceneSpecSchema.parse(duplicateId)).toThrow(
      "ACTOR_BLUEPRINT_ID_CONFLICT",
    );

    const sameContentDifferentIdDocument =
      createGenericActorBlueprintDocument();
    sameContentDifferentIdDocument.blueprintId = "actor_blueprint_2";
    const sameHashDifferentId = createActorBlueprintSnapshot(
      sameContentDifferentIdDocument,
    );
    const duplicateHash = sceneWithSnapshot(first);
    duplicateHash.actorBlueprints.push(sameHashDifferentId);
    expect(() => sceneSpecSchema.parse(duplicateHash)).toThrow(
      "ACTOR_BLUEPRINT_HASH_DUPLICATE",
    );
  });

  it("rejects missing blueprint and variant references", () => {
    const missingBlueprint: SceneSpec = createDefaultScene();
    missingBlueprint.entities.push(
      createBlueprintActor({
        blueprintId: "actor_blueprint_99",
      }),
    );
    expect(() => sceneSpecSchema.parse(missingBlueprint)).toThrow(
      "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    );

    const unknownVariant = sceneWithSnapshot();
    unknownVariant.entities.push(
      createBlueprintActor({ variantId: "unknown_variant" }),
    );
    expect(() => sceneSpecSchema.parse(unknownVariant)).toThrow(
      "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    );
  });

  it("exposes exact actor branch guards", () => {
    const scene = sceneWithSnapshot();
    scene.entities.push(createBlueprintActor());
    const actors = sceneSpecSchema
      .parse(scene)
      .entities.filter((entity) => entity.kind === "actor");

    expect(actors.filter(isLegacyActorEntity)).toHaveLength(1);
    expect(actors.filter(isBlueprintActorEntity)).toHaveLength(1);
  });

  it.each([1, 2, 3, 4] as const)(
    "normalizes SceneSpec v%s without changing legacy actor state",
    (version) => {
      const parsed = parseSceneSpecInput(legacyInput(version));
      const actors = parsed.entities.filter(isLegacyActorEntity);

      expect(parsed.schemaVersion).toBe(6);
      expect(parsed.actorBlueprints).toEqual([]);
      expect(actors).toHaveLength(1);
      expect(actors[0]?.rig.id).toBe("rig.humanoid-v1");
      expect(actors[0]?.body.heightM).toBe(1.72);
      expect(Object.values(actors[0]!.body.limbPresence)).toEqual(
        Array(12).fill("present"),
      );
    },
  );

  it("routes App pose actions through resolved actor stature for either actor branch", () => {
    const source = readFileSync("src/App.tsx", "utf8");

    expect(source).not.toContain("!isLegacyActorEntity(actor)");
    expect(source).toContain("actorStatureHeightM(currentScene, actor)");
  });
});
