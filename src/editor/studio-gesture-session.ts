import type { SceneEntity, SceneSpec } from "../domain/scene-schema";

export interface StudioEntityGestureSession {
  sceneId: string;
  baseRevision: number;
  entityId: string;
  entityKind: SceneEntity["kind"];
  focusedEntityId: string;
  cancelled: boolean;
}

export type StudioEntityGestureDecision =
  | { status: "commit"; preserveLock: boolean }
  | { status: "blocked"; code: "USER_LOCKED" }
  | { status: "conflict"; code: "STUDIO_GESTURE_REVISION_CONFLICT" };

export const createStudioEntityGestureSession = (
  scene: SceneSpec,
  entityId: string,
  entityKind: SceneEntity["kind"],
  focusedEntityId: string,
): StudioEntityGestureSession => ({
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  entityId,
  entityKind,
  focusedEntityId,
  cancelled: false,
});

export const decideStudioEntityGesture = (
  session: StudioEntityGestureSession | null,
  scene: SceneSpec,
  entityId: string,
): StudioEntityGestureDecision => {
  const entity = scene.entities.find((candidate) => candidate.id === entityId);
  if (
    !session ||
    session.cancelled ||
    session.sceneId !== scene.sceneId ||
    session.baseRevision !== scene.revision ||
    session.entityId !== entityId ||
    session.focusedEntityId !== entityId ||
    !entity ||
    entity.kind !== session.entityKind
  ) {
    return { status: "conflict", code: "STUDIO_GESTURE_REVISION_CONFLICT" };
  }
  if (entity.lockMode === "user") return { status: "blocked", code: "USER_LOCKED" };
  return { status: "commit", preserveLock: entity.lockMode === "workflow" };
};
