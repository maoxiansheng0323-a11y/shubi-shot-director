import type { CanonicalPuppetJointId } from "../domain/actor-joints";
import type { SceneEntity, SceneSpec } from "../domain/scene-schema";

export const STUDIO_POINTER_DRAG_THRESHOLD_PX = 5;
export const STUDIO_DOUBLE_CLICK_MS = 300;

export interface StudioFocusState {
  selectedEntityId: string | null;
  focusedEntityId: string | null;
  focusedActorJointId: CanonicalPuppetJointId | null;
  focusRequestVersion: number;
}

export type StudioPointerClassification =
  | "click"
  | "double-click"
  | "drag"
  | "clear"
  | "pan";

export interface StudioPointerClassificationInput {
  button: 0 | 2;
  down: readonly [number, number];
  up: readonly [number, number];
  elapsedMs: number;
  previousClickAtMs: number | null;
  nowMs: number;
}

const isEditableEntity = (entity: SceneEntity): boolean =>
  entity.kind === "actor" || entity.kind === "prop" || entity.kind === "camera";

export const hasStudioPointerExceededDragThreshold = (
  down: readonly [number, number],
  up: readonly [number, number],
): boolean =>
  Math.hypot(up[0] - down[0], up[1] - down[1]) >
  STUDIO_POINTER_DRAG_THRESHOLD_PX;

export const createStudioFocusState = (): StudioFocusState => ({
  selectedEntityId: null,
  focusedEntityId: null,
  focusedActorJointId: null,
  focusRequestVersion: 0,
});

export const classifyStudioPointer = ({
  button,
  down,
  up,
  elapsedMs,
  previousClickAtMs,
  nowMs,
}: StudioPointerClassificationInput): StudioPointerClassification => {
  const moved = hasStudioPointerExceededDragThreshold(down, up);
  if (button === 2) return moved ? "pan" : "clear";
  if (moved) return "drag";
  if (
    elapsedMs <= STUDIO_DOUBLE_CLICK_MS &&
    previousClickAtMs !== null &&
    nowMs - previousClickAtMs <= STUDIO_DOUBLE_CLICK_MS
  ) {
    return "double-click";
  }
  return "click";
};

export const focusStudioEntity = (
  state: StudioFocusState,
  scene: SceneSpec,
  entityId: string,
): StudioFocusState => {
  const entity = scene.entities.find((candidate) => candidate.id === entityId);
  if (!entity || !entity.visible) return state;
  return {
    selectedEntityId: entity.id,
    focusedEntityId: isEditableEntity(entity) ? entity.id : null,
    focusedActorJointId: null,
    focusRequestVersion: state.focusRequestVersion + 1,
  };
};

export const clearStudioFocus = (
  state: StudioFocusState,
): StudioFocusState => ({
  ...state,
  selectedEntityId: null,
  focusedEntityId: null,
  focusedActorJointId: null,
  focusRequestVersion: state.focusRequestVersion + 1,
});

export const reconcileStudioFocus = (
  state: StudioFocusState,
  previousScene: SceneSpec | null,
  nextScene: SceneSpec,
): StudioFocusState => {
  const previousFocused = previousScene?.entities.find(
    (entity) => entity.id === state.focusedEntityId,
  );
  const nextFocused = nextScene.entities.find(
    (entity) => entity.id === state.focusedEntityId,
  );
  const focusStillValid =
    previousScene?.sceneId === nextScene.sceneId &&
    previousFocused !== undefined &&
    nextFocused !== undefined &&
    nextFocused.visible &&
    previousFocused.kind === nextFocused.kind &&
    isEditableEntity(nextFocused);
  const selectedStillValid =
    state.selectedEntityId !== null &&
    nextScene.entities.some(
      (entity) => entity.id === state.selectedEntityId && entity.visible,
    );
  if (!focusStillValid && state.focusedEntityId !== null) {
    return {
      ...state,
      selectedEntityId: selectedStillValid ? state.selectedEntityId : null,
      focusedEntityId: null,
      focusedActorJointId: null,
      focusRequestVersion: state.focusRequestVersion + 1,
    };
  }
  return {
    ...state,
    selectedEntityId: selectedStillValid ? state.selectedEntityId : null,
    focusedActorJointId:
      nextFocused?.kind === "actor" ? state.focusedActorJointId : null,
  };
};
