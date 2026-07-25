import {
  intentReportSchema,
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
  "entity.locked": [],
  "actor.slot": ["actor-slot"],
  "actor.pose": ["pose", "relationship"],
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
  switch (path) {
    case "entity.kind":
    case "entity.parentId":
    case "entity.transform.positionM":
    case "entity.transform.rotation":
    case "entity.transform.scale":
    case "entity.visible":
    case "entity.locked":
      return true;
    case "actor.slot":
    case "actor.pose":
      return entity.kind === "actor";
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
      return kind === "visibility"
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
  }
};

const targetKindsAreValid = (
  constraint: IntentConstraint,
  report: IntentReport,
  context: IntentCoverageContext,
): boolean => {
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
      return (
        targetEntities.length > 0 &&
        targetEntities.every((entity) => entity?.kind === "actor")
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
