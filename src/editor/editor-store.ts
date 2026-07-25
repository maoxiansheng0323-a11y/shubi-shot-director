import { create } from "zustand";
import type { ScenePatch } from "../domain/scene-patch";
import type { SceneSpec } from "../domain/scene-schema";
import {
  sceneClient,
  SceneClientError,
  type SceneConnectionStatus,
  type SceneChangeEvent,
  type SceneHistoryStatus,
  type SceneSessionUpdate,
} from "./scene-client";
import {
  downloadSceneFile,
  loadSceneFile,
} from "./scene-files";
import { userFacingError } from "./error-messages";

export type EditorToolMode = "select" | "translate" | "rotate";

export interface SceneEventSummary {
  reason: SceneChangeEvent["reason"];
  revision: number;
  text: string;
}

export interface EditorStoreState {
  scene: SceneSpec | null;
  history: SceneHistoryStatus;
  loading: boolean;
  isMutating: boolean;
  error: string | null;
  connectionStatus: SceneConnectionStatus;
  selectedEntityId: string | null;
  toolMode: EditorToolMode;
  lastSceneEvent: SceneEventSummary | null;
  initialize: () => () => void;
  disconnect: () => void;
  refresh: () => Promise<SceneSpec | null>;
  clearError: () => void;
  setSelectedEntityId: (entityId: string | null) => void;
  setToolMode: (mode: EditorToolMode) => void;
  applyPatch: (patch: ScenePatch) => Promise<SceneSpec>;
  undo: () => Promise<SceneSpec | null>;
  redo: () => Promise<SceneSpec | null>;
  replaceScene: (scene: SceneSpec) => Promise<SceneSpec>;
  saveScene: (requestedName?: string) => string | null;
  loadScene: (file: Blob) => Promise<SceneSpec>;
  reportTransformConflict: () => void;
}

const EMPTY_HISTORY: SceneHistoryStatus = {
  canUndo: false,
  canRedo: false,
};

export const TRANSFORM_CONFLICT_MESSAGE =
  "场景在拖动期间已更新；旧拖动已取消。请检查最新画面后重试。 · TRANSFORM_DRAG_REVISION_CONFLICT";

export interface TransformDragSession {
  entityId: string;
  sceneId: string;
  baseRevision: number;
  cancelled: boolean;
}

export type TransformDragCommitDecision =
  | { status: "commit" }
  | {
      status: "conflict";
      code: "TRANSFORM_DRAG_REVISION_CONFLICT";
    };

export const createTransformDragSession = (
  scene: SceneSpec,
  entityId: string,
): TransformDragSession => ({
  entityId,
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  cancelled: false,
});

export const decideTransformDragCommit = (
  session: TransformDragSession | null,
  scene: SceneSpec,
  entityId: string,
): TransformDragCommitDecision =>
  session &&
  !session.cancelled &&
  session.entityId === entityId &&
  session.sceneId === scene.sceneId &&
  session.baseRevision === scene.revision
    ? { status: "commit" }
    : {
        status: "conflict",
        code: "TRANSFORM_DRAG_REVISION_CONFLICT",
      };

const summarizeSceneEvent = (
  event: SceneChangeEvent,
): SceneEventSummary => {
  const labels: Record<SceneChangeEvent["reason"], string> = {
    patch: "External patch",
    replace: "Scene replace",
    undo: "Undo update",
    redo: "Redo update",
  };
  return {
    reason: event.reason,
    revision: event.scene.revision,
    text: `${labels[event.reason]} · REV ${event.scene.revision}`,
  };
};

export const useEditorStore = create<EditorStoreState>((set, get) => {
  let unsubscribeEvents: (() => void) | null = null;
  let initialRequest: AbortController | null = null;
  let connectionGeneration = 0;
  let serverStateEpoch = 0;
  let latestRefreshId = 0;
  let pendingMutations = 0;

  const commitUpdate = (
    update: SceneSessionUpdate,
    requestEpoch?: number,
  ): SceneSpec | null => {
    const currentScene = get().scene;
    const incomingScene = update.scene;
    if (
      currentScene &&
      incomingScene &&
      incomingScene.revision < currentScene.revision
    ) {
      return currentScene;
    }
    if (
      currentScene &&
      incomingScene &&
      incomingScene.sceneId !== currentScene.sceneId &&
      requestEpoch !== undefined &&
      requestEpoch !== serverStateEpoch
    ) {
      return currentScene;
    }

    serverStateEpoch += 1;
    set((state) => {
      const scene = incomingScene ?? state.scene;
      const selectedEntityId =
        state.selectedEntityId === null ||
        scene?.entities.some(
          (entity) => entity.id === state.selectedEntityId,
        )
          ? state.selectedEntityId
          : null;
      return {
        scene,
        history: update.history,
        selectedEntityId,
        error: null,
      };
    });
    return incomingScene ?? currentScene;
  };

  const refreshSnapshot = async (
    options: {
      generation?: number;
      showLoading: boolean;
      reportError: boolean;
      signal?: AbortSignal;
    },
  ): Promise<SceneSpec | null> => {
    const refreshId = ++latestRefreshId;
    const startingEpoch = serverStateEpoch;
    if (options.showLoading) {
      set({ loading: true });
    }

    try {
      const snapshot = await sceneClient.getScene(options.signal);
      if (
        options.generation !== undefined &&
        options.generation !== connectionGeneration
      ) {
        return null;
      }
      let result = get().scene;
      if (
        refreshId === latestRefreshId &&
        startingEpoch === serverStateEpoch
      ) {
        result = commitUpdate(snapshot);
      }
      return result;
    } catch (error) {
      if (
        error instanceof SceneClientError &&
        error.code === "REQUEST_ABORTED"
      ) {
        return null;
      }
      if (
        options.reportError &&
        (options.generation === undefined ||
          options.generation === connectionGeneration)
      ) {
        set({ error: userFacingError(error) });
      }
      return null;
    } finally {
      if (
        options.showLoading &&
        (options.generation === undefined ||
          options.generation === connectionGeneration)
      ) {
        set({ loading: false });
      }
    }
  };

  const attachEvents = (generation: number): void => {
    if (generation !== connectionGeneration) {
      return;
    }
    unsubscribeEvents?.();
    unsubscribeEvents = sceneClient.subscribe({
      onConnectionChange: (connectionStatus) => {
        if (generation === connectionGeneration) {
          set({ connectionStatus });
        }
      },
      onError: (error) => {
        if (generation === connectionGeneration) {
          set({ error: userFacingError(error) });
        }
      },
      onScene: (event) => {
        if (generation !== connectionGeneration) {
          return;
        }
        const { scene } = event;
        const currentScene = get().scene;
        if (
          currentScene &&
          scene.revision < currentScene.revision
        ) {
          return;
        }
        serverStateEpoch += 1;
        set((state) => ({
          scene,
          loading: false,
          lastSceneEvent: summarizeSceneEvent(event),
          selectedEntityId:
            state.selectedEntityId === null ||
            scene.entities.some(
              (entity) => entity.id === state.selectedEntityId,
            )
              ? state.selectedEntityId
              : null,
        }));
        void refreshSnapshot({
          generation,
          showLoading: false,
          reportError: false,
        });
      },
    });
  };

  const stopConnection = (generation?: number): void => {
    if (
      generation !== undefined &&
      generation !== connectionGeneration
    ) {
      return;
    }
    connectionGeneration += 1;
    initialRequest?.abort();
    initialRequest = null;
    unsubscribeEvents?.();
    unsubscribeEvents = null;
    set({
      loading: false,
      connectionStatus: "disconnected",
    });
  };

  const runUpdate = async (
    request: () => Promise<SceneSessionUpdate>,
  ): Promise<SceneSpec | null> => {
    const requestEpoch = serverStateEpoch;
    pendingMutations += 1;
    set({ isMutating: true, error: null });
    try {
      const update = await request();
      return commitUpdate(update, requestEpoch);
    } catch (error) {
      set({ error: userFacingError(error) });
      throw error;
    } finally {
      pendingMutations -= 1;
      set({ isMutating: pendingMutations > 0 });
    }
  };

  return {
    scene: null,
    history: EMPTY_HISTORY,
    loading: false,
    isMutating: false,
    error: null,
    connectionStatus: "idle",
    selectedEntityId: null,
    toolMode: "select",
    lastSceneEvent: null,

    initialize: () => {
      stopConnection();
      const generation = connectionGeneration;
      initialRequest = new AbortController();
      set({
        loading: true,
        error: null,
        connectionStatus: "connecting",
      });
      void refreshSnapshot({
        generation,
        showLoading: false,
        reportError: true,
        signal: initialRequest.signal,
      }).finally(() => {
        if (generation === connectionGeneration) {
          initialRequest = null;
          set({ loading: false });
          attachEvents(generation);
        }
      });
      return () => stopConnection(generation);
    },

    disconnect: () => stopConnection(),

    refresh: () =>
      refreshSnapshot({
        showLoading: true,
        reportError: true,
      }),

    clearError: () => set({ error: null }),

    setSelectedEntityId: (entityId) => {
      const scene = get().scene;
      set({
        selectedEntityId:
          entityId === null ||
          scene?.entities.some((entity) => entity.id === entityId)
            ? entityId
            : null,
      });
    },

    setToolMode: (toolMode) => set({ toolMode }),

    applyPatch: async (patch) => {
      const scene = await runUpdate(() => sceneClient.applyPatch(patch));
      if (scene === null) {
        throw new SceneClientError(
          "MISSING_SCENE",
          "The patch response did not contain a scene.",
        );
      }
      return scene;
    },

    undo: () => runUpdate(() => sceneClient.undo()),

    redo: () => runUpdate(() => sceneClient.redo()),

    replaceScene: async (scene) => {
      const updated = await runUpdate(() =>
        sceneClient.replaceScene(scene),
      );
      if (updated === null) {
        throw new SceneClientError(
          "MISSING_SCENE",
          "The replace response did not contain a scene.",
        );
      }
      return updated;
    },

    saveScene: (requestedName) => {
      const scene = get().scene;
      if (scene === null) {
        set({ error: "There is no scene to save." });
        return null;
      }
      try {
        const fileName = downloadSceneFile(scene, requestedName);
        set({ error: null });
        return fileName;
      } catch (error) {
        set({ error: userFacingError(error) });
        return null;
      }
    },

    loadScene: async (file) => {
      const scene = await runUpdate(() =>
        loadSceneFile(file, sceneClient),
      );
      if (scene === null) {
        throw new SceneClientError(
          "MISSING_SCENE",
          "The load response did not contain a scene.",
        );
      }
      return scene;
    },

    reportTransformConflict: () => {
      set({ error: TRANSFORM_CONFLICT_MESSAGE });
    },
  };
});

export const initializeEditorStore = (): (() => void) =>
  useEditorStore.getState().initialize();
