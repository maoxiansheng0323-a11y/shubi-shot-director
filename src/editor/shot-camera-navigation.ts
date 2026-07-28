import { actorVisibleRigBounds } from "../domain/actor-visible-bounds";
import { actorAnchorWorldPoint } from "../domain/humanoid-rig";
import {
  addVectors,
  lookAtQuaternion,
  rotateVector,
  transformPoint,
} from "../domain/scene-math";
import type {
  CameraEntity,
  SceneConstraint,
  SceneEntity,
  SceneSpec,
  TransformSpec,
  Vec3,
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

export interface ShotOrbitTarget {
  targetM: Vec3;
  source:
    | "keep-visible-framing"
    | "keep-visible"
    | "framing"
    | "visible-bounds"
    | "camera-forward";
}

type KeepVisibleConstraint = Extract<
  SceneConstraint,
  { type: "keep-visible" }
>;

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

const pointsCenter = (points: readonly Vec3[]): Vec3 | null => {
  const finitePoints = points.filter(finiteVector);
  if (finitePoints.length === 0) {
    return null;
  }
  return [
    (Math.min(...finitePoints.map((point) => point[0])) +
      Math.max(...finitePoints.map((point) => point[0]))) /
      2,
    (Math.min(...finitePoints.map((point) => point[1])) +
      Math.max(...finitePoints.map((point) => point[1]))) /
      2,
    (Math.min(...finitePoints.map((point) => point[2])) +
      Math.max(...finitePoints.map((point) => point[2]))) /
      2,
  ];
};

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

const visibleEntityPoints = (entity: SceneEntity): Vec3[] => {
  if (!entity.visible || entity.kind === "camera") {
    return [];
  }
  switch (entity.kind) {
    case "actor":
      return actorVisibleRigBounds(entity).worldPoints;
    case "prop":
      return propWorldPoints(entity);
    case "environment":
      return [[...entity.transform.positionM]];
  }
};

const visibleEntityCenter = (entity: SceneEntity): Vec3 | null =>
  pointsCenter(visibleEntityPoints(entity));

const visibleSceneBoundsCenter = (scene: SceneSpec): Vec3 | null => {
  const points = scene.entities.flatMap(visibleEntityPoints);
  if (scene.spatialLayout) {
    for (const region of scene.spatialLayout.regions) {
      if (!region.visible) {
        continue;
      }
      for (const [x, z] of region.footprintXZ) {
        points.push(
          [x, scene.spatialLayout.floorY, z],
          [x, scene.spatialLayout.floorY + region.heightM, z],
        );
      }
    }
  }
  return pointsCenter(points);
};

const resolveConstraintTarget = (
  scene: SceneSpec,
  constraint: KeepVisibleConstraint,
): Vec3 | null => {
  const subject = scene.entities.find(
    (entity) =>
      entity.id === constraint.subjectEntityId && entity.visible,
  );
  if (!subject) {
    return null;
  }
  const target =
    subject.kind === "actor"
      ? actorAnchorWorldPoint(subject, constraint.anchor)
      : ([...subject.transform.positionM] as Vec3);
  return finiteVector(target) ? target : null;
};

export const panShotCamera = (
  camera: CameraEntity,
  targetM: Vec3,
  deltaPx: readonly [number, number],
  viewportHeightPx: number,
): TransformSpec => {
  const distanceM = Math.max(
    0.1,
    Math.hypot(
      ...camera.transform.positionM.map(
        (value, axis) => value - targetM[axis],
      ),
    ),
  );
  const sensorHeightMm = camera.lens.sensorWidthMm * (9 / 16);
  const verticalFov =
    2 *
    Math.atan(sensorHeightMm / (2 * camera.lens.focalLengthMm));
  const metersPerPixel =
    (2 * distanceM * Math.tan(verticalFov / 2)) /
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

export const deriveShotOrbitTarget = (
  scene: SceneSpec,
  camera: CameraEntity,
): ShotOrbitTarget => {
  const framingIds =
    scene.compositionGoals?.framing?.targetEntityIds ?? [];
  const constraints = scene.constraints.filter(
    (constraint): constraint is KeepVisibleConstraint =>
      constraint.type === "keep-visible" &&
      constraint.enabled &&
      constraint.cameraId === camera.id,
  );
  for (const entityId of framingIds) {
    const constraint = constraints.find(
      (candidate) => candidate.subjectEntityId === entityId,
    );
    const targetM = constraint
      ? resolveConstraintTarget(scene, constraint)
      : null;
    if (targetM) {
      return { targetM, source: "keep-visible-framing" };
    }
  }
  for (const constraint of constraints) {
    const targetM = resolveConstraintTarget(scene, constraint);
    if (targetM) {
      return { targetM, source: "keep-visible" };
    }
  }
  for (const entityId of framingIds) {
    const entity = scene.entities.find(
      (candidate) =>
        candidate.id === entityId && candidate.visible,
    );
    const targetM = entity ? visibleEntityCenter(entity) : null;
    if (targetM) {
      return { targetM, source: "framing" };
    }
  }
  const boundsCenter = visibleSceneBoundsCenter(scene);
  const forward = rotateVector(
    [0, 0, -1],
    camera.transform.rotation,
  );
  if (boundsCenter) {
    const projectedDistance = dotVectors(
      subtractVectors(
        boundsCenter,
        camera.transform.positionM,
      ),
      forward,
    );
    if (projectedDistance > 0.1) {
      return {
        targetM: addVectors(
          camera.transform.positionM,
          scaleVector(forward, projectedDistance),
        ),
        source: "visible-bounds",
      };
    }
  }
  return {
    targetM: addVectors(
      camera.transform.positionM,
      scaleVector(forward, 5),
    ),
    source: "camera-forward",
  };
};
