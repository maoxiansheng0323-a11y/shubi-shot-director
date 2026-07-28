import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  parseScenePatchInput,
  parseSceneSpecInput,
} from "../src/domain/scene-migrations";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";

const copyWithoutProperty = (
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> => {
  const copy = { ...value };
  delete copy[property];
  return copy;
};

const createLegacyEntity = (id: string, locked: boolean) => {
  const template = createDefaultScene().entities.find(
    (entity) => entity.kind === "prop",
  );
  if (!template) {
    throw new Error("Default scene is missing its prop template.");
  }
  return {
    ...copyWithoutProperty(
      structuredClone(template) as unknown as Record<string, unknown>,
      "lockMode",
    ),
    id,
    label: `Legacy ${id}`,
    locked,
  };
};

const createLegacyScene = (schemaVersion: 1 | 2) => {
  const current = createDefaultScene();
  const legacy: Record<string, unknown> = {
    ...current,
    schemaVersion,
    revision: 7,
    entities: current.entities.map((entity, index) => {
      const legacyEntity: Record<string, unknown> = {
        ...copyWithoutProperty(
          entity as unknown as Record<string, unknown>,
          "lockMode",
        ),
        locked: index % 2 === 1,
      };
      if (legacyEntity.kind === "actor") {
        legacyEntity.body = copyWithoutProperty(
          legacyEntity.body as Record<string, unknown>,
          "limbPresence",
        );
      }
      return legacyEntity;
    }),
  };

  if (schemaVersion === 1) {
    delete legacy.spatialLayout;
  }

  return legacy;
};

const createV3Scene = () => {
  const current = structuredClone(createDefaultScene()) as unknown as Record<
    string,
    unknown
  >;
  current.schemaVersion = 3;
  current.revision = 7;
  const actor = (current.entities as Array<Record<string, unknown>>).find(
    (entity) => entity.kind === "actor",
  );
  if (!actor) throw new Error("Default scene is missing its actor template.");
  actor.body = copyWithoutProperty(
    actor.body as Record<string, unknown>,
    "limbPresence",
  );
  return current;
};

const createCanonicalScene = () => {
  const current = createDefaultScene();
  const lockModes = ["none", "workflow", "user", "none"] as const;

  return {
    ...current,
    schemaVersion: SCENE_SCHEMA_VERSION,
    entities: current.entities.map((entity, index) => ({
      ...entity,
      lockMode: lockModes[index],
    })),
  };
};

const createLegacyPatch = (schemaVersion: 1 | 2) => ({
  schemaVersion,
  patchId: `patch_legacy_v${schemaVersion}`,
  sceneId: "scene_starter",
  baseRevision: 7,
  source: "manual",
  operations: [
    {
      op: "scene.title.set",
      value: "Migrated title",
    },
    {
      op: "entity.flags.set",
      entityId: "actor_generic_1",
      visible: true,
      locked: true,
    },
    {
      op: "entity.flags.set",
      entityId: "prop_block_1",
      visible: false,
      locked: false,
    },
    {
      op: "entity.add",
      value: createLegacyEntity("prop_added_unlocked", false),
    },
    {
      op: "entity.add",
      value: createLegacyEntity("prop_added_locked", true),
    },
  ],
});

const createCanonicalPatch = (operationCount = 1) => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: "patch_lock_schema",
  sceneId: "scene_starter",
  baseRevision: 7,
  source: "manual",
  preserveLock: false,
  operations: Array.from({ length: operationCount }, (_, index) => ({
    op: "scene.title.set",
    value: `Title ${index}`,
  })),
});

describe("lock schema migrations", () => {
  it.each([1, 2] as const)(
    "migrates SceneSpec v%s lock booleans without changing revision",
    (schemaVersion) => {
      const parsed = parseSceneSpecInput(createLegacyScene(schemaVersion));

      expect(parsed.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
      expect(parsed.revision).toBe(7);
      expect(parsed.spatialLayout).toBeNull();
      expect(parsed.entities.map((entity) => entity.lockMode)).toEqual([
        "none",
        "workflow",
        "none",
        "workflow",
      ]);
      expect(
        parsed.entities.every((entity) => !("locked" in entity)),
      ).toBe(true);
    },
  );

  it("accepts exactly the three canonical v4 SceneSpec lock modes", () => {
    const canonical = createCanonicalScene();

    expect(sceneSpecSchema.safeParse(canonical).success).toBe(true);

    const unknownMode = structuredClone(canonical) as unknown as {
      entities: Record<string, unknown>[];
    };
    unknownMode.entities[0].lockMode = "automatic";
    expect(sceneSpecSchema.safeParse(unknownMode).success).toBe(false);

    const missingMode = structuredClone(canonical) as unknown as {
      entities: Record<string, unknown>[];
    };
    delete missingMode.entities[0].lockMode;
    expect(sceneSpecSchema.safeParse(missingMode).success).toBe(false);
  });

  it("migrates SceneSpec v3 lock modes without changing revision", () => {
    const legacy = createV3Scene();
    const entities = legacy.entities as Array<Record<string, unknown>>;
    entities[0].lockMode = "user";

    const parsed = parseSceneSpecInput(legacy);

    expect(parsed.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(parsed.revision).toBe(7);
    expect(parsed.entities[0].lockMode).toBe("user");
  });

  it("rejects SceneSpec v3 entities with legacy locked fields", () => {
    const legacy = createV3Scene();
    (legacy.entities as Array<Record<string, unknown>>)[0].locked = false;
    expect(() => parseSceneSpecInput(legacy)).toThrow();
  });

  it("retains a non-null SceneSpec v2 spatialLayout", () => {
    const legacy = createLegacyScene(2);
    legacy.entities = (
      legacy.entities as Array<Record<string, unknown>>
    ).filter((entity) => entity.kind !== "environment");
    legacy.constraints = [];
    legacy.spatialLayout = {
      floorY: 0,
      regions: [
        {
          id: "region_alpha",
          label: "Region Alpha",
          footprintXZ: [
            [-2, -2],
            [2, -2],
            [2, 2],
            [-2, 2],
          ],
          heightM: 2.8,
          visible: true,
        },
      ],
      boundaries: [],
      openings: [],
      connections: [],
      memberships: [],
    };

    const parsed = parseSceneSpecInput(legacy);

    expect(parsed.spatialLayout).toEqual(legacy.spatialLayout);
  });

  it.each([1, 2] as const)(
    "rejects SceneSpec v%s entities with mixed lock fields",
    (schemaVersion) => {
      const legacy = createLegacyScene(schemaVersion);
      const entities = legacy.entities as Array<Record<string, unknown>>;
      entities[0].lockMode = "user";

      expect(() => parseSceneSpecInput(legacy)).toThrow();
    },
  );

  it.each([1, 2] as const)(
    "migrates ScenePatch v%s flags one-to-one and defaults preserveLock",
    (schemaVersion) => {
      const legacy = createLegacyPatch(schemaVersion);
      const parsed = parseScenePatchInput(legacy);

      expect(parsed.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
      expect(parsed.preserveLock).toBe(false);
      expect(parsed.operations).toHaveLength(legacy.operations.length);
      expect(parsed.operations[0]).toEqual(legacy.operations[0]);
      expect(parsed.operations[1]).toEqual({
        op: "entity.flags.set",
        entityId: "actor_generic_1",
        visible: true,
        lockMode: "workflow",
      });
      expect(parsed.operations[2]).toEqual({
        op: "entity.flags.set",
        entityId: "prop_block_1",
        visible: false,
        lockMode: "none",
      });
      expect(parsed.operations[3]).toEqual({
        op: "entity.add",
        value: {
          ...copyWithoutProperty(
            createLegacyEntity("prop_added_unlocked", false),
            "locked",
          ),
          lockMode: "none",
        },
      });
      expect(parsed.operations[4]).toEqual({
        op: "entity.add",
        value: {
          ...copyWithoutProperty(
            createLegacyEntity("prop_added_locked", true),
            "locked",
          ),
          lockMode: "workflow",
        },
      });
      expect(
        parsed.operations.every(
          (operation) =>
            operation.op !== "entity.add" ||
            !("locked" in operation.value),
        ),
      ).toBe(true);
    },
  );

  it.each([1, 2] as const)(
    "keeps ScenePatch v%s legacy flag fields required",
    (schemaVersion) => {
      const missingLocked = createLegacyPatch(schemaVersion);
      delete (
        missingLocked.operations[1] as Record<string, unknown>
      ).locked;
      expect(() => parseScenePatchInput(missingLocked)).toThrow();

      const missingVisible = createLegacyPatch(schemaVersion);
      delete (
        missingVisible.operations[1] as Record<string, unknown>
      ).visible;
      expect(() => parseScenePatchInput(missingVisible)).toThrow();
    },
  );

  it.each([1, 2] as const)(
    "rejects ScenePatch v%s mixed lock fields",
    (schemaVersion) => {
      const legacy = createLegacyPatch(schemaVersion);

      expect(() =>
        parseScenePatchInput({
          ...legacy,
          preserveLock: false,
          operations: [legacy.operations[0]],
        }),
      ).toThrow();
      expect(() =>
        parseScenePatchInput({
          ...legacy,
          operations: [
            {
              ...legacy.operations[1],
              lockMode: "user",
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        parseScenePatchInput({
          ...legacy,
          operations: [
            {
              ...legacy.operations[3],
              value: {
                ...(legacy.operations[3].value as Record<string, unknown>),
                lockMode: "user",
              },
            },
          ],
        }),
      ).toThrow();
    },
  );

  it("migrates ScenePatch v3 preserveLock and operation order", () => {
    const legacy = {
      ...createCanonicalPatch(2),
      schemaVersion: 3,
      preserveLock: true,
    };
    const parsed = parseScenePatchInput(legacy);
    expect(parsed.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(parsed.preserveLock).toBe(true);
    expect(parsed.operations).toEqual(legacy.operations);
  });

  it("rejects ScenePatch v3 legacy lock fields", () => {
    expect(() =>
      parseScenePatchInput({
        ...createCanonicalPatch(),
        schemaVersion: 3,
        operations: [
          {
            op: "entity.flags.set",
            entityId: "actor_generic_1",
            visible: true,
            locked: false,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a canonical v4 ScenePatch without preserveLock", () => {
    const missingPreserveLock = copyWithoutProperty(
      createCanonicalPatch() as unknown as Record<string, unknown>,
      "preserveLock",
    );
    const result = scenePatchSchema.safeParse(missingPreserveLock);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["preserveLock"] }),
        ]),
      );
    }
  });

  it("requires canonical entity flags to set visible or lockMode", () => {
    const withOperation = (operation: Record<string, unknown>) => ({
      ...createCanonicalPatch(),
      operations: [operation],
    });

    expect(
      scenePatchSchema.safeParse(
        withOperation({
          op: "entity.flags.set",
          entityId: "actor_generic_1",
          visible: false,
        }),
      ).success,
    ).toBe(true);
    expect(
      scenePatchSchema.safeParse(
        withOperation({
          op: "entity.flags.set",
          entityId: "actor_generic_1",
          lockMode: "user",
        }),
      ).success,
    ).toBe(true);
    expect(
      scenePatchSchema.safeParse(
        withOperation({
          op: "entity.flags.set",
          entityId: "actor_generic_1",
        }),
      ).success,
    ).toBe(false);
    expect(
      scenePatchSchema.safeParse(
        withOperation({
          op: "entity.flags.set",
          entityId: "actor_generic_1",
          visible: true,
          locked: true,
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts 256 operations and rejects 257", () => {
    expect(scenePatchSchema.safeParse(createCanonicalPatch(256)).success).toBe(
      true,
    );
    expect(scenePatchSchema.safeParse(createCanonicalPatch(257)).success).toBe(
      false,
    );
  });
});
