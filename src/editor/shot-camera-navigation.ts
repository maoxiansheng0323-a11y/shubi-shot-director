import { actorVisibleRigBounds } from "../domain/actor-visible-bounds";
import {
  addVectors,
  lookAtQuaternion,
  rotateVector,
  transformPoint,
} from "../domain/scene-math";
import {
  type CameraEntity,
  type SceneEntity,
  type SceneSpec,
  type TransformSpec,
  type Vec3,
} from "../domain/scene-schema";

export type ShotNavigationKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "PageUp"
  | "PageDown";

export interface ShotNavigationModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

export const SHOT_KEY_STEP_M = 0.1;
export const SHOT_KEY_FAST_STEP_M = 0.5;
export const SHOT_KEY_FINE_STEP_M = 0.02;
export const SHOT_WHEEL_STEP_MM = 0.5;
export const SHOT_WHEEL_FAST_STEP_MM = 2;
export const SHOT_WHEEL_FINE_STEP_MM = 0.1;
export const SHOT_ORBIT_RADIANS_PER_PIXEL = 0.005;
export const SHOT_ORBIT_MAX_PITCH =
  Math.PI / 2 - Math.PI / 180;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const subtractVectors = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const scaleVector = (vector: Vec3, scalar: number): Vec3 => [
  vector[0] * scalar,
  vector[1] * scalar,
  vector[2] * scalar,
];

const dotVectors = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] +
  left[1] * right[1] +
  left[2] * right[2];

const finiteVector = (vector: Vec3): boolean =>
  vector.every(Number.isFinite);

const propWorldPoints = (
  entity: Extract<SceneEntity, { kind: "prop" }>,
): Vec3[] => {
  const [width, height, depth] = entity.geometry.sizeM;
  const points: Vec3[] = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [-height / 2, height / 2]) {
      for (const z of [-depth / 2, depth / 2]) {
        points.push(transformPoint(entity.transform, [x, y, z]));
      }
    }
  }
  return points;
};

const visibleEntityPoints = (
  scene: SceneSpec,
  entity: SceneEntity,
): Vec3[] => {
  if (!entity.visible || entity.kind === "camera") {
    return [];
  }
  switch (entity.kind) {
    case "actor":
      return actorVisibleRigBounds(scene, entity).worldPoints;
    case "prop":
      return propWorldPoints(entity);
    case "environment":
      return [[...entity.transform.positionM]];
  }
};

const forEachVisibleScenePoint = (
  scene: SceneSpec,
  callback: (point: Vec3) => void,
): void => {
  for (const entity of scene.entities) {
    for (const point of visibleEntityPoints(scene, entity)) {
      callback(point);
    }
  }
  if (!scene.spatialLayout) {
    return;
  }
  for (const region of scene.spatialLayout.regions) {
    if (!region.visible) {
      continue;
    }
    for (const [x, z] of region.footprintXZ) {
      callback([x, scene.spatialLayout.floorY, z]);
      callback([
        x,
        scene.spatialLayout.floorY + region.heightM,
        z,
      ]);
    }
  }
};

export const panShotCamera = (
  camera: CameraEntity,
  distanceM: number,
  deltaPx: readonly [number, number],
  viewportHeightPx: number,
): TransformSpec => {
  const referenceDistanceM =
    Number.isFinite(distanceM) && distanceM > 0
      ? Math.max(0.1, distanceM)
      : 0.1;
  const sensorHeightMm = camera.lens.sensorWidthMm * (9 / 16);
  const verticalFov =
    2 *
    Math.atan(sensorHeightMm / (2 * camera.lens.focalLengthMm));
  const metersPerPixel =
    (2 * referenceDistanceM * Math.tan(verticalFov / 2)) /
    Math.max(1, viewportHeightPx);
  const right = rotateVector(
    [1, 0, 0],
    camera.transform.rotation,
  );
  const up = rotateVector([0, 1, 0], camera.transform.rotation);
  const translation = addVectors(
    scaleVector(right, deltaPx[0] * metersPerPixel),
    scaleVector(up, -deltaPx[1] * metersPerPixel),
  );
  return {
    ...camera.transform,
    positionM: addVectors(
      camera.transform.positionM,
      translation,
    ),
  };
};

export const rotateShotCameraFree = (
  camera: CameraEntity,
  totalDeltaPx: readonly [number, number],
): TransformSpec => {
  const originalForward = rotateVector(
    [0, 0, -1],
    camera.transform.rotation,
  );
  const forwardLength = Math.hypot(...originalForward);
  const forward: Vec3 = originalForward.map(
    (component) => component / forwardLength,
  ) as Vec3;
  const yaw =
    Math.atan2(-forward[0], -forward[2]) -
    totalDeltaPx[0] * SHOT_ORBIT_RADIANS_PER_PIXEL;
  const pitch = clamp(
    Math.asin(clamp(forward[1], -1, 1)) -
      totalDeltaPx[1] * SHOT_ORBIT_RADIANS_PER_PIXEL,
    -SHOT_ORBIT_MAX_PITCH,
    SHOT_ORBIT_MAX_PITCH,
  );
  const horizontal = Math.cos(pitch);
  const nextForward: Vec3 = [
    -Math.sin(yaw) * horizontal,
    Math.sin(pitch),
    -Math.cos(yaw) * horizontal,
  ];
  const positionM: Vec3 = [...camera.transform.positionM];
  return {
    ...camera.transform,
    positionM,
    rotation: lookAtQuaternion(
      positionM,
      addVectors(positionM, nextForward),
    ),
    scale: [...camera.transform.scale],
  };
};

export const orbitShotCamera = (
  camera: CameraEntity,
  targetM: Vec3,
  deltaPx: readonly [number, number],
): TransformSpec => {
  const offset = subtractVectors(
    camera.transform.positionM,
    targetM,
  );
  const radius = Math.max(0.05, Math.hypot(...offset));
  const yaw =
    Math.atan2(offset[0], offset[2]) -
    deltaPx[0] * SHOT_ORBIT_RADIANS_PER_PIXEL;
  const pitch = clamp(
    Math.asin(clamp(offset[1] / radius, -1, 1)) -
      deltaPx[1] * SHOT_ORBIT_RADIANS_PER_PIXEL,
    -SHOT_ORBIT_MAX_PITCH,
    SHOT_ORBIT_MAX_PITCH,
  );
  const horizontalRadius = Math.cos(pitch) * radius;
  const positionM: Vec3 = [
    targetM[0] + Math.sin(yaw) * horizontalRadius,
    targetM[1] + Math.sin(pitch) * radius,
    targetM[2] + Math.cos(yaw) * horizontalRadius,
  ];
  return {
    ...camera.transform,
    positionM,
    rotation: lookAtQuaternion(positionM, targetM),
  };
};

export const moveShotCameraByKey = (
  camera: CameraEntity,
  key: ShotNavigationKey,
  modifiers: ShotNavigationModifiers,
): TransformSpec => {
  const stepM = modifiers.altKey
    ? SHOT_KEY_FINE_STEP_M
    : modifiers.shiftKey
      ? SHOT_KEY_FAST_STEP_M
      : SHOT_KEY_STEP_M;
  const localDirections: Partial<Record<ShotNavigationKey, Vec3>> = {
    ArrowUp: [0, 0, -1],
    ArrowDown: [0, 0, 1],
    ArrowLeft: [-1, 0, 0],
    ArrowRight: [1, 0, 0],
  };
  const direction =
    key === "PageUp"
      ? ([0, 1, 0] as Vec3)
      : key === "PageDown"
        ? ([0, -1, 0] as Vec3)
        : rotateVector(
            localDirections[key] ?? [0, 0, 0],
            camera.transform.rotation,
          );
  return {
    ...camera.transform,
    positionM: addVectors(
      camera.transform.positionM,
      scaleVector(direction, stepM),
    ),
  };
};

export const adjustShotFocalLength = (
  focalLengthMm: number,
  deltaY: number,
  modifiers: ShotNavigationModifiers,
): number => {
  if (deltaY === 0) {
    return focalLengthMm;
  }
  const stepMm = modifiers.altKey
    ? SHOT_WHEEL_FINE_STEP_MM
    : modifiers.shiftKey
      ? SHOT_WHEEL_FAST_STEP_MM
      : SHOT_WHEEL_STEP_MM;
  const next =
    focalLengthMm + (deltaY < 0 ? stepMm : -stepMm);
  return Math.round(clamp(next, 12, 300) * 10) / 10;
};

export const deriveShotPanReferenceDistance = (
  scene: SceneSpec,
  camera: CameraEntity,
  explicitTargetM?: Vec3 | null,
): number => {
  if (explicitTargetM && finiteVector(explicitTargetM)) {
    const explicitDistanceM = Math.hypot(
      ...subtractVectors(camera.transform.positionM, explicitTargetM),
    );
    if (Number.isFinite(explicitDistanceM)) {
      return Math.max(0.1, explicitDistanceM);
    }
  }
  const rawForward = rotateVector(
    [0, 0, -1],
    camera.transform.rotation,
  );
  const forwardLength = Math.hypot(...rawForward);
  if (!Number.isFinite(forwardLength) || forwardLength <= 0) {
    return 5;
  }
  const forward = scaleVector(rawForward, 1 / forwardLength);
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  forEachVisibleScenePoint(scene, (point) => {
    if (!finiteVector(point)) {
      return;
    }
    const depth = dotVectors(
      subtractVectors(point, camera.transform.positionM),
      forward,
    );
    if (!Number.isFinite(depth) || depth <= 0) {
      return;
    }
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  });
  if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth)) {
    return 5;
  }
  const midpointDepth = minDepth / 2 + maxDepth / 2;
  return Number.isFinite(midpointDepth)
    ? Math.max(0.1, midpointDepth)
    : 5;
};
