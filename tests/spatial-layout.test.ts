import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { sceneSpecSchema } from "../src/domain/scene-schema";
import {
  deriveBoundaryWallBoxes,
  spatialAdjacency,
  spatialLayoutBounds,
} from "../src/domain/spatial-layout";

const createConnectedSceneInput = () => {
  const base = createDefaultScene();
  return {
    ...base,
    schemaVersion: 4,
    entities: base.entities.filter((entity) => entity.kind !== "environment"),
    constraints: [],
    spatialLayout: {
      floorY: 0,
      regions: [
        {
          id: "region_alpha",
          label: "Region Alpha",
          footprintXZ: [
            [-4, -2],
            [0, -2],
            [0, 2],
            [-4, 2],
          ],
          heightM: 2.8,
          visible: true,
        },
        {
          id: "region_beta",
          label: "Region Beta",
          footprintXZ: [
            [0, -2],
            [4, -2],
            [4, 2],
            [0, 2],
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
          startXZ: [0, -2],
          endXZ: [0, 2],
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
          regionId: "region_alpha",
        },
        {
          entityId: "prop_block_1",
          regionId: "region_beta",
        },
        {
          entityId: "camera_shot_1",
          regionId: "region_alpha",
        },
      ],
    },
  };
};

describe("generic connected spatial layouts", () => {
  it("accepts abstract regions, a shared boundary, an opening, and memberships", () => {
    const parsed = sceneSpecSchema.parse(createConnectedSceneInput());

    expect(parsed.schemaVersion).toBe(4);
    expect(parsed.spatialLayout?.regions.map(({ id }) => id)).toEqual([
      "region_alpha",
      "region_beta",
    ]);
    expect(parsed.spatialLayout?.connections[0]).toMatchObject({
      openingId: "opening_alpha_beta",
      allowsPassage: true,
      allowsSight: true,
    });
    expect(parsed.entities.some((entity) => entity.kind === "environment")).toBe(
      false,
    );
  });

  it("rejects a self-intersecting region footprint", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.regions[0].footprintXZ = [
      [-4, -2],
      [0, 2],
      [0, -2],
      [-4, 2],
    ];

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /self-intersecting region footprint/i,
    );
  });

  it("rejects a zero-area region footprint", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.regions[0].footprintXZ = [
      [-4, 0],
      [-2, 0],
      [0, 0],
    ];

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /zero-area region footprint/i,
    );
  });

  it("rejects a boundary endpoint outside a referenced region footprint", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.boundaries[0].startXZ = [1, -2];

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /boundary endpoint is not on region footprint/i,
    );
  });

  it("rejects duplicate spatial ids and zero-length boundaries", () => {
    const duplicate = createConnectedSceneInput();
    duplicate.spatialLayout.regions[1].id = "region_alpha";
    expect(() => sceneSpecSchema.parse(duplicate)).toThrow(
      /duplicate spatial id/i,
    );

    const zeroLength = createConnectedSceneInput();
    zeroLength.spatialLayout.boundaries[0].endXZ =
      zeroLength.spatialLayout.boundaries[0].startXZ;
    expect(() => sceneSpecSchema.parse(zeroLength)).toThrow(
      /zero-length boundary/i,
    );
  });

  it("rejects repeated region ids on a shared boundary or connection", () => {
    const boundary = createConnectedSceneInput();
    boundary.spatialLayout.boundaries[0].regionIds = [
      "region_alpha",
      "region_alpha",
    ];
    expect(() => sceneSpecSchema.parse(boundary)).toThrow(
      /boundary region ids must be distinct/i,
    );

    const connection = createConnectedSceneInput();
    connection.spatialLayout.connections[0].regionIds = [
      "region_alpha",
      "region_alpha",
    ];
    expect(() => sceneSpecSchema.parse(connection)).toThrow(
      /connection region ids must be distinct/i,
    );
  });

  it("rejects an opening that extends past its boundary", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.openings[0].offsetM = 3.2;

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /opening extends past boundary/i,
    );
  });

  it("rejects overlapping openings on one boundary", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.openings.push({
      id: "opening_alpha_beta_second",
      label: "Opening Alpha Beta Second",
      boundaryId: "boundary_alpha_beta",
      offsetM: 1.8,
      widthM: 1,
      bottomM: 0,
      heightM: 2,
      visible: true,
    });

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /overlapping openings/i,
    );
  });

  it("rejects a connection whose regions do not match the opening boundary", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.boundaries[0].regionIds = ["region_alpha"];

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /connection regions do not match opening boundary/i,
    );
  });

  it("rejects duplicate region memberships for one entity", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.memberships.push({
      entityId: "actor_generic_1",
      regionId: "region_beta",
    });

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /duplicate region membership/i,
    );
  });

  it("rejects a legacy environment entity in connected-region mode", () => {
    const scene = createConnectedSceneInput();
    const environment = createDefaultScene().entities.find(
      (entity) => entity.kind === "environment",
    );
    if (!environment) {
      throw new Error("Expected the starter scene to include an environment.");
    }
    scene.entities.push(
      environment as unknown as (typeof scene.entities)[number],
    );

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /connected-region scenes cannot contain environment entities/i,
    );
  });

  it("rejects a membership that references a missing scene entity", () => {
    const scene = createConnectedSceneInput();
    scene.spatialLayout.memberships[0].entityId = "actor_missing_1";

    expect(() => sceneSpecSchema.parse(scene)).toThrow(
      /membership references missing scene entity/i,
    );
  });

  it("derives enabled region adjacency without semantic room types", () => {
    const scene = sceneSpecSchema.parse(createConnectedSceneInput());

    expect(spatialAdjacency(scene.spatialLayout!)).toEqual(
      new Map([
        ["region_alpha", new Set(["region_beta"])],
        ["region_beta", new Set(["region_alpha"])],
      ]),
    );
  });

  it("derives complete world bounds for overview framing", () => {
    const scene = sceneSpecSchema.parse(createConnectedSceneInput());

    expect(spatialLayoutBounds(scene.spatialLayout!)).toEqual({
      min: [-4, 0, -2],
      max: [4, 2.8, 2],
    });
  });

  it("splits a wall into solid boxes around a visible opening", () => {
    const scene = sceneSpecSchema.parse(createConnectedSceneInput());
    const layout = scene.spatialLayout!;

    expect(
      deriveBoundaryWallBoxes(layout, layout.boundaries[0]).map(
        ({ size }) => size,
      ),
    ).toEqual([
      [1.2, 2.8, 0.1],
      [1.6, 2.8, 0.1],
      [1.2, 0.7, 0.1],
    ]);
  });
});
