import {
  spatialAdjacency,
  type SpatialLayout,
  type XzPoint,
} from "../domain/spatial-layout";

export type SpatialPreviewMode = "overview" | "local";

export interface SpatialCameraFrame {
  position: [number, number, number];
  target: [number, number, number];
}

export interface SpatialPreviewProjection {
  focusedRegionId: string | null;
  regionOpacity: Map<string, number>;
  boundaryOpacity: Map<string, number>;
  camera: SpatialCameraFrame;
}

const DEFAULT_CAMERA: SpatialCameraFrame = {
  position: [6, 4.5, 7],
  target: [0, 1, 0],
};

export const resolveFocusedRegionId = (
  layout: SpatialLayout,
  requestedRegionId: string | null,
): string | null => {
  const requested = layout.regions.find(
    (region) => region.id === requestedRegionId && region.visible,
  );
  return (
    requested?.id ??
    layout.regions.find((region) => region.visible)?.id ??
    layout.regions[0]?.id ??
    null
  );
};

const cameraFrameForPoints = (
  layout: SpatialLayout,
  points: readonly XzPoint[],
  heightM: number,
  local: boolean,
): SpatialCameraFrame => {
  if (points.length === 0) {
    return DEFAULT_CAMERA;
  }
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minZ = Math.min(...points.map(([, z]) => z));
  const maxZ = Math.max(...points.map(([, z]) => z));
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, 2);
  const targetHeight = Math.min(heightM * 0.25, 1);
  return {
    position: local
      ? [
          centerX + span * 0.95,
          layout.floorY + Math.max(heightM * 1.75, span * 1.1, 4.5),
          centerZ + span * 1.1,
        ]
      : [
          centerX + span * 0.5,
          layout.floorY + Math.max(heightM * 1.8, span * 0.95, 4),
          centerZ + span * 0.58,
        ],
    target: [centerX, layout.floorY + targetHeight, centerZ],
  };
};

export const deriveSpatialPreview = (
  layout: SpatialLayout | null,
  mode: SpatialPreviewMode,
  requestedRegionId: string | null,
): SpatialPreviewProjection => {
  if (layout === null) {
    return {
      focusedRegionId: null,
      regionOpacity: new Map(),
      boundaryOpacity: new Map(),
      camera: DEFAULT_CAMERA,
    };
  }

  const focusedRegionId = resolveFocusedRegionId(
    layout,
    requestedRegionId,
  );
  const adjacency = spatialAdjacency(layout);
  const adjacentRegionIds =
    focusedRegionId === null
      ? new Set<string>()
      : (adjacency.get(focusedRegionId) ?? new Set<string>());
  const regionOpacity = new Map(
    layout.regions.map((region) => {
      if (!region.visible) {
        return [region.id, 0] as const;
      }
      if (mode !== "local") {
        return [region.id, 1] as const;
      }
      if (region.id === focusedRegionId) {
        return [region.id, 1] as const;
      }
      return [
        region.id,
        adjacentRegionIds.has(region.id) ? 0.34 : 0.12,
      ] as const;
    }),
  );
  const boundaryOpacity = new Map(
    layout.boundaries.map((boundary) => {
      if (!boundary.visible) {
        return [boundary.id, 0] as const;
      }
      const regionMaximum = Math.max(
        ...boundary.regionIds.map(
          (regionId) => regionOpacity.get(regionId) ?? 0,
        ),
      );
      return [
        boundary.id,
        mode === "local"
          ? regionMaximum >= 1
            ? 0.22
            : Math.max(0.04, regionMaximum * 0.28)
          : regionMaximum,
      ] as const;
    }),
  );
  const framedRegions =
    mode === "local" && focusedRegionId !== null
      ? layout.regions.filter((region) => region.id === focusedRegionId)
      : layout.regions.filter((region) => region.visible);
  const points = framedRegions.flatMap((region) => region.footprintXZ);
  const heightM = Math.max(
    0,
    ...framedRegions.map((region) => region.heightM),
  );

  return {
    focusedRegionId,
    regionOpacity,
    boundaryOpacity,
    camera: cameraFrameForPoints(
      layout,
      points,
      heightM,
      mode === "local",
    ),
  };
};
