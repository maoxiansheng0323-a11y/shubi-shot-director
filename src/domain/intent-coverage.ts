import {
  ACTOR_LIMB_EVIDENCE_PATHS,
  intentReportSchema,
  type ActorLimbEvidencePath,
  type IntentConstraint,
  type IntentEvidence,
  type IntentReport,
} from "./intent-report";
import { IntentSubmissionError } from "./intent-submission-error";
import type {
  SceneOperation,
  ScenePatch,
} from "./scene-patch";
import type {
  SceneConstraint,
  SceneEntity,
  SceneSpec,
} from "./scene-schema";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
} from "./scene-schema";

export interface IntentCoverageContext {
  before?: SceneSpec;
  after: SceneSpec;
  patch?: ScenePatch;
}

type IntentKind = IntentConstraint["kind"];
type EntityEvidencePath = Extract<
  IntentEvidence,
  { type: "entity-property" }
>["path"];
type SceneEvidencePath = Extract<
  IntentEvidence,
  { type: "scene-property" }
>["path"];

interface EvidenceAssessment {
  primary: boolean;
  targetIds: ReadonlySet<string>;
}

const PRIMARY_ENTITY_EVIDENCE_KINDS = new Set<IntentKind>([
  "environment",
  "entity-presence",
  "entity-removal",
]);

const createActorLimbPropertyKinds = (): Record<
  ActorLimbEvidencePath,
  readonly IntentKind[]
> => {
  const kinds = {} as Record<
    ActorLimbEvidencePath,
    readonly IntentKind[]
  >;
  for (const path of ACTOR_LIMB_EVIDENCE_PATHS) {
    kinds[path] = ["actor-limb-presence"];
  }
  return kinds;
};

const actorLimbPropertyKinds = createActorLimbPropertyKinds();

const ACTOR_LIMB_EVIDENCE_PATH_SET: ReadonlySet<string> = new Set(
  ACTOR_LIMB_EVIDENCE_PATHS,
);

const isActorLimbEvidencePath = (
  path: EntityEvidencePath,
): path is ActorLimbEvidencePath =>
  ACTOR_LIMB_EVIDENCE_PATH_SET.has(path);

const ENTITY_PROPERTY_KINDS: Record<
  EntityEvidencePath,
  readonly IntentKind[]
> = {
  "entity.kind": ["environment", "entity-presence", "entity-removal"],
  "entity.parentId": ["relationship"],
  "entity.transform.positionM": [
    "position",
    "relationship",
    "camera-height",
  ],
  "entity.transform.rotation": [
    "rotation",
    "relationship",
    "camera-angle",
    "camera-target",
  ],
  "entity.transform.scale": ["scale"],
  "entity.visible": ["visibility"],
  "entity.lockMode": ["lock-protection"],
  "actor.slot": ["actor-slot"],
  "actor.pose": ["pose", "relationship"],
  "actor.blueprintInstance": [
    "actor-blueprint-instance",
    "actor-blueprint-variant",
    "actor-limb-presence",
  ],
  "actor.body.heightM": ["actor-height"],
  "actor.blueprintInstance.heightScale": ["actor-height"],
  ...actorLimbPropertyKinds,
  "camera.heightM": ["camera-height"],
  "camera.lens.focalLengthMm": ["focal-length"],
  "camera.lens.sensorWidthMm": ["focal-length"],
};

const idsFromGoals = (
  goals: SceneSpec["compositionGoals"],
): ReadonlySet<string> =>
  new Set([
    ...(goals?.framing?.targetEntityIds ?? []),
    ...(goals?.criticalEntityIds ?? []),
  ]);

const idsFromConstraint = (
  constraint: SceneConstraint,
): ReadonlySet<string> =>
  constraint.type === "ground-contact"
    ? new Set(
        constraint.surfaceEntityId === null
          ? [constraint.entityId]
          : [constraint.entityId, constraint.surfaceEntityId],
      )
    : new Set([constraint.cameraId, constraint.subjectEntityId]);

const visibleScenes = (
  report: IntentReport,
  context: IntentCoverageContext,
): SceneSpec[] =>
  report.operation === "create"
    ? [context.after]
    : [context.after, context.before].filter(
        (scene): scene is SceneSpec => scene !== undefined,
      );

const entityForConstraint = (
  constraint: IntentConstraint,
  report: IntentReport,
  entityId: string,
  context: IntentCoverageContext,
): SceneEntity | undefined => {
  if (report.operation === "create") {
    return context.after.entities.find((entity) => entity.id === entityId);
  }
  if (constraint.kind === "entity-removal") {
    return context.before?.entities.find((entity) => entity.id === entityId);
  }
  if (constraint.kind === "entity-presence") {
    return context.after.entities.find((entity) => entity.id === entityId);
  }
  const afterEntity = context.after.entities.find(
    (entity) => entity.id === entityId,
  );
  if (afterEntity !== undefined) {
    return afterEntity;
  }
  return context.before?.entities.find((entity) => entity.id === entityId);
};

const entityPropertyExists = (
  entity: SceneEntity,
  path: EntityEvidencePath,
): boolean => {
  if (isActorLimbEvidencePath(path)) {
    return isLegacyActorEntity(entity);
  }
  switch (path) {
    case "entity.kind":
    case "entity.parentId":
    case "entity.transform.positionM":
    case "entity.transform.rotation":
    case "entity.transform.scale":
    case "entity.visible":
    case "entity.lockMode":
      return true;
    case "actor.slot":
    case "actor.pose":
      return entity.kind === "actor";
    case "actor.body.heightM":
      return isLegacyActorEntity(entity);
    case "actor.blueprintInstance":
    case "actor.blueprintInstance.heightScale":
      return isBlueprintActorEntity(entity);
    case "camera.heightM":
      return (
        entity.kind === "camera" &&
        Number.isFinite(entity.transform.positionM[1])
      );
    case "camera.lens.focalLengthMm":
      return (
        entity.kind === "camera" &&
        Number.isFinite(entity.lens.focalLengthMm)
      );
    case "camera.lens.sensorWidthMm":
      return (
        entity.kind === "camera" &&
        Number.isFinite(entity.lens.sensorWidthMm)
      );
  }
};

const scenePropertyKinds = (
  path: SceneEvidencePath,
): readonly IntentKind[] => {
  switch (path) {
    case "scene.activeCameraId":
      return ["composition-safety"];
    case "scene.output":
      return ["output"];
    case "scene.compositionGoals":
    case "scene.compositionGoals.framing":
      return ["framing", "composition-safety"];
    case "scene.compositionGoals.captionZone":
    case "scene.compositionGoals.sideUiZone":
    case "scene.compositionGoals.criticalEntityIds":
      return ["composition-safety"];
    case "scene.spatialLayout.regions":
      return ["spatial-region", "region-visibility"];
    case "scene.spatialLayout.boundaries":
      return ["spatial-boundary"];
    case "scene.spatialLayout.openings":
      return ["spatial-opening"];
    case "scene.spatialLayout.connections":
      return ["spatial-connection"];
    case "scene.spatialLayout.memberships":
      return ["entity-region-membership"];
    case "scene.actorBlueprints":
      return ["actor-blueprint-registration"];
  }
};

const scenePropertyAssessment = (
  path: SceneEvidencePath,
  scenes: readonly SceneSpec[],
): EvidenceAssessment | undefined => {
  for (const scene of scenes) {
    switch (path) {
      case "scene.activeCameraId":
        return {
          primary: true,
          targetIds: new Set([scene.activeCameraId]),
        };
      case "scene.output":
        return { primary: true, targetIds: new Set() };
      case "scene.compositionGoals":
        if (scene.compositionGoals !== undefined) {
          return {
            primary: true,
            targetIds: idsFromGoals(scene.compositionGoals),
          };
        }
        break;
      case "scene.compositionGoals.framing":
        if (scene.compositionGoals?.framing !== undefined) {
          return {
            primary: true,
            targetIds: new Set(
              scene.compositionGoals.framing.targetEntityIds,
            ),
          };
        }
        break;
      case "scene.compositionGoals.captionZone":
        if (scene.compositionGoals?.captionZone !== undefined) {
          return { primary: true, targetIds: new Set() };
        }
        break;
      case "scene.compositionGoals.sideUiZone":
        if (scene.compositionGoals?.sideUiZone !== undefined) {
          return { primary: true, targetIds: new Set() };
        }
        break;
      case "scene.compositionGoals.criticalEntityIds":
        if (scene.compositionGoals?.criticalEntityIds !== undefined) {
          return {
            primary: true,
            targetIds: new Set(
              scene.compositionGoals.criticalEntityIds,
            ),
          };
        }
        break;
      case "scene.spatialLayout.regions":
        if (scene.spatialLayout !== null) {
          return {
            primary: true,
            targetIds: new Set(
              scene.spatialLayout.regions.map(({ id }) => id),
            ),
          };
        }
        break;
      case "scene.spatialLayout.boundaries":
        if (scene.spatialLayout !== null) {
          return {
            primary: true,
            targetIds: new Set(
              scene.spatialLayout.boundaries.map(({ id }) => id),
            ),
          };
        }
        break;
      case "scene.spatialLayout.openings":
        if (scene.spatialLayout !== null) {
          return {
            primary: true,
            targetIds: new Set(
              scene.spatialLayout.openings.map(({ id }) => id),
            ),
          };
        }
        break;
      case "scene.spatialLayout.connections":
        if (scene.spatialLayout !== null) {
          return {
            primary: true,
            targetIds: new Set(
              scene.spatialLayout.connections.map(({ id }) => id),
            ),
          };
        }
        break;
      case "scene.spatialLayout.memberships":
        if (scene.spatialLayout !== null) {
          return {
            primary: true,
            targetIds: new Set(
              scene.spatialLayout.memberships.flatMap(
                ({ entityId, regionId }) => [entityId, regionId],
              ),
            ),
          };
        }
        break;
      case "scene.actorBlueprints":
        return {
          primary: true,
          targetIds: new Set(
            scene.actorBlueprints.map(({ blueprintId }) => blueprintId),
          ),
        };
    }
  }
  return undefined;
};

const constraintSupportsKind = (
  constraint: SceneConstraint,
  kind: IntentKind,
): boolean =>
  constraint.type === "ground-contact"
    ? kind === "contact" || kind === "relationship"
    : kind === "camera-target" || kind === "composition-safety";

const entityKindsForAddedEntity = (
  entity: SceneEntity,
): ReadonlySet<IntentKind> => {
  const kinds = new Set<IntentKind>([
    "entity-presence",
    "position",
    "rotation",
    "scale",
    "visibility",
    "relationship",
    "camera-target",
  ]);
  if (entity.kind === "environment") {
    kinds.add("environment");
  }
  if (entity.kind === "actor") {
    kinds.add("actor-slot");
    kinds.add("pose");
    kinds.add("actor-height");
    kinds.add("actor-limb-presence");
    if (isBlueprintActorEntity(entity)) {
      kinds.add("actor-blueprint-instance");
    }
  }
  if (entity.kind === "camera") {
    kinds.add("camera-height");
    kinds.add("camera-angle");
    kinds.add("camera-target");
    kinds.add("focal-length");
  }
  return kinds;
};

const operationEntity = (
  entityId: string,
  report: IntentReport,
  context: IntentCoverageContext,
): SceneEntity | undefined => {
  const afterEntity = context.after.entities.find(
    (entity) => entity.id === entityId,
  );
  if (report.operation === "create" || afterEntity !== undefined) {
    return afterEntity;
  }
  return context.before?.entities.find((entity) => entity.id === entityId);
};

const operationAssessment = (
  operation: SceneOperation,
  kind: IntentKind,
  report: IntentReport,
  context: IntentCoverageContext,
): EvidenceAssessment | undefined => {
  switch (operation.op) {
    case "actor.blueprint.register":
      return kind === "actor-blueprint-registration"
        ? {
            primary: true,
            targetIds: new Set([operation.snapshot.blueprintId]),
          }
        : undefined;
    case "entity.add":
      if (kind === "camera-target") {
        return {
          primary: operation.value.kind === "camera",
          targetIds: new Set([operation.value.id]),
        };
      }
      return entityKindsForAddedEntity(operation.value).has(kind)
        ? { primary: true, targetIds: new Set([operation.value.id]) }
        : undefined;
    case "entity.remove":
      return kind === "entity-removal" &&
        context.before?.entities.some(
          (entity) => entity.id === operation.entityId,
        )
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    case "entity.transform.set": {
      const entity = operationEntity(operation.entityId, report, context);
      const compatible = new Set<IntentKind>([
        "position",
        "rotation",
        "scale",
        "relationship",
      ]);
      if (entity?.kind === "camera") {
        compatible.add("camera-height");
        compatible.add("camera-angle");
        compatible.add("camera-target");
      }
      return compatible.has(kind)
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    }
    case "entity.transform.translate": {
      const entity = operationEntity(operation.entityId, report, context);
      return kind === "position" ||
        kind === "relationship" ||
        (kind === "camera-height" && entity?.kind === "camera")
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    }
    case "entity.transform.rotate": {
      const entity = operationEntity(operation.entityId, report, context);
      return kind === "rotation" ||
        kind === "relationship" ||
        ((kind === "camera-angle" || kind === "camera-target") &&
          entity?.kind === "camera")
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    }
    case "entity.flags.set":
      return (kind === "visibility" && operation.visible !== undefined) ||
        (kind === "lock-protection" && operation.lockMode !== undefined)
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    case "entity.preset.parameters.set":
      return kind === "environment" &&
        operationEntity(operation.entityId, report, context)?.kind ===
          "environment"
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    case "actor.pose.set":
      return (kind === "pose" || kind === "relationship") &&
        operationEntity(operation.entityId, report, context)?.kind === "actor"
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    case "actor.height.set":
      return kind === "actor-height" &&
        operationEntity(operation.actorId, report, context)?.kind === "actor"
        ? { primary: true, targetIds: new Set([operation.actorId]) }
        : undefined;
    case "actor.pose.joints.set":
      return kind === "pose" &&
        operationEntity(operation.actorId, report, context)?.kind === "actor"
        ? { primary: true, targetIds: new Set([operation.actorId]) }
        : undefined;
    case "actor.limb-presence.set":
      return kind === "actor-limb-presence" &&
        operationEntity(operation.actorId, report, context)?.kind === "actor"
        ? { primary: true, targetIds: new Set([operation.actorId]) }
        : undefined;
    case "actor.variant.set":
      return kind === "actor-blueprint-variant" &&
        isBlueprintActorEntity(
          operationEntity(operation.actorId, report, context),
        )
        ? { primary: true, targetIds: new Set([operation.actorId]) }
        : undefined;
    case "camera.lens.set":
      return kind === "focal-length" &&
        operationEntity(operation.entityId, report, context)?.kind === "camera"
        ? { primary: true, targetIds: new Set([operation.entityId]) }
        : undefined;
    case "camera.look-at": {
      if (
        (kind !== "camera-angle" && kind !== "camera-target") ||
        operationEntity(operation.entityId, report, context)?.kind !== "camera"
      ) {
        return undefined;
      }
      return {
        primary: true,
        targetIds: new Set(
          operation.target.type === "entity-anchor"
            ? [operation.entityId, operation.target.entityId]
            : [operation.entityId],
        ),
      };
    }
    case "constraint.set":
      return constraintSupportsKind(operation.value, kind)
        ? { primary: true, targetIds: idsFromConstraint(operation.value) }
        : undefined;
    case "constraint.remove": {
      const constraint = context.before?.constraints.find(
        (candidate) => candidate.id === operation.constraintId,
      );
      return constraint && constraintSupportsKind(constraint, kind)
        ? { primary: true, targetIds: idsFromConstraint(constraint) }
        : undefined;
    }
    case "scene.active-camera.set":
      return kind === "composition-safety" &&
        operationEntity(operation.cameraId, report, context)?.kind === "camera"
        ? { primary: true, targetIds: new Set([operation.cameraId]) }
        : undefined;
    case "scene.output.set":
      return kind === "output"
        ? { primary: true, targetIds: new Set() }
        : undefined;
    case "scene.composition-goals.set":
      return kind === "framing" || kind === "composition-safety"
        ? {
            primary: true,
            targetIds:
              operation.value === null
                ? idsFromGoals(context.before?.compositionGoals)
                : idsFromGoals(operation.value),
          }
        : undefined;
    case "scene.title.set":
      return undefined;
    case "spatial.region.visibility.set":
      return kind === "region-visibility"
        ? { primary: true, targetIds: new Set([operation.regionId]) }
        : undefined;
    case "spatial.region.upsert":
      return kind === "spatial-region"
        ? { primary: true, targetIds: new Set([operation.value.id]) }
        : undefined;
    case "spatial.region.remove":
      return kind === "spatial-region"
        ? { primary: true, targetIds: new Set([operation.regionId]) }
        : undefined;
    case "spatial.boundary.upsert":
      return kind === "spatial-boundary"
        ? { primary: true, targetIds: new Set([operation.value.id]) }
        : undefined;
    case "spatial.boundary.visibility.set":
      return kind === "spatial-boundary"
        ? { primary: true, targetIds: new Set([operation.boundaryId]) }
        : undefined;
    case "spatial.boundary.remove":
      return kind === "spatial-boundary"
        ? { primary: true, targetIds: new Set([operation.boundaryId]) }
        : undefined;
    case "spatial.opening.upsert":
      return kind === "spatial-opening"
        ? { primary: true, targetIds: new Set([operation.value.id]) }
        : undefined;
    case "spatial.opening.remove":
      return kind === "spatial-opening"
        ? { primary: true, targetIds: new Set([operation.openingId]) }
        : undefined;
    case "spatial.connection.upsert":
      return kind === "spatial-connection"
        ? { primary: true, targetIds: new Set([operation.value.id]) }
        : undefined;
    case "spatial.connection.remove":
      return kind === "spatial-connection"
        ? { primary: true, targetIds: new Set([operation.connectionId]) }
        : undefined;
    case "spatial.membership.set":
      return kind === "entity-region-membership"
        ? {
            primary: true,
            targetIds: new Set([
              operation.value.entityId,
              operation.value.regionId,
            ]),
          }
        : undefined;
    case "spatial.membership.remove": {
      if (kind !== "entity-region-membership") {
        return undefined;
      }
      const membership = context.before?.spatialLayout?.memberships.find(
        (candidate) => candidate.entityId === operation.entityId,
      );
      return {
        primary: true,
        targetIds: new Set(
          membership
            ? [operation.entityId, membership.regionId]
            : [operation.entityId],
        ),
      };
    }
  }
};

const SPATIAL_INTENT_KINDS = new Set<IntentKind>([
  "spatial-region",
  "spatial-boundary",
  "spatial-opening",
  "spatial-connection",
  "entity-region-membership",
  "region-visibility",
]);

const spatialTargetIds = (
  scene: SceneSpec,
  kind: IntentKind,
): ReadonlySet<string> => {
  const layout = scene.spatialLayout;
  if (layout === null) {
    return new Set();
  }
  switch (kind) {
    case "spatial-region":
    case "region-visibility":
      return new Set(layout.regions.map(({ id }) => id));
    case "spatial-boundary":
      return new Set(layout.boundaries.map(({ id }) => id));
    case "spatial-opening":
      return new Set(layout.openings.map(({ id }) => id));
    case "spatial-connection":
      return new Set(layout.connections.map(({ id }) => id));
    case "entity-region-membership":
      return new Set(
        layout.memberships.flatMap(({ entityId, regionId }) => [
          entityId,
          regionId,
        ]),
      );
    default:
      return new Set();
  }
};

const targetKindsAreValid = (
  constraint: IntentConstraint,
  report: IntentReport,
  context: IntentCoverageContext,
): boolean => {
  if (constraint.kind === "actor-blueprint-registration") {
    const blueprintIds = new Set(
      visibleScenes(report, context).flatMap((scene) =>
        scene.actorBlueprints.map(({ blueprintId }) => blueprintId),
      ),
    );
    return (
      constraint.targets.length > 0 &&
      constraint.targets.every((targetId) => blueprintIds.has(targetId))
    );
  }
  if (SPATIAL_INTENT_KINDS.has(constraint.kind)) {
    const availableTargets = new Set(
      visibleScenes(report, context).flatMap((scene) => [
        ...spatialTargetIds(scene, constraint.kind),
      ]),
    );
    return (
      constraint.targets.length > 0 &&
      constraint.targets.every((targetId) => availableTargets.has(targetId))
    );
  }
  if (constraint.targets.length === 0) {
    return (
      constraint.kind === "output" ||
      constraint.kind === "composition-safety"
    );
  }
  const targetEntities = constraint.targets.map((targetId) =>
    entityForConstraint(constraint, report, targetId, context),
  );
  if (targetEntities.some((entity) => entity === undefined)) {
    return false;
  }
  switch (constraint.kind) {
    case "actor-slot":
    case "pose":
    case "actor-height":
    case "actor-limb-presence":
      return (
        targetEntities.length > 0 &&
        targetEntities.every((entity) => entity?.kind === "actor")
      );
    case "actor-blueprint-instance":
    case "actor-blueprint-variant":
      return (
        targetEntities.length > 0 &&
        targetEntities.every(isBlueprintActorEntity)
      );
    case "camera-height":
    case "camera-angle":
    case "focal-length":
      return (
        targetEntities.length > 0 &&
        targetEntities.every((entity) => entity?.kind === "camera")
      );
    case "camera-target":
      return (
        targetEntities.length > 0 &&
        targetEntities.some((entity) => entity?.kind === "camera")
      );
    case "environment":
      return (
        targetEntities.length > 0 &&
        targetEntities.every((entity) => entity?.kind === "environment")
      );
    case "entity-removal":
      return (
        report.operation === "modify" &&
        constraint.targets.every(
          (targetId) =>
            !context.after.entities.some((entity) => entity.id === targetId),
        )
      );
    case "relationship":
      return targetEntities.length >= 2;
    case "contact": {
      if (targetEntities.length < 1 || targetEntities.length > 2) {
        return false;
      }
      const actors = targetEntities.filter(
        (entity) => entity?.kind === "actor",
      );
      if (actors.length !== 1) {
        return false;
      }
      if (targetEntities.length === 1) {
        return true;
      }
      const surface = targetEntities.find((entity) => entity?.kind !== "actor");
      return surface?.kind === "environment" || surface?.kind === "prop";
    }
    case "framing":
      return targetEntities.every(
        (entity) => entity?.kind === "actor" || entity?.kind === "prop",
      );
    default:
      return true;
  }
};

const evidenceAssessment = (
  evidence: IntentEvidence,
  constraint: IntentConstraint,
  report: IntentReport,
  context: IntentCoverageContext,
): EvidenceAssessment | undefined => {
  switch (evidence.type) {
    case "entity": {
      const entity = entityForConstraint(
        constraint,
        report,
        evidence.entityId,
        context,
      );
      return entity
        ? {
            primary: PRIMARY_ENTITY_EVIDENCE_KINDS.has(constraint.kind),
            targetIds: new Set([evidence.entityId]),
          }
        : undefined;
    }
    case "entity-property": {
      if (
        (constraint.kind === "actor-limb-presence" ||
          constraint.kind === "actor-blueprint-instance" ||
          constraint.kind === "actor-blueprint-variant") &&
        report.operation === "modify"
      ) {
        return undefined;
      }
      if (!ENTITY_PROPERTY_KINDS[evidence.path].includes(constraint.kind)) {
        return undefined;
      }
      const entity = entityForConstraint(
        constraint,
        report,
        evidence.entityId,
        context,
      );
      return entity && entityPropertyExists(entity, evidence.path)
        ? {
            primary:
              constraint.kind !== "camera-target" ||
              evidence.path !== "entity.transform.rotation" ||
              entity.kind === "camera",
            targetIds: new Set([evidence.entityId]),
          }
        : undefined;
    }
    case "scene-property": {
      if (
        constraint.kind === "actor-blueprint-registration" &&
        report.operation === "modify"
      ) {
        return undefined;
      }
      if (!scenePropertyKinds(evidence.path).includes(constraint.kind)) {
        return undefined;
      }
      return scenePropertyAssessment(
        evidence.path,
        visibleScenes(report, context),
      );
    }
    case "scene-constraint": {
      const afterConstraint = context.after.constraints.find(
        (candidate) => candidate.id === evidence.constraintId,
      );
      const matching =
        report.operation === "create" || afterConstraint !== undefined
          ? afterConstraint
          : context.before?.constraints.find(
              (candidate) => candidate.id === evidence.constraintId,
            );
      return matching && constraintSupportsKind(matching, constraint.kind)
        ? { primary: true, targetIds: idsFromConstraint(matching) }
        : undefined;
    }
    case "patch-operation": {
      const operation = context.patch?.operations[evidence.operationIndex];
      return operation
        ? operationAssessment(operation, constraint.kind, report, context)
        : undefined;
    }
  }
};

const intersects = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean => [...left].some((value) => right.has(value));

const coverageIsComplete = (
  constraint: IntentConstraint,
  report: IntentReport,
  context: IntentCoverageContext,
): boolean => {
  if (!targetKindsAreValid(constraint, report, context)) {
    return false;
  }
  if (constraint.required && constraint.evidence.length === 0) {
    return false;
  }

  const declaredTargets = new Set(constraint.targets);
  const coveredTargets = new Set<string>();
  let hasPrimaryEvidence = false;

  for (const evidence of constraint.evidence) {
    if (
      evidence.type === "entity" &&
      !declaredTargets.has(evidence.entityId)
    ) {
      return false;
    }
    if (
      evidence.type === "entity-property" &&
      !declaredTargets.has(evidence.entityId)
    ) {
      return false;
    }
    const assessment = evidenceAssessment(
      evidence,
      constraint,
      report,
      context,
    );
    if (!assessment) {
      return false;
    }
    if (
      declaredTargets.size > 0 &&
      assessment.targetIds.size > 0 &&
      !intersects(assessment.targetIds, declaredTargets)
    ) {
      return false;
    }
    hasPrimaryEvidence ||= assessment.primary;
    for (const targetId of assessment.targetIds) {
      if (declaredTargets.has(targetId)) {
        coveredTargets.add(targetId);
      }
    }
  }

  return (
    !constraint.required ||
    (hasPrimaryEvidence &&
      constraint.targets.every((targetId) => coveredTargets.has(targetId)))
  );
};

export const validateIntentPolicy = (
  report: IntentReport,
  operation?: IntentReport["operation"],
): void => {
  if (!report.canApplySafely) {
    throw new IntentSubmissionError("UNSUPPORTED_DESCRIPTION");
  }
  if (operation !== undefined && report.operation !== operation) {
    throw new IntentSubmissionError("INTENT_REPORT_INVALID");
  }
  if (report.operation === "create" && report.allowPartial) {
    throw new IntentSubmissionError("INTENT_REPORT_INVALID");
  }
  if (
    !report.allowPartial &&
    (report.unsupportedConstraints.length > 0 ||
      report.unresolvedRelations.length > 0)
  ) {
    throw new IntentSubmissionError("UNSUPPORTED_DESCRIPTION");
  }
};

export const validateIntentCoverage = (
  reportInput: IntentReport,
  context: IntentCoverageContext,
): void => {
  const parsed = intentReportSchema.safeParse(reportInput);
  if (!parsed.success) {
    throw new IntentSubmissionError("INTENT_REPORT_INVALID");
  }
  const report = parsed.data;
  validateIntentPolicy(report);

  if (
    report.recognizedConstraints.some(
      (constraint) => !coverageIsComplete(constraint, report, context),
    )
  ) {
    throw new IntentSubmissionError("INTENT_COVERAGE_INCOMPLETE");
  }
};
