import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  type SceneSpec,
  type TransformSpec,
} from "./domain/scene-schema";
import type {
  ActorLimbPartId,
  ActorLimbPresenceMode,
} from "./domain/actor-anatomy";
import { snapTransformToContact } from "./domain/contact-constraints";
import {
  buildRelationshipOperations,
  materializePose,
} from "./domain/presets";
import { Inspector } from "./editor/Inspector";
import { Outliner } from "./editor/Outliner";
import { useEditorStore } from "./editor/editor-store";
import {
  createCameraLensPatch,
  createActorVariantPatch,
  createLockModePatch,
  createOperationsPatch,
  createTransformPatch,
  nextManualLockMode,
  transformsEqual,
} from "./editor/manual-patches";
import { applyActorLimbPresenceCommand } from "./editor/limb-presence-command";
import {
  paneAfterSceneSelection,
  type CompactWorkspacePane,
} from "./editor/compact-workspace";
import { CompactWorkspaceTabs } from "./editor/CompactWorkspaceTabs";
import { ViewportWorkspace } from "./editor/ViewportWorkspace";
import {
  commitShotCameraFocalLength,
  commitShotCameraTransform,
} from "./editor/shot-camera-commands";
import type { ShotCameraGestureSession } from "./editor/shot-camera-session";
import type { SpatialPreviewMode } from "./editor/spatial-preview";
import { userFacingError } from "./editor/error-messages";
import type { ShotExporterHandle } from "./three/ShotExporter";
import { connectPreviewExportBridge } from "./three/preview-export-client";

const connectionLabels = {
  idle: "未连接",
  connecting: "连接中",
  connected: "已同步",
  reconnecting: "重连中",
  disconnected: "已断开",
} as const;

export const App = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exporterRef = useRef<ShotExporterHandle | null>(null);
  const cameraDraftActiveRef = useRef(false);
  const consumedSceneEventRevisionRef = useRef<number | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [previewMode, setPreviewMode] =
    useState<SpatialPreviewMode>("overview");
  const [focusedRegionId, setFocusedRegionId] =
    useState<string | null>(null);
  const [compactPane, setCompactPane] =
    useState<CompactWorkspacePane>("editor");
  const [exporting, setExporting] = useState(false);
  const [savingScene, setSavingScene] = useState(false);
  const [exporterReady, setExporterReady] = useState(false);
  const [cameraDraftActive, setCameraDraftActive] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const scene = useEditorStore((state) => state.scene);
  const history = useEditorStore((state) => state.history);
  const loading = useEditorStore((state) => state.loading);
  const isMutating = useEditorStore((state) => state.isMutating);
  const error = useEditorStore((state) => state.error);
  const connectionStatus = useEditorStore(
    (state) => state.connectionStatus,
  );
  const selectedEntityId = useEditorStore(
    (state) => state.selectedEntityId,
  );
  const toolMode = useEditorStore((state) => state.toolMode);
  const lastSceneEvent = useEditorStore(
    (state) => state.lastSceneEvent,
  );
  const setSelectedEntityId = useEditorStore(
    (state) => state.setSelectedEntityId,
  );
  const setToolMode = useEditorStore((state) => state.setToolMode);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const saveScene = useEditorStore((state) => state.saveScene);
  const loadScene = useEditorStore((state) => state.loadScene);
  const clearError = useEditorStore((state) => state.clearError);

  const registerExporter = useCallback(
    (exporter: ShotExporterHandle | null) => {
      exporterRef.current = exporter;
      setExporterReady(exporter !== null);
    },
    [],
  );

  const commitTransform = useCallback(
    async (entityId: string, transform: TransformSpec): Promise<void> => {
      const state = useEditorStore.getState();
      const currentScene = state.scene;
      const entity = currentScene?.entities.find(
        (candidate) => candidate.id === entityId,
      );
      if (
        !currentScene ||
        !entity ||
        entity.lockMode !== "none"
      ) {
        return;
      }
      let constrainedTransform: TransformSpec;
      try {
        constrainedTransform = snapTransformToContact(
          currentScene,
          entityId,
          transform,
        );
      } catch (cause) {
        setLocalError(
          userFacingError(cause, "接触约束无法解析这次移动。"),
        );
        return;
      }
      if (transformsEqual(entity.transform, constrainedTransform)) {
        return;
      }
      try {
        await state.applyPatch(
          createTransformPatch(
            currentScene,
            entityId,
            constrainedTransform,
          ),
        );
      } catch {
        // The store already exposes the server's readable error in the UI.
      }
    },
    [],
  );

  const applyPosePreset = useCallback(
    async (actorId: string, presetId: string): Promise<void> => {
      const state = useEditorStore.getState();
      const currentScene = state.scene;
      const actor = currentScene?.entities.find(
        (entity) => entity.id === actorId,
      );
      if (
        !currentScene ||
        !actor ||
        !isLegacyActorEntity(actor) ||
        actor.lockMode !== "none"
      ) {
        return;
      }
      try {
        const pose = materializePose(actor, presetId);
        await state.applyPatch(
          createOperationsPatch(currentScene, "pose", [
            {
              op: "actor.pose.set",
              entityId: actor.id,
              value: pose,
            },
          ]),
        );
        setLocalError(null);
        setActionNotice(`已应用姿势 · ${pose.preset.id}`);
      } catch (cause) {
        setLocalError(
          userFacingError(cause, "姿势预设应用失败。"),
        );
      }
    },
    [],
  );

  const applyRelationshipPreset = useCallback(
    async (
      presetId: string,
      primaryActorId: string,
      secondaryActorId: string,
      surfaceEntityId?: string,
    ): Promise<void> => {
      const state = useEditorStore.getState();
      const currentScene = state.scene;
      if (!currentScene) {
        return;
      }
      try {
        const operations = buildRelationshipOperations(
          currentScene,
          presetId,
          {
            primaryActorId,
            secondaryActorId,
            surfaceEntityId,
          },
        );
        await state.applyPatch(
          createOperationsPatch(
            currentScene,
            "relationship",
            operations,
          ),
        );
        setLocalError(null);
        setActionNotice(`已应用双人关系 · ${presetId}`);
      } catch (cause) {
        setLocalError(
          userFacingError(cause, "双人关系预设应用失败。"),
        );
      }
    },
    [],
  );

  const setGroundContact = useCallback(
    async (
      actorId: string,
      surfaceEntityId: string | null,
      enabled: boolean,
    ): Promise<void> => {
      const state = useEditorStore.getState();
      const currentScene = state.scene;
      const actor = currentScene?.entities.find(
        (entity) => entity.id === actorId,
      );
      if (
        !currentScene ||
        actor?.kind !== "actor" ||
        actor.lockMode !== "none"
      ) {
        return;
      }
      const existing = currentScene.constraints.find(
        (constraint) =>
          constraint.type === "ground-contact" &&
          constraint.entityId === actor.id,
      );
      if (
        existing?.type === "ground-contact" &&
        existing.surfaceEntityId === surfaceEntityId &&
        existing.enabled === enabled
      ) {
        return;
      }
      try {
        await state.applyPatch(
          createOperationsPatch(currentScene, "contact", [
            {
              op: "constraint.set",
              value: {
                id:
                  existing?.id ??
                  `constraint_ground_${actor.slot}`,
                type: "ground-contact",
                entityId: actor.id,
                surfaceEntityId,
                enabled,
              },
            },
          ]),
        );
        setLocalError(null);
        setActionNotice(enabled ? "人物接触吸附已启用" : "人物接触吸附已停用");
      } catch (cause) {
        setLocalError(
          userFacingError(cause, "接触约束更新失败。"),
        );
      }
    },
    [],
  );

  // The command layer submits one preserveLock: true Patch per gesture.
  const commitFinalCameraTransform = useCallback(
    (
      session: ShotCameraGestureSession,
      transform: TransformSpec,
    ): Promise<SceneSpec | void> =>
      commitShotCameraTransform(
        useEditorStore.getState,
        session,
        transform,
      ),
    [],
  );

  const handleCameraDraftChange = useCallback((active: boolean): void => {
    cameraDraftActiveRef.current = active;
    setCameraDraftActive(active);
  }, []);

  const commitFinalCameraFocalLength = useCallback(
    (
      session: ShotCameraGestureSession,
      focalLengthMm: number,
    ): Promise<SceneSpec | void> =>
      commitShotCameraFocalLength(
        useEditorStore.getState,
        session,
        focalLengthMm,
      ),
    [],
  );

  const setLimbPresence = useCallback(
    async (
      actorId: string,
      partId: ActorLimbPartId,
      mode: ActorLimbPresenceMode,
    ): Promise<void> => {
      try {
        await applyActorLimbPresenceCommand(
          useEditorStore.getState,
          actorId,
          partId,
          mode,
        );
        setLocalError(null);
      } catch (error) {
        setLocalError(userFacingError(error));
      }
    },
    [],
  );

  const setActorVariant = useCallback(
    async (actorId: string, variantId: string): Promise<void> => {
      const state = useEditorStore.getState();
      const currentScene = state.scene;
      const actor = currentScene?.entities.find(
        (entity) => entity.id === actorId,
      );
      if (
        !currentScene ||
        !isBlueprintActorEntity(actor) ||
        actor.lockMode !== "none" ||
        actor.blueprintInstance.variantId === variantId
      ) {
        return;
      }
      try {
        await state.applyPatch(
          createActorVariantPatch(currentScene, actor.id, variantId),
        );
        setLocalError(null);
      } catch {
        // The store already exposes the server's readable error in the UI.
      }
    },
    [],
  );

  const commitFocalLength = useCallback(
    async (cameraId: string, focalLengthMm: number): Promise<void> => {
      const state = useEditorStore.getState();
      const currentScene = state.scene;
      const camera = currentScene?.entities.find(
        (entity) => entity.id === cameraId,
      );
      if (
        !currentScene ||
        camera?.kind !== "camera" ||
        camera.lockMode !== "none" ||
        Math.abs(camera.lens.focalLengthMm - focalLengthMm) < 1e-8
      ) {
        return;
      }
      try {
        await state.applyPatch(
          createCameraLensPatch(currentScene, camera, focalLengthMm),
        );
      } catch {
        // The store already exposes the server's readable error in the UI.
      }
    },
    [],
  );

  const toggleActiveCameraLock = useCallback(async (): Promise<void> => {
    const state = useEditorStore.getState();
    const currentScene = state.scene;
    const camera = currentScene?.entities.find(
      (entity) =>
        entity.kind === "camera" &&
        entity.id === currentScene.activeCameraId,
    );
    if (!currentScene || camera?.kind !== "camera") {
      return;
    }
    try {
      const updated = await state.applyPatch(
        createLockModePatch(
          currentScene,
          camera.id,
          nextManualLockMode(camera.lockMode),
        ),
      );
      const updatedCamera = updated.entities.find(
        (entity) => entity.id === camera.id,
      );
      setLocalError(null);
      setActionNotice(
        updatedCamera?.lockMode === "user"
          ? "最终镜头已启用用户保护"
          : "最终镜头已解锁",
      );
    } catch {
      // The store already exposes the server's readable error in the UI.
    }
  }, []);

  const saveCurrentScene = useCallback(async (): Promise<void> => {
    setSavingScene(true);
    try {
      const fileName = await saveScene();
      if (fileName) {
        setActionNotice(`已生成 ${fileName}`);
      }
    } finally {
      setSavingScene(false);
    }
  }, [saveScene]);

  const exportPerspective = useCallback(async (): Promise<void> => {
    const state = useEditorStore.getState();
    const targetScene = state.scene;
    const exporter = exporterRef.current;
    const targetCamera = targetScene?.entities.find(
      (entity) =>
        entity.kind === "camera" &&
        entity.id === targetScene.activeCameraId,
    );
    if (
      !targetScene ||
      !targetCamera ||
      !exporter ||
      state.connectionStatus !== "connected" ||
      state.loading ||
      state.isMutating ||
      cameraDraftActive
    ) {
      setLocalError("最终镜头导出器尚未准备完成。");
      return;
    }
    const targetRevision = targetScene.revision;
    const draftLabel =
      targetCamera.lockMode !== "none"
        ? ""
        : " · 草稿（镜头未锁定）";
    setExporting(true);
    setLocalError(null);
    try {
      const result = await exporter.exportPng();
      setActionNotice(
        `已导出 ${result.fileName} · ${result.width} × ${result.height} · REV ${targetRevision}${draftLabel}`,
      );
    } catch (cause) {
      setLocalError(
        userFacingError(cause, "透视参考图导出失败。"),
      );
    } finally {
      setExporting(false);
    }
  }, [cameraDraftActive]);

  useEffect(() => useEditorStore.getState().initialize(), []);

  useEffect(
    () =>
      connectPreviewExportBridge({
        getScene: () => useEditorStore.getState().scene,
        getExporter: () =>
          cameraDraftActiveRef.current ? null : exporterRef.current,
      }),
    [],
  );

  useEffect(() => {
    setLocalError(null);
  }, [scene?.sceneId, scene?.revision]);

  useEffect(() => {
    const layout = scene?.spatialLayout;
    if (layout === null || layout === undefined) {
      setFocusedRegionId(null);
      setPreviewMode((mode) => (mode === "local" ? "overview" : mode));
      return;
    }
    setFocusedRegionId((current) => {
      if (
        current !== null &&
        layout.regions.some(
          (region) => region.id === current && region.visible,
        )
      ) {
        return current;
      }
      return (
        layout.regions.find((region) => region.visible)?.id ??
        layout.regions[0]?.id ??
        null
      );
    });
  }, [scene?.sceneId, scene?.spatialLayout]);

  useEffect(() => {
    if (
      !lastSceneEvent ||
      consumedSceneEventRevisionRef.current === lastSceneEvent.revision
    ) {
      return;
    }
    consumedSceneEventRevisionRef.current = lastSceneEvent.revision;
    if (!isMutating) {
      const labels = {
        patch: "场景 Patch 更新",
        replace: "场景已替换",
        undo: "场景已撤销",
        redo: "场景已重做",
      } as const;
      setActionNotice(
        `${labels[lastSceneEvent.reason]} · REV ${lastSceneEvent.revision}`,
      );
    }
  }, [isMutating, lastSceneEvent]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key.toLowerCase() === "q") {
        setToolMode("select");
      }
      if (event.key.toLowerCase() === "w") {
        setToolMode("translate");
      }
      if (event.key.toLowerCase() === "e") {
        setToolMode("rotate");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const currentState = useEditorStore.getState();
        if (
          currentState.isMutating ||
          currentState.loading ||
          currentState.connectionStatus !== "connected"
        ) {
          return;
        }
        if (event.shiftKey) {
          void redo().catch(() => undefined);
        } else {
          void undo().catch(() => undefined);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, setToolMode, undo]);

  useEffect(() => {
    if (!actionNotice) {
      return;
    }
    const timer = window.setTimeout(() => setActionNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  if (!scene) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">S</div>
        <p className="panel-kicker">SHUBI SHOT DIRECTOR</p>
        <h1>正在建立灰模场景</h1>
        <p>{error ?? "正在连接本地 SceneSession……"}</p>
      </main>
    );
  }

  const activeCamera = scene.entities.find(
    (entity) =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  const interactionDisabled =
    loading || isMutating || connectionStatus !== "connected";
  const exportDisabled =
    exporting ||
    cameraDraftActive ||
    interactionDisabled ||
    !exporterReady ||
    activeCamera?.kind !== "camera";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <div>
            <p>SHUBI SHOT DIRECTOR</p>
            <strong>{scene.title}</strong>
          </div>
        </div>

        <div className="tool-cluster" aria-label="编辑工具">
          <button
            className={toolMode === "select" ? "tool is-active" : "tool"}
            disabled={interactionDisabled}
            onClick={() => setToolMode("select")}
            title="选择（Q）"
            type="button"
          >
            <span>↖</span>
            <small>Q</small>
          </button>
          <button
            className={toolMode === "translate" ? "tool is-active" : "tool"}
            disabled={interactionDisabled}
            onClick={() => setToolMode("translate")}
            title="移动（W）"
            type="button"
          >
            <span>✣</span>
            <small>W</small>
          </button>
          <button
            className={toolMode === "rotate" ? "tool is-active" : "tool"}
            disabled={interactionDisabled}
            onClick={() => setToolMode("rotate")}
            title="旋转（E）"
            type="button"
          >
            <span>↻</span>
            <small>E</small>
          </button>
          <span className="toolbar-divider" />
          <button
            className="tool"
            disabled={!history.canUndo || interactionDisabled}
            onClick={() => void undo().catch(() => undefined)}
            title="撤销（Ctrl+Z）"
            type="button"
          >
            <span>↶</span>
          </button>
          <button
            className="tool"
            disabled={!history.canRedo || interactionDisabled}
            onClick={() => void redo().catch(() => undefined)}
            title="重做（Ctrl+Shift+Z）"
            type="button"
          >
            <span>↷</span>
          </button>
          <span className="toolbar-divider" />
          <button
            className={snapEnabled ? "tool is-active" : "tool"}
            disabled={interactionDisabled}
            onClick={() => setSnapEnabled((enabled) => !enabled)}
            title="吸附：移动 0.1 米，旋转 5°"
            type="button"
            aria-pressed={snapEnabled}
          >
            <span>⊞</span>
            <small>SNAP</small>
          </button>
        </div>

        <div className="topbar-actions">
          <div className={`connection connection-${connectionStatus}`}>
            <span />
            {connectionLabels[connectionStatus]}
          </div>
          <button
            className="button button-quiet"
            disabled={loading || isMutating || exporting}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            加载
          </button>
          <button
            className="button button-quiet"
            disabled={
              interactionDisabled || activeCamera?.kind !== "camera"
            }
            onClick={() => void toggleActiveCameraLock()}
            aria-label={
              activeCamera?.lockMode === "workflow"
                ? "Workflow locked. Unlock camera"
                : activeCamera?.lockMode === "user"
                  ? "User protected. Unlock camera"
                  : "User protect camera"
            }
            title={
              activeCamera?.lockMode === "workflow"
                ? "流程锁定"
                : activeCamera?.lockMode === "user"
                  ? "用户保护"
                  : "启用用户保护"
            }
            type="button"
          >
            {activeCamera?.lockMode === "workflow"
              ? "解除流程锁定"
              : activeCamera?.lockMode === "user"
                ? "解除用户保护"
                : "用户保护镜头"}
          </button>
          <button
            className="button button-primary"
            disabled={
              loading || isMutating || exporting || savingScene
            }
            onClick={() =>
              void saveCurrentScene().catch(() => undefined)
            }
            type="button"
          >
            {savingScene ? "保存中…" : "保存场景"}
          </button>
          <button
            className="button button-export"
            disabled={exportDisabled}
            onClick={() => void exportPerspective()}
            title={
              activeCamera?.lockMode !== "none"
                ? "导出当前权威 revision"
                : "镜头未锁定，将标记为草稿导出"
            }
            type="button"
          >
            {exporting ? "导出中…" : "导出 PNG"}
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,.scene.json,application/json"
            aria-label="加载 SceneSpec 文件"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void loadScene(file)
                  .then(() => setSelectedEntityId(null))
                  .catch(() => undefined)
                  .finally(() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  });
              }
            }}
          />
        </div>
      </header>

      <main
        className="workspace-grid"
        data-compact-pane={compactPane}
      >
        <CompactWorkspaceTabs
          activePane={compactPane}
          onChange={(pane) => {
            setCompactPane(pane);
            if (pane === "shot") {
              setPreviewMode("shot");
            } else if (pane === "editor" && previewMode === "shot") {
              setPreviewMode("overview");
            }
          }}
        />
        <Outliner
          scene={scene}
          selectedId={selectedEntityId}
          selectedRegionId={focusedRegionId}
          onSelect={(entityId) => {
            setSelectedEntityId(entityId);
            const membership = scene.spatialLayout?.memberships.find(
              (candidate) => candidate.entityId === entityId,
            );
            if (membership) {
              setFocusedRegionId(membership.regionId);
            }
            setCompactPane(paneAfterSceneSelection());
          }}
          onSelectRegion={(regionId) => {
            setFocusedRegionId(regionId);
            setSelectedEntityId(null);
            setPreviewMode("local");
            setCompactPane("editor");
          }}
        />
        <section
          className="viewport-stage"
          id="compact-viewport-panel"
          aria-label="镜头工作区"
        >
          <ViewportWorkspace
            scene={scene}
            selectedId={selectedEntityId}
            onSelect={(entityId) => {
              setSelectedEntityId(entityId);
              const membership =
                scene.spatialLayout?.memberships.find(
                  (candidate) => candidate.entityId === entityId,
                );
              if (membership) {
                setFocusedRegionId(membership.regionId);
              }
            }}
            toolMode={interactionDisabled ? "select" : toolMode}
            snapEnabled={snapEnabled}
            onCommitTransform={commitTransform}
            interactionDisabled={interactionDisabled}
            onUnlockUserProtectedCamera={toggleActiveCameraLock}
            onCommitCameraTransform={commitFinalCameraTransform}
            onCommitCameraFocalLength={commitFinalCameraFocalLength}
            onCameraDraftChange={handleCameraDraftChange}
            registerExporter={registerExporter}
            previewMode={previewMode}
            focusedRegionId={focusedRegionId}
            onPreviewModeChange={(mode) => {
              setPreviewMode(mode);
              if (mode === "shot") {
                setCompactPane("shot");
              } else if (compactPane === "shot") {
                setCompactPane("editor");
              }
            }}
            onFocusedRegionChange={(regionId) => {
              setFocusedRegionId(regionId);
              setSelectedEntityId(null);
              setPreviewMode("local");
            }}
          />
          {loading || isMutating ? (
            <div className="working-indicator" role="status">
              <span />
              {loading ? "读取场景" : "写入 revision"}
            </div>
          ) : null}
        </section>
        <Inspector
          scene={scene}
          selectedId={selectedEntityId}
          selectedRegionId={focusedRegionId}
          disabled={interactionDisabled}
          onSetLimbPresence={setLimbPresence}
          onSetVariant={(actorId, variantId) => {
            void setActorVariant(actorId, variantId);
          }}
          onCommitTransform={(entityId, transform) => {
            void commitTransform(entityId, transform);
          }}
          onCommitFocalLength={(cameraId, focalLengthMm) => {
            void commitFocalLength(cameraId, focalLengthMm);
          }}
          onApplyPose={(actorId, presetId) => {
            void applyPosePreset(actorId, presetId);
          }}
          onApplyRelationship={(
            presetId,
            primaryActorId,
            secondaryActorId,
            surfaceEntityId,
          ) => {
            void applyRelationshipPreset(
              presetId,
              primaryActorId,
              secondaryActorId,
              surfaceEntityId,
            );
          }}
          onSetGroundContact={(actorId, surfaceEntityId, enabled) => {
            void setGroundContact(actorId, surfaceEntityId, enabled);
          }}
        />
      </main>

      <footer className="statusbar">
        <div>
          <span className="status-label">SCENE</span>
          <strong>{scene.sceneId}</strong>
        </div>
        <div>
          <span className="status-label">REV</span>
          <strong>{scene.revision}</strong>
        </div>
        <div className="status-spacer" />
        {actionNotice ? (
          <div
            className="action-notice"
            role="status"
            data-testid="action-notice"
          >
            {actionNotice}
          </div>
        ) : null}
        <div>
          <span className="status-label">UNIT</span>
          <strong>meters · Y-up</strong>
        </div>
        <div>
          <span className="status-label">OUTPUT</span>
          <strong>
            {scene.output.resolutionPx.width} ×{" "}
            {scene.output.resolutionPx.height}
          </strong>
        </div>
      </footer>

      {error || localError ? (
        <div className="error-toast" role="alert">
          <div>
            <strong>操作没有完成</strong>
            <p>{error ?? localError}</p>
          </div>
          <button
            onClick={() => {
              clearError();
              setLocalError(null);
            }}
            type="button"
            aria-label="关闭错误"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
};
