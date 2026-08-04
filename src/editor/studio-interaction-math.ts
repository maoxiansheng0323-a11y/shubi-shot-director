import { actorVisibleRigBounds } from "../domain/actor-visible-bounds";
import { transformPoint } from "../domain/scene-math";
import type { SceneSpec, TransformSpec, Vec3 } from "../domain/scene-schema";

export interface EntityWorldBound {
  centerM: Vec3;
  radiusM: number;
}

export interface EditorCameraFrame {
  positionM: Vec3;
  targetM: Vec3;
}

export interface EditorGroundAxes {
  forward: Vec3;
  right: Vec3;
}

const vectorLength = (value: Vec3): number =>
  Math.hypot(value[0], value[1], value[2]);

const normalized = (value: Vec3): Vec3 => {
  const length = vectorLength(value);
  if (!Number.isFinite(length) || length < 1e-8) return [0, 0, -1];
  return [value[0] / length, value[1] / length, value[2] / length];
};

const pointsBounds = (points: readonly Vec3[]): EntityWorldBound | null => {
  if (points.length === 0 || points.some((point) => point.some((value) => !Number.isFinite(value)))) {
    return null;
  }
  const min: Vec3 = [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.min(...points.map((point) => point[2])),
  ];
  const max: Vec3 = [
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[2])),
  ];
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  return {
    centerM: center,
    radiusM: Math.max(
      0.01,
      Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]),
    ),
  };
};

const propBounds = (
  transform: TransformSpec,
  sizeM: Vec3,
): EntityWorldBound | null => {
  const half: Vec3 = [sizeM[0] / 2, sizeM[1] / 2, sizeM[2] / 2];
  const points: Vec3[] = [];
  for (const x of [-half[0], half[0]]) {
    for (const y of [-half[1], half[1]]) {
      for (const z of [-half[2], half[2]]) {
        points.push(transformPoint(transform, [x, y, z]));
      }
    }
  }
  return pointsBounds(points);
};

const cameraProxyBounds = (transform: TransformSpec): EntityWorldBound | null =>
  propBounds(transform, [0.45, 0.3, 0.65]);

export const resolveEntityWorldBound = (
  scene: SceneSpec,
  entityId: string,
  transformOverrides?: Readonly<Record<string, TransformSpec | undefined>>,
): EntityWorldBound | null => {
  const entity = scene.entities.find((candidate) => candidate.id === entityId);
  if (!entity || !entity.visible) return null;
  const transform = transformOverrides?.[entity.id] ?? entity.transform;
  if (entity.kind === "actor") {
    const bounds = actorVisibleRigBounds(scene, entity, transform);
    return pointsBounds(bounds.worldPoints);
  }
  if (entity.kind === "prop") return propBounds(transform, entity.geometry.sizeM);
  if (entity.kind === "camera") return cameraProxyBounds(transform);
  return null;
};

export const frameSelectedBound = (
  bound: EntityWorldBound,
  viewDirection: Vec3,
  verticalFovDeg: number,
  aspect: number,
  options: { fitFraction?: number; minimumDistanceM?: number } = {},
): EditorCameraFrame | null => {
  if (
    !Number.isFinite(verticalFovDeg) ||
    verticalFovDeg <= 0 ||
    verticalFovDeg >= 179 ||
    !Number.isFinite(aspect) ||
    aspect <= 0
  ) {
    return null;
  }
  const direction = normalized(viewDirection);
  const fitFraction = options.fitFraction ?? 0.72;
  const minimumDistanceM = options.minimumDistanceM ?? 0.5;
  if (
    !Number.isFinite(fitFraction) ||
    fitFraction <= 0 ||
    fitFraction >= 1 ||
    !Number.isFinite(minimumDistanceM) ||
    minimumDistanceM <= 0
  ) {
    return null;
  }
  const verticalHalfFov = (verticalFovDeg * Math.PI) / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const distance = Math.max(
    minimumDistanceM,
    bound.radiusM / (Math.tan(verticalHalfFov) * fitFraction),
    bound.radiusM / (Math.tan(horizontalHalfFov) * fitFraction),
  );
  return {
    targetM: [...bound.centerM],
    positionM: [
      bound.centerM[0] - direction[0] * distance,
      bound.centerM[1] - direction[1] * distance,
      bound.centerM[2] - direction[2] * distance,
    ],
  };
};

export const followFocusedCenter = (
  frame: EditorCameraFrame,
  previousCenterM: Vec3,
  nextCenterM: Vec3,
): EditorCameraFrame => {
  const delta: Vec3 = [
    nextCenterM[0] - previousCenterM[0],
    nextCenterM[1] - previousCenterM[1],
    nextCenterM[2] - previousCenterM[2],
  ];
  return {
    positionM: [
      frame.positionM[0] + delta[0],
      frame.positionM[1] + delta[1],
      frame.positionM[2] + delta[2],
    ],
    targetM: [
      frame.targetM[0] + delta[0],
      frame.targetM[1] + delta[1],
      frame.targetM[2] + delta[2],
    ],
  };
};

export const editorGroundAxes = (viewDirection: Vec3): EditorGroundAxes => {
  const forward = normalized([viewDirection[0], 0, viewDirection[2]]);
  const right = normalized([-forward[2], 0, forward[0]]);
  return { forward, right };
};
