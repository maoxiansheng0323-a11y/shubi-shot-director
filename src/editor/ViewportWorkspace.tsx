import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Canvas } from "@react-three/fiber";
import {
  Grid,
  OrbitControls,
  PerspectiveCamera,
  View,
} from "@react-three/drei";
import { snapTransformToContact } from "../domain/contact-constraints";
import type {
  CameraEntity,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";
import {
  ShotCameraNavigation,
  type ShotCameraDraft,
} from "./ShotCameraNavigation";
import type { ShotCameraGestureSession } from "./shot-camera-session";
import {
  createTransformDragSession,
  decideTransformDragCommit,
  useEditorStore,
  type TransformDragSession,
} from "./editor-store";
import {
  deriveSpatialPreview,
  type SpatialPreviewMode,
  type SpatialPreviewProjection,
} from "./spatial-preview";
import { SceneWorld, ShotCamera } from "../three/SceneWorld";
import {
  ShotExporter,
  type ShotExporterHandle,
} from "../three/ShotExporter";

export interface ViewportWorkspaceProps {
  scene: SceneSpec;
  selectedId: string | null;
  onSelect: (entityId: string | null) => void;
  toolMode: "select" | "translate" | "rotate";
  snapEnabled: boolean;
  onCommitTransform: (
    entityId: string,
    transform: TransformSpec,
  ) => void | Promise<void>;
  registerExporter: (exporter: ShotExporterHandle | null) => void;
  previewMode: SpatialPreviewMode;
  focusedRegionId: string | null;
  onPreviewModeChange: (mode: SpatialPreviewMode) => void;
  onFocusedRegionChange: (regionId: string) => void;
  interactionDisabled: boolean;
  onUnlockUserProtectedCamera: () => void | Promise<void>;
  onCommitCameraTransform: (
    session: ShotCameraGestureSession,
    transform: TransformSpec,
  ) => Promise<SceneSpec | void>;
  onCommitCameraFocalLength: (
    session: ShotCameraGestureSession,
    focalLengthMm: number,
  ) => Promise<SceneSpec | void>;
  onCameraDraftChange: (active: boolean) => void;
}

const workspaceStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  width: "100%",
  height: "100%",
  minHeight: 520,
  overflow: "hidden",
  padding: 12,
  boxSizing: "border-box",
  background: "#11151b",
};

const viewportFrameStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  border: "1px solid rgba(203, 213, 225, 0.2)",
  borderRadius: 8,
  background: "transparent",
  boxShadow: "0 14px 40px rgba(0, 0, 0, 0.24)",
};

const editorFrameStyle: CSSProperties = {
  ...viewportFrameStyle,
  gridArea: "1 / 1",
  width: "100%",
  height: "100%",
};

const shotFrameStyle: CSSProperties = {
  ...viewportFrameStyle,
  gridArea: "1 / 1",
  alignSelf: "center",
  justifySelf: "center",
  width: "100%",
  maxWidth:
    "min(1120px, max(320px, calc((100vh - 180px) * 16 / 9)))",
  height: "auto",
  maxHeight: "100%",
};

const viewStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const labelStyle: CSSProperties = {
  position: "absolute",
  zIndex: 2,
  top: 10,
  left: 10,
  margin: 0,
  padding: "5px 8px",
  border: "1px solid rgba(226, 232, 240, 0.16)",
  borderRadius: 5,
  background: "rgba(15, 23, 42, 0.76)",
  color: "#e2e8f0",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  pointerEvents: "none",
  userSelect: "none",
};

const canvasStyle: CSSProperties = {
  position: "absolute",
  zIndex: 0,
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

const modeSwitcherStyle: CSSProperties = {
  position: "absolute",
  zIndex: 4,
  top: 20,
  right: 20,
  display: "flex",
  gap: 4,
  padding: 4,
  border: "1px solid rgba(226, 232, 240, 0.16)",
  borderRadius: 8,
  background: "rgba(15, 23, 42, 0.82)",
  backdropFilter: "blur(8px)",
};

type EditorSceneProps = Pick<
  ViewportWorkspaceProps,
  | "scene"
  | "selectedId"
  | "onSelect"
  | "toolMode"
  | "snapEnabled"
  | "previewMode"
  | "focusedRegionId"
  | "onFocusedRegionChange"
> &
  DraftSceneProps;

const EditorScene = ({
  scene,
  selectedId,
  onSelect,
  toolMode,
  snapEnabled,
  transformOverrides,
  onTransformStart,
  onTransformDraft,
  onTransformCommit,
  editorDomElement,
  previewMode,
  focusedRegionId,
  onFocusedRegionChange,
  spatialPreview,
}: EditorSceneProps) => (
  <>
    <color attach="background" args={["#1c222b"]} />
    <PerspectiveCamera
      makeDefault
      position={spatialPreview.camera.position}
      fov={50}
      near={0.02}
      far={500}
    />
    <OrbitControls
      makeDefault
      domElement={editorDomElement ?? undefined}
      target={spatialPreview.camera.target}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.5}
      maxDistance={80}
    />
    <Grid
      position={[0, 0.002, 0]}
      args={[40, 40]}
      cellSize={0.25}
      cellThickness={0.45}
      cellColor="#4b5563"
      sectionSize={1}
      sectionThickness={0.9}
      sectionColor="#788493"
      fadeDistance={35}
      fadeStrength={1}
      infiniteGrid
    />
    <axesHelper args={[2]} />
    <SceneWorld
      scene={scene}
      view="editor"
      selectedEntityId={selectedId}
      onSelectEntity={onSelect}
      selectedRegionId={focusedRegionId}
      onSelectRegion={onFocusedRegionChange}
      spatialPreview={spatialPreview}
      previewMode={previewMode}
      toolMode={toolMode}
      snapEnabled={snapEnabled}
      transformOverrides={transformOverrides}
      onTransformStart={onTransformStart}
      onTransformDraft={onTransformDraft}
      onTransformCommit={onTransformCommit}
      transformDomElement={editorDomElement ?? undefined}
    />
  </>
);

interface DraftSceneProps {
  spatialPreview: SpatialPreviewProjection;
  transformOverrides?: Readonly<
    Record<string, TransformSpec | undefined>
  >;
  onTransformDraft?: (
    entityId: string,
    transform: TransformSpec,
  ) => void;
  onTransformStart?: (entityId: string) => void;
  onTransformCommit?: (
    entityId: string,
    transform: TransformSpec,
  ) => void | Promise<void>;
  editorDomElement?: HTMLElement | null;
}

interface ShotSceneProps {
  scene: SceneSpec;
  selectedId: string | null;
  onSelect: (entityId: string | null) => void;
  registerExporter: (exporter: ShotExporterHandle | null) => void;
  cameraDraft: ShotCameraDraft | null;
}

const ShotScene = ({
  scene,
  selectedId,
  onSelect,
  registerExporter,
  cameraDraft,
}: ShotSceneProps) => {
  const activeCamera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  const cameraTransformOverride =
    cameraDraft?.cameraId === scene.activeCameraId
      ? cameraDraft.transform
      : undefined;
  const effectiveCameraTransform =
    cameraTransformOverride ?? activeCamera?.transform;

  return (
    <>
      <color attach="background" args={["#20252c"]} />
      <ShotCamera
        scene={scene}
        transformOverride={cameraTransformOverride}
        focalLengthOverrideMm={
          cameraDraft?.cameraId === scene.activeCameraId
            ? cameraDraft.focalLengthMm
            : undefined
        }
      />
      <ShotExporter
        output={scene.output}
        registerExporter={registerExporter}
      />
      <SceneWorld
        scene={scene}
        view="shot"
        selectedEntityId={selectedId}
        onSelectEntity={onSelect}
        shotCameraTransform={effectiveCameraTransform}
      />
    </>
  );
};

/**
 * One WebGL canvas with explicit overview, local, and final-shot modes. Every
 * mode projects the same authoritative SceneSpec revision.
 */
export const ViewportWorkspace = ({
  scene,
  selectedId,
  onSelect,
  toolMode,
  snapEnabled,
  onCommitTransform,
  registerExporter,
  previewMode,
  focusedRegionId,
  onPreviewModeChange,
  onFocusedRegionChange,
  interactionDisabled,
  onUnlockUserProtectedCamera,
  onCommitCameraTransform,
  onCommitCameraFocalLength,
  onCameraDraftChange,
}: ViewportWorkspaceProps) => {
  // Canvas accepts a RefObject<HTMLElement>; React fills the ref before the
  // Canvas layout effect subscribes its pointer events.
  const eventSourceRef = useRef<HTMLDivElement>(null!);
  const [editorDomElement, setEditorDomElement] =
    useState<HTMLElement | null>(null);
  const [draftTransform, setDraftTransform] = useState<{
    entityId: string;
    transform: TransformSpec;
  } | null>(null);
  const [shotCameraDraft, setShotCameraDraft] =
    useState<ShotCameraDraft | null>(null);
  const dragSessionRef = useRef<TransformDragSession | null>(null);

  const handleShotCameraDraftChange = useCallback(
    (nextDraft: ShotCameraDraft | null): void => {
      setShotCameraDraft(nextDraft);
      onCameraDraftChange(nextDraft !== null);
    },
    [onCameraDraftChange],
  );

  useEffect(() => {
    setDraftTransform(null);
    const dragSession = dragSessionRef.current;
    if (
      dragSession &&
      (dragSession.sceneId !== scene.sceneId ||
        dragSession.baseRevision !== scene.revision ||
        dragSession.entityId !== selectedId)
    ) {
      dragSession.cancelled = true;
    }
  }, [scene.sceneId, scene.revision, selectedId]);

  const transformOverrides = useMemo(
    () =>
      draftTransform
        ? { [draftTransform.entityId]: draftTransform.transform }
        : undefined,
    [draftTransform],
  );
  const spatialPreview = useMemo(
    () =>
      deriveSpatialPreview(
        scene.spatialLayout,
        previewMode,
        focusedRegionId,
      ),
    [focusedRegionId, previewMode, scene.spatialLayout],
  );

  useEffect(() => {
    if (previewMode === "local" && scene.spatialLayout === null) {
      onPreviewModeChange("overview");
    }
  }, [onPreviewModeChange, previewMode, scene.spatialLayout]);

  const handleTransformDraft = (
    entityId: string,
    transform: TransformSpec,
  ): void => {
    const dragSession =
      dragSessionRef.current ??
      createTransformDragSession(scene, entityId);
    dragSessionRef.current = dragSession;
    if (
      decideTransformDragCommit(dragSession, scene, entityId).status ===
      "conflict"
    ) {
      setDraftTransform(null);
      return;
    }
    try {
      setDraftTransform({
        entityId,
        transform: snapTransformToContact(scene, entityId, transform),
      });
    } catch {
      setDraftTransform({ entityId, transform });
    }
  };

  const handleTransformStart = (entityId: string): void => {
    dragSessionRef.current = createTransformDragSession(scene, entityId);
    setDraftTransform(null);
  };

  const handleTransformCommit = async (
    entityId: string,
    transform: TransformSpec,
  ): Promise<void> => {
    const dragSession = dragSessionRef.current;
    dragSessionRef.current = null;
    const decision = decideTransformDragCommit(
      dragSession,
      scene,
      entityId,
    );
    if (decision.status === "conflict") {
      setDraftTransform(null);
      useEditorStore.getState().reportTransformConflict();
      return;
    }
    try {
      await onCommitTransform(entityId, transform);
    } catch {
      // The authoritative store exposes the readable mutation error.
    } finally {
      setDraftTransform(null);
    }
  };

  return (
    <div
      ref={eventSourceRef}
      style={workspaceStyle}
      data-testid="viewport-workspace"
      aria-label="3D shot workspace"
    >
      <section
        className="shot-preview-panel"
        id="compact-shot-panel"
        style={{
          ...shotFrameStyle,
          zIndex: previewMode === "shot" ? 2 : 1,
          opacity: previewMode === "shot" ? 1 : 0,
          pointerEvents: previewMode === "shot" ? "auto" : "none",
        }}
        data-testid="shot-preview"
        aria-label="Locked 16 by 9 shot preview"
        aria-hidden={previewMode !== "shot"}
      >
        <div className="shot-preview-image">
          <p style={labelStyle} aria-hidden="true">
            Shot Preview · {scene.output.resolutionPx.width} ×{" "}
            {scene.output.resolutionPx.height}
          </p>
          <View id="shot-three-view" style={viewStyle} index={1}>
            <ShotScene
              scene={scene}
              selectedId={selectedId}
              onSelect={onSelect}
              registerExporter={registerExporter}
              cameraDraft={shotCameraDraft}
            />
          </View>
        </div>
        {previewMode === "shot" ? (
          <ShotCameraNavigation
            scene={scene}
            disabled={interactionDisabled}
            onUnlockUserProtectedCamera={onUnlockUserProtectedCamera}
            onDraftChange={handleShotCameraDraftChange}
            onCommitTransform={onCommitCameraTransform}
            onCommitFocalLength={onCommitCameraFocalLength}
          />
        ) : null}
      </section>

      <section
        ref={setEditorDomElement}
        id="compact-editor-panel"
        style={{
          ...editorFrameStyle,
          zIndex: 2,
          display: previewMode === "shot" ? "none" : "block",
        }}
        data-testid="editor-viewport"
        aria-label="Editor viewport. Drag to orbit, right-drag to pan, and scroll to zoom."
      >
        <p style={labelStyle} aria-hidden="true">
          {previewMode === "local"
            ? `Local · ${spatialPreview.focusedRegionId ?? "No region"}`
            : scene.spatialLayout
              ? "Overview"
              : "Editor View"}
        </p>
        <View id="editor-three-view" style={viewStyle} index={2}>
          <EditorScene
            key={`${previewMode}-${spatialPreview.focusedRegionId ?? "none"}`}
            scene={scene}
            selectedId={selectedId}
            onSelect={onSelect}
            toolMode={toolMode}
            snapEnabled={snapEnabled}
            previewMode={previewMode}
            focusedRegionId={focusedRegionId}
            onFocusedRegionChange={onFocusedRegionChange}
            transformOverrides={transformOverrides}
            spatialPreview={spatialPreview}
            onTransformStart={handleTransformStart}
            onTransformDraft={handleTransformDraft}
            onTransformCommit={handleTransformCommit}
            editorDomElement={editorDomElement}
          />
        </View>
      </section>

      <nav style={modeSwitcherStyle} aria-label="Viewport preview mode">
        {(
          [
            ["overview", "整体总览"],
            ["local", "局部预览"],
            ["shot", "镜头预览"],
          ] as const
        ).map(([mode, label]) => (
          <button
            className={
              previewMode === mode
                ? "viewport-mode-button is-active"
                : "viewport-mode-button"
            }
            data-preview-mode={mode}
            data-view-mode={mode}
            disabled={mode === "local" && scene.spatialLayout === null}
            key={mode}
            onClick={() => onPreviewModeChange(mode)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      <Canvas
        data-testid="viewport-webgl-canvas"
        aria-label="Shared WebGL renderer for the active preview mode"
        style={canvasStyle}
        eventSource={eventSourceRef}
        eventPrefix="client"
        dpr={[1, 2]}
        shadows="percentage"
        gl={{ antialias: true, alpha: true }}
      >
        <View.Port />
      </Canvas>
    </div>
  );
};
