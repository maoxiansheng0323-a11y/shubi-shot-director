import {
  scenePatchSchema,
  type ScenePatch,
} from "./scene-patch";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "./scene-schema";
import { PATCH_SCHEMA_VERSION } from "./schema-versions";
import { applyScenePatch } from "./apply-scene-patch";

export const WORKFLOW_LOCK_CHECKPOINT_INVALID =
  "WORKFLOW_LOCK_CHECKPOINT_INVALID";

export class WorkflowLockCheckpointError extends Error {
  readonly code = WORKFLOW_LOCK_CHECKPOINT_INVALID;

  constructor() {
    super("The workflow lock checkpoint response is invalid.");
    this.name = "WorkflowLockCheckpointError";
  }
}

export const createWorkflowLockCheckpointPatch = (
  scene: SceneSpec,
  patchId: string,
  source: ScenePatch["source"],
): ScenePatch | null => {
  const operations = scene.entities
    .filter((entity) => entity.lockMode === "none")
    .map((entity) => ({
      op: "entity.flags.set" as const,
      entityId: entity.id,
      lockMode: "workflow" as const,
    }));
  if (operations.length === 0) {
    return null;
  }

  return scenePatchSchema.parse({
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId,
    sceneId: scene.sceneId,
    baseRevision: scene.revision,
    source,
    preserveLock: false,
    operations,
  });
};

export const validateWorkflowLockCheckpointAcceptance = (
  beforeInput: SceneSpec,
  checkpointInput: ScenePatch,
  acceptedInput: SceneSpec,
): SceneSpec => {
  try {
    const before = sceneSpecSchema.parse(beforeInput);
    const checkpoint = scenePatchSchema.parse(checkpointInput);
    const accepted = sceneSpecSchema.parse(acceptedInput);
    const expected = applyScenePatch(before, checkpoint).next;
    if (JSON.stringify(accepted) !== JSON.stringify(expected)) {
      throw new WorkflowLockCheckpointError();
    }
    return accepted;
  } catch (error) {
    if (error instanceof WorkflowLockCheckpointError) {
      throw error;
    }
    throw new WorkflowLockCheckpointError();
  }
};
