import { Vector3 } from "three";
import { actorVisibleRigBounds } from "./actor-visible-bounds";
import { rotateVector } from "./scene-math";
import type { SceneEntity, SceneSpec, Vec3 } from "./scene-schema";
import type { ShotHardConstraint, ShotIntentPlan } from "./shot-intent";

export type ShotHardConstraintCheckStatus = "pass" | "fail";

export interface ShotHardConstraintCheck {
  id: string;
  kind: ShotHardConstraint["kind"];
  status: ShotHardConstraintCheckStatus;
  measured?: number;
  minimum?: number;
  maximum?: number;
  evidence?: string;
}

export interface ShotHardConstraintReport {
  status: ShotHardConstraintCheckStatus;
  checks: ShotHardConstraintCheck[];
}

const EPSILON_M = 0.02;
const FACING_DOT_MINIMUM = Math.cos((15 * Math.PI) / 180);
const DIRECTION_DOT_MINIMUM = 0.5;

type Xz = readonly [number, number];

const entityById = (scene: SceneSpec, id: string): SceneEntity | undefined =>
  scene.entities.find((entity) => entity.id === id);

const dot = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const normalize = (value: Vec3): Vec3 | null => {
  const length = Math.hypot(...value);
  return length <= 1e-9
    ? null
    : [value[0] / length, value[1] / length, value[2] / length];
};

const pointInsidePolygon = ([x, z]: Xz, polygon: readonly Xz[]): boolean => {
  let inside = false;
  for (
    let index = 0, prior = polygon.length - 1;
    index < polygon.length;
    prior = index++
  ) {
    const [xi, zi] = polygon[index];
    const [xj, zj] = polygon[prior];
    if (
      (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const distanceToSegment = (point: Xz, start: Xz, end: Xz): number => {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared === 0
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
            lengthSquared,
        ),
      );
  return Math.hypot(
    point[0] - (start[0] + dx * amount),
    point[1] - (start[1] + dz * amount),
  );
};

const pointHasPolygonMargin = (
  point: Xz,
  polygon: readonly Xz[],
  marginM: number,
): boolean =>
  pointInsidePolygon(point, polygon) &&
  polygon.every(
    (start, index) =>
      distanceToSegment(
        point,
        start,
        polygon[(index + 1) % polygon.length],
      ) >= marginM,
  );

const relationAxis = (
  constraint: Extract<ShotHardConstraint, { kind: "spatial-relationship" }>,
  reference: SceneEntity,
): Vec3 => {
  const local: Vec3 =
    constraint.relation === "left-of"
      ? [-1, 0, 0]
      : constraint.relation === "right-of" || constraint.relation === "beside"
        ? [1, 0, 0]
        : constraint.relation === "above"
          ? [0, 1, 0]
          : constraint.relation === "below"
            ? [0, -1, 0]
            : constraint.relation === "behind"
              ? [0, 0, -1]
              : constraint.relation === "in-front-of"
                ? [0, 0, 1]
                : [1, 0, 0];
  return constraint.axisFrame === "reference"
    ? rotateVector(local, reference.transform.rotation)
    : local;
};

const spatialRelationshipCheck = (
  scene: SceneSpec,
  constraint: Extract<ShotHardConstraint, { kind: "spatial-relationship" }>,
): ShotHardConstraintCheck => {
  const subject = entityById(scene, constraint.subjectId);
  const reference = entityById(scene, constraint.referenceId);
  if (!subject || !reference) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "referenced entity missing",
    };
  }
  const delta = subtract(
    subject.transform.positionM,
    reference.transform.positionM,
  );
  const distance = Math.hypot(...delta);
  const inRange =
    distance + EPSILON_M >= constraint.distance.minM &&
    distance - EPSILON_M <= constraint.distance.maxM;
  if (constraint.relation === "near" || constraint.relation === "separated") {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: inRange ? "pass" : "fail",
      measured: distance,
      minimum: constraint.distance.minM,
      maximum: constraint.distance.maxM,
    };
  }
  const direction = normalize(delta);
  const axis = normalize(relationAxis(constraint, reference));
  if (!direction || !axis) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      measured: distance,
      evidence: "relationship direction is degenerate",
    };
  }
  const alignment = dot(direction, axis);
  const directionPass = constraint.relation === "beside"
    ? Math.abs(alignment) >= DIRECTION_DOT_MINIMUM
    : alignment >= DIRECTION_DOT_MINIMUM;
  return {
    id: constraint.id,
    kind: constraint.kind,
    status: inRange && directionPass ? "pass" : "fail",
    measured: distance,
    minimum: constraint.distance.minM,
    maximum: constraint.distance.maxM,
    evidence: `axisAlignment=${alignment.toFixed(6)}`,
  };
};

const facingCheck = (
  scene: SceneSpec,
  constraint: Extract<ShotHardConstraint, { kind: "facing" }>,
): ShotHardConstraintCheck => {
  const subject = entityById(scene, constraint.subjectId);
  const target = entityById(scene, constraint.targetEntityId);
  if (!subject || !target) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "referenced entity missing",
    };
  }
  const forward = normalize(
    rotateVector([0, 0, 1], subject.transform.rotation),
  );
  const toTarget = normalize(
    subtract(target.transform.positionM, subject.transform.positionM),
  );
  if (!forward || !toTarget) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "facing direction is degenerate",
    };
  }
  const alignment = dot(forward, toTarget);
  return {
    id: constraint.id,
    kind: constraint.kind,
    status: alignment >= FACING_DOT_MINIMUM ? "pass" : "fail",
    measured: alignment,
    minimum: FACING_DOT_MINIMUM,
    evidence: `facingDot=${alignment.toFixed(6)}`,
  };
};

const entityHalfSize = (scene: SceneSpec, entity: SceneEntity): Vec3 => {
  if (entity.kind === "prop") {
    return entity.geometry.sizeM.map(
      (value, index) => (value * entity.transform.scale[index]) / 2,
    ) as Vec3;
  }
  if (entity.kind === "actor") {
    const bounds = actorVisibleRigBounds(scene, entity);
    return [
      (bounds.maxWorld[0] - bounds.minWorld[0]) / 2,
      (bounds.maxWorld[1] - bounds.minWorld[1]) / 2,
      (bounds.maxWorld[2] - bounds.minWorld[2]) / 2,
    ];
  }
  return [0, 0, 0];
};

const surfacePlacementCheck = (
  scene: SceneSpec,
  constraint: Extract<ShotHardConstraint, { kind: "surface-placement" }>,
): ShotHardConstraintCheck => {
  const subject = entityById(scene, constraint.subjectId);
  if (!subject) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "subject entity missing",
    };
  }
  const subjectHalf = entityHalfSize(scene, subject);
  if (constraint.surfaceEntityId === null) {
    const gap = subject.transform.positionM[1] - subjectHalf[1] - constraint.clearanceM;
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: Math.abs(gap) <= EPSILON_M ? "pass" : "fail",
      measured: gap,
      minimum: -EPSILON_M,
      maximum: EPSILON_M,
    };
  }
  const surface = entityById(scene, constraint.surfaceEntityId);
  if (!surface || surface.kind !== "prop") {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "surface prop missing",
    };
  }
  const half = surface.geometry.sizeM.map(
    (value, index) => (value * surface.transform.scale[index]) / 2,
  ) as Vec3;
  const faceAxis: Record<typeof constraint.surfaceFace, Vec3> = {
    top: [0, 1, 0],
    bottom: [0, -1, 0],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    front: [0, 0, -1],
    back: [0, 0, 1],
  };
  const localAxis = faceAxis[constraint.surfaceFace];
  const worldAxis = normalize(
    rotateVector(localAxis, surface.transform.rotation),
  );
  if (!worldAxis) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "surface normal is degenerate",
    };
  }
  const surfaceDistance =
    Math.abs(localAxis[0]) * half[0] +
    Math.abs(localAxis[1]) * half[1] +
    Math.abs(localAxis[2]) * half[2];
  const subjectDistance =
    Math.abs(localAxis[0]) * subjectHalf[0] +
    Math.abs(localAxis[1]) * subjectHalf[1] +
    Math.abs(localAxis[2]) * subjectHalf[2];
  const expected = surfaceDistance + subjectDistance + constraint.clearanceM;
  const measured = dot(
    subtract(subject.transform.positionM, surface.transform.positionM),
    worldAxis,
  );
  return {
    id: constraint.id,
    kind: constraint.kind,
    status: Math.abs(measured - expected) <= EPSILON_M ? "pass" : "fail",
    measured,
    minimum: expected - EPSILON_M,
    maximum: expected + EPSILON_M,
  };
};

const containmentCheck = (
  scene: SceneSpec,
  constraint: Extract<ShotHardConstraint, { kind: "inside-region" }>,
): ShotHardConstraintCheck => {
  const entity = entityById(scene, constraint.entityId);
  const region = scene.spatialLayout?.regions.find(
    (candidate) => candidate.id === constraint.regionId,
  );
  if (!entity || !region || scene.spatialLayout === null) {
    return {
      id: constraint.id,
      kind: constraint.kind,
      status: "fail",
      evidence: "entity or region missing",
    };
  }
  const point: Xz = [
    entity.transform.positionM[0],
    entity.transform.positionM[2],
  ];
  const horizontalPass = pointHasPolygonMargin(
    point,
    region.footprintXZ,
    constraint.marginM,
  );
  const verticalPass =
    entity.transform.positionM[1] >= scene.spatialLayout.floorY - EPSILON_M &&
    entity.transform.positionM[1] <=
      scene.spatialLayout.floorY + region.heightM + EPSILON_M;
  return {
    id: constraint.id,
    kind: constraint.kind,
    status: horizontalPass && verticalPass ? "pass" : "fail",
    evidence: `horizontal=${horizontalPass};vertical=${verticalPass}`,
  };
};

export const analyzeFinalShotHardConstraints = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
): ShotHardConstraintReport => {
  const checks: ShotHardConstraintCheck[] = [];
  for (const constraint of plan.hardConstraints) {
    if (constraint.kind === "spatial-relationship") {
      checks.push(spatialRelationshipCheck(scene, constraint));
    } else if (constraint.kind === "facing") {
      checks.push(facingCheck(scene, constraint));
    } else if (constraint.kind === "surface-placement") {
      checks.push(surfacePlacementCheck(scene, constraint));
    } else if (
      constraint.kind === "inside-region" &&
      constraint.entityId !== plan.cameraId
    ) {
      checks.push(containmentCheck(scene, constraint));
    }
  }
  return {
    status: checks.every(({ status }) => status === "pass") ? "pass" : "fail",
    checks,
  };
};
