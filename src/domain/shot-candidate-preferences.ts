import { PerspectiveCamera, Vector3 } from "three";
import { actorVisibleRigBounds } from "./actor-visible-bounds";
import { rotateVector } from "./scene-math";
import type {
  CameraEntity,
  SceneEntity,
  SceneSpec,
  Vec3,
} from "./scene-schema";
import type { ShotIntentPlan, ShotSoftPreference } from "./shot-intent";
import type { SolvedCameraCandidate } from "./camera-solver";

const vec = (value: Vec3): Vector3 => new Vector3(...value);

const cameraByPlan = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
): CameraEntity | null => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === plan.cameraId,
  );
  return camera ?? null;
};

const projectionCamera = (cameraEntity: CameraEntity): PerspectiveCamera => {
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
  return camera;
};

const entityCenter = (scene: SceneSpec, entity: SceneEntity): Vec3 => {
  if (entity.kind !== "actor") return [...entity.transform.positionM];
  const bounds = actorVisibleRigBounds(scene, entity);
  return [
    (bounds.minWorld[0] + bounds.maxWorld[0]) / 2,
    (bounds.minWorld[1] + bounds.maxWorld[1]) / 2,
    (bounds.minWorld[2] + bounds.maxWorld[2]) / 2,
  ];
};

const entityNdc = (
  scene: SceneSpec,
  camera: PerspectiveCamera,
  entityId: string,
): Vector3 | null => {
  const entity = scene.entities.find(({ id }) => id === entityId);
  if (!entity) return null;
  return vec(entityCenter(scene, entity)).project(camera);
};

const primaryActor = (scene: SceneSpec, plan: ShotIntentPlan) =>
  plan.primaryTargetIds
    .map((id) => scene.entities.find((entity) => entity.id === id))
    .find((entity) => entity?.kind === "actor");

const cameraHeightPenalty = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  cameraEntity: CameraEntity,
  preference: Extract<ShotSoftPreference, { kind: "camera-height" }>,
): number => {
  const actor = primaryActor(scene, plan);
  if (!actor || actor.kind !== "actor") return 0;
  const bounds = actorVisibleRigBounds(scene, actor);
  const height = Math.max(0.5, bounds.maxWorld[1] - bounds.minWorld[1]);
  const target = preference.tendency === "low"
    ? bounds.minWorld[1] + height * 0.28
    : preference.tendency === "high"
      ? bounds.maxWorld[1] + height * 0.12
      : bounds.minWorld[1] + height * 0.82;
  return (
    Math.abs(cameraEntity.transform.positionM[1] - target) /
    height
  ) * preference.weight * 18;
};

const viewAnglePenalty = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  cameraEntity: CameraEntity,
  preference: Extract<ShotSoftPreference, { kind: "view-angle" }>,
): number => {
  const actor = primaryActor(scene, plan);
  if (!actor || actor.kind !== "actor") return 0;
  const forward = vec(rotateVector([0, 0, 1], actor.transform.rotation)).normalize();
  const toCamera = vec(cameraEntity.transform.positionM)
    .sub(vec(actor.transform.positionM))
    .normalize();
  const angle = Math.acos(
    Math.min(1, Math.max(-1, forward.dot(toCamera))),
  ) * (180 / Math.PI);
  const desired = preference.tendency === "frontal"
    ? 0
    : preference.tendency === "three-quarter"
      ? 42
      : preference.tendency === "side"
        ? 82
        : 180;
  let penalty = Math.abs(angle - desired) * preference.weight * 0.2;
  if (preference.side !== "either") {
    const right = vec(rotateVector([1, 0, 0], actor.transform.rotation)).normalize();
    const sideDot = right.dot(toCamera);
    const wrongSide = preference.side === "left" ? sideDot > 0 : sideDot < 0;
    if (wrongSide) penalty += 18 * preference.weight;
  }
  return penalty;
};

const screenPlacementPenalty = (
  scene: SceneSpec,
  camera: PerspectiveCamera,
  preference: Extract<ShotSoftPreference, { kind: "screen-placement" }>,
): number => {
  const projected = entityNdc(scene, camera, preference.entityId);
  if (!projected) return 30 * preference.weight;
  const target = preference.horizontal === "left"
    ? -0.34
    : preference.horizontal === "right"
      ? 0.34
      : 0;
  return Math.abs(projected.x - target) * preference.weight * 30;
};

const lensPenalty = (
  cameraEntity: CameraEntity,
  preference: Extract<ShotSoftPreference, { kind: "lens" }>,
): number => {
  const target = preference.tendency === "mild-wide"
    ? 32
    : preference.tendency === "mild-telephoto"
      ? 72
      : 45;
  return (
    Math.abs(cameraEntity.lens.focalLengthMm - target) /
    target
  ) * preference.weight * 12;
};

const headroomPenalty = (
  scene: SceneSpec,
  plan: ShotIntentPlan,
  camera: PerspectiveCamera,
  preference: Extract<ShotSoftPreference, { kind: "headroom" }>,
): number => {
  const actor = primaryActor(scene, plan);
  if (!actor || actor.kind !== "actor") return 0;
  const bounds = actorVisibleRigBounds(scene, actor);
  const top = vec([
    (bounds.minWorld[0] + bounds.maxWorld[0]) / 2,
    bounds.maxWorld[1],
    (bounds.minWorld[2] + bounds.maxWorld[2]) / 2,
  ]).project(camera);
  const measured = (1 - top.y) / 2;
  const target = preference.tendency === "tight"
    ? 0.06
    : preference.tendency === "generous"
      ? 0.16
      : 0.1;
  return Math.abs(measured - target) * preference.weight * 60;
};

const lookRoomPenalty = (
  scene: SceneSpec,
  camera: PerspectiveCamera,
  preference: Extract<ShotSoftPreference, { kind: "look-room" }>,
): number => {
  const actor = scene.entities.find(
    (entity) => entity.kind === "actor" && entity.id === preference.entityId,
  );
  if (!actor || actor.kind !== "actor") return 30 * preference.weight;
  const centerWorld = vec(entityCenter(scene, actor));
  const center = centerWorld.clone().project(camera);
  const forwardWorld = vec(
    rotateVector([0, 0, 1], actor.transform.rotation),
  ).normalize();
  const forwardPoint = centerWorld
    .clone()
    .add(forwardWorld.multiplyScalar(0.5))
    .project(camera);
  const screenDirection = forwardPoint.x - center.x;
  if (Math.abs(screenDirection) < 0.01) return 0;
  const available = screenDirection > 0
    ? (1 - center.x) / 2
    : (center.x + 1) / 2;
  const target = preference.tendency === "compact"
    ? 0.32
    : preference.tendency === "generous"
      ? 0.68
      : 0.5;
  return Math.abs(available - target) * preference.weight * 30;
};

const environmentPenalty = (
  candidate: SolvedCameraCandidate,
  preference: Extract<ShotSoftPreference, { kind: "environment-context" }>,
): number => {
  const target = preference.tendency === "minimal"
    ? 0.72
    : preference.tendency === "wide"
      ? 0.42
      : 0.58;
  return (
    Math.abs(candidate.metrics.framingFill - target) *
    preference.weight *
    35
  );
};

const faceReadabilityPenalty = (
  scene: SceneSpec,
  cameraEntity: CameraEntity,
  preference: Extract<ShotSoftPreference, { kind: "face-readability" }>,
): number => {
  const actor = scene.entities.find(
    (entity) => entity.kind === "actor" && entity.id === preference.actorId,
  );
  if (!actor || actor.kind !== "actor") return 30 * preference.weight;
  const forward = vec(rotateVector([0, 0, 1], actor.transform.rotation)).normalize();
  const toCamera = vec(cameraEntity.transform.positionM)
    .sub(vec(actor.transform.positionM))
    .normalize();
  return (1 - Math.max(-1, forward.dot(toCamera))) * preference.weight * 14;
};

export const semanticPreferencePenalty = (
  candidate: SolvedCameraCandidate,
  plan: ShotIntentPlan,
): number => {
  const scene = candidate.scene;
  const cameraEntity = cameraByPlan(scene, plan);
  if (!cameraEntity) return Number.POSITIVE_INFINITY;
  const camera = projectionCamera(cameraEntity);
  let penalty = 0;
  for (const preference of plan.softPreferences) {
    if (preference.kind === "camera-height") {
      penalty += cameraHeightPenalty(scene, plan, cameraEntity, preference);
    } else if (preference.kind === "view-angle") {
      penalty += viewAnglePenalty(scene, plan, cameraEntity, preference);
    } else if (preference.kind === "screen-placement") {
      penalty += screenPlacementPenalty(scene, camera, preference);
    } else if (preference.kind === "lens") {
      penalty += lensPenalty(cameraEntity, preference);
    } else if (preference.kind === "headroom") {
      penalty += headroomPenalty(scene, plan, camera, preference);
    } else if (preference.kind === "look-room") {
      penalty += lookRoomPenalty(scene, camera, preference);
    } else if (preference.kind === "environment-context") {
      penalty += environmentPenalty(candidate, preference);
    } else if (preference.kind === "face-readability") {
      penalty += faceReadabilityPenalty(scene, cameraEntity, preference);
    }
  }
  return Math.round(penalty * 1000) / 1000;
};

export const rankSemanticShotCandidates = (
  candidates: readonly SolvedCameraCandidate[],
  plan: ShotIntentPlan,
): SolvedCameraCandidate[] =>
  candidates
    .map((candidate) => {
      const penalty = semanticPreferencePenalty(candidate, plan);
      return {
        ...candidate,
        score: Math.round(Math.max(0, candidate.score - penalty) * 1000) / 1000,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.profile.localeCompare(right.profile),
    )
    .map((candidate, index) => ({
      ...candidate,
      candidateId: `candidate_${String.fromCharCode(97 + index)}`,
    }));
