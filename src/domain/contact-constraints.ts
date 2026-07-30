import { rotateVector } from "./scene-math";
import { actorVisibleRigBounds } from "./actor-visible-bounds";
import {
  mutationBlockedByLock,
  type EntityLockErrorCode,
} from "./entity-lock";
import {
  sceneSpecSchema,
  transformSchema,
  type SceneEntity,
  type SceneSpec,
  type TransformSpec,
} from "./scene-schema";

export type ContactConstraintErrorCode =
  | "ENTITY_NOT_FOUND"
  | "SURFACE_NOT_FOUND"
  | "UNSUPPORTED_SURFACE"
  | "SURFACE_NOT_HORIZONTAL"
  | "CONTACT_TARGET_UNSUPPORTED"
  | "AMBIGUOUS_GROUND_CONTACT"
  | EntityLockErrorCode
  | "LOCKED_ENTITY_CONFLICT";

export class ContactConstraintError extends Error {
  readonly code: ContactConstraintErrorCode;

  constructor(code: ContactConstraintErrorCode, message: string) {
    super(message);
    this.name = "ContactConstraintError";
    this.code = code;
  }
}

const HORIZONTAL_EPSILON = 1e-5;
const LEGACY_CONTACT_TOLERANCE_M = 0.001;
const CONTACT_NUMERIC_EPSILON_M = 1e-9;

const entityById = (
  scene: SceneSpec,
  entityId: string,
): SceneEntity | undefined =>
  scene.entities.find((entity) => entity.id === entityId);

const assertHorizontal = (surface: SceneEntity): void => {
  const worldUp = rotateVector([0, 1, 0], surface.transform.rotation);
  const horizontal =
    Math.abs(worldUp[0]) <= HORIZONTAL_EPSILON &&
    Math.abs(worldUp[2]) <= HORIZONTAL_EPSILON &&
    Math.abs(Math.abs(worldUp[1]) - 1) <= HORIZONTAL_EPSILON;

  if (!horizontal) {
    throw new ContactConstraintError(
      "SURFACE_NOT_HORIZONTAL",
      "Ground contact only supports horizontal surfaces.",
    );
  }
};

/**
 * Returns the world-space Y coordinate of a supported horizontal surface.
 *
 * Room environment presets expose their floor at local Y=0. Box and plane
 * props are centered on their transform, so their top is half their scaled
 * geometry height above the transform origin.
 */
export const surfaceTopY = (
  scene: SceneSpec,
  surfaceEntityId: string,
): number => {
  const surface = entityById(scene, surfaceEntityId);
  if (!surface) {
    throw new ContactConstraintError(
      "SURFACE_NOT_FOUND",
      "The contact surface does not exist.",
    );
  }

  if (surface.kind === "environment") {
    if (!surface.preset.id.startsWith("room.")) {
      throw new ContactConstraintError(
        "UNSUPPORTED_SURFACE",
        "Only room environment floors can be contact surfaces.",
      );
    }
    assertHorizontal(surface);
    return surface.transform.positionM[1];
  }

  if (
    surface.kind === "prop" &&
    (surface.geometry.primitive === "box" ||
      surface.geometry.primitive === "plane")
  ) {
    assertHorizontal(surface);
    const scaledHeight =
      surface.geometry.sizeM[1] * surface.transform.scale[1];
    return surface.transform.positionM[1] + scaledHeight / 2;
  }

  throw new ContactConstraintError(
    "UNSUPPORTED_SURFACE",
    "The entity cannot be used as a ground-contact surface.",
  );
};

/**
 * Uses the same validation path as contact enforcement so UI pickers and
 * relationship recipes cannot offer a surface that the solver will reject.
 */
export const isSupportedContactSurface = (
  scene: SceneSpec,
  surfaceEntityId: string,
): boolean => {
  try {
    surfaceTopY(scene, surfaceEntityId);
    return true;
  } catch (error) {
    if (error instanceof ContactConstraintError) {
      return false;
    }
    throw error;
  }
};

const actorContactOffsetM = (
  scene: SceneSpec,
  entity: SceneEntity,
  transform: TransformSpec,
): number => {
  if (entity.kind !== "actor") {
    throw new ContactConstraintError(
      "CONTACT_TARGET_UNSUPPORTED",
      "Ground contact currently supports actor targets only.",
    );
  }

  return actorVisibleRigBounds(scene, entity, transform).supportOffsetM;
};

type GroundContactConstraint = Extract<
  SceneSpec["constraints"][number],
  { type: "ground-contact" }
>;

const enabledGroundConstraint = (scene: SceneSpec, entityId: string) => {
  const constraints = scene.constraints.filter(
    (constraint): constraint is GroundContactConstraint =>
      constraint.type === "ground-contact" &&
      constraint.enabled &&
      constraint.entityId === entityId,
  );
  if (constraints.length > 1) {
    throw new ContactConstraintError(
      "AMBIGUOUS_GROUND_CONTACT",
      "An entity cannot have multiple enabled ground contacts.",
    );
  }
  return constraints[0];
};

/**
 * Snaps a proposed actor transform to its enabled ground-contact constraint.
 * A null surfaceEntityId means the implicit world ground at Y=0.
 */
export const snapTransformToContact = (
  scene: SceneSpec,
  entityId: string,
  candidateTransform: TransformSpec,
): TransformSpec => {
  const candidate = transformSchema.parse(structuredClone(candidateTransform));
  const entity = entityById(scene, entityId);
  if (!entity) {
    throw new ContactConstraintError(
      "ENTITY_NOT_FOUND",
      "The contact target does not exist.",
    );
  }

  const constraint = enabledGroundConstraint(scene, entityId);
  if (!constraint) {
    return candidate;
  }

  const surfaceY =
    constraint.surfaceEntityId === null
      ? 0
      : surfaceTopY(scene, constraint.surfaceEntityId);
  const supportOffsetM = actorContactOffsetM(scene, entity, candidate);

  return {
    ...candidate,
    positionM: [
      candidate.positionM[0],
      surfaceY + supportOffsetM,
      candidate.positionM[2],
    ],
  };
};

const transformNeedsVerticalMove = (
  before: TransformSpec,
  after: TransformSpec,
  toleranceM: number,
): boolean =>
  Math.abs(before.positionM[1] - after.positionM[1]) >
  toleranceM;

/**
 * Enforces enabled actor ground contacts without mutating the supplied scene.
 *
 * When affectedEntityIds is supplied, a contact is recomputed if either its
 * actor or its surface is affected. This makes actors follow a moved surface
 * while avoiding unrelated scene changes.
 */
export const enforceGroundContacts = (
  scene: SceneSpec,
  affectedEntityIds?: ReadonlySet<string>,
  options: { preserveLock?: boolean } = {},
): SceneSpec => {
  const nextScene = structuredClone(scene);
  const contactToleranceM =
    affectedEntityIds === undefined
      ? LEGACY_CONTACT_TOLERANCE_M
      : CONTACT_NUMERIC_EPSILON_M;

  for (const constraint of nextScene.constraints) {
    if (constraint.type !== "ground-contact" || !constraint.enabled) {
      continue;
    }
    if (
      affectedEntityIds &&
      !affectedEntityIds.has(constraint.entityId) &&
      (constraint.surfaceEntityId === null ||
        !affectedEntityIds.has(constraint.surfaceEntityId))
    ) {
      continue;
    }

    const entity = entityById(nextScene, constraint.entityId);
    if (!entity) {
      throw new ContactConstraintError(
        "ENTITY_NOT_FOUND",
        "The contact target does not exist.",
      );
    }
    const snapped = snapTransformToContact(
      nextScene,
      entity.id,
      entity.transform,
    );

    if (
      transformNeedsVerticalMove(
        entity.transform,
        snapped,
        contactToleranceM,
      )
    ) {
      const lockError = mutationBlockedByLock(
        entity.lockMode,
        options.preserveLock === true,
      );
      if (lockError !== null) {
        throw new ContactConstraintError(
          lockError,
          "A locked actor cannot be moved to satisfy ground contact.",
        );
      }
      entity.transform = snapped;
    }
  }

  return sceneSpecSchema.parse(nextScene);
};
