import { Vector3 } from "three";
import { actorVisibleRigBounds } from "./actor-visible-bounds";
import { lookAtQuaternion, rotateVector } from "./scene-math";
import {
  sceneSpecSchema,
  type SceneEntity,
  type SceneSpec,
  type Vec3,
} from "./scene-schema";
import {
  type ShotHardConstraint,
  type ShotIntentPlan,
  shotIntentPlanSchema,
} from "./shot-intent";
import { materializeStaticBlockingPlans } from "./static-blocking";

export type SceneRelationshipErrorCode =
  | "SHOT_INTENT_ENTITY_NOT_FOUND"
  | "SHOT_INTENT_REGION_NOT_FOUND"
  | "SHOT_CONSTRAINT_CONTRADICTION"
  | "SHOT_RELATIONSHIP_UNSOLVABLE";

export class SceneRelationshipError extends Error {
  readonly code: SceneRelationshipErrorCode;

  constructor(code: SceneRelationshipErrorCode, message: string) {
    super(message);
    this.name = "SceneRelationshipError";
    this.code = code;
  }
}

const entityById = (scene: SceneSpec, id: string): SceneEntity => {
  const entity = scene.entities.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new SceneRelationshipError(
      "SHOT_INTENT_ENTITY_NOT_FOUND",
      "A shot relationship references an unavailable entity.",
    );
  }
  return entity;
};

const midpoint = (min: number, max: number): number => (min + max) / 2;

type Xz = readonly [number, number];

const pointInsidePolygon = ([x, z]: Xz, polygon: readonly Xz[]): boolean => {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
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
    : Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
          lengthSquared,
      ));
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
  polygon.every((start, index) =>
    distanceToSegment(point, start, polygon[(index + 1) % polygon.length]) >= marginM,
  );

const relationAxis = (
  relation: Extract<ShotHardConstraint, { kind: "spatial-relationship" }>,
  reference: SceneEntity,
): Vec3 => {
  const local: Vec3 =
    relation.relation === "left-of"
      ? [-1, 0, 0]
      : relation.relation === "right-of" || relation.relation === "beside"
        ? [1, 0, 0]
        : relation.relation === "above"
          ? [0, 1, 0]
          : relation.relation === "below"
            ? [0, -1, 0]
            : relation.relation === "behind"
              ? [0, 0, -1]
              : relation.relation === "in-front-of"
                ? [0, 0, 1]
                : [1, 0, 0];
  return relation.axisFrame === "reference"
    ? rotateVector(local, reference.transform.rotation)
    : local;
};

const setAtDistance = (
  subject: SceneEntity,
  reference: SceneEntity,
  axis: Vec3,
  distanceM: number,
): void => {
  const direction = new Vector3(...axis).normalize();
  subject.transform.positionM = [
    reference.transform.positionM[0] + direction.x * distanceM,
    reference.transform.positionM[1] + direction.y * distanceM,
    reference.transform.positionM[2] + direction.z * distanceM,
  ];
};

const normalizedPair = (left: string, right: string): string =>
  left < right ? `${left}|${right}` : `${right}|${left}`;

const inverseRelations = new Map<string, string>([
  ["left-of", "right-of"],
  ["right-of", "left-of"],
  ["in-front-of", "behind"],
  ["behind", "in-front-of"],
  ["above", "below"],
  ["below", "above"],
]);

const assertNoContradictoryRelationships = (plan: ShotIntentPlan): void => {
  const byDirectedPair = new Map<string, string>();
  const byUndirectedPair = new Map<string, ShotHardConstraint[]>();
  for (const constraint of plan.hardConstraints) {
    if (constraint.kind !== "spatial-relationship") continue;
    const directedKey = `${constraint.subjectId}|${constraint.referenceId}`;
    const prior = byDirectedPair.get(directedKey);
    if (
      prior !== undefined &&
      prior !== constraint.relation &&
      constraint.relation !== "near" &&
      constraint.relation !== "separated"
    ) {
      throw new SceneRelationshipError(
        "SHOT_CONSTRAINT_CONTRADICTION",
        "Two hard spatial relationships demand incompatible directions.",
      );
    }
    byDirectedPair.set(directedKey, constraint.relation);
    const pair = normalizedPair(constraint.subjectId, constraint.referenceId);
    const entries = byUndirectedPair.get(pair) ?? [];
    entries.push(constraint);
    byUndirectedPair.set(pair, entries);
  }
  for (const entries of byUndirectedPair.values()) {
    for (const left of entries) {
      if (left.kind !== "spatial-relationship") continue;
      for (const right of entries) {
        if (
          right.kind !== "spatial-relationship" ||
          left.subjectId !== right.referenceId ||
          left.referenceId !== right.subjectId
        ) continue;
        const expected = inverseRelations.get(left.relation);
        if (expected !== undefined && right.relation !== expected) {
          throw new SceneRelationshipError(
            "SHOT_CONSTRAINT_CONTRADICTION",
            "Opposing hard relationships are not semantic inverses.",
          );
        }
      }
    }
  }
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

const solveSurfacePlacement = (
  scene: SceneSpec,
  constraint: Extract<ShotHardConstraint, { kind: "surface-placement" }>,
): void => {
  const subject = entityById(scene, constraint.subjectId);
  const subjectHalf = entityHalfSize(scene, subject);
  if (constraint.surfaceEntityId === null) {
    subject.transform.positionM[1] = subjectHalf[1] + constraint.clearanceM;
    return;
  }
  const surface = entityById(scene, constraint.surfaceEntityId);
  if (surface.kind !== "prop") {
    throw new SceneRelationshipError(
      "SHOT_RELATIONSHIP_UNSOLVABLE",
      "Surface placement currently requires world ground or a primitive prop.",
    );
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
  const worldAxis = rotateVector(localAxis, surface.transform.rotation);
  const surfaceDistance = Math.abs(localAxis[0]) * half[0] +
    Math.abs(localAxis[1]) * half[1] + Math.abs(localAxis[2]) * half[2];
  const subjectDistance = Math.abs(localAxis[0]) * subjectHalf[0] +
    Math.abs(localAxis[1]) * subjectHalf[1] + Math.abs(localAxis[2]) * subjectHalf[2];
  const distance = surfaceDistance + subjectDistance + constraint.clearanceM;
  subject.transform.positionM = [
    surface.transform.positionM[0] + worldAxis[0] * distance,
    surface.transform.positionM[1] + worldAxis[1] * distance,
    surface.transform.positionM[2] + worldAxis[2] * distance,
  ];
};

const solveContainment = (
  scene: SceneSpec,
  constraint: Extract<ShotHardConstraint, { kind: "inside-region" }>,
): void => {
  const entity = entityById(scene, constraint.entityId);
  const region = scene.spatialLayout?.regions.find(
    (candidate) => candidate.id === constraint.regionId,
  );
  if (!region || scene.spatialLayout === null) {
    throw new SceneRelationshipError(
      "SHOT_INTENT_REGION_NOT_FOUND",
      "A shot containment constraint references an unavailable region.",
    );
  }
  const margin = constraint.marginM;
  const minX = Math.min(...region.footprintXZ.map(([x]) => x));
  const maxX = Math.max(...region.footprintXZ.map(([x]) => x));
  const minZ = Math.min(...region.footprintXZ.map(([, z]) => z));
  const maxZ = Math.max(...region.footprintXZ.map(([, z]) => z));
  const samples: Xz[] = [[midpoint(minX, maxX), midpoint(minZ, maxZ)]];
  for (let zIndex = 1; zIndex < 16; zIndex += 1) {
    for (let xIndex = 1; xIndex < 16; xIndex += 1) {
      samples.push([
        minX + ((maxX - minX) * xIndex) / 16,
        minZ + ((maxZ - minZ) * zIndex) / 16,
      ]);
    }
  }
  const accepted = samples.find((point) =>
    pointHasPolygonMargin(point, region.footprintXZ, margin),
  );
  if (!accepted) {
    throw new SceneRelationshipError(
      "SHOT_RELATIONSHIP_UNSOLVABLE",
      "The requested region is too small for its containment margin.",
    );
  }
  entity.transform.positionM[0] = accepted[0];
  entity.transform.positionM[2] = accepted[1];
};

export interface SceneRelationshipSolveResult {
  scene: SceneSpec;
  appliedConstraintIds: string[];
}

export const solveSceneRelationships = (
  sceneInput: SceneSpec,
  planInput: ShotIntentPlan,
): SceneRelationshipSolveResult => {
  const plan = shotIntentPlanSchema.parse(planInput);
  assertNoContradictoryRelationships(plan);
  let scene = structuredClone(sceneSpecSchema.parse(sceneInput));
  const appliedConstraintIds: string[] = [];

  for (const constraint of plan.hardConstraints) {
    if (constraint.kind === "spatial-relationship") {
      const subject = entityById(scene, constraint.subjectId);
      const reference = entityById(scene, constraint.referenceId);
      const distanceM = midpoint(constraint.distance.minM, constraint.distance.maxM);
      setAtDistance(subject, reference, relationAxis(constraint, reference), distanceM);
      appliedConstraintIds.push(constraint.id);
    } else if (constraint.kind === "facing") {
      const subject = entityById(scene, constraint.subjectId);
      const target = entityById(scene, constraint.targetEntityId);
      const oppositeTarget: Vec3 = [
        subject.transform.positionM[0] * 2 - target.transform.positionM[0],
        subject.transform.positionM[1] * 2 - target.transform.positionM[1],
        subject.transform.positionM[2] * 2 - target.transform.positionM[2],
      ];
      const rotation = lookAtQuaternion(
        subject.transform.positionM,
        oppositeTarget,
      );
      subject.transform.rotation = rotation;
      appliedConstraintIds.push(constraint.id);
    } else if (constraint.kind === "surface-placement") {
      solveSurfacePlacement(scene, constraint);
      appliedConstraintIds.push(constraint.id);
    } else if (constraint.kind === "inside-region") {
      solveContainment(scene, constraint);
      appliedConstraintIds.push(constraint.id);
    }
  }

  scene = sceneSpecSchema.parse(scene);
  const blockingPlans = plan.hardConstraints
    .filter((constraint) => constraint.kind === "actor-blocking")
    .map(({ id, plan: blockingPlan }) => {
      appliedConstraintIds.push(id);
      return blockingPlan;
    });
  if (blockingPlans.length > 0) {
    scene = materializeStaticBlockingPlans(scene, blockingPlans);
  }
  return { scene, appliedConstraintIds };
};
