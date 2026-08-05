import { useEffect, type ReactNode } from "react";
import type { SceneSpec, TransformSpec, Vec3 } from "../domain/scene-schema";
import { moveEntityByEditorKey } from "./studio-interaction-math";
import { hasStudioPointerExceededDragThreshold } from "./studio-selection";

export interface StudioInteractionControllerProps {
  scene: SceneSpec;
  surface: HTMLElement | null;
  selectedEntityId: string | null;
  focusedEntityId: string | null;
  editorViewDirection: Vec3;
  disabled?: boolean;
  onCommitTransform: (entityId: string, transform: TransformSpec) => void | Promise<void>;
  onClearFocus: () => void;
  children: ReactNode;
}

const MOVEMENT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
]);

const isKeyboardExcluded = (target: EventTarget | null): boolean => {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(
    element?.closest?.(
      '[data-studio-keyboard-exclusion], input, select, textarea, button, [contenteditable="true"]',
    ),
  );
};

/**
 * Keeps editor-only keyboard behavior beside the viewport without putting any
 * of that transient state into SceneSpec.
 */
export const StudioInteractionController = ({
  scene,
  surface,
  selectedEntityId,
  focusedEntityId,
  editorViewDirection,
  disabled = false,
  onCommitTransform,
  onClearFocus,
  children,
}: StudioInteractionControllerProps) => {
  useEffect(() => {
    if (!surface) return;

    let rightGesture: {
      pointerId: number;
      down: readonly [number, number];
      dragged: boolean;
    } | null = null;

    const handlePointerDown = (event: PointerEvent): void => {
      if (disabled || event.button !== 2) return;
      rightGesture = {
        pointerId: event.pointerId,
        down: [event.clientX, event.clientY],
        dragged: false,
      };
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (!rightGesture || rightGesture.pointerId !== event.pointerId) return;
      if (
        hasStudioPointerExceededDragThreshold(rightGesture.down, [
          event.clientX,
          event.clientY,
        ])
      ) {
        rightGesture.dragged = true;
      }
    };

    const handlePointerUp = (event: PointerEvent): void => {
      if (!rightGesture || rightGesture.pointerId !== event.pointerId) return;
      const shouldClear =
        !rightGesture.dragged &&
        !hasStudioPointerExceededDragThreshold(rightGesture.down, [
          event.clientX,
          event.clientY,
        ]);
      rightGesture = null;
      if (!disabled && shouldClear) onClearFocus();
    };

    const handlePointerCancellation = (event: PointerEvent): void => {
      if (rightGesture?.pointerId === event.pointerId) rightGesture = null;
    };

    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (disabled || isKeyboardExcluded(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClearFocus();
        return;
      }
      if (!MOVEMENT_KEYS.has(event.key)) return;
      const entityId = focusedEntityId ?? selectedEntityId;
      const entity = scene.entities.find(
        (candidate) => candidate.id === entityId,
      );
      if (!entity || entity.kind === "environment" || entity.lockMode === "user") {
        return;
      }
      event.preventDefault();
      const transform = moveEntityByEditorKey(
        entity.transform,
        event.key as
          | "ArrowUp"
          | "ArrowDown"
          | "ArrowLeft"
          | "ArrowRight"
          | "PageUp"
          | "PageDown",
        editorViewDirection,
        event,
      );
      void onCommitTransform(entity.id, transform);
    };

    surface.addEventListener("pointerdown", handlePointerDown);
    surface.addEventListener("pointermove", handlePointerMove);
    surface.addEventListener("pointerup", handlePointerUp);
    surface.addEventListener("pointercancel", handlePointerCancellation);
    surface.addEventListener("lostpointercapture", handlePointerCancellation);
    surface.addEventListener("pointerleave", handlePointerCancellation);
    surface.addEventListener("contextmenu", handleContextMenu);
    surface.addEventListener("keydown", handleKeyDown);
    return () => {
      rightGesture = null;
      surface.removeEventListener("pointerdown", handlePointerDown);
      surface.removeEventListener("pointermove", handlePointerMove);
      surface.removeEventListener("pointerup", handlePointerUp);
      surface.removeEventListener("pointercancel", handlePointerCancellation);
      surface.removeEventListener(
        "lostpointercapture",
        handlePointerCancellation,
      );
      surface.removeEventListener("pointerleave", handlePointerCancellation);
      surface.removeEventListener("contextmenu", handleContextMenu);
      surface.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    disabled,
    editorViewDirection,
    focusedEntityId,
    onClearFocus,
    onCommitTransform,
    scene,
    selectedEntityId,
    surface,
  ]);

  return <>{children}</>;
};
