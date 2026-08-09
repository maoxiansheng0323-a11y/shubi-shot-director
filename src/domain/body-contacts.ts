import {
  actorVisiblePrimitivePointClouds,
  type ActorVisiblePrimitivePointCloud,
} from "./actor-visible-bounds";
import { resolveActorProjection } from "./actor-projection";
import {
  mutationBlockedByLock,
  type EntityLockErrorCode,
} from "./entity-lock";
import {
  addVectors,
  rotateVector,
  transformNormal,
  transformPoint,
} from "./scene-math";
import {
  sceneSpecSchema,
  type AnyActorEntity,
  type SceneEntity,
  type SceneSpec,
  type Vec3,
} from "./scene-schema";
import type {
  ActorBodySite,
  ContactSurfaceFace,
} from "./static-blocking-schema";

export type BodyContactErrorCode =
  | "BODY_CONTACT_ACTOR_NOT_FOUND"
  | "BODY_CONTACT_SITE_UNAVAILABLE"
  | "BODY_CONTACT_SURFACE_NOT_FOUND"
  | "BODY_CONTACT_SURFACE_UNSUPPORTED"
  | EntityLockErrorCode;

export class BodyContactError extends Error {
  readonly code: BodyContactErrorCode;

  constructor(code: BodyContactErrorCode, message: string) {
    super(message);
    this.name = "BodyContactError";
    this.code = code;
  }
}

export interface ResolvedContactSurface {
  readonly surfaceEntityId: string | null;
  readonly face: ContactSurfaceFace;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly tangentU: Vec3;
  readonly tangentV: Vec3;
  readonly halfExtentU: number;
  readonly halfExtentV: number;
}

export interface BodyContactMeasurement {
  readonly actorId: string;
  readonly bodySite: ActorBodySite;
  readonly surfaceEntityId: string | null;
  readonly surfaceFace: ContactSurfaceFace;
  readonly bodyPointWorld: Vec3;
  readonly surfacePointWorld: Vec3;
  readonly gapM: number;
  readonly penetrationM: number;
  readonly surfaceCoordinatesM: readonly [number, number];
  readonly boundsOverflowM: number;
  readonly actorMinGapM: number;
  readonly actorMinPrimitiveId: string;
  readonly bodySiteNormalWorld: Vec3 | null;
  readonly orientationDeviationDeg: number | null;
}

export const BODY_CONTACT_ORIENTATION_TOLERANCE_DEG = 45;

type BodyContactConstraint = Extract<
  SceneSpec["constraints"][number],
  { type: "body-contact" }
>;

const dot = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const scale = (vector: Vec3, scalar: number): Vec3 => [
  vector[0] * scalar,
  vector[1] * scalar,
  vector[2] * scalar,
];

const deviationDegrees = (left: Vec3, right: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(left, right)))) *
  (180 / Math.PI);

const entityById = (
  scene: SceneSpec,
  entityId: string,
): SceneEntity | undefined =>
  scene.entities.find((entity) => entity.id === entityId);

const unboundedSurface = (
  surfaceEntityId: string | null,
  point: Vec3,
): ResolvedContactSurface => ({
  surfaceEntityId,
  face: "top",
  point,
  normal: [0, 1, 0],
  tangentU: [1, 0, 0],
  tangentV: [0, 0, 1],
  halfExtentU: Number.POSITIVE_INFINITY,
  halfExtentV: Number.POSITIVE_INFINITY,
});

interface LocalFaceDefinition {
  readonly normal: Vec3;
  readonly center: Vec3;
  readonly tangentU: Vec3;
  readonly tangentV: Vec3;
  readonly extentAxes: readonly [0 | 1 | 2, 0 | 1 | 2];
}

const boxFaceDefinition = (
  face: ContactSurfaceFace,
  halfSize: Vec3,
): LocalFaceDefinition => {
  switch (face) {
    case "top":
      return {
        normal: [0, 1, 0],
        center: [0, halfSize[1], 0],
        tangentU: [1, 0, 0],
        tangentV: [0, 0, 1],
        extentAxes: [0, 2],
      };
    case "bottom":
      return {
        normal: [0, -1, 0],
        center: [0, -halfSize[1], 0],
        tangentU: [1, 0, 0],
        tangentV: [0, 0, -1],
        extentAxes: [0, 2],
      };
    case "right":
      return {
        normal: [1, 0, 0],
        center: [halfSize[0], 0, 0],
        tangentU: [0, 0, -1],
        tangentV: [0, 1, 0],
        extentAxes: [2, 1],
      };
    case "left":
      return {
        normal: [-1, 0, 0],
        center: [-halfSize[0], 0, 0],
        tangentU: [0, 0, 1],
        tangentV: [0, 1, 0],
        extentAxes: [2, 1],
      };
    case "front":
      return {
        normal: [0, 0, 1],
        center: [0, 0, halfSize[2]],
        tangentU: [1, 0, 0],
        tangentV: [0, 1, 0],
        extentAxes: [0, 1],
      };
    case "back":
      return {
        normal: [0, 0, -1],
        center: [0, 0, -halfSize[2]],
        tangentU: [-1, 0, 0],
        tangentV: [0, 1, 0],
        extentAxes: [0, 1],
      };
  }
};

export const resolveContactSurface = (
  scene: SceneSpec,
  surfaceEntityId: string | null,
  face: ContactSurfaceFace,
): ResolvedContactSurface => {
  if (surfaceEntityId === null) {
    if (face !== "top") {
      throw new BodyContactError(
        "BODY_CONTACT_SURFACE_UNSUPPORTED",
        "Implicit world ground exposes only a top surface.",
      );
    }
    return unboundedSurface(null, [0, 0, 0]);
  }

  const surface = entityById(scene, surfaceEntityId);
  if (!surface) {
    throw new BodyContactError(
      "BODY_CONTACT_SURFACE_NOT_FOUND",
      "The body-contact surface does not exist.",
    );
  }
  if (surface.kind === "environment") {
    if (!surface.preset.id.startsWith("room.") || face !== "top") {
      throw new BodyContactError(
        "BODY_CONTACT_SURFACE_UNSUPPORTED",
        "Room environments expose only their floor surface.",
      );
    }
    return unboundedSurface(surface.id, [...surface.transform.positionM]);
  }
  if (
    surface.kind !== "prop" ||
    (surface.geometry.primitive !== "box" &&
      surface.geometry.primitive !== "plane")
  ) {
    throw new BodyContactError(
      "BODY_CONTACT_SURFACE_UNSUPPORTED",
      "Body contact requires a room floor or box/plane prop surface.",
    );
  }
  if (surface.geometry.primitive === "plane" && face !== "top") {
    throw new BodyContactError(
      "BODY_CONTACT_SURFACE_UNSUPPORTED",
      "Plane props expose only their top surface.",
    );
  }

  const scaledSize: Vec3 = [
    surface.geometry.sizeM[0] * surface.transform.scale[0],
    surface.geometry.sizeM[1] * surface.transform.scale[1],
    surface.geometry.sizeM[2] * surface.transform.scale[2],
  ];
  const halfSize = scaledSize.map((value) => value / 2) as Vec3;
  const definition = boxFaceDefinition(face, halfSize);
  const localCenter: Vec3 = [
    definition.center[0] / surface.transform.scale[0],
    definition.center[1] / surface.transform.scale[1],
    definition.center[2] / surface.transform.scale[2],
  ];
  return {
    surfaceEntityId: surface.id,
    face,
    point: transformPoint(surface.transform, localCenter),
    normal: rotateVector(definition.normal, surface.transform.rotation),
    tangentU: rotateVector(definition.tangentU, surface.transform.rotation),
    tangentV: rotateVector(definition.tangentV, surface.transform.rotation),
    halfExtentU: scaledSize[definition.extentAxes[0]] / 2,
    halfExtentV: scaledSize[definition.extentAxes[1]] / 2,
  };
};

const primitiveIdsForSite = (
  bodySite: ActorBodySite,
): readonly string[] => {
  switch (bodySite) {
    case "pelvis":
      return ["pelvis", "hip_l", "hip_r"];
    case "upper-back":
    case "chest":
      return ["torso"];
    case "head":
      return ["head"];
    case "hand-l":
      return ["hand_l"];
    case "hand-r":
      return ["hand_r"];
    case "knee-l":
      return ["knee_l"];
    case "knee-r":
      return ["knee_r"];
    case "foot-l":
      return ["foot_l"];
    case "foot-r":
      return ["foot_r"];
  }
};

const pointsForBodySite = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  bodySite: ActorBodySite,
): Vec3[] => {
  const selectedIds = new Set(primitiveIdsForSite(bodySite));
  const clouds = actorVisiblePrimitivePointClouds(scene, actor).filter(
    ({ primitiveId }) => selectedIds.has(primitiveId),
  );
  if (clouds.length === 0) {
    throw new BodyContactError(
      "BODY_CONTACT_SITE_UNAVAILABLE",
      "The requested actor body site is not present.",
    );
  }
  if (bodySite !== "upper-back" && bodySite !== "chest") {
    return clouds.flatMap(({ worldPoints }) => worldPoints);
  }

  const projection = resolveActorProjection(scene, actor);
  const torso = projection.primitives.find(({ id }) => id === "torso");
  if (!torso) {
    throw new BodyContactError(
      "BODY_CONTACT_SITE_UNAVAILABLE",
      "The actor torso body site is unavailable.",
    );
  }
  const torsoAxis = rotateVector([0, 1, 0], torso.frame.rotation);
  const surfaceNormal = projection.anatomicalSurfaceNormals[bodySite];
  const minimumRatio = bodySite === "upper-back" ? 0.55 : 0.3;
  const maximumRatio = bodySite === "upper-back" ? 1 : 0.94;
  const points = clouds.flatMap(({ localPoints, worldPoints }) =>
    localPoints.flatMap((point, index) => {
      const height = dot(subtract(point, torso.frame.position), torsoAxis);
      return height >= projection.dimensions.torsoLength * minimumRatio &&
        height <= projection.dimensions.torsoLength * maximumRatio &&
        dot(subtract(point, torso.frame.position), surfaceNormal) >= -1e-9
        ? [worldPoints[index]]
        : [];
    }),
  );
  if (points.length === 0) {
    throw new BodyContactError(
      "BODY_CONTACT_SITE_UNAVAILABLE",
      "The actor torso body site has no visible surface points.",
    );
  }
  return points;
};

const minimumPointAlongNormal = (
  points: readonly Vec3[],
  surface: ResolvedContactSurface,
): Vec3 =>
  points.reduce((best, point) =>
    dot(point, surface.normal) < dot(best, surface.normal) ? point : best,
  );

export const measureBodyContact = (
  scene: SceneSpec,
  constraint: BodyContactConstraint,
): BodyContactMeasurement => {
  const actor = entityById(scene, constraint.actorId);
  if (actor?.kind !== "actor") {
    throw new BodyContactError(
      "BODY_CONTACT_ACTOR_NOT_FOUND",
      "The body-contact actor does not exist.",
    );
  }
  const surface = resolveContactSurface(
    scene,
    constraint.surfaceEntityId,
    constraint.surfaceFace,
  );
  const projection = resolveActorProjection(scene, actor);
  const anatomicalNormal =
    constraint.bodySite === "upper-back" || constraint.bodySite === "chest"
      ? projection.anatomicalSurfaceNormals[constraint.bodySite]
      : null;
  const bodySiteNormalWorld = anatomicalNormal
    ? transformNormal(actor.transform, anatomicalNormal)
    : null;
  const orientationDeviationDeg = bodySiteNormalWorld
    ? deviationDegrees(bodySiteNormalWorld, scale(surface.normal, -1))
    : null;
  const bodyPointWorld = minimumPointAlongNormal(
    pointsForBodySite(scene, actor, constraint.bodySite),
    surface,
  );
  const displacement = subtract(bodyPointWorld, surface.point);
  const gapM = dot(displacement, surface.normal);
  const coordinateU = dot(displacement, surface.tangentU);
  const coordinateV = dot(displacement, surface.tangentV);
  const boundsOverflowM = Math.max(
    0,
    Math.abs(coordinateU) - surface.halfExtentU,
    Math.abs(coordinateV) - surface.halfExtentV,
  );
  const surfacePointWorld = subtract(
    bodyPointWorld,
    scale(surface.normal, gapM),
  );
  const overlappingSurfacePoints = actorVisiblePrimitivePointClouds(
    scene,
    actor,
  ).flatMap(({ primitiveId, worldPoints }) =>
    worldPoints.flatMap((point) => {
      const relative = subtract(point, surface.point);
      return Math.abs(dot(relative, surface.tangentU)) <=
        surface.halfExtentU + constraint.toleranceM &&
        Math.abs(dot(relative, surface.tangentV)) <=
          surface.halfExtentV + constraint.toleranceM
        ? [{ primitiveId, point }]
        : [];
    }),
  );
  const minimumActorPoint = (
    overlappingSurfacePoints.length > 0
      ? overlappingSurfacePoints
      : [{ primitiveId: String(constraint.bodySite), point: bodyPointWorld }]
  ).reduce((minimum, candidate) =>
    dot(subtract(candidate.point, surface.point), surface.normal) <
    dot(subtract(minimum.point, surface.point), surface.normal)
      ? candidate
      : minimum,
  );
  const actorMinGapM = dot(
    subtract(minimumActorPoint.point, surface.point),
    surface.normal,
  );

  return {
    actorId: actor.id,
    bodySite: constraint.bodySite,
    surfaceEntityId: constraint.surfaceEntityId,
    surfaceFace: constraint.surfaceFace,
    bodyPointWorld,
    surfacePointWorld,
    gapM,
    penetrationM: Math.max(0, -gapM),
    surfaceCoordinatesM: [coordinateU, coordinateV],
    boundsOverflowM,
    actorMinGapM,
    actorMinPrimitiveId: minimumActorPoint.primitiveId,
    bodySiteNormalWorld,
    orientationDeviationDeg,
  };
};

const enabledActorContacts = (
  scene: SceneSpec,
  actorId: string,
): BodyContactConstraint[] =>
  scene.constraints.filter(
    (constraint): constraint is BodyContactConstraint =>
      constraint.type === "body-contact" &&
      constraint.enabled &&
      constraint.actorId === actorId,
  );

const projectActorContactsInPlace = (
  scene: SceneSpec,
  actor: AnyActorEntity,
): void => {
  const contacts = enabledActorContacts(scene, actor.id);
  for (let iteration = 0; iteration < 16; iteration += 1) {
    let maximumCorrectionM = 0;
    for (const constraint of contacts) {
      const measurement = measureBodyContact(scene, constraint);
      maximumCorrectionM = Math.max(
        maximumCorrectionM,
        Math.abs(measurement.gapM),
      );
      actor.transform.positionM = addVectors(
        actor.transform.positionM,
        scale(
          resolveContactSurface(
            scene,
            constraint.surfaceEntityId,
            constraint.surfaceFace,
          ).normal,
          -measurement.gapM,
        ),
      );
    }
    if (maximumCorrectionM <= 1e-7) break;
  }
};

export const enforceBodyContacts = (
  scene: SceneSpec,
  affectedEntityIds?: ReadonlySet<string>,
  options: { preserveLock?: boolean } = {},
): SceneSpec => {
  const next = structuredClone(scene);
  const actorIds = new Set(
    next.constraints.flatMap((constraint) =>
      constraint.type === "body-contact" &&
      constraint.enabled &&
      (affectedEntityIds === undefined ||
        affectedEntityIds.has(constraint.actorId) ||
        (constraint.surfaceEntityId !== null &&
          affectedEntityIds.has(constraint.surfaceEntityId)))
        ? [constraint.actorId]
        : [],
    ),
  );

  for (const actorId of actorIds) {
    const actor = entityById(next, actorId);
    if (actor?.kind !== "actor") {
      throw new BodyContactError(
        "BODY_CONTACT_ACTOR_NOT_FOUND",
        "The body-contact actor does not exist.",
      );
    }
    const before = [...actor.transform.positionM] as Vec3;
    projectActorContactsInPlace(next, actor);
    if (
      Math.hypot(
        actor.transform.positionM[0] - before[0],
        actor.transform.positionM[1] - before[1],
        actor.transform.positionM[2] - before[2],
      ) > 1e-9
    ) {
      const lockError = mutationBlockedByLock(
        actor.lockMode,
        options.preserveLock === true,
      );
      if (lockError !== null) {
        throw new BodyContactError(
          lockError,
          "A locked actor cannot be moved to satisfy body contact.",
        );
      }
    }
  }
  return sceneSpecSchema.parse(next);
};

export const bodyContactActorIds = (scene: SceneSpec): string[] => [
  ...new Set(
    scene.constraints.flatMap((constraint) =>
      constraint.type === "body-contact" && constraint.enabled
        ? [constraint.actorId]
        : [],
    ),
  ),
];

export const projectAllBodyContacts = (scene: SceneSpec): SceneSpec =>
  enforceBodyContacts(scene);

export const bodyContactSurfaceEntityIds = (
  scene: SceneSpec,
  actorId: string,
): string[] =>
  enabledActorContacts(scene, actorId).flatMap(({ surfaceEntityId }) =>
    surfaceEntityId === null ? [] : [surfaceEntityId],
  );

export const bodyContactPointClouds = (
  scene: SceneSpec,
  actor: AnyActorEntity,
): ActorVisiblePrimitivePointCloud[] =>
  actorVisiblePrimitivePointClouds(scene, actor);
