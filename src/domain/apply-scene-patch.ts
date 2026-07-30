import {
  addVectors,
  lookAtQuaternion,
  multiplyQuaternions,
  rotateVector,
} from "./scene-math";
import {
  ActorLimbPresenceError,
  resolveActorLimbPresenceUpdates,
} from "./actor-anatomy";
import {
  actorAnchorWorldPoint,
  type ActorAnchor,
} from "./actor-projection";
import {
  ContactConstraintError,
  enforceGroundContacts,
} from "./contact-constraints";
import {
  isLocked,
  mutationBlockedByLock,
  type EntityLockMode,
} from "./entity-lock";
import {
  scenePatchStructureSchema,
  type SceneOperation,
  type ScenePatch,
} from "./scene-patch";
import { parseScenePatchInput } from "./scene-migrations";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  sceneSpecSchema,
  type BlueprintActorEntity,
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

const requireSpatialLayout = (
  scene: SceneSpec,
): NonNullable<SceneSpec["spatialLayout"]> => {
  if (scene.spatialLayout === null) {
    throw new SceneDomainError(
      "SPATIAL_LAYOUT_REQUIRED",
      "The scene does not contain a spatial layout.",
    );
  }
  return scene.spatialLayout;
};

const upsertById = <Value extends { id: string }>(
  values: Value[],
  value: Value,
): void => {
  const existingIndex = values.findIndex(
    (candidate) => candidate.id === value.id,
  );
  if (existingIndex === -1) {
    values.push(value);
  } else {
    values[existingIndex] = value;
  }
};

const removeById = <Value extends { id: string }>(
  values: Value[],
  id: string,
  code: string,
  label: string,
): void => {
  const existingIndex = values.findIndex(
    (candidate) => candidate.id === id,
  );
  if (existingIndex === -1) {
    throw new SceneDomainError(code, `${label} does not exist: ${id}`);
  }
  values.splice(existingIndex, 1);
};

const requireMutable = (
  entity: SceneEntity,
  preserveLock: boolean,
): void => {
  const code = mutationBlockedByLock(entity.lockMode, preserveLock);
  if (code !== null) {
    throw new SceneDomainError(
      code,
      `Entity mutation is blocked by its lock: ${entity.id}`,
    );
  }
};

type EntityLockMap = ReadonlyMap<string, EntityLockMode>;

const lockPreservationConflict = (
  message: string,
): SceneDomainError =>
  new SceneDomainError("LOCK_PRESERVATION_CONFLICT", message);

const preflightPreservedLocks = (
  current: SceneSpec,
  patch: ScenePatch,
): EntityLockMap => {
  const originalLocks = new Map(
    current.entities.map(
      ({ id, lockMode }) => [id, lockMode] as const,
    ),
  );
  if (!patch.preserveLock) {
    return originalLocks;
  }

  const workingLocks = new Map(originalLocks);
  for (const operation of patch.operations) {
    if (operation.op === "entity.add") {
      if (isLocked(operation.value.lockMode)) {
        throw lockPreservationConflict(
          `A locked entity cannot be added while preserving locks: ${operation.value.id}`,
        );
      }
      if (!workingLocks.has(operation.value.id)) {
        workingLocks.set(operation.value.id, operation.value.lockMode);
      }
      continue;
    }

    if (operation.op === "entity.remove") {
      const originalLock = originalLocks.get(operation.entityId);
      if (originalLock !== undefined && isLocked(originalLock)) {
        throw lockPreservationConflict(
          `A locked entity cannot be removed while preserving locks: ${operation.entityId}`,
        );
      }
      workingLocks.delete(operation.entityId);
      continue;
    }

    if (
      operation.op === "entity.flags.set" &&
      operation.lockMode !== undefined
    ) {
      const workingLock = workingLocks.get(operation.entityId);
      if (
        workingLock !== undefined &&
        operation.lockMode !== workingLock
      ) {
        throw lockPreservationConflict(
          `Entity lock mode cannot change while preserving locks: ${operation.entityId}`,
        );
      }
    }
  }
  return originalLocks;
};

const assertPreservedLocks = (
  next: SceneSpec,
  originalLocks: EntityLockMap,
): void => {
  for (const [entityId, lockMode] of originalLocks) {
    const entity = next.entities.find(
      (candidate) => candidate.id === entityId,
    );
    if (!entity && isLocked(lockMode)) {
      throw lockPreservationConflict(
        `A locked entity was removed: ${entityId}`,
      );
    }
    if (entity && entity.lockMode !== lockMode) {
      throw lockPreservationConflict(
        `Entity lock mode changed: ${entityId}`,
      );
    }
  }

  for (const entity of next.entities) {
    if (!originalLocks.has(entity.id) && isLocked(entity.lockMode)) {
      throw lockPreservationConflict(
        `A newly added entity is locked: ${entity.id}`,
      );
    }
  }
};

const blueprintReferenceError = (message: string): SceneDomainError =>
  new SceneDomainError("ACTOR_BLUEPRINT_REFERENCE_INVALID", message);

const requireBlueprintVariant = (
  scene: Pick<SceneSpec, "actorBlueprints">,
  actor: BlueprintActorEntity,
  variantId = actor.blueprintInstance.variantId,
): void => {
  const snapshot = scene.actorBlueprints.find(
    (candidate) =>
      candidate.blueprintId === actor.blueprintInstance.blueprintId,
  );
  if (
    snapshot === undefined ||
    !snapshot.variants.some(
      (variant) => variant.variantId === variantId,
    )
  ) {
    throw blueprintReferenceError(
      `Blueprint actor reference is invalid: ${actor.id}`,
    );
  }
};

const preflightBlueprintOperations = (
  current: SceneSpec,
  patch: ScenePatch,
): void => {
  const patchIds = new Map<string, string>();
  const patchHashes = new Map<string, string>();

  for (const operation of patch.operations) {
    if (operation.op !== "actor.blueprint.register") continue;
    const { blueprintId, contentSha256 } = operation.snapshot;
    const priorIdHash = patchIds.get(blueprintId);
    if (
      priorIdHash !== undefined &&
      priorIdHash !== contentSha256
    ) {
      throw new SceneDomainError(
        "ACTOR_BLUEPRINT_ID_CONFLICT",
        `Blueprint ID conflicts inside the Patch: ${blueprintId}`,
      );
    }
    if (
      priorIdHash !== undefined ||
      patchHashes.has(contentSha256)
    ) {
      throw new SceneDomainError(
        "ACTOR_BLUEPRINT_HASH_DUPLICATE",
        "Blueprint content hash is duplicated inside the Patch.",
      );
    }
    patchIds.set(blueprintId, contentSha256);
    patchHashes.set(contentSha256, blueprintId);
  }

  for (const operation of patch.operations) {
    if (operation.op !== "actor.blueprint.register") continue;
    const existing = current.actorBlueprints.find(
      (snapshot) =>
        snapshot.blueprintId === operation.snapshot.blueprintId,
    );
    if (
      existing !== undefined &&
      existing.contentSha256 !== operation.snapshot.contentSha256
    ) {
      throw new SceneDomainError(
        "ACTOR_BLUEPRINT_ID_CONFLICT",
        `Blueprint ID is already registered: ${operation.snapshot.blueprintId}`,
      );
    }
  }

  const plannedBlueprints = structuredClone(current.actorBlueprints);
  for (const operation of patch.operations) {
    if (operation.op !== "actor.blueprint.register") continue;
    const { snapshot } = operation;
    if (
      plannedBlueprints.some(
        (candidate) =>
          candidate.blueprintId === snapshot.blueprintId ||
          candidate.contentSha256 === snapshot.contentSha256,
      )
    ) {
      continue;
    }
    plannedBlueprints.push(snapshot);
  }

  const plannedScene = { actorBlueprints: plannedBlueprints };
  const actors = new Map(
    current.entities
      .filter((entity) => entity.kind === "actor")
      .map((entity) => [entity.id, structuredClone(entity)] as const),
  );
  for (const operation of patch.operations) {
    if (operation.op === "entity.add") {
      if (isBlueprintActorEntity(operation.value)) {
        requireBlueprintVariant(plannedScene, operation.value);
      }
      if (
        !actors.has(operation.value.id) &&
        operation.value.kind === "actor"
      ) {
        actors.set(operation.value.id, structuredClone(operation.value));
      }
      continue;
    }
    if (operation.op === "entity.remove") {
      actors.delete(operation.entityId);
      continue;
    }
    if (operation.op !== "actor.variant.set") continue;
    const actor = actors.get(operation.actorId);
    if (!isBlueprintActorEntity(actor)) {
      throw blueprintReferenceError(
        `Variant target is not a blueprint actor: ${operation.actorId}`,
      );
    }
    requireBlueprintVariant(plannedScene, actor, operation.variantId);
    actor.blueprintInstance.variantId = operation.variantId;
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
  return actorAnchorWorldPoint(scene, entity, anchor);
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
    case "entity.preset.parameters.set":
    case "actor.pose.set":
      return new Set([operation.entityId]);
    case "actor.limb-presence.set":
    case "actor.variant.set":
      return new Set([operation.actorId]);
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
  preserveLock: boolean,
): SceneSpec => {
  const affectedIds = contactAffectedEntityIds(operation);
  if (affectedIds.size === 0) {
    return scene;
  }
  try {
    return enforceGroundContacts(scene, affectedIds, { preserveLock });
  } catch (error) {
    if (error instanceof ContactConstraintError) {
      throw new SceneDomainError(error.code, error.message);
    }
    throw error;
  }
};

const applyOperation = (
  scene: SceneSpec,
  operation: SceneOperation,
  preserveLock: boolean,
): void => {
  switch (operation.op) {
    case "actor.blueprint.register": {
      const existingId = scene.actorBlueprints.find(
        (snapshot) =>
          snapshot.blueprintId === operation.snapshot.blueprintId,
      );
      if (existingId !== undefined) {
        if (
          existingId.contentSha256 !== operation.snapshot.contentSha256
        ) {
          throw new SceneDomainError(
            "ACTOR_BLUEPRINT_ID_CONFLICT",
            `Blueprint ID is already registered: ${operation.snapshot.blueprintId}`,
          );
        }
        return;
      }
      if (
        scene.actorBlueprints.some(
          (snapshot) =>
            snapshot.contentSha256 === operation.snapshot.contentSha256,
        )
      ) {
        return;
      }
      scene.actorBlueprints.push(operation.snapshot);
      return;
    }
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
      requireMutable(entity, preserveLock);
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
        compositionGoalsReferenceEntity(scene, entity.id) ||
        scene.spatialLayout?.memberships.some(
          (membership) => membership.entityId === entity.id,
        ) === true
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
      requireMutable(entity, preserveLock);
      entity.transform = operation.value;
      return;
    }
    case "entity.transform.translate": {
      const entity = findEntity(scene, operation.entityId);
      requireMutable(entity, preserveLock);
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
      requireMutable(entity, preserveLock);
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
      const changesLockMode =
        operation.lockMode !== undefined &&
        operation.lockMode !== entity.lockMode;
      if (operation.visible !== undefined && !changesLockMode) {
        requireMutable(entity, preserveLock);
      }
      if (operation.visible !== undefined) {
        entity.visible = operation.visible;
      }
      if (operation.lockMode !== undefined) {
        entity.lockMode = operation.lockMode;
      }
      return;
    }
    case "entity.preset.parameters.set": {
      const entity = findEntity(scene, operation.entityId);
      requireMutable(entity, preserveLock);
      updatePresetParameters(entity, operation.value);
      return;
    }
    case "actor.pose.set": {
      const entity = findEntity(scene, operation.entityId);
      requireMutable(entity, preserveLock);
      if (entity.kind !== "actor") {
        throw new SceneDomainError(
          "ENTITY_KIND_MISMATCH",
          `Entity is not an actor: ${entity.id}`,
        );
      }
      entity.pose = operation.value;
      return;
    }
    case "actor.limb-presence.set": {
      const entity = scene.entities.find(
        (candidate) => candidate.id === operation.actorId,
      );
      if (!entity || !isLegacyActorEntity(entity)) {
        throw new SceneDomainError(
          "ACTOR_LIMB_TARGET_INVALID",
          `Actor limb target is not editable: ${operation.actorId}`,
        );
      }
      requireMutable(entity, preserveLock);
      try {
        entity.body.limbPresence = resolveActorLimbPresenceUpdates(
          entity.body.limbPresence,
          operation.updates,
        );
      } catch (error) {
        if (error instanceof ActorLimbPresenceError) {
          throw new SceneDomainError(error.code, error.message);
        }
        throw error;
      }
      return;
    }
    case "actor.variant.set": {
      const entity = scene.entities.find(
        (candidate) => candidate.id === operation.actorId,
      );
      if (!isBlueprintActorEntity(entity)) {
        throw blueprintReferenceError(
          `Variant target is not a blueprint actor: ${operation.actorId}`,
        );
      }
      requireMutable(entity, preserveLock);
      requireBlueprintVariant(scene, entity, operation.variantId);
      entity.blueprintInstance.variantId = operation.variantId;
      return;
    }
    case "camera.lens.set": {
      const entity = findEntity(scene, operation.entityId);
      requireMutable(entity, preserveLock);
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
      requireMutable(entity, preserveLock);
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
    case "spatial.region.visibility.set": {
      const layout = requireSpatialLayout(scene);
      const region = layout.regions.find(
        (candidate) => candidate.id === operation.regionId,
      );
      if (!region) {
        throw new SceneDomainError(
          "SPATIAL_REGION_NOT_FOUND",
          `Spatial region does not exist: ${operation.regionId}`,
        );
      }
      region.visible = operation.visible;
      return;
    }
    case "spatial.region.upsert": {
      upsertById(requireSpatialLayout(scene).regions, operation.value);
      return;
    }
    case "spatial.region.remove": {
      removeById(
        requireSpatialLayout(scene).regions,
        operation.regionId,
        "SPATIAL_REGION_NOT_FOUND",
        "Spatial region",
      );
      return;
    }
    case "spatial.boundary.upsert": {
      upsertById(requireSpatialLayout(scene).boundaries, operation.value);
      return;
    }
    case "spatial.boundary.visibility.set": {
      const boundary = requireSpatialLayout(scene).boundaries.find(
        (candidate) => candidate.id === operation.boundaryId,
      );
      if (!boundary) {
        throw new SceneDomainError(
          "SPATIAL_BOUNDARY_NOT_FOUND",
          `Spatial boundary does not exist: ${operation.boundaryId}`,
        );
      }
      boundary.visible = operation.visible;
      return;
    }
    case "spatial.boundary.remove": {
      removeById(
        requireSpatialLayout(scene).boundaries,
        operation.boundaryId,
        "SPATIAL_BOUNDARY_NOT_FOUND",
        "Spatial boundary",
      );
      return;
    }
    case "spatial.opening.upsert": {
      upsertById(requireSpatialLayout(scene).openings, operation.value);
      return;
    }
    case "spatial.opening.remove": {
      removeById(
        requireSpatialLayout(scene).openings,
        operation.openingId,
        "SPATIAL_OPENING_NOT_FOUND",
        "Spatial opening",
      );
      return;
    }
    case "spatial.connection.upsert": {
      upsertById(requireSpatialLayout(scene).connections, operation.value);
      return;
    }
    case "spatial.connection.remove": {
      removeById(
        requireSpatialLayout(scene).connections,
        operation.connectionId,
        "SPATIAL_CONNECTION_NOT_FOUND",
        "Spatial connection",
      );
      return;
    }
    case "spatial.membership.set": {
      const memberships = requireSpatialLayout(scene).memberships;
      const existingIndex = memberships.findIndex(
        (candidate) =>
          candidate.entityId === operation.value.entityId,
      );
      if (existingIndex === -1) {
        memberships.push(operation.value);
      } else {
        memberships[existingIndex] = operation.value;
      }
      return;
    }
    case "spatial.membership.remove": {
      const memberships = requireSpatialLayout(scene).memberships;
      const existingIndex = memberships.findIndex(
        (candidate) => candidate.entityId === operation.entityId,
      );
      if (existingIndex === -1) {
        throw new SceneDomainError(
          "SPATIAL_MEMBERSHIP_NOT_FOUND",
          `Spatial membership does not exist: ${operation.entityId}`,
        );
      }
      memberships.splice(existingIndex, 1);
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
  const currentStructure = scenePatchStructureSchema.safeParse(patchInput);
  const patch = currentStructure.success
    ? currentStructure.data
    : parseScenePatchInput(patchInput);

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
  const canonicalPatch = currentStructure.success
    ? parseScenePatchInput(patchInput)
    : patch;

  preflightBlueprintOperations(current, canonicalPatch);
  const originalLocks = preflightPreservedLocks(current, canonicalPatch);
  let next = structuredClone(current);
  for (const operation of canonicalPatch.operations) {
    const variantBefore =
      operation.op === "actor.variant.set"
        ? structuredClone(
            next.entities.find(
              (entity) => entity.id === operation.actorId,
            ),
          )
        : undefined;
    applyOperation(next, operation, canonicalPatch.preserveLock);
    next = enforceContactsForOperation(
      next,
      operation,
      canonicalPatch.preserveLock,
    );
    if (
      operation.op === "actor.variant.set" &&
      isBlueprintActorEntity(variantBefore)
    ) {
      const variantAfter = next.entities.find(
        (entity) => entity.id === operation.actorId,
      );
      if (!isBlueprintActorEntity(variantAfter)) {
        throw blueprintReferenceError(
          `Variant target disappeared: ${operation.actorId}`,
        );
      }
      const contactEnabled = next.constraints.some(
        (constraint) =>
          constraint.type === "ground-contact" &&
          constraint.enabled &&
          constraint.entityId === operation.actorId,
      );
      const expected = {
        ...variantBefore,
        blueprintInstance: {
          ...variantBefore.blueprintInstance,
          variantId: operation.variantId,
        },
        transform: contactEnabled
          ? {
              ...variantBefore.transform,
              positionM: [
                variantBefore.transform.positionM[0],
                variantAfter.transform.positionM[1],
                variantBefore.transform.positionM[2],
              ],
            }
          : variantBefore.transform,
      };
      if (JSON.stringify(expected) !== JSON.stringify(variantAfter)) {
        throw new SceneDomainError(
          "ACTOR_VARIANT_TRANSFORM_CONFLICT",
          "Variant selection changed state outside its contact-owned transform component.",
        );
      }
    }
  }
  if (canonicalPatch.preserveLock) {
    assertPreservedLocks(next, originalLocks);
  }
  const deduplicationOnly =
    canonicalPatch.operations.every(
      (operation) => operation.op === "actor.blueprint.register",
    ) && JSON.stringify(next) === JSON.stringify(current);
  next.revision = deduplicationOnly
    ? current.revision
    : current.revision + 1;

  return {
    previous: current,
    next: sceneSpecSchema.parse(next),
    patch: canonicalPatch,
  };
};
