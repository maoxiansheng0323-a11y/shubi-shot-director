import { actorVisibleRigBounds } from "../domain/actor-visible-bounds";
import { transformPoint } from "../domain/scene-math";
import type {
  SceneSpec,
  Vec3,
} from "../domain/scene-schema";

export interface ShotOrbitTargetOption {
  entityId: string;
  label: string;
  kind: "actor" | "prop";
}

const finiteVector = (vector: Vec3): boolean =>
  vector.every(Number.isFinite);

const boundsCenter = (minimum: Vec3, maximum: Vec3): Vec3 | null => {
  if (!finiteVector(minimum) || !finiteVector(maximum)) {
    return null;
  }
  const center: Vec3 = [
    minimum[0] / 2 + maximum[0] / 2,
    minimum[1] / 2 + maximum[1] / 2,
    minimum[2] / 2 + maximum[2] / 2,
  ];
  return finiteVector(center) ? center : null;
};

const pointsBoundsCenter = (points: readonly Vec3[]): Vec3 | null => {
  if (points.length === 0 || !points.every(finiteVector)) {
    return null;
  }
  return boundsCenter(
    [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.min(...points.map((point) => point[2])),
    ],
    [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[2])),
    ],
  );
};

export const listShotOrbitTargets = (
  scene: SceneSpec,
): ShotOrbitTargetOption[] =>
  scene.entities.flatMap((entity): ShotOrbitTargetOption[] => {
    if (
      !entity.visible ||
      (entity.kind !== "actor" && entity.kind !== "prop")
    ) {
      return [];
    }
    const label =
      typeof entity.label === "string" && entity.label.trim().length > 0
        ? entity.label
        : entity.kind === "actor"
          ? "Actor"
          : "Prop";
    return [{ entityId: entity.id, label, kind: entity.kind }];
  });

export const resolveShotOrbitTargetCenter = (
  scene: SceneSpec,
  entityId: string,
): Vec3 | null => {
  const entity = scene.entities.find(
    (candidate) => candidate.id === entityId,
  );
  if (!entity?.visible) {
    return null;
  }
  if (entity.kind === "actor") {
    try {
      const bounds = actorVisibleRigBounds(scene, entity);
      return boundsCenter(bounds.minWorld, bounds.maxWorld);
    } catch {
      return null;
    }
  }
  if (entity.kind !== "prop") {
    return null;
  }
  const [width, height, depth] = entity.geometry.sizeM;
  const corners: Vec3[] = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [-height / 2, height / 2]) {
      for (const z of [-depth / 2, depth / 2]) {
        corners.push(transformPoint(entity.transform, [x, y, z]));
      }
    }
  }
  return pointsBoundsCenter(corners);
};

export const reconcileShotOrbitTargetId = (
  scene: SceneSpec,
  activeCameraId: string,
  previous: {
    sceneId: string;
    activeCameraId: string;
    entityId: string | null;
  },
): string | null => {
  if (
    scene.sceneId !== previous.sceneId ||
    activeCameraId !== previous.activeCameraId ||
    previous.entityId === null
  ) {
    return null;
  }
  return resolveShotOrbitTargetCenter(scene, previous.entityId)
    ? previous.entityId
    : null;
};
