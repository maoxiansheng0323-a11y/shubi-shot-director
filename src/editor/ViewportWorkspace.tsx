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
  View,
} from "@react-three/drei";
import { snapTransformToContact } from "../domain/contact-constraints";
import type {
  CameraEntity,
  QuaternionTuple,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";
import {
  ShotCameraNavigation,
  type ShotCameraDraft,
} from "./ShotCameraNavigation";
import { CompactShotPreviewControls } from "./CompactShotPreviewControls";
import { EditorCameraRig } from "./EditorCameraRig";
import { StudioInteractionController } from "./StudioInteractionController";
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
import {
  frameSelectedBound,
  resolveEntityWorldBound,
} from "./studio-interaction-math";
import type { CanonicalPuppetJointId } from "../domain/actor-joints";
import {
  createStudioEntityGestureSession,
  decideStudioEntityGesture,
  type StudioEntityGestureSession,
} from "./studio-gesture-session";
import { SceneWorld, ShotCamera } from "../three/SceneWorld";
import {
  ShotExporter,
  type ShotExporterHandle,
} from "../three/ShotExporter";

export interface ViewportWorkspaceProps {
  scene: SceneSpec;
  selectedId: string | null;
  focusedEntityId?: string | null;
  focusedActorJointId?: CanonicalPuppetJointId | null;
  focusRequestVersion?: number;
  onSelect: (entityId: string | null) => void;
  onFocusEntity?: (entityId: string) => void;
  onFocusActorJoint?: (jointId: CanonicalPuppetJointId) => void;
  onClearFocus?: () => void;
  toolMode: "select" | "translate" | "rotate";
  snapEnabled: boolean;
  onCommitTransform: (
    entityId: string,
    transform: TransformSpec,
  ) => void | Promise<void>;
  onCommitActorJoint?: (
    actorId: string,
    jointId: CanonicalPuppetJointId,
    rotation: QuaternionTuple,
  ) => void | Promise<void>;
  registerExporter: (exporter: ShotExporterHandle | null) => void;
  previewMode: SpatialPreviewMode | "shot";
  shotPreviewExpanded?: boolean;
  focusedRegionId: string | null;
  onPreviewModeChange: (mode: SpatialPreviewMode) => void;
  onShotPreviewExpandedChange?: (expanded: boolean) => void;
  onActivateShotCamera?: (cameraId: string) => void | Promise<void>;
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
  alignSelf: "end",
  justifySelf: "end",
  width: "min(42%, 560px)",
  maxWidth: "calc(100% - 32px)",
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
  | "focusedEntityId"
  | "focusedActorJointId"
  | "focusRequestVersion"
  | "onSelect"
  | "onFocusEntity"
  | "onFocusActorJoint"
  | "toolMode"
  | "snapEnabled"
  | "previewMode"
  | "focusedRegionId"
  | "onFocusedRegionChange"
> &
  DraftSceneProps & {
    previewMode: SpatialPreviewMode;
  };

const EditorScene = ({
  scene,
  selectedId,
  focusedEntityId = null,
  focusedActorJointId = null,
  focusRequestVersion = 0,
  onSelect,
  onFocusEntity = () => undefined,
  onFocusActorJoint = () => undefined,
  toolMode,
  snapEnabled,
  transformOverrides,
  onTransformStart,
  onTransformCancel,
  onTransformDraft,
  onTransformCommit,
  editorDomElement,
  previewMode,
  focusedRegionId,
  onFocusedRegionChange,
  spatialPreview,
  actorJointOverrides,
  onActorJointStart,
  onActorJointDraft,
  onActorJointCommit,
}: EditorSceneProps) => {
  const frame = useMemo(() => {
    const focusedBound = focusedEntityId
      ? resolveEntityWorldBound(scene, focusedEntityId, transformOverrides)
      : null;
    const viewDirection = [
      spatialPreview.camera.target[0] - spatialPreview.camera.position[0],
      spatialPreview.camera.target[1] - spatialPreview.camera.position[1],
      spatialPreview.camera.target[2] - spatialPreview.camera.position[2],
    ] as [number, number, number];
    return focusedBound
      ? frameSelectedBound(focusedBound, viewDirection, 50, 16 / 9) ?? {
          positionM: spatialPreview.camera.position,
          targetM: spatialPreview.camera.target,
        }
      : {
          positionM: spatialPreview.camera.position,
          targetM: spatialPreview.camera.target,
        };
  }, [
    focusRequestVersion,
    focusedEntityId,
    scene,
    spatialPreview.camera.position,
    spatialPreview.camera.target,
    transformOverrides,
  ]);
  return (
    <>
      <color attach="background" args={["#1c222b"]} />
      <EditorCameraRig
        frame={frame}
        frameRequestVersion={focusRequestVersion}
        shouldFrame={focusedEntityId !== null}
        domElement={editorDomElement ?? undefined}
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
        focusedEntityId={focusedEntityId}
        focusedActorJointId={focusedActorJointId}
        actorJointOverrides={actorJointOverrides}
        onSelectEntity={onSelect}
        onFocusEntity={onFocusEntity}
        onFocusActorJoint={onFocusActorJoint}
        onActorJointStart={onActorJointStart}
        onActorJointDraft={onActorJointDraft}
        onActorJointCommit={onActorJointCommit}
        selectedRegionId={focusedRegionId}
        onSelectRegion={onFocusedRegionChange}
        spatialPreview={spatialPreview}
        previewMode={previewMode}
        toolMode={toolMode}
        snapEnabled={snapEnabled}
        transformOverrides={transformOverrides}
        onTransformStart={onTransformStart}
        onTransformCancel={onTransformCancel}
        onTransformDraft={onTransformDraft}
        onTransformCommit={onTransformCommit}
        transformDomElement={editorDomElement ?? undefined}
      />
    </>
  );
};

interface DraftSceneProps {
  spatialPreview: SpatialPreviewProjection;
  actorJointOverrides?: Readonly<
    Record<string, Partial<Record<CanonicalPuppetJointId, QuaternionTuple>>>
  >;
  onActorJointStart?: (
    actorId: string,
    jointId: CanonicalPuppetJointId,
  ) => void;
  onActorJointDraft?: (
    actorId: string,
    jointId: CanonicalPuppetJointId,
    rotation: QuaternionTuple,
  ) => void;
  onActorJointCommit?: (
    actorId: string,
    jointId: CanonicalPuppetJointId,
    rotation: QuaternionTuple,
  ) => void | Promise<void>;
  transformOverrides?: Readonly<
    Record<string, TransformSpec | undefined>
  >;
  onTransformDraft?: (
    entityId: string,
    transform: TransformSpec,
  ) => void;
  onTransformStart?: (entityId: string) => void;
  onTransformCancel?: (entityId: string) => void;
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
  focusedEntityId = null,
  focusedActorJointId = null,
  focusRequestVersion = 0,
  onSelect,
  onFocusEntity = () => undefined,
  onFocusActorJoint = () => undefined,
  onClearFocus = () => undefined,
  toolMode,
  snapEnabled,
  onCommitTransform,
  onCommitActorJoint = () => undefined,
  registerExporter,
  previewMode,
  shotPreviewExpanded = false,
  focusedRegionId,
  onPreviewModeChange,
  onShotPreviewExpandedChange = () => undefined,
  onActivateShotCamera = () => undefined,
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
  const [draftActorJoint, setDraftActorJoint] = useState<{
    actorId: string;
    jointId: CanonicalPuppetJointId;
    rotation: QuaternionTuple;
  } | null>(null);
  const [shotCameraDraft, setShotCameraDraft] =
    useState<ShotCameraDraft | null>(null);
  const dragSessionRef = useRef<TransformDragSession | null>(null);
  const jointGestureSessionRef = useRef<StudioEntityGestureSession | null>(null);
  const isShotPreviewExpanded = shotPreviewExpanded || previewMode === "shot";

  const handleShotCameraDraftChange = useCallback(
    (nextDraft: ShotCameraDraft | null): void => {
      setShotCameraDraft(nextDraft);
      onCameraDraftChange(nextDraft !== null);
    },
    [onCameraDraftChange],
  );

  const handleActivateShotCamera = useCallback(
    async (cameraId: string): Promise<void> => {
      setShotCameraDraft(null);
      onCameraDraftChange(false);
      await onActivateShotCamera(cameraId);
    },
    [onActivateShotCamera, onCameraDraftChange],
  );

  useEffect(() => {
    setDraftTransform(null);
    setDraftActorJoint(null);
    const dragSession = dragSessionRef.current;
    if (
      dragSession &&
      (dragSession.sceneId !== scene.sceneId ||
        dragSession.baseRevision !== scene.revision ||
        dragSession.entityId !== selectedId)
    ) {
      dragSession.cancelled = true;
    }
    const jointSession = jointGestureSessionRef.current;
    if (
      jointSession &&
      (jointSession.sceneId !== scene.sceneId ||
        jointSession.baseRevision !== scene.revision ||
        jointSession.focusedEntityId !== focusedEntityId)
    ) {
      jointSession.cancelled = true;
    }
  }, [focusedEntityId, scene.sceneId, scene.revision, selectedId]);

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
        previewMode === "local" ? "local" : "overview",
        focusedRegionId,
      ),
    [focusedRegionId, previewMode, scene.spatialLayout],
  );
  const actorJointOverrides = useMemo(
    () =>
      draftActorJoint
        ? {
            [draftActorJoint.actorId]: {
              [draftActorJoint.jointId]: draftActorJoint.rotation,
            },
          }
        : undefined,
    [draftActorJoint],
  );
  const editorViewDirection = useMemo(
    () =>
      [
        spatialPreview.camera.target[0] - spatialPreview.camera.position[0],
        spatialPreview.camera.target[1] - spatialPreview.camera.position[1],
        spatialPreview.camera.target[2] - spatialPreview.camera.position[2],
      ] as [number, number, number],
    [spatialPreview.camera.position, spatialPreview.camera.target],
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

  const handleTransformCancel = useCallback((entityId: string): void => {
    if (dragSessionRef.current?.entityId === entityId) {
      dragSessionRef.current = null;
    }
    setDraftTransform((current) =>
      current?.entityId === entityId ? null : current,
    );
  }, []);

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
      onSelect(entityId);
    } catch {
      // The authoritative store exposes the readable mutation error.
    } finally {
      setDraftTransform(null);
    }
  };

  const handleActorJointDraft = (
    actorId: string,
    jointId: CanonicalPuppetJointId,
    rotation: QuaternionTuple,
  ): void => {
    const decision = decideStudioEntityGesture(
      jointGestureSessionRef.current,
      scene,
      actorId,
    );
    if (decision.status !== "commit") return;
    setDraftActorJoint({ actorId, jointId, rotation });
  };

  const handleActorJointStart = (
    actorId: string,
    _jointId: CanonicalPuppetJointId,
  ): void => {
    const actor = scene.entities.find((entity) => entity.id === actorId);
    if (actor?.kind !== "actor") return;
    jointGestureSessionRef.current = createStudioEntityGestureSession(
      scene,
      actorId,
      "actor",
      focusedEntityId ?? actorId,
    );
  };

  const handleActorJointCommit = async (
    actorId: string,
    jointId: CanonicalPuppetJointId,
    rotation: QuaternionTuple,
  ): Promise<void> => {
    const decision = decideStudioEntityGesture(
      jointGestureSessionRef.current,
      scene,
      actorId,
    );
    jointGestureSessionRef.current = null;
    setDraftActorJoint(null);
    if (decision.status !== "commit") {
      if (decision.status === "conflict") {
        useEditorStore.getState().reportTransformConflict();
      }
      return;
    }
    await onCommitActorJoint(actorId, jointId, rotation);
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
          zIndex: isShotPreviewExpanded ? 5 : 3,
          opacity: 1,
          pointerEvents: "auto",
          ...(isShotPreviewExpanded
            ? {
                position: "absolute",
                inset: 12,
                width: "auto",
                maxWidth: "none",
                maxHeight: "none",
                alignSelf: "stretch",
                justifySelf: "stretch",
              }
            : {}),
        }}
        data-testid="shot-preview"
        data-shot-preview-expanded={isShotPreviewExpanded}
        aria-label="Locked 16 by 9 shot preview"
        aria-hidden={false}
      >
        <div
          className="shot-preview-image"
          style={
            isShotPreviewExpanded
              ? { height: "100%", aspectRatio: "auto" }
              : undefined
          }
        >
          <p style={labelStyle} aria-hidden="true">
            Shot Preview · {scene.output.resolutionPx.width} ×{" "}
            {scene.output.resolutionPx.height}
          </p>
          <View id="shot-three-view" style={viewStyle} index={2}>
            <ShotScene
              scene={scene}
              selectedId={selectedId}
              onSelect={onSelect}
              registerExporter={registerExporter}
              cameraDraft={shotCameraDraft}
            />
          </View>
        </div>
        <CompactShotPreviewControls
          scene={scene}
          disabled={interactionDisabled}
          onActivateCamera={handleActivateShotCamera}
          onExpand={() => onShotPreviewExpandedChange(true)}
          expanded={isShotPreviewExpanded}
          onCollapse={() => onShotPreviewExpandedChange(false)}
        />
        {isShotPreviewExpanded ? (
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
          display: "block",
          pointerEvents: isShotPreviewExpanded ? "none" : "auto",
        }}
        data-testid="editor-viewport"
        aria-label="Editor viewport. Left-drag to pan, right-drag to orbit, and scroll to zoom."
        tabIndex={0}
      >
        <p style={labelStyle} aria-hidden="true">
          {previewMode === "local"
            ? `Local · ${spatialPreview.focusedRegionId ?? "No region"}`
            : scene.spatialLayout
              ? "Overview"
              : "Editor View"}
        </p>
        <View id="editor-three-view" style={viewStyle} index={1}>
          <StudioInteractionController
            scene={scene}
            surface={editorDomElement}
            selectedEntityId={selectedId}
            focusedEntityId={focusedEntityId}
            editorViewDirection={editorViewDirection}
            disabled={interactionDisabled}
            onCommitTransform={onCommitTransform}
            onClearFocus={onClearFocus}
          >
            <EditorScene
              scene={scene}
              selectedId={selectedId}
              focusedEntityId={focusedEntityId}
              focusedActorJointId={focusedActorJointId}
              focusRequestVersion={focusRequestVersion}
              onSelect={onSelect}
              onFocusEntity={onFocusEntity}
              onFocusActorJoint={onFocusActorJoint}
              toolMode={toolMode}
              snapEnabled={snapEnabled}
              previewMode={previewMode === "local" ? "local" : "overview"}
              focusedRegionId={focusedRegionId}
              onFocusedRegionChange={onFocusedRegionChange}
              transformOverrides={transformOverrides}
              actorJointOverrides={actorJointOverrides}
              spatialPreview={spatialPreview}
              onTransformStart={handleTransformStart}
              onTransformCancel={handleTransformCancel}
              onTransformDraft={handleTransformDraft}
              onTransformCommit={handleTransformCommit}
              onActorJointStart={handleActorJointStart}
              onActorJointDraft={handleActorJointDraft}
              onActorJointCommit={handleActorJointCommit}
              editorDomElement={editorDomElement}
            />
          </StudioInteractionController>
        </View>
      </section>

      <nav style={modeSwitcherStyle} aria-label="Viewport preview mode">
        {(
          [
            ["overview", "整体总览"],
            ["local", "局部预览"],
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
