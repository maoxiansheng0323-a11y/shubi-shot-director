import {
  addVectors,
  lookAtQuaternion,
  multiplyQuaternions,
  rotateVector,
} from "./scene-math";
import {
  actorAnchorWorldPoint,
  type ActorAnchor,
} from "./humanoid-rig";
import {
  ContactConstraintError,
  enforceGroundContacts,
} from "./contact-constraints";
import {
  scenePatchSchema,
  type SceneOperation,
  type ScenePatch,
} from "./scene-patch";
import {
  sceneSpecSchema,
  type SceneEntity,
  type SceneSpec,
  type Vec3,
} from "./scene-schema";

export class SceneDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SceneDomainError";
    this.code = code;
  }
}

const findEntity = (scene: SceneSpec, entityId: string): SceneEntity => {
  const entity = scene.entities.find((candidate) => candidate.id === entityId);
  if (!entity) {
    throw new SceneDomainError(
      "ENTITY_NOT_FOUND",
      `Entity does not exist: ${entityId}`,
    );
  }
  return entity;
};

const requireUnlocked = (entity: SceneEntity): void => {
  if (entity.locked) {
    throw new SceneDomainError(
      "ENTITY_LOCKED",
      `Entity is locked: ${entity.id}`,
    );
  }
};

const constraintReferencesEntity = (
  constraint: SceneSpec["constraints"][number],
  entityId: string,
): boolean =>
  constraint.type === "ground-contact"
    ? constraint.entityId === entityId ||
      constraint.surfaceEntityId === entityId
    : constraint.cameraId === entityId ||
      constraint.subjectEntityId === entityId;

const compositionGoalsReferenceEntity = (
  scene: SceneSpec,
  entityId: string,
): boolean =>
  scene.compositionGoals?.framing?.targetEntityIds.includes(entityId) ===
    true ||
  scene.compositionGoals?.criticalEntityIds?.includes(entityId) === true;

const resolveAnchor = (
  scene: SceneSpec,
  entityId: string,
  anchor: ActorAnchor,
): Vec3 => {
  const entity = findEntity(scene, entityId);
  if (entity.kind !== "actor") {
    return entity.transform.positionM;
  }
  return actorAnchorWorldPoint(entity, anchor);
};

const updatePresetParameters = (
  entity: SceneEntity,
  parameters: Record<string, unknown>,
): void => {
  if (entity.kind !== "environment" && entity.kind !== "prop") {
    throw new SceneDomainError(
      "ENTITY_KIND_MISMATCH",
      "Only environment and prop entities expose preset parameters.",
    );
  }
  entity.preset.parameters = parameters as never;
};

const contactAffectedEntityIds = (
  operation: SceneOperation,
): ReadonlySet<string> => {
  switch (operation.op) {
    case "entity.add":
      return new Set([operation.value.id]);
    case "entity.transform.set":
    case "entity.transform.translate":
    case "entity.transform.rotate":
    case "entity.flags.set":
    case "entity.preset.parameters.set":
    case "actor.pose.set":
      return new Set([operation.entityId]);
    case "constraint.set":
      return operation.value.type === "ground-contact"
        ? new Set(
            operation.value.surfaceEntityId === null
              ? [operation.value.entityId]
              : [
                  operation.value.entityId,
                  operation.value.surfaceEntityId,
                ],
          )
        : new Set();
    default:
      return new Set();
  }
};

const enforceContactsForOperation = (
  scene: SceneSpec,
  operation: SceneOperation,
): SceneSpec => {
  const affectedIds = contactAffectedEntityIds(operation);
  if (affectedIds.size === 0) {
    return scene;
  }
  try {
    return enforceGroundContacts(scene, affectedIds);
  } catch (error) {
    if (error instanceof ContactConstraintError) {
      throw new SceneDomainError(error.code, error.message);
    }
    throw error;
  }
};

const applyOperation = (scene: SceneSpec, operation: SceneOperation): void => {
  switch (operation.op) {
    case "entity.add": {
      if (scene.entities.some((entity) => entity.id === operation.value.id)) {
        throw new SceneDomainError(
          "ENTITY_ALREADY_EXISTS",
          `Entity already exists: ${operation.value.id}`,
        );
      }
      scene.entities.push(operation.value);
      return;
    }
    case "entity.remove": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      if (scene.activeCameraId === entity.id) {
        throw new SceneDomainError(
          "ACTIVE_CAMERA_REMOVE_FORBIDDEN",
          "Select another active camera before removing this camera.",
        );
      }
      if (
        scene.entities.some((candidate) => candidate.parentId === entity.id) ||
        scene.constraints.some((constraint) =>
          constraintReferencesEntity(constraint, entity.id),
        ) ||
        compositionGoalsReferenceEntity(scene, entity.id)
      ) {
        throw new SceneDomainError(
          "ENTITY_STILL_REFERENCED",
          `Entity is still referenced: ${entity.id}`,
        );
      }
      scene.entities = scene.entities.filter(
        (candidate) => candidate.id !== entity.id,
      );
      return;
    }
    case "entity.transform.set": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      entity.transform = operation.value;
      return;
    }
    case "entity.transform.translate": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      let worldDelta = operation.deltaM;
      if (operation.referenceSpace === "local") {
        worldDelta = rotateVector(operation.deltaM, entity.transform.rotation);
      }
      if (operation.referenceSpace === "camera") {
        const cameraId =
          operation.referenceCameraId ?? scene.activeCameraId;
        const camera = findEntity(scene, cameraId);
        if (camera.kind !== "camera") {
          throw new SceneDomainError(
            "ENTITY_KIND_MISMATCH",
            `Reference entity is not a camera: ${cameraId}`,
          );
        }
        worldDelta = rotateVector(operation.deltaM, camera.transform.rotation);
      }
      entity.transform.positionM = addVectors(
        entity.transform.positionM,
        worldDelta,
      );
      return;
    }
    case "entity.transform.rotate": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      entity.transform.rotation =
        operation.referenceSpace === "world"
          ? multiplyQuaternions(
              operation.deltaRotation,
              entity.transform.rotation,
            )
          : multiplyQuaternions(
              entity.transform.rotation,
              operation.deltaRotation,
            );
      return;
    }
    case "entity.flags.set": {
      const entity = findEntity(scene, operation.entityId);
      entity.visible = operation.visible;
      entity.locked = operation.locked;
      return;
    }
    case "entity.preset.parameters.set": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      updatePresetParameters(entity, operation.value);
      return;
    }
    case "actor.pose.set": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      if (entity.kind !== "actor") {
        throw new SceneDomainError(
          "ENTITY_KIND_MISMATCH",
          `Entity is not an actor: ${entity.id}`,
        );
      }
      entity.pose = operation.value;
      return;
    }
    case "camera.lens.set": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      if (entity.kind !== "camera") {
        throw new SceneDomainError(
          "ENTITY_KIND_MISMATCH",
          `Entity is not a camera: ${entity.id}`,
        );
      }
      entity.lens = operation.value;
      return;
    }
    case "camera.look-at": {
      const entity = findEntity(scene, operation.entityId);
      requireUnlocked(entity);
      if (entity.kind !== "camera") {
        throw new SceneDomainError(
          "ENTITY_KIND_MISMATCH",
          `Entity is not a camera: ${entity.id}`,
        );
      }
      const target =
        operation.target.type === "point"
          ? operation.target.pointM
          : resolveAnchor(
              scene,
              operation.target.entityId,
              operation.target.anchor,
            );
      entity.transform.rotation = lookAtQuaternion(
        entity.transform.positionM,
        target,
      );
      return;
    }
    case "constraint.set": {
      const existingIndex = scene.constraints.findIndex(
        (constraint) => constraint.id === operation.value.id,
      );
      if (existingIndex === -1) {
        scene.constraints.push(operation.value);
      } else {
        scene.constraints[existingIndex] = operation.value;
      }
      return;
    }
    case "constraint.remove": {
      const existingIndex = scene.constraints.findIndex(
        (constraint) => constraint.id === operation.constraintId,
      );
      if (existingIndex === -1) {
        throw new SceneDomainError(
          "CONSTRAINT_NOT_FOUND",
          `Constraint does not exist: ${operation.constraintId}`,
        );
      }
      scene.constraints.splice(existingIndex, 1);
      return;
    }
    case "scene.active-camera.set": {
      const entity = findEntity(scene, operation.cameraId);
      if (entity.kind !== "camera") {
        throw new SceneDomainError(
          "ENTITY_KIND_MISMATCH",
          `Entity is not a camera: ${entity.id}`,
        );
      }
      scene.activeCameraId = entity.id;
      return;
    }
    case "scene.output.set": {
      scene.output = operation.value;
      return;
    }
    case "scene.composition-goals.set": {
      if (operation.value === null) {
        delete scene.compositionGoals;
      } else {
        scene.compositionGoals = operation.value;
      }
      return;
    }
    case "scene.title.set": {
      scene.title = operation.value;
      return;
    }
  }
};

export interface AppliedScenePatch {
  previous: SceneSpec;
  next: SceneSpec;
  patch: ScenePatch;
}

export const applyScenePatch = (
  currentInput: SceneSpec,
  patchInput: unknown,
): AppliedScenePatch => {
  const current = sceneSpecSchema.parse(currentInput);
  const patch = scenePatchSchema.parse(patchInput);

  if (patch.sceneId !== current.sceneId) {
    throw new SceneDomainError(
      "SCENE_ID_MISMATCH",
      "Patch targets a different scene.",
    );
  }
  if (patch.baseRevision !== current.revision) {
    throw new SceneDomainError(
      "STALE_REVISION",
      `Patch revision ${patch.baseRevision} does not match current revision ${current.revision}.`,
    );
  }

  let next = structuredClone(current);
  for (const operation of patch.operations) {
    applyOperation(next, operation);
    next = enforceContactsForOperation(next, operation);
  }
  next.revision = current.revision + 1;

  return {
    previous: current,
    next: sceneSpecSchema.parse(next),
    patch,
  };
};
