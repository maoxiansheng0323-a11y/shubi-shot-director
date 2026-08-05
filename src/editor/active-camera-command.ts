import type { SceneSpec } from "../domain/scene-schema";
import type { EditorStoreState } from "./editor-store";
import { createActiveCameraPatch } from "./manual-patches";

export type ActiveCameraCommandState = Pick<
  EditorStoreState,
  "scene" | "applyPatch"
>;

export const activateShotCamera = async (
  getState: () => ActiveCameraCommandState,
  cameraId: string,
): Promise<SceneSpec | null> => {
  const state = getState();
  if (!state.scene) return null;
  const patch = createActiveCameraPatch(state.scene, cameraId);
  if (!patch) return null;
  try {
    return await state.applyPatch(patch);
  } catch {
    return null;
  }
};
