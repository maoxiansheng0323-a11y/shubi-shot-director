import {
  PerspectiveCamera,
  Vector3,
} from "three";
import {
  actorVisibleFramingPoints,
  actorVisibleRigBounds,
} from "./actor-visible-bounds";
import {
  analyzeComposition,
  type CompositionReport,
} from "./composition-safety";
import {
  lookAtQuaternion,
  rotateVector,
  transformPoint,
} from "./scene-math";
import {
  sceneSpecSchema,
  type CameraEntity,
  type CompositionFramingMode,
  type SceneEntity,
  type SceneSpec,
  type Vec3,
} from "./scene-schema";
import {
  type ShotHardConstraint,
  type ShotIntentPlan,
  type ShotSoftPreference,
  shotIntentPlanSchema,
} from "./shot-intent";

export type CameraSolveErrorCode =
  | "SHOT_CAMERA_NOT_FOUND"
  | "SHOT_CAMERA_TARGET_NOT_FOUND"
  | "SHOT_CAMERA_NO_VALID_CANDIDATE";

export class CameraSolveError extends Error {
  readonly code: CameraSolveErrorCode;

  constructor(code: CameraSolveErrorCode, message: string) {
    super(message);
    this.name = "CameraSolveError";
    this.code = code;
  }
}

export type ShotCandidateProfile = "balanced" | "dramatic-low" | "environmental";

export interface CameraCandidateMetrics {
  framingFill: number;
  targetCenterNdc: [number, number];
  headroomFraction: number | null;
  cameraHeightM: number;
  focalLengthMm: number;
  viewAngleDeg: number;
  softScore: number;
  warningCount: number;
}

export interface SolvedCameraCandidate {
  candidateId: string;
  label: string;
  profile: ShotCandidateProfile;
  scene: SceneSpec;
  composition: CompositionReport;
  metrics: CameraCandidateMetrics;
  score: number;
}

interface Bounds {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  size: Vector3;
  points: Vector3[];
}

const vec = (value: Vec3): Vector3 => new Vector3(...value);
const tuple = (value: Vector3): Vec3 => [value.x, value.y, value.z];

const boxCorners = (half: Vec3): Vec3[] => {
  const points: Vec3[] = [];
  for (const x of [-half[0], half[0]]) {
    for (const y of [-half[1], half[1]]) {
      for (const z of [-half[2], half[2]]) points.push([x, y, z]);
    }
  }
  return points;
};

const framingMode = (plan: ShotIntentPlan): CompositionFramingMode =>
  plan.hardConstraints.find(
    (constraint): constraint is Extract<ShotHardConstraint, { kind: "framing" }> =>
      constraint.kind === "framing",
  )?.mode ??
  (plan.softPreferences.some(
    (preference) => preference.kind === "environment-context" && preference.tendency === "wide",
  )
    ? "full"
    : "medium");

const entityFramingPoints = (
  scene: SceneSpec,
  entity: SceneEntity,
  mode: CompositionFramingMode,
): Vec3[] => {
  if (entity.kind === "actor") {
    const lowerFraction = mode === "close"
      ? 0.72
      : mode === "medium-close"
        ? 0.5
        : mode === "medium"
          ? 0.3
          : 0;
    return actorVisibleFramingPoints(scene, entity, lowerFraction);
  }
  if (entity.kind === "prop") {
    const half = entity.geometry.sizeM.map((value) => value / 2) as Vec3;
    return boxCorners(half).map((point) => transformPoint(entity.transform, point));
  }
  return [entity.transform.positionM];
};

const entityFullBoundsPoints = (
  scene: SceneSpec,
  entity: SceneEntity,
): Vec3[] => {
  if (entity.kind === "actor") {
    const bounds = actorVisibleRigBounds(scene, entity);
    const points: Vec3[] = [];
    for (const x of [bounds.minWorld[0], bounds.maxWorld[0]]) {
      for (const y of [bounds.minWorld[1], bounds.maxWorld[1]]) {
        for (const z of [bounds.minWorld[2], bounds.maxWorld[2]]) points.push([x, y, z]);
      }
    }
    return points;
  }
  return entityFramingPoints(scene, entity, "full");
};

const criticalTargetIds = (plan: ShotIntentPlan): string[] => [...new Set([
  ...plan.primaryTargetIds,
  ...requiredVisibility(plan).map(({ entityId }) => entityId),
  ...plan.hardConstraints.flatMap((constraint) =>
    constraint.kind === "depth-ordering"
      ? [constraint.foregroundEntityId, constraint.backgroundEntityId]
      : [],
  ),
])];

const targetBounds = (scene: SceneSpec, plan: ShotIntentPlan): Bounds => {
  const mode = framingMode(plan);
  const mustFitReservedAreas = plan.hardConstraints.some(
    (constraint) => constraint.kind === "safe-area",
  );
  const targetIds = mustFitReservedAreas ? criticalTargetIds(plan) : plan.primaryTargetIds;
  const entities = targetIds.map((id) => {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) {
      throw new CameraSolveError(
        "SHOT_CAMERA_TARGET_NOT_FOUND",
        "A primary camera target is unavailable.",
      );
    }
    return entity;
  });
  const points = entities
    .flatMap((entity) => mustFitReservedAreas
      ? entityFullBoundsPoints(scene, entity)
      : entityFramingPoints(scene, entity, mode))
    .map(vec);
  const min = new Vector3(
    Math.min(...points.map(({ x }) => x)),
    Math.min(...points.map(({ y }) => y)),
    Math.min(...points.map(({ z }) => z)),
  );
  const max = new Vector3(
    Math.max(...points.map(({ x }) => x)),
    Math.max(...points.map(({ y }) => y)),
    Math.max(...points.map(({ z }) => z)),
  );
  return {
    min,
    max,
    center: min.clone().add(max).multiplyScalar(0.5),
    size: max.clone().sub(min),
    points,
  };
};

const preference = <Kind extends ShotSoftPreference["kind"]>(
  plan: ShotIntentPlan,
  kind: Kind,
): Extract<ShotSoftPreference, { kind: Kind }> | undefined =>
  plan.softPreferences.find(
    (candidate): candidate is Extract<ShotSoftPreference, { kind: Kind }> =>
      candidate.kind === kind,
  );

const requiredVisibility = (plan: ShotIntentPlan) =>
  plan.hardConstraints.filter(
    (constraint): constraint is Extract<ShotHardConstraint, { kind: "visibility" }> =>
      constraint.kind === "visibility",
  );

const applyCompositionIntent = (
  sceneInput: SceneSpec,
  plan: ShotIntentPlan,
): SceneSpec => {
  const scene = structuredClone(sceneInput);
  const framing = plan.hardConstraints.find(
    (constraint): constraint is Extract<ShotHardConstraint, { kind: "framing" }> =>
      constraint.kind === "framing",
  );
  const safeArea = plan.hardConstraints.find(
    (constraint): constraint is Extract<ShotHardConstraint, { kind: "safe-area" }> =>
      constraint.kind === "safe-area",
  );
  const visibility = requiredVisibility(plan);
  const criticalEntityIds = criticalTargetIds(plan);
  scene.compositionGoals = {
    ...(framing
      ? { framing: { mode: framing.mode, targetEntityIds: framing.targetEntityIds } }
      : { framing: { mode: framingMode(plan), targetEntityIds: plan.primaryTargetIds } }),
    ...(safeArea?.captionBottomFraction !== undefined
      ? { captionZone: { bottomFraction: safeArea.captionBottomFraction } }
      : {}),
    ...(safeArea?.sideUi ? { sideUiZone: safeArea.sideUi } : {}),
    criticalEntityIds,
  };
  for (const requirement of visibility) {
    if (requirement.anchor === undefined) continue;
    const value = {
      id: requirement.id,
      type: "keep-visible" as const,
      cameraId: plan.cameraId,
      subjectEntityId: requirement.entityId,
      anchor: requirement.anchor,
      enabled: true,
    };
    const index = scene.constraints.findIndex(({ id }) => id === value.id);
    if (index === -1) scene.constraints.push(value);
    else scene.constraints[index] = value;
  }
  return sceneSpecSchema.parse(scene);
};

const angleSamples = (plan: ShotIntentPlan): number[] => {
  const view = preference(plan, "view-angle");
  const signed = (angle: number): number[] =>
    view?.side === "left"
      ? [-Math.abs(angle)]
      : view?.side === "right"
        ? [Math.abs(angle)]
        : [-Math.abs(angle), Math.abs(angle)];
  if (view?.tendency === "frontal") return [0, ...signed(25)];
  if (view?.tendency === "three-quarter") return [...signed(40), 0];
  if (view?.tendency === "side") return [...signed(78), ...signed(60)].slice(0, 3);
  if (view?.tendency === "rear") return [180, 160, -160];
  return [0, -40, 40];
};

const lensSamples = (plan: ShotIntentPlan, profile: ShotCandidateProfile): number[] => {
  const lens = preference(plan, "lens")?.tendency;
  const base = lens === "mild-wide"
    ? [28, 35]
    : lens === "mild-telephoto"
      ? [65, 80]
      : [40, 50];
  if (profile === "dramatic-low") return [...new Set([28, ...base])];
  if (profile === "environmental") return [24, 32];
  return base;
};

const heightOffsets = (
  plan: ShotIntentPlan,
  profile: ShotCandidateProfile,
  bounds: Bounds,
): number[] => {
  const height = preference(plan, "camera-height")?.tendency;
  const center = bounds.center.y;
  const span = Math.max(bounds.size.y, 0.5);
  const base = height === "low"
    ? [center - span * 0.35, center - span * 0.18]
    : height === "high"
      ? [center + span * 0.25, center + span * 0.45]
      : [center, center + span * 0.12];
  if (profile === "dramatic-low") return [center - span * 0.48, base[0]];
  if (profile === "environmental") return [center + span * 0.08, base[0]];
  return base;
};

const primaryActor = (scene: SceneSpec, plan: ShotIntentPlan) =>
  plan.primaryTargetIds
    .map((id) => scene.entities.find((entity) => entity.id === id))
    .find((entity) => entity?.kind === "actor");

const baseFrontDirection = (scene: SceneSpec, plan: ShotIntentPlan): Vector3 => {
  const actor = primaryActor(scene, plan);
  return actor
    ? vec(rotateVector([0, 0, 1], actor.transform.rotation)).normalize()
    : new Vector3(0, 0, 1);
};

const rotateAroundY = (direction: Vector3, degrees: number): Vector3 =>
  direction.clone().applyAxisAngle(new Vector3(0, 1, 0), degrees * Math.PI / 180).normalize();

const verticalFovRadians = (focalLengthMm: number, sensorWidthMm: number): number => {
  const horizontal = 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm));
  return 2 * Math.atan(Math.tan(horizontal / 2) / (16 / 9));
};

const desiredFill = (
  plan: ShotIntentPlan,
  profile: ShotCandidateProfile,
): number => {
  const mode = framingMode(plan);
  const base = mode === "close"
    ? 0.78
    : mode === "medium-close"
      ? 0.68
      : mode === "medium"
        ? 0.58
        : 0.78;
  return profile === "environmental"
    ? Math.max(0.38, base - 0.22)
    : profile === "dramatic-low"
      ? Math.min(0.86, base + 0.05)
      : base;
};

interface ProjectionMetrics {
  fill: number;
  center: [number, number];
  headroom: number | null;
}

const projectMetrics = (
  scene: SceneSpec,
  cameraEntity: CameraEntity,
  bounds: Bounds,
  plan: ShotIntentPlan,
): ProjectionMetrics => {
  const camera = new PerspectiveCamera();
  camera.aspect = 16 / 9;
  camera.filmGauge = cameraEntity.lens.sensorWidthMm;
  camera.setFocalLength(cameraEntity.lens.focalLengthMm);
  camera.near = cameraEntity.lens.nearM;
  camera.far = cameraEntity.lens.farM;
  camera.position.fromArray(cameraEntity.transform.positionM);
  camera.quaternion.fromArray(cameraEntity.transform.rotation);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const projected = bounds.points.map((point) => point.clone().project(camera));
  const minX = Math.min(...projected.map(({ x }) => x));
  const maxX = Math.max(...projected.map(({ x }) => x));
  const minY = Math.min(...projected.map(({ y }) => y));
  const maxY = Math.max(...projected.map(({ y }) => y));
  let headroom: number | null = null;
  const actor = primaryActor(scene, plan);
  if (actor?.kind === "actor") {
    const boundsActor = actorVisibleRigBounds(scene, actor);
    const head = vec([
      (boundsActor.minWorld[0] + boundsActor.maxWorld[0]) / 2,
      boundsActor.maxWorld[1],
      (boundsActor.minWorld[2] + boundsActor.maxWorld[2]) / 2,
    ]).project(camera);
    headroom = (1 - head.y) / 2;
  }
  return {
    fill: Math.max(maxX - minX, maxY - minY) / 2,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
    headroom,
  };
};

const desiredScreenX = (plan: ShotIntentPlan): number => {
  const placement = preference(plan, "screen-placement");
  if (placement) return placement.horizontal === "left"
    ? -0.34
    : placement.horizontal === "right"
      ? 0.34
      : 0;
  const sideUi = plan.hardConstraints.find(
    (constraint) => constraint.kind === "safe-area" && constraint.sideUi !== undefined,
  );
  return sideUi?.kind === "safe-area" && sideUi.sideUi?.side === "left"
    ? 0.34
    : sideUi?.kind === "safe-area" && sideUi.sideUi?.side === "right"
      ? -0.34
      : 0;
};

const desiredScreenY = (plan: ShotIntentPlan): number => {
  const caption = plan.hardConstraints.find(
    (constraint) =>
      constraint.kind === "safe-area" && constraint.captionBottomFraction !== undefined,
  );
  return caption?.kind === "safe-area" && caption.captionBottomFraction !== undefined
    ? caption.captionBottomFraction * 0.95
    : 0;
};

const desiredHeadroom = (plan: ShotIntentPlan): number => {
  const headroom = preference(plan, "headroom")?.tendency;
  return headroom === "tight" ? 0.06 : headroom === "generous" ? 0.16 : 0.1;
};

const softScore = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  camera: CameraEntity,
  profile: ShotCandidateProfile,
  metrics: ProjectionMetrics,
  angleDeg: number,
): number => {
  let score = 100;
  score -= Math.abs(metrics.fill - desiredFill(plan, profile)) * 90;
  score -= Math.abs(metrics.center[0] - desiredScreenX(plan)) * 32;
  score -= Math.abs(metrics.center[1] - desiredScreenY(plan)) * 28;
  if (metrics.headroom !== null) {
    score -= Math.abs(metrics.headroom - desiredHeadroom(plan)) * 80;
  }
  const view = preference(plan, "view-angle");
  const desiredAngle = view?.tendency === "frontal"
    ? 0
    : view?.tendency === "three-quarter"
      ? 42
      : view?.tendency === "side"
        ? 82
        : view?.tendency === "rear"
          ? 180
          : Math.abs(angleDeg);
  score -= Math.abs(Math.abs(angleDeg) - desiredAngle) * (view?.weight ?? 0.2) * 0.35;
  const face = preference(plan, "face-readability");
  if (face) {
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor" && entity.id === face.actorId,
    );
    if (actor?.kind === "actor") {
      const forward = vec(rotateVector([0, 0, 1], actor.transform.rotation)).normalize();
      const toCamera = vec(camera.transform.positionM)
        .sub(vec(actor.transform.positionM))
        .normalize();
      score -= (1 - Math.max(-1, forward.dot(toCamera))) * face.weight * 14;
    }
  }
  return Math.max(0, score);
};

const hardCompositionFailure = (
  report: CompositionReport,
  plan: ShotIntentPlan,
): boolean => {
  if (report.issues.some(({ severity }) => severity === "error")) return true;
  const captionRequired = plan.hardConstraints.some(
    (constraint) => constraint.kind === "safe-area" && constraint.captionBottomFraction !== undefined,
  );
  const sideUiRequired = plan.hardConstraints.some(
    (constraint) => constraint.kind === "safe-area" && constraint.sideUi !== undefined,
  );
  return report.issues.some(({ code }) =>
    code === "RESERVED_ZONE_TARGET_UNPROJECTABLE" ||
    (captionRequired && code === "SUBJECT_OVERLAPS_CAPTION_ZONE") ||
    (sideUiRequired && code === "SUBJECT_OVERLAPS_SIDE_UI_ZONE"),
  );
};

type Xz = readonly [number, number];

const pointInsidePolygon = ([x, z]: Xz, polygon: readonly Xz[]): boolean => {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const [xi, zi] = polygon[index];
    const [xj, zj] = polygon[prior];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
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
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared,
      ));
  return Math.hypot(
    point[0] - (start[0] + dx * amount),
    point[1] - (start[1] + dz * amount),
  );
};

const satisfiesCameraContainment = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  camera: CameraEntity,
): boolean =>
  plan.hardConstraints.every((constraint) => {
    if (constraint.kind !== "inside-region" || constraint.entityId !== camera.id) return true;
    const region = scene.spatialLayout?.regions.find(({ id }) => id === constraint.regionId);
    if (!region || scene.spatialLayout === null) return false;
    const point: Xz = [camera.transform.positionM[0], camera.transform.positionM[2]];
    return (
      camera.transform.positionM[1] >= scene.spatialLayout.floorY &&
      camera.transform.positionM[1] <= scene.spatialLayout.floorY + region.heightM &&
      pointInsidePolygon(point, region.footprintXZ) &&
      region.footprintXZ.every((start, index) =>
        distanceToSegment(point, start, region.footprintXZ[(index + 1) % region.footprintXZ.length]) >=
          constraint.marginM,
      )
    );
  });

const distanceToAabb = (point: Vector3, min: Vec3, max: Vec3): number => {
  const dx = Math.max(min[0] - point.x, 0, point.x - max[0]);
  const dy = Math.max(min[1] - point.y, 0, point.y - max[1]);
  const dz = Math.max(min[2] - point.z, 0, point.z - max[2]);
  return Math.hypot(dx, dy, dz);
};

const satisfiesCameraClearance = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  camera: CameraEntity,
): boolean => {
  const required = plan.hardConstraints
    .filter((constraint) => constraint.kind === "camera-clearance")
    .reduce((maximum, constraint) => Math.max(maximum, constraint.minimumEntityDistanceM), 0);
  if (required === 0) return true;
  const position = vec(camera.transform.positionM);
  return scene.entities.every((entity) => {
    if (!entity.visible || entity.id === camera.id || entity.kind === "environment") return true;
    if (entity.kind === "actor") {
      const bounds = actorVisibleRigBounds(scene, entity);
      return distanceToAabb(position, bounds.minWorld, bounds.maxWorld) >= required;
    }
    if (entity.kind === "prop") {
      const radius = Math.hypot(
        entity.geometry.sizeM[0] * entity.transform.scale[0],
        entity.geometry.sizeM[1] * entity.transform.scale[1],
        entity.geometry.sizeM[2] * entity.transform.scale[2],
      ) / 2;
      return position.distanceTo(vec(entity.transform.positionM)) - radius >= required;
    }
    return true;
  });
};

const depthM = (camera: CameraEntity, point: Vec3): number => {
  const forward = vec(rotateVector([0, 0, -1], camera.transform.rotation)).normalize();
  return vec(point).sub(vec(camera.transform.positionM)).dot(forward);
};

const depthOrderingPasses = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  camera: CameraEntity,
): boolean =>
  plan.hardConstraints.every((constraint) => {
    if (constraint.kind !== "depth-ordering") return true;
    const foreground = scene.entities.find(({ id }) => id === constraint.foregroundEntityId);
    const background = scene.entities.find(({ id }) => id === constraint.backgroundEntityId);
    if (!foreground || !background) return false;
    return depthM(camera, foreground.transform.positionM) + constraint.minimumDepthSeparationM <=
      depthM(camera, background.transform.positionM);
  });

const profileLabel: Record<ShotCandidateProfile, string> = {
  balanced: "Balanced / safest",
  "dramatic-low": "Lower / more dramatic",
  environmental: "Wider / environmental",
};

const profileCandidates = (
  sceneInput: SceneSpec,
  plan: ShotIntentPlan,
  profile: ShotCandidateProfile,
): SolvedCameraCandidate[] => {
  const scene = applyCompositionIntent(sceneInput, plan);
  const cameraIndex = scene.entities.findIndex(
    (entity) => entity.kind === "camera" && entity.id === plan.cameraId,
  );
  const camera = scene.entities[cameraIndex];
  if (!camera || camera.kind !== "camera") {
    throw new CameraSolveError("SHOT_CAMERA_NOT_FOUND", "The semantic shot camera is unavailable.");
  }
  scene.activeCameraId = camera.id;
  const bounds = targetBounds(scene, plan);
  const front = baseFrontDirection(scene, plan);
  const results: SolvedCameraCandidate[] = [];
  let ordinal = 0;
  for (const angleDeg of angleSamples(plan)) {
    const direction = rotateAroundY(front, angleDeg);
    for (const heightM of heightOffsets(plan, profile, bounds)) {
      for (const focalLengthMm of lensSamples(plan, profile)) {
          const verticalFov = verticalFovRadians(focalLengthMm, camera.lens.sensorWidthMm);
          const horizontalFov = 2 * Math.atan(
            camera.lens.sensorWidthMm / (2 * focalLengthMm),
          );
          const halfHeight = Math.max(bounds.size.y / 2, 0.2);
          const horizontalRadius = Math.max(
            ...bounds.points.map((point) => Math.hypot(
              point.x - bounds.center.x,
              point.z - bounds.center.z,
            )),
            0.2,
          );
          const fill = desiredFill(plan, profile);
          const baseDistance = Math.max(
            halfHeight / Math.max(0.08, Math.tan(verticalFov / 2) * fill),
            horizontalRadius / Math.max(0.08, Math.tan(horizontalFov / 2) * fill),
          );
        for (const distanceScale of [0.94, 1.06]) {
          const candidateScene = structuredClone(scene);
          const candidateCamera = candidateScene.entities[cameraIndex];
          if (candidateCamera.kind !== "camera") continue;
          const distance = Math.max(0.35, baseDistance * distanceScale);
          const position = bounds.center.clone()
            .add(direction.clone().multiplyScalar(distance));
          position.y = heightM;
          const screenOffset = desiredScreenX(plan);
          const opticalTarget = bounds.center.clone();
          const preliminaryForward = opticalTarget.clone().sub(position).normalize();
          const cameraRight = new Vector3().crossVectors(preliminaryForward, new Vector3(0, 1, 0)).normalize();
          opticalTarget.add(cameraRight.multiplyScalar(-screenOffset * distance * 0.32));
          opticalTarget.y -= desiredScreenY(plan) * distance * Math.tan(verticalFov / 2);
          candidateCamera.transform.positionM = tuple(position);
          candidateCamera.transform.rotation = lookAtQuaternion(tuple(position), tuple(opticalTarget));
          candidateCamera.lens.focalLengthMm = focalLengthMm;
          const parsed = sceneSpecSchema.parse(candidateScene);
          const composition = analyzeComposition(parsed);
          if (
            hardCompositionFailure(composition, plan) ||
            !depthOrderingPasses(parsed, plan, candidateCamera) ||
            !satisfiesCameraContainment(parsed, plan, candidateCamera) ||
            !satisfiesCameraClearance(parsed, plan, candidateCamera)
          ) {
            continue;
          }
          const projected = projectMetrics(parsed, candidateCamera, bounds, plan);
          const scored = softScore(parsed, plan, candidateCamera, profile, projected, angleDeg);
          const warningCount = composition.issues.filter(({ severity }) => severity === "warning").length;
          results.push({
            candidateId: `candidate_${profile.replaceAll("-", "_")}_${ordinal++}`,
            label: profileLabel[profile],
            profile,
            scene: parsed,
            composition,
            metrics: {
              framingFill: projected.fill,
              targetCenterNdc: projected.center,
              headroomFraction: projected.headroom,
              cameraHeightM: heightM,
              focalLengthMm,
              viewAngleDeg: angleDeg,
              softScore: scored,
              warningCount,
            },
            score: Math.max(0, scored - warningCount * 2.5),
          });
        }
      }
    }
  }
  return results.sort((left, right) =>
    right.score - left.score || left.candidateId.localeCompare(right.candidateId),
  );
};

const cameraDistance = (left: SolvedCameraCandidate, right: SolvedCameraCandidate): number => {
  const leftCamera = left.scene.entities.find(
    (entity): entity is CameraEntity => entity.kind === "camera" && entity.id === left.scene.activeCameraId,
  );
  const rightCamera = right.scene.entities.find(
    (entity): entity is CameraEntity => entity.kind === "camera" && entity.id === right.scene.activeCameraId,
  );
  if (!leftCamera || !rightCamera) return 0;
  return vec(leftCamera.transform.positionM).distanceTo(vec(rightCamera.transform.positionM)) +
    Math.abs(leftCamera.lens.focalLengthMm - rightCamera.lens.focalLengthMm) / 20;
};

export const solveCameraCandidates = (
  sceneInput: SceneSpec,
  planInput: ShotIntentPlan,
): SolvedCameraCandidate[] => {
  const plan = shotIntentPlanSchema.parse(planInput);
  const profiles: ShotCandidateProfile[] = ["balanced", "dramatic-low", "environmental"];
  const pools = profiles.map((profile) => profileCandidates(sceneInput, plan, profile));
  const selected: SolvedCameraCandidate[] = [];
  for (const pool of pools) {
    const diverse = pool.find((candidate) =>
      selected.every((prior) => cameraDistance(candidate, prior) >= 0.45),
    ) ?? pool[0];
    if (diverse) selected.push(diverse);
    if (selected.length >= plan.candidateCount) break;
  }
  const remaining = pools.flat().filter(
    (candidate) => !selected.some(({ candidateId }) => candidateId === candidate.candidateId),
  );
  for (const candidate of remaining) {
    if (selected.length >= plan.candidateCount) break;
    if (selected.every((prior) => cameraDistance(candidate, prior) >= 0.45)) selected.push(candidate);
  }
  if (selected.length === 0) {
    throw new CameraSolveError(
      "SHOT_CAMERA_NO_VALID_CANDIDATE",
      "No camera candidate satisfies all hard shot constraints.",
    );
  }
  return selected
    .sort((left, right) => right.score - left.score || left.profile.localeCompare(right.profile))
    .map((candidate, index) => ({
      ...candidate,
      candidateId: `candidate_${String.fromCharCode(97 + index)}`,
      score: Math.round(candidate.score * 1000) / 1000,
    }));
};
