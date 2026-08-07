import { actorVisibleRigBounds } from "../domain/actor-visible-bounds";
import {
  multiplyQuaternions,
  rotateVector,
  transformPoint,
} from "../domain/scene-math";
import { Quaternion, Vector3 } from "three";
import type {
  QuaternionTuple,
  SceneSpec,
  TransformSpec,
  Vec3,
} from "../domain/scene-schema";
import type { CanonicalPuppetJointId } from "../domain/actor-joints";

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

export interface StudioPointerRay {
  originM: Vec3;
  directionM: Vec3;
}

export interface DirectEntityDragEligibility {
  view: "editor" | "shot";
  button: number;
  toolMode: "select" | "translate" | "rotate";
  lockMode: "none" | "workflow" | "user";
  entityKind: "environment" | "actor" | "prop" | "camera";
  focused?: boolean;
}

export type DirectEntityDragMode = "translate" | "rotate";

export const directEntityDragMode = ({
  view,
  button,
  toolMode,
  lockMode,
  entityKind,
  focused = false,
}: DirectEntityDragEligibility): DirectEntityDragMode | null => {
  const eligible =
    view === "editor" &&
    button === 0 &&
    toolMode === "select" &&
    lockMode !== "user" &&
    entityKind !== "environment";
  if (!eligible) return null;
  return entityKind === "camera" && focused ? "rotate" : "translate";
};

export const canBeginDirectEntityDrag = (
  eligibility: DirectEntityDragEligibility,
): boolean => directEntityDragMode(eligibility) !== null;

export const shouldCommitDirectEntityDrag = (moved: boolean): boolean =>
  moved;

export interface StudioTransformControlsVisibility {
  selected: boolean;
  view: "editor" | "shot";
  lockMode: "none" | "workflow" | "user";
  toolMode: "select" | "translate" | "rotate";
}

export const shouldShowStudioTransformControls = ({
  selected,
  view,
  lockMode,
  toolMode,
}: StudioTransformControlsVisibility): boolean =>
  selected &&
  view === "editor" &&
  lockMode !== "user" &&
  toolMode !== "select";

export interface GroundDragCapture {
  floorY: number;
  offsetM: Vec3;
}

export interface MovementKeyModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface StudioJointDragCapture {
  jointId: CanonicalPuppetJointId;
  startPointerPx: readonly [number, number];
  pivotPointerPx: readonly [number, number];
  startRotation: QuaternionTuple;
  axes: StudioRotationDragAxes;
}

export interface StudioEntityRotationDragCapture {
  startPointerPx: readonly [number, number];
  startRotation: QuaternionTuple;
  axes: StudioRotationDragAxes;
}

export interface StudioRotationDragAxes {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
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

export const intersectGroundPlane = (
  ray: StudioPointerRay,
  floorY: number,
): Vec3 | null => {
  const denominator = ray.directionM[1];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const distance = (floorY - ray.originM[1]) / denominator;
  if (!Number.isFinite(distance) || distance < 0) return null;
  return [
    ray.originM[0] + ray.directionM[0] * distance,
    floorY,
    ray.originM[2] + ray.directionM[2] * distance,
  ];
};

export const beginGroundDrag = (
  entityPositionM: Vec3,
  pointerRay: StudioPointerRay,
  floorY: number,
): GroundDragCapture | null => {
  const hit = intersectGroundPlane(pointerRay, floorY);
  if (!hit) return null;
  return {
    floorY,
    offsetM: [
      entityPositionM[0] - hit[0],
      entityPositionM[1] - floorY,
      entityPositionM[2] - hit[2],
    ],
  };
};

export const updateGroundDrag = (
  capture: GroundDragCapture,
  pointerRay: StudioPointerRay,
): Vec3 | null => {
  const hit = intersectGroundPlane(pointerRay, capture.floorY);
  if (!hit) return null;
  return [
    hit[0] + capture.offsetM[0],
    capture.floorY + capture.offsetM[1],
    hit[2] + capture.offsetM[2],
  ];
};

export const moveEntityByEditorKey = (
  transform: TransformSpec,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "PageUp" | "PageDown",
  viewDirection: Vec3,
  modifiers: MovementKeyModifiers,
): TransformSpec => {
  const step = modifiers.altKey ? 0.02 : modifiers.shiftKey ? 0.5 : 0.1;
  const axes = editorGroundAxes(viewDirection);
  const delta: Vec3 = [0, 0, 0];
  if (key === "ArrowUp") {
    delta[0] = axes.forward[0] * step;
    delta[2] = axes.forward[2] * step;
  } else if (key === "ArrowDown") {
    delta[0] = -axes.forward[0] * step;
    delta[2] = -axes.forward[2] * step;
  } else if (key === "ArrowLeft") {
    delta[0] = -axes.right[0] * step;
    delta[2] = -axes.right[2] * step;
  } else if (key === "ArrowRight") {
    delta[0] = axes.right[0] * step;
    delta[2] = axes.right[2] * step;
  } else if (key === "PageUp") {
    delta[1] = step;
  } else if (key === "PageDown") {
    delta[1] = -step;
  }
  return {
    ...transform,
    positionM: [
      transform.positionM[0] + delta[0],
      transform.positionM[1] + delta[1],
      transform.positionM[2] + delta[2],
    ],
  };
};

export const beginJointDrag = (
  jointId: CanonicalPuppetJointId,
  startRotation: QuaternionTuple,
  pointerPx: readonly [number, number],
  axes: StudioRotationDragAxes,
  pivotPointerPx: readonly [number, number],
): StudioJointDragCapture => ({
  jointId,
  startPointerPx: pointerPx,
  pivotPointerPx,
  startRotation,
  axes,
});

export const beginEntityRotationDrag = (
  startRotation: QuaternionTuple,
  pointerPx: readonly [number, number],
  axes: StudioRotationDragAxes,
): StudioEntityRotationDragCapture => ({
  startPointerPx: pointerPx,
  startRotation,
  axes,
});

export const rotationDragAxesInLocalSpace = (
  axes: StudioRotationDragAxes,
  parentWorldRotation: QuaternionTuple,
): StudioRotationDragAxes => {
  const inverseParent: QuaternionTuple = [
    -parentWorldRotation[0],
    -parentWorldRotation[1],
    -parentWorldRotation[2],
    parentWorldRotation[3],
  ];
  return {
    right: normalized(rotateVector(axes.right, inverseParent)),
    up: normalized(rotateVector(axes.up, inverseParent)),
    forward: normalized(rotateVector(axes.forward, inverseParent)),
  };
};

const quaternionFromAxisDegrees = (
  axis: Vec3,
  degrees: number,
): QuaternionTuple => {
  const normalizedAxis = normalized(axis);
  const rotation = new Quaternion().setFromAxisAngle(
    new Vector3(...normalizedAxis),
    (degrees * Math.PI) / 180,
  );
  return [rotation.x, rotation.y, rotation.z, rotation.w];
};

const updateScreenRelativeRotationDrag = (
  capture: StudioEntityRotationDragCapture | StudioJointDragCapture,
  pointerPx: readonly [number, number],
  direction: 1 | -1,
): QuaternionTuple => {
  const deltaX = pointerPx[0] - capture.startPointerPx[0];
  const deltaY = pointerPx[1] - capture.startPointerPx[1];
  const horizontal = quaternionFromAxisDegrees(
    capture.axes.up,
    deltaX * 0.55 * direction,
  );
  const vertical = quaternionFromAxisDegrees(
    capture.axes.right,
    deltaY * 0.55 * direction,
  );
  return multiplyQuaternions(
    multiplyQuaternions(horizontal, vertical),
    capture.startRotation,
  );
};

export const updateEntityRotationDrag = (
  capture: StudioEntityRotationDragCapture,
  pointerPx: readonly [number, number],
): QuaternionTuple =>
  updateScreenRelativeRotationDrag(capture, pointerPx, -1);

export const updateJointDrag = (
  capture: StudioJointDragCapture,
  pointerPx: readonly [number, number],
): QuaternionTuple => {
  const startX = capture.startPointerPx[0] - capture.pivotPointerPx[0];
  const startY = capture.startPointerPx[1] - capture.pivotPointerPx[1];
  const currentX = pointerPx[0] - capture.pivotPointerPx[0];
  const currentY = pointerPx[1] - capture.pivotPointerPx[1];
  const startLength = Math.hypot(startX, startY);
  const currentLength = Math.hypot(currentX, currentY);
  if (startLength < 1e-4 || currentLength < 1e-4) {
    return capture.startRotation;
  }
  const signedAngleDegrees =
    (Math.atan2(
      startX * currentY - startY * currentX,
      startX * currentX + startY * currentY,
    ) *
      180) /
    Math.PI;
  return multiplyQuaternions(
    quaternionFromAxisDegrees(capture.axes.forward, signedAngleDegrees),
    capture.startRotation,
  );
};
