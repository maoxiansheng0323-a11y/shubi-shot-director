import { rotateVector } from "../domain/scene-math";
import type {
  TransformSpec,
  Vec3,
} from "../domain/scene-schema";
import {
  deriveBoundaryWallBoxes,
  type SpatialLayout,
  type SpatialWallBox,
  type XzPoint,
} from "../domain/spatial-layout";

const EPSILON = 1e-8;

export const shotWallBoxKey = (
  boundaryId: string,
  boxIndex: number,
): string => `${boundaryId}:${boxIndex}`;

const pointOnSegment = (
  point: XzPoint,
  start: XzPoint,
  end: XzPoint,
): boolean => {
  const cross =
    (end[0] - start[0]) * (point[1] - start[1]) -
    (end[1] - start[1]) * (point[0] - start[0]);
  return (
    Math.abs(cross) <= EPSILON &&
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  );
};

const pointInsideFootprint = (
  point: XzPoint,
  footprint: XzPoint[],
): boolean => {
  if (
    footprint.some((start, index) =>
      pointOnSegment(
        point,
        start,
        footprint[(index + 1) % footprint.length],
      ),
    )
  ) {
    return true;
  }

  let inside = false;
  for (
    let index = 0, previous = footprint.length - 1;
    index < footprint.length;
    previous = index, index += 1
  ) {
    const [currentX, currentZ] = footprint[index];
    const [previousX, previousZ] = footprint[previous];
    const crossesZ = (currentZ > point[1]) !== (previousZ > point[1]);
    if (
      crossesZ &&
      point[0] <
        ((previousX - currentX) * (point[1] - currentZ)) /
          (previousZ - currentZ) +
          currentX
    ) {
      inside = !inside;
    }
  }
  return inside;
};

export const isCameraInsideVisibleRegionVolume = (
  layout: SpatialLayout,
  positionM: Vec3,
): boolean =>
  layout.regions.some(
    (region) =>
      region.visible &&
      positionM[1] >= layout.floorY - EPSILON &&
      positionM[1] <=
        layout.floorY + region.heightM + EPSILON &&
      pointInsideFootprint(
        [positionM[0], positionM[2]],
        region.footprintXZ,
      ),
  );

const toWallLocal = (
  vector: Vec3,
  rotationY: number,
): Vec3 => {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return [
    cosine * vector[0] - sine * vector[2],
    vector[1],
    sine * vector[0] + cosine * vector[2],
  ];
};

const rayDistanceToWallBox = (
  origin: Vec3,
  direction: Vec3,
  wall: SpatialWallBox,
): number | null => {
  const localOrigin = toWallLocal(
    [
      origin[0] - wall.position[0],
      origin[1] - wall.position[1],
      origin[2] - wall.position[2],
    ],
    wall.rotationY,
  );
  const localDirection = toWallLocal(direction, wall.rotationY);
  const halfSize: Vec3 = [
    wall.size[0] / 2,
    wall.size[1] / 2,
    wall.size[2] / 2,
  ];
  let entryDistance = Number.NEGATIVE_INFINITY;
  let exitDistance = Number.POSITIVE_INFINITY;

  for (let axis = 0; axis < 3; axis += 1) {
    const axisOrigin = localOrigin[axis];
    const axisDirection = localDirection[axis];
    const halfExtent = halfSize[axis];
    if (Math.abs(axisDirection) <= EPSILON) {
      if (
        axisOrigin < -halfExtent - EPSILON ||
        axisOrigin > halfExtent + EPSILON
      ) {
        return null;
      }
      continue;
    }

    const first = (-halfExtent - axisOrigin) / axisDirection;
    const second = (halfExtent - axisOrigin) / axisDirection;
    entryDistance = Math.max(entryDistance, Math.min(first, second));
    exitDistance = Math.min(exitDistance, Math.max(first, second));
    if (exitDistance < entryDistance - EPSILON) {
      return null;
    }
  }

  if (!Number.isFinite(exitDistance) || exitDistance <= EPSILON) {
    return null;
  }
  const distance =
    entryDistance > EPSILON ? entryDistance : exitDistance;
  return Number.isFinite(distance) ? distance : null;
};

export const deriveHiddenShotWallBoxKey = (
  layout: SpatialLayout | null,
  cameraTransform: TransformSpec | undefined,
): string | null => {
  if (
    layout === null ||
    cameraTransform === undefined ||
    !layout.regions.some((region) => region.visible) ||
    isCameraInsideVisibleRegionVolume(
      layout,
      cameraTransform.positionM,
    )
  ) {
    return null;
  }

  const unnormalizedDirection = rotateVector(
    [0, 0, -1],
    cameraTransform.rotation,
  );
  const magnitude = Math.hypot(...unnormalizedDirection);
  if (!Number.isFinite(magnitude) || magnitude <= EPSILON) {
    return null;
  }
  const direction: Vec3 = [
    unnormalizedDirection[0] / magnitude,
    unnormalizedDirection[1] / magnitude,
    unnormalizedDirection[2] / magnitude,
  ];

  let closestKey: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const boundary of layout.boundaries) {
    const walls = deriveBoundaryWallBoxes(layout, boundary);
    for (const [boxIndex, wall] of walls.entries()) {
      const distance = rayDistanceToWallBox(
        cameraTransform.positionM,
        direction,
        wall,
      );
      if (
        distance !== null &&
        distance < closestDistance - EPSILON
      ) {
        closestDistance = distance;
        closestKey = shotWallBoxKey(boundary.id, boxIndex);
      }
    }
  }
  return closestKey;
};
