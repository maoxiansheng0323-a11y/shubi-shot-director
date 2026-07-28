import { describe, expect, it } from "vitest";
import { lookAtQuaternion } from "../src/domain/scene-math";
import type {
  TransformSpec,
  Vec3,
} from "../src/domain/scene-schema";
import type { SpatialLayout } from "../src/domain/spatial-layout";
import {
  deriveHiddenShotWallBoxKey,
  isCameraInsideVisibleRegionVolume,
  shotWallBoxKey,
} from "../src/editor/shot-wall-visibility";

const cameraTransform = (
  positionM: Vec3,
  targetM: Vec3,
): TransformSpec => ({
  positionM,
  rotation: lookAtQuaternion(positionM, targetM),
  scale: [1, 1, 1],
});

const connectedLayout = (): SpatialLayout => ({
  floorY: 0,
  regions: [
    {
      id: "region_alpha",
      label: "Alpha",
      footprintXZ: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      heightM: 2.8,
      visible: true,
    },
    {
      id: "region_beta",
      label: "Beta",
      footprintXZ: [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ],
      heightM: 2.8,
      visible: true,
    },
  ],
  boundaries: [
    {
      id: "boundary_alpha_west",
      label: "Alpha West",
      regionIds: ["region_alpha"],
      startXZ: [0, 0],
      endXZ: [0, 4],
      heightM: 2.8,
      thicknessM: 0.1,
      visible: true,
    },
    {
      id: "boundary_alpha_beta",
      label: "Alpha Beta",
      regionIds: ["region_alpha", "region_beta"],
      startXZ: [4, 0],
      endXZ: [4, 4],
      heightM: 2.8,
      thicknessM: 0.1,
      visible: true,
    },
    {
      id: "boundary_beta_east",
      label: "Beta East",
      regionIds: ["region_beta"],
      startXZ: [8, 0],
      endXZ: [8, 4],
      heightM: 2.8,
      thicknessM: 0.1,
      visible: true,
    },
  ],
  openings: [
    {
      id: "opening_alpha_west",
      label: "Alpha West Opening",
      boundaryId: "boundary_alpha_west",
      offsetM: 1.25,
      widthM: 1.5,
      bottomM: 0,
      heightM: 2.2,
      visible: true,
    },
  ],
  connections: [],
  memberships: [],
});

describe("shot wall visibility", () => {
  it("treats interior and room-volume boundary positions as inside", () => {
    const layout = connectedLayout();

    expect(
      isCameraInsideVisibleRegionVolume(layout, [2, 1.4, 0.5]),
    ).toBe(true);
    expect(
      isCameraInsideVisibleRegionVolume(layout, [0, 1.4, 0.5]),
    ).toBe(true);
    expect(
      isCameraInsideVisibleRegionVolume(layout, [2, 0, 0.5]),
    ).toBe(true);
    expect(
      isCameraInsideVisibleRegionVolume(layout, [2, 2.8, 0.5]),
    ).toBe(true);
  });

  it("treats lateral, above-room, and below-room positions as outside", () => {
    const layout = connectedLayout();

    expect(
      isCameraInsideVisibleRegionVolume(layout, [-2, 1.4, 0.5]),
    ).toBe(false);
    expect(
      isCameraInsideVisibleRegionVolume(layout, [2, 4, 0.5]),
    ).toBe(false);
    expect(
      isCameraInsideVisibleRegionVolume(layout, [2, -1, 0.5]),
    ).toBe(false);
  });

  it("keeps every wall when the camera is inside a visible room", () => {
    const layout = connectedLayout();

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([2, 1.4, 0.5], [6, 1.4, 0.5]),
      ),
    ).toBeNull();
    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([0, 1.4, 0.5], [6, 1.4, 0.5]),
      ),
    ).toBeNull();
  });

  it("selects only the first solid wall box in front of an outside camera", () => {
    const layout = connectedLayout();

    const hidden = deriveHiddenShotWallBoxKey(
      layout,
      cameraTransform([-2, 1.4, 0.5], [6, 1.4, 0.5]),
    );

    expect(hidden).toBe(shotWallBoxKey("boundary_alpha_west", 0));
    expect(hidden).not.toBe(shotWallBoxKey("boundary_alpha_beta", 0));
  });

  it("uses full room height when an outside camera crosses a wall", () => {
    const layout = connectedLayout();

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([2, 4, 0.5], [6, 1.4, 0.5]),
      ),
    ).toBe(shotWallBoxKey("boundary_alpha_beta", 0));
    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([2, -1, 0.5], [6, 1.4, 0.5]),
      ),
    ).toBe(shotWallBoxKey("boundary_alpha_beta", 0));
  });

  it("skips an opening gap and selects the next solid wall", () => {
    const layout = connectedLayout();

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([-2, 1, 2], [6, 1, 2]),
      ),
    ).toBe(shotWallBoxKey("boundary_alpha_beta", 0));
  });

  it("returns no wall when an opening ray has no later blocker", () => {
    const layout = connectedLayout();
    layout.regions = [layout.regions[0]];
    layout.boundaries = [layout.boundaries[0]];

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([-2, 1, 2], [6, 1, 2]),
      ),
    ).toBeNull();
  });

  it("ignores walls behind or outside the camera ray", () => {
    const layout = connectedLayout();

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([-2, 1.4, 0.5], [-6, 1.4, 0.5]),
      ),
    ).toBeNull();
  });

  it("intersects a rotated wall box", () => {
    const layout: SpatialLayout = {
      floorY: 0,
      regions: [
        {
          id: "region_diagonal",
          label: "Diagonal",
          footprintXZ: [
            [0, 0],
            [4, 4],
            [0, 4],
          ],
          heightM: 2.8,
          visible: true,
        },
      ],
      boundaries: [
        {
          id: "boundary_diagonal",
          label: "Diagonal Boundary",
          regionIds: ["region_diagonal"],
          startXZ: [0, 0],
          endXZ: [4, 4],
          heightM: 2.8,
          thicknessM: 0.1,
          visible: true,
        },
      ],
      openings: [],
      connections: [],
      memberships: [],
    };

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([3, 1.4, 1], [1, 1.4, 3]),
      ),
    ).toBe(shotWallBoxKey("boundary_diagonal", 0));
  });

  it("uses layout order to break equal-distance ties", () => {
    const layout = connectedLayout();
    const duplicate = {
      ...layout.boundaries[0],
      id: "boundary_alpha_west_duplicate",
      label: "Alpha West Duplicate",
    };
    layout.boundaries = [layout.boundaries[0], duplicate];
    layout.openings = [];

    expect(
      deriveHiddenShotWallBoxKey(
        layout,
        cameraTransform([-2, 1.4, 0.5], [2, 1.4, 0.5]),
      ),
    ).toBe(shotWallBoxKey("boundary_alpha_west", 0));
  });

  it("skips hidden regions and boundaries and handles absent layout data", () => {
    const layout = connectedLayout();
    const transform = cameraTransform(
      [-2, 1.4, 0.5],
      [6, 1.4, 0.5],
    );

    layout.boundaries[0].visible = false;
    expect(deriveHiddenShotWallBoxKey(layout, transform)).toBe(
      shotWallBoxKey("boundary_alpha_beta", 0),
    );

    layout.regions.forEach((region) => {
      region.visible = false;
    });
    expect(deriveHiddenShotWallBoxKey(layout, transform)).toBeNull();
    expect(deriveHiddenShotWallBoxKey(null, transform)).toBeNull();
    expect(deriveHiddenShotWallBoxKey(layout, undefined)).toBeNull();
  });
});
