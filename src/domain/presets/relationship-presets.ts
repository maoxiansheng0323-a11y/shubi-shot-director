import { rotateVector } from "../scene-math";
import { mutationBlockedByLock } from "../entity-lock";
import { actorVisibleRigBounds } from "../actor-visible-bounds";
import {
  ContactConstraintError,
  surfaceTopY,
} from "../contact-constraints";
import type { SceneOperation } from "../scene-patch";
import type {
  ActorEntity,
  QuaternionTuple,
  SceneEntity,
  SceneSpec,
  TransformSpec,
} from "../scene-schema";
import { materializePose } from "./pose-presets";

export interface RelationshipPresetDefinition {
  readonly id: string;
  readonly version: 1;
  readonly label: string;
  readonly primaryPoseId: string;
  readonly secondaryPoseId: string;
}

export interface RelationshipRoles {
  readonly primaryActorId: string;
  readonly secondaryActorId: string;
  readonly surfaceEntityId?: string;
}

export class RelationshipPresetError extends Error {
  readonly code:
    | "RELATIONSHIP_PRESET_NOT_FOUND"
    | "ROLE_ACTOR_NOT_FOUND"
    | "ROLE_ACTOR_LOCKED"
    | "ROLE_ACTORS_MUST_DIFFER"
    | "SURFACE_NOT_FOUND"
    | "SURFACE_KIND_MISMATCH"
    | "SURFACE_UNSUPPORTED";

  constructor(
    code: RelationshipPresetError["code"],
    message: string,
  ) {
    super(message);
    this.name = "RelationshipPresetError";
    this.code = code;
  }
}

const relationshipPresets = Object.freeze([
  Object.freeze({
    id: "relationship.face-to-face-v1",
    version: 1 as const,
    label: "Face to face",
    primaryPoseId: "pose.standing-neutral-v1",
    secondaryPoseId: "pose.standing-neutral-v1",
  }),
  Object.freeze({
    id: "relationship.over-under-focus-lower-v1",
    version: 1 as const,
    label: "Over under, focus lower",
    primaryPoseId: "pose.kneeling-lean-v1",
    secondaryPoseId: "pose.lying-supine-v1",
  }),
] satisfies readonly RelationshipPresetDefinition[]);

const relationshipById = new Map<
  string,
  RelationshipPresetDefinition
>(
  relationshipPresets.map((preset) => [preset.id, preset]),
);

const requireActor = (
  scene: SceneSpec,
  entityId: string,
): ActorEntity => {
  const entity = scene.entities.find(
    (candidate) =>
      candidate.id === entityId && candidate.kind === "actor",
  );
  if (!entity || entity.kind !== "actor") {
    throw new RelationshipPresetError(
      "ROLE_ACTOR_NOT_FOUND",
      "A relationship role does not reference an actor.",
    );
  }
  if (mutationBlockedByLock(entity.lockMode, true) === "USER_LOCKED") {
    throw new RelationshipPresetError(
      "ROLE_ACTOR_LOCKED",
      "A relationship role references a locked actor.",
    );
  }
  return entity;
};

const resolveSurface = (
  scene: SceneSpec,
  surfaceEntityId: string | undefined,
): Extract<SceneEntity, { kind: "environment" | "prop" }> | null => {
  if (!surfaceEntityId) {
    return null;
  }
  const entity = scene.entities.find(
    (candidate) => candidate.id === surfaceEntityId,
  );
  if (!entity) {
    throw new RelationshipPresetError(
      "SURFACE_NOT_FOUND",
      "The requested support surface does not exist.",
    );
  }
  if (entity.kind !== "environment" && entity.kind !== "prop") {
    throw new RelationshipPresetError(
      "SURFACE_KIND_MISMATCH",
      "The requested support entity is not a surface.",
    );
  }
  return entity;
};

interface HorizontalDirection {
  readonly x: number;
  readonly z: number;
}

const normalizeHorizontal = (
  x: number,
  z: number,
  fallback: HorizontalDirection = { x: 0, z: 1 },
): HorizontalDirection => {
  const length = Math.hypot(x, z);
  if (length < 1e-6) {
    return fallback;
  }
  return { x: x / length, z: z / length };
};

const yawFacing = (
  direction: HorizontalDirection,
): QuaternionTuple => {
  const yaw = Math.atan2(direction.x, direction.z);
  const halfYaw = yaw / 2;
  return [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)];
};

const horizontalForward = (
  rotation: QuaternionTuple,
): HorizontalDirection => {
  const [x, , z] = rotateVector([0, 0, 1], rotation);
  return normalizeHorizontal(x, z);
};

const transformAt = (
  actor: ActorEntity,
  positionM: [number, number, number],
  rotation: QuaternionTuple,
): TransformSpec => ({
  positionM,
  rotation,
  scale: [...actor.transform.scale],
});

const supportedTransformAt = (
  actor: ActorEntity,
  pose: ReturnType<typeof materializePose>,
  positionXZ: readonly [number, number],
  rotation: QuaternionTuple,
  supportY: number,
): TransformSpec => {
  const candidate = transformAt(
    actor,
    [positionXZ[0], 0, positionXZ[1]],
    rotation,
  );
  const supportOffsetM = actorVisibleRigBounds(
    { ...actor, pose, transform: candidate },
    candidate,
  ).supportOffsetM;
  return {
    ...candidate,
    positionM: [positionXZ[0], supportY + supportOffsetM, positionXZ[1]],
  };
};

const stableHash = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
};

const uniqueConstraintId = (
  scene: SceneSpec,
  category: "ground" | "visible",
  key: string,
): string => {
  const base = `constraint_${category}_${stableHash(key)}`;
  const ids = new Set(scene.constraints.map((constraint) => constraint.id));
  if (!ids.has(base)) {
    return base;
  }
  for (let salt = 1; salt < 1_000; salt += 1) {
    const candidate = `${base}_${salt.toString(36)}`;
    if (!ids.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Unable to allocate a relationship constraint.");
};

const groundConstraintOperation = (
  scene: SceneSpec,
  actorId: string,
  surfaceId: string | null,
): SceneOperation => {
  const existing = scene.constraints.find(
    (constraint) =>
      constraint.type === "ground-contact" &&
      constraint.entityId === actorId,
  );
  return {
    op: "constraint.set",
    value: {
      id:
        existing?.id ??
        uniqueConstraintId(scene, "ground", actorId),
      type: "ground-contact",
      entityId: actorId,
      surfaceEntityId: surfaceId,
      enabled: true,
    },
  };
};

const keepFaceVisibleOperation = (
  scene: SceneSpec,
  actorId: string,
): SceneOperation => {
  const existing = scene.constraints.find(
    (constraint) =>
      constraint.type === "keep-visible" &&
      constraint.cameraId === scene.activeCameraId &&
      constraint.subjectEntityId === actorId &&
      constraint.anchor === "face",
  );
  return {
    op: "constraint.set",
    value: {
      id:
        existing?.id ??
        uniqueConstraintId(
          scene,
          "visible",
          `${scene.activeCameraId}:${actorId}:face`,
        ),
      type: "keep-visible",
      cameraId: scene.activeCameraId,
      subjectEntityId: actorId,
      anchor: "face",
      enabled: true,
    },
  };
};

const buildFaceToFaceOperations = (
  scene: SceneSpec,
  primary: ActorEntity,
  secondary: ActorEntity,
  supportY: number,
  surfaceId: string | null,
): SceneOperation[] => {
  const primaryPose = materializePose(
    primary,
    "pose.standing-neutral-v1",
  );
  const secondaryPose = materializePose(
    secondary,
    "pose.standing-neutral-v1",
  );
  const direction = normalizeHorizontal(
    secondary.transform.positionM[0] -
      primary.transform.positionM[0],
    secondary.transform.positionM[2] -
      primary.transform.positionM[2],
  );
  const midpointX =
    (primary.transform.positionM[0] +
      secondary.transform.positionM[0]) /
    2;
  const midpointZ =
    (primary.transform.positionM[2] +
      secondary.transform.positionM[2]) /
    2;
  const separationM = Math.max(
    0.75,
    (primary.body.shoulderWidthM +
      secondary.body.shoulderWidthM) *
      0.9,
  );
  const halfSeparation = separationM / 2;
  const primaryRotation = yawFacing(direction);
  const secondaryRotation = yawFacing({
    x: -direction.x,
    z: -direction.z,
  });
  const primaryTransform = supportedTransformAt(
    primary,
    primaryPose,
    [
      midpointX - direction.x * halfSeparation,
      midpointZ - direction.z * halfSeparation,
    ],
    primaryRotation,
    supportY,
  );
  const secondaryTransform = supportedTransformAt(
    secondary,
    secondaryPose,
    [
      midpointX + direction.x * halfSeparation,
      midpointZ + direction.z * halfSeparation,
    ],
    secondaryRotation,
    supportY,
  );

  return [
    {
      op: "actor.pose.set",
      entityId: primary.id,
      value: primaryPose,
    },
    {
      op: "actor.pose.set",
      entityId: secondary.id,
      value: secondaryPose,
    },
    {
      op: "entity.transform.set",
      entityId: primary.id,
      value: primaryTransform,
    },
    {
      op: "entity.transform.set",
      entityId: secondary.id,
      value: secondaryTransform,
    },
    groundConstraintOperation(scene, primary.id, surfaceId),
    groundConstraintOperation(scene, secondary.id, surfaceId),
  ];
};

const buildOverUnderOperations = (
  scene: SceneSpec,
  primary: ActorEntity,
  secondary: ActorEntity,
  supportY: number,
  surfaceId: string | null,
): SceneOperation[] => {
  const primaryPose = materializePose(
    primary,
    "pose.kneeling-lean-v1",
  );
  const secondaryPose = materializePose(
    secondary,
    "pose.lying-supine-v1",
  );
  const lowerForward = horizontalForward(
    secondary.transform.rotation,
  );
  const midpointX =
    (primary.transform.positionM[0] +
      secondary.transform.positionM[0]) /
    2;
  const midpointZ =
    (primary.transform.positionM[2] +
      secondary.transform.positionM[2]) /
    2;
  const primaryLongitudinalOffset =
    secondary.body.heightM * 0.1;
  const primaryRotation = yawFacing(lowerForward);
  const secondaryRotation = yawFacing({
    x: -lowerForward.x,
    z: -lowerForward.z,
  });
  const secondaryTransform = supportedTransformAt(
    secondary,
    secondaryPose,
    [midpointX, midpointZ],
    secondaryRotation,
    supportY,
  );
  const primaryTransform = supportedTransformAt(
    primary,
    primaryPose,
    [
      midpointX + -lowerForward.x * primaryLongitudinalOffset,
      midpointZ + -lowerForward.z * primaryLongitudinalOffset,
    ],
    primaryRotation,
    supportY,
  );

  return [
    {
      op: "actor.pose.set",
      entityId: primary.id,
      value: primaryPose,
    },
    {
      op: "actor.pose.set",
      entityId: secondary.id,
      value: secondaryPose,
    },
    {
      op: "entity.transform.set",
      entityId: primary.id,
      value: primaryTransform,
    },
    {
      op: "entity.transform.set",
      entityId: secondary.id,
      value: secondaryTransform,
    },
    groundConstraintOperation(scene, primary.id, surfaceId),
    groundConstraintOperation(scene, secondary.id, surfaceId),
    keepFaceVisibleOperation(scene, secondary.id),
  ];
};

export const listRelationshipPresets =
  (): readonly RelationshipPresetDefinition[] =>
    relationshipPresets;

export const buildRelationshipOperations = (
  scene: SceneSpec,
  presetId: string,
  roles: RelationshipRoles,
): SceneOperation[] => {
  const preset = relationshipById.get(presetId);
  if (!preset) {
    throw new RelationshipPresetError(
      "RELATIONSHIP_PRESET_NOT_FOUND",
      "The requested relationship preset is not available.",
    );
  }
  if (roles.primaryActorId === roles.secondaryActorId) {
    throw new RelationshipPresetError(
      "ROLE_ACTORS_MUST_DIFFER",
      "Relationship roles must reference two different actors.",
    );
  }

  const primary = requireActor(scene, roles.primaryActorId);
  const secondary = requireActor(scene, roles.secondaryActorId);
  const surface = resolveSurface(scene, roles.surfaceEntityId);
  let supportY = 0;
  if (surface) {
    try {
      supportY = surfaceTopY(scene, surface.id);
    } catch (error) {
      if (error instanceof ContactConstraintError) {
        throw new RelationshipPresetError(
          "SURFACE_UNSUPPORTED",
          "The requested support surface is not horizontal or does not support ground contact.",
        );
      }
      throw error;
    }
  }
  const surfaceId = surface?.id ?? null;

  switch (preset.id) {
    case "relationship.face-to-face-v1":
      return buildFaceToFaceOperations(
        scene,
        primary,
        secondary,
        supportY,
        surfaceId,
      );
    case "relationship.over-under-focus-lower-v1":
      return buildOverUnderOperations(
        scene,
        primary,
        secondary,
        supportY,
        surfaceId,
      );
  }

  throw new RelationshipPresetError(
    "RELATIONSHIP_PRESET_NOT_FOUND",
    "The requested relationship preset is not available.",
  );
};
