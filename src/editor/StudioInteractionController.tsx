import { useEffect, type ReactNode } from "react";
import type { SceneSpec, TransformSpec, Vec3 } from "../domain/scene-schema";
import { moveEntityByEditorKey } from "./studio-interaction-math";

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

    surface.addEventListener("keydown", handleKeyDown);
    return () => surface.removeEventListener("keydown", handleKeyDown);
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
