import { create } from "zustand";
import type { ScenePatch } from "../domain/scene-patch";
import type { SceneSpec } from "../domain/scene-schema";
import {
  createWorkflowLockCheckpointPatch,
  validateWorkflowLockCheckpointAcceptance,
} from "../domain/workflow-lock-patch";
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
import {
  clearStudioFocus,
  createStudioFocusState,
  focusStudioEntity,
  reconcileStudioFocus,
  type StudioFocusState,
} from "./studio-selection";
import type { CanonicalPuppetJointId } from "../domain/actor-joints";

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
  focusedEntityId: string | null;
  focusedActorJointId: CanonicalPuppetJointId | null;
  focusRequestVersion: number;
  toolMode: EditorToolMode;
  lastSceneEvent: SceneEventSummary | null;
  initialize: () => () => void;
  disconnect: () => void;
  refresh: () => Promise<SceneSpec | null>;
  clearError: () => void;
  setSelectedEntityId: (entityId: string | null) => void;
  focusEntity: (entityId: string) => void;
  focusActorJoint: (jointId: CanonicalPuppetJointId | null) => void;
  clearStudioFocus: () => void;
  reconcileStudioFocus: (previousScene: SceneSpec | null, nextScene: SceneSpec) => void;
  setToolMode: (mode: EditorToolMode) => void;
  applyPatch: (patch: ScenePatch) => Promise<SceneSpec>;
  undo: () => Promise<SceneSpec | null>;
  redo: () => Promise<SceneSpec | null>;
  replaceScene: (scene: SceneSpec) => Promise<SceneSpec>;
  saveScene: (requestedName?: string) => Promise<string | null>;
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
  let saveQueue: Promise<void> = Promise.resolve();

  const currentFocusState = (): StudioFocusState => {
    const state = get();
    return {
      selectedEntityId: state.selectedEntityId,
      focusedEntityId: state.focusedEntityId,
      focusedActorJointId: state.focusedActorJointId,
      focusRequestVersion: state.focusRequestVersion,
    };
  };

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
      const focus = scene
        ? reconcileStudioFocus(
            {
              selectedEntityId: state.selectedEntityId,
              focusedEntityId: state.focusedEntityId,
              focusedActorJointId: state.focusedActorJointId,
              focusRequestVersion: state.focusRequestVersion,
            },
            currentScene,
            scene,
          )
        : createStudioFocusState();
      return {
        scene,
        history: update.history,
        ...focus,
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
          ...reconcileStudioFocus(
            {
              selectedEntityId: state.selectedEntityId,
              focusedEntityId: state.focusedEntityId,
              focusedActorJointId: state.focusedActorJointId,
              focusRequestVersion: state.focusRequestVersion,
            },
            currentScene,
            scene,
          ),
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
    validateBeforeCommit?: (update: SceneSessionUpdate) => void,
  ): Promise<{
    accepted: SceneSessionUpdate;
    current: SceneSpec | null;
  }> => {
    const requestEpoch = serverStateEpoch;
    pendingMutations += 1;
    set({ isMutating: true, error: null });
    try {
      const update = await request();
      validateBeforeCommit?.(update);
      return {
        accepted: update,
        current: commitUpdate(update, requestEpoch),
      };
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
    ...createStudioFocusState(),
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
      if (entityId === null) {
        set(clearStudioFocus(currentFocusState()));
        return;
      }
      const entity = scene?.entities.find((candidate) => candidate.id === entityId);
      if (!entity) return;
      set({
        ...clearStudioFocus(currentFocusState()),
        selectedEntityId: entity.id,
      });
    },

    focusEntity: (entityId) => {
      const scene = get().scene;
      if (!scene) return;
      set(focusStudioEntity(currentFocusState(), scene, entityId));
    },

    focusActorJoint: (jointId) => {
      const scene = get().scene;
      const focused = scene?.entities.find(
        (entity) => entity.id === get().focusedEntityId,
      );
      if (!focused || focused.kind !== "actor") {
        set({ focusedActorJointId: null });
        return;
      }
      set({ focusedActorJointId: jointId });
    },

    clearStudioFocus: () => set(clearStudioFocus(currentFocusState())),

    reconcileStudioFocus: (previousScene, nextScene) =>
      set(reconcileStudioFocus(currentFocusState(), previousScene, nextScene)),

    setToolMode: (toolMode) => set({ toolMode }),

    applyPatch: async (patch) => {
      const result = await runUpdate(() => sceneClient.applyPatch(patch));
      if (result.accepted.scene === null) {
        throw new SceneClientError(
          "MISSING_SCENE",
          "The patch response did not contain a scene.",
        );
      }
      return result.accepted.scene;
    },

    undo: async () => (await runUpdate(() => sceneClient.undo())).current,

    redo: async () => (await runUpdate(() => sceneClient.redo())).current,

    replaceScene: async (scene) => {
      const result = await runUpdate(() =>
        sceneClient.replaceScene(scene),
      );
      if (result.current === null) {
        throw new SceneClientError(
          "MISSING_SCENE",
          "The replace response did not contain a scene.",
        );
      }
      return result.current;
    },

    saveScene: (requestedName) => {
      const save = async (): Promise<string | null> => {
        const before = get().scene;
        if (before === null) {
          set({ error: "There is no scene to save." });
          return null;
        }
        try {
          const checkpoint = createWorkflowLockCheckpointPatch(
            before,
            `manual_save_${before.revision}`,
            "manual",
          );
          let sceneToDownload = before;
          if (checkpoint !== null) {
            const result = await runUpdate(
              () => sceneClient.applyPatch(checkpoint),
              (update) => {
                if (update.scene === null) {
                  throw new SceneClientError(
                    "MISSING_SCENE",
                    "The patch response did not contain a scene.",
                  );
                }
                validateWorkflowLockCheckpointAcceptance(
                  before,
                  checkpoint,
                  update.scene,
                );
              },
            );
            const accepted = result.accepted.scene;
            if (accepted === null) {
              throw new SceneClientError(
                "MISSING_SCENE",
                "The patch response did not contain a scene.",
              );
            }
            sceneToDownload = accepted;
            if (get().scene !== accepted) {
              throw new SceneClientError(
                "STALE_REVISION",
                "The scene changed before the accepted save checkpoint could be downloaded.",
              );
            }
          }
          const fileName = downloadSceneFile(
            sceneToDownload,
            requestedName,
          );
          set({ error: null });
          return fileName;
        } catch (error) {
          set({ error: userFacingError(error) });
          return null;
        }
      };
      const queued = saveQueue.then(save, save);
      saveQueue = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },

    loadScene: async (file) => {
      const result = await runUpdate(() =>
        loadSceneFile(file, sceneClient),
      );
      if (result.current === null) {
        throw new SceneClientError(
          "MISSING_SCENE",
          "The load response did not contain a scene.",
        );
      }
      return result.current;
    },

    reportTransformConflict: () => {
      set({ error: TRANSFORM_CONFLICT_MESSAGE });
    },
  };
});

export const initializeEditorStore = (): (() => void) =>
  useEditorStore.getState().initialize();
