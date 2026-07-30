import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { sceneSpecSchema } from "../src/domain/scene-schema";

const createSpatialScene = () => {
  const base = createDefaultScene();
  return sceneSpecSchema.parse({
    ...base,
    entities: base.entities.filter((entity) => entity.kind !== "environment"),
    constraints: [],
    spatialLayout: {
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
    },
  });
};

const createConnectedSpatialScene = () => {
  const scene = createSpatialScene();
  return sceneSpecSchema.parse({
    ...scene,
    spatialLayout: {
      floorY: 0,
      regions: [
        scene.spatialLayout!.regions[0],
        {
          id: "region_beta",
          label: "Region Beta",
          footprintXZ: [
            [2, -2],
            [6, -2],
            [6, 2],
            [2, 2],
          ],
          heightM: 2.8,
          visible: true,
        },
      ],
      boundaries: [
        {
          id: "boundary_alpha_beta",
          label: "Boundary Alpha Beta",
          regionIds: ["region_alpha", "region_beta"],
          startXZ: [2, -2],
          endXZ: [2, 2],
          heightM: 2.8,
          thicknessM: 0.1,
          visible: true,
        },
      ],
      openings: [
        {
          id: "opening_alpha_beta",
          label: "Opening Alpha Beta",
          boundaryId: "boundary_alpha_beta",
          offsetM: 1.2,
          widthM: 1.2,
          bottomM: 0,
          heightM: 2.1,
          visible: true,
        },
      ],
      connections: [
        {
          id: "connection_alpha_beta",
          label: "Connection Alpha Beta",
          regionIds: ["region_alpha", "region_beta"],
          openingId: "opening_alpha_beta",
          allowsPassage: true,
          allowsSight: true,
          enabled: true,
        },
      ],
      memberships: [
        {
          entityId: "actor_generic_1",
          regionId: "region_beta",
        },
      ],
    },
  });
};

describe("spatial ScenePatch operations", () => {
  it("sets persistent region visibility atomically", () => {
    const scene = createSpatialScene();

    const applied = applyScenePatch(scene, {
      schemaVersion: 3,
      patchId: "patch_region_visibility",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "spatial.region.visibility.set",
          regionId: "region_alpha",
          visible: false,
        },
      ],
    });

    expect(applied.next.spatialLayout?.regions[0].visible).toBe(false);
    expect(applied.next.revision).toBe(scene.revision + 1);
    expect(applied.previous).toEqual(scene);
  });

  it("upserts a connected region topology and entity membership in one revision", () => {
    const scene = createSpatialScene();

    const applied = applyScenePatch(scene, {
      schemaVersion: 3,
      patchId: "patch_add_connected_region",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "spatial.region.upsert",
          value: {
            id: "region_beta",
            label: "Region Beta",
            footprintXZ: [
              [2, -2],
              [6, -2],
              [6, 2],
              [2, 2],
            ],
            heightM: 2.8,
            visible: true,
          },
        },
        {
          op: "spatial.boundary.upsert",
          value: {
            id: "boundary_alpha_beta",
            label: "Boundary Alpha Beta",
            regionIds: ["region_alpha", "region_beta"],
            startXZ: [2, -2],
            endXZ: [2, 2],
            heightM: 2.8,
            thicknessM: 0.1,
            visible: true,
          },
        },
        {
          op: "spatial.opening.upsert",
          value: {
            id: "opening_alpha_beta",
            label: "Opening Alpha Beta",
            boundaryId: "boundary_alpha_beta",
            offsetM: 1.2,
            widthM: 1.2,
            bottomM: 0,
            heightM: 2.1,
            visible: true,
          },
        },
        {
          op: "spatial.connection.upsert",
          value: {
            id: "connection_alpha_beta",
            label: "Connection Alpha Beta",
            regionIds: ["region_alpha", "region_beta"],
            openingId: "opening_alpha_beta",
            allowsPassage: true,
            allowsSight: true,
            enabled: true,
          },
        },
        {
          op: "spatial.membership.set",
          value: {
            entityId: "actor_generic_1",
            regionId: "region_beta",
          },
        },
      ],
    });

    expect(applied.next.spatialLayout).toMatchObject({
      regions: [
        { id: "region_alpha" },
        { id: "region_beta" },
      ],
      boundaries: [{ id: "boundary_alpha_beta" }],
      openings: [{ id: "opening_alpha_beta" }],
      connections: [{ id: "connection_alpha_beta" }],
      memberships: [
        {
          entityId: "actor_generic_1",
          regionId: "region_beta",
        },
      ],
    });
    expect(applied.next.revision).toBe(scene.revision + 1);
  });

  it("sets persistent boundary visibility", () => {
    const scene = createConnectedSpatialScene();

    const applied = applyScenePatch(scene, {
      schemaVersion: 3,
      patchId: "patch_boundary_visibility",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "spatial.boundary.visibility.set",
          boundaryId: "boundary_alpha_beta",
          visible: false,
        },
      ],
    });

    expect(applied.next.spatialLayout?.boundaries[0].visible).toBe(false);
  });

  it("removes dependent topology explicitly in one atomic patch", () => {
    const scene = createConnectedSpatialScene();

    const applied = applyScenePatch(scene, {
      schemaVersion: 3,
      patchId: "patch_remove_connected_region",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "spatial.connection.remove",
          connectionId: "connection_alpha_beta",
        },
        {
          op: "spatial.opening.remove",
          openingId: "opening_alpha_beta",
        },
        {
          op: "spatial.boundary.remove",
          boundaryId: "boundary_alpha_beta",
        },
        {
          op: "spatial.membership.remove",
          entityId: "actor_generic_1",
        },
        {
          op: "spatial.region.remove",
          regionId: "region_beta",
        },
      ],
    });

    expect(applied.next.spatialLayout).toMatchObject({
      regions: [{ id: "region_alpha" }],
      boundaries: [],
      openings: [],
      connections: [],
      memberships: [],
    });
    expect(applied.next.revision).toBe(scene.revision + 1);
  });

  it("migrates a legacy v1 patch containing only legacy operations", () => {
    const scene = createSpatialScene();

    const applied = applyScenePatch(scene, {
      schemaVersion: 1,
      patchId: "patch_legacy_title",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      operations: [
        {
          op: "scene.title.set",
          value: "Migrated legacy title",
        },
      ],
    });

    expect(applied.patch.schemaVersion).toBe(5);
    expect(applied.patch.preserveLock).toBe(false);
    expect(applied.next.title).toBe("Migrated legacy title");
  });

  it("requires membership removal before removing a placed entity", () => {
    const scene = createConnectedSpatialScene();

    expect(() =>
      applyScenePatch(scene, {
        schemaVersion: 3,
        patchId: "patch_remove_placed_entity",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "natural-language",
        preserveLock: false,
        operations: [
          {
            op: "entity.remove",
            entityId: "actor_generic_1",
          },
        ],
      }),
    ).toThrow(/entity is still referenced/i);
  });
});
