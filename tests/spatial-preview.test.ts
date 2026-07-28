import { describe, expect, it } from "vitest";
import {
  deriveSpatialPreview,
  resolveFocusedRegionId,
} from "../src/editor/spatial-preview";
import type { SpatialLayout } from "../src/domain/spatial-layout";

const layout: SpatialLayout = {
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
    {
      id: "region_gamma",
      label: "Gamma",
      footprintXZ: [
        [8, 0],
        [12, 0],
        [12, 4],
        [8, 4],
      ],
      heightM: 2.8,
      visible: true,
    },
  ],
  boundaries: [
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
      id: "boundary_beta_gamma",
      label: "Beta Gamma",
      regionIds: ["region_beta", "region_gamma"],
      startXZ: [8, 0],
      endXZ: [8, 4],
      heightM: 2.8,
      thicknessM: 0.1,
      visible: true,
    },
  ],
  openings: [],
  connections: [
    {
      id: "connection_alpha_beta",
      label: "Alpha Beta",
      regionIds: ["region_alpha", "region_beta"],
      openingId: "opening_alpha_beta",
      allowsPassage: true,
      allowsSight: true,
      enabled: true,
    },
    {
      id: "connection_beta_gamma",
      label: "Beta Gamma",
      regionIds: ["region_beta", "region_gamma"],
      openingId: "opening_beta_gamma",
      allowsPassage: true,
      allowsSight: true,
      enabled: true,
    },
  ],
  memberships: [],
};

describe("spatial preview projection", () => {
  it("uses the requested region or a deterministic visible fallback", () => {
    expect(resolveFocusedRegionId(layout, "region_beta")).toBe(
      "region_beta",
    );
    expect(resolveFocusedRegionId(layout, "region_missing")).toBe(
      "region_alpha",
    );
  });

  it("keeps every visible region opaque in overview mode", () => {
    const preview = deriveSpatialPreview(layout, "overview", null);

    expect(preview.regionOpacity).toEqual(
      new Map([
        ["region_alpha", 1],
        ["region_beta", 1],
        ["region_gamma", 1],
      ]),
    );
  });

  it("fades adjacent and distant regions in local mode", () => {
    const preview = deriveSpatialPreview(
      layout,
      "local",
      "region_alpha",
    );

    expect(preview.regionOpacity.get("region_alpha")).toBe(1);
    expect(preview.regionOpacity.get("region_beta")).toBe(0.34);
    expect(preview.regionOpacity.get("region_gamma")).toBe(0.12);
    expect(preview.boundaryOpacity.get("boundary_alpha_beta")).toBe(0.22);
    expect(preview.camera.target).toEqual([2, 0.7, 2]);
    expect(preview.camera.position[1]).toBeGreaterThan(2.8);
  });
});
