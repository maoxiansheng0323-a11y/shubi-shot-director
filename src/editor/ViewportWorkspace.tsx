import {
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
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";
import {
  createTransformDragSession,
  decideTransformDragCommit,
  useEditorStore,
  type TransformDragSession,
} from "./editor-store";
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
}

const workspaceStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 38%)",
  gap: 12,
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
  height: "100%",
};

const shotColumnStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  minWidth: 0,
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: 40,
  pointerEvents: "none",
};

const shotFrameStyle: CSSProperties = {
  ...viewportFrameStyle,
  width: "100%",
  aspectRatio: "16 / 9",
  pointerEvents: "auto",
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
}: ViewportWorkspaceProps & DraftSceneProps) => (
  <>
    <color attach="background" args={["#1c222b"]} />
    <PerspectiveCamera
      makeDefault
      position={[6, 4.5, 7]}
      fov={50}
      near={0.02}
      far={500}
    />
    <OrbitControls
      makeDefault
      domElement={editorDomElement ?? undefined}
      target={[0, 1, 0]}
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

const ShotScene = ({
  scene,
  selectedId,
  onSelect,
  transformOverrides,
  registerExporter,
}: ViewportWorkspaceProps & DraftSceneProps) => (
  <>
    <color attach="background" args={["#20252c"]} />
    <ShotCamera
      scene={scene}
      transformOverride={transformOverrides?.[scene.activeCameraId]}
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
      transformOverrides={transformOverrides}
    />
  </>
);

/**
 * One WebGL canvas, split into an inspectable editor view and a locked 16:9
 * final-shot view. Both are projections of the same SceneSpec revision.
 */
export const ViewportWorkspace = ({
  scene,
  selectedId,
  onSelect,
  toolMode,
  snapEnabled,
  onCommitTransform,
  registerExporter,
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
  const dragSessionRef = useRef<TransformDragSession | null>(null);

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
        ref={setEditorDomElement}
        id="compact-editor-panel"
        style={editorFrameStyle}
        data-testid="editor-viewport"
        aria-label="Editor viewport. Drag to orbit, right-drag to pan, and scroll to zoom."
      >
        <p style={labelStyle} aria-hidden="true">
          Editor View
        </p>
        <View id="editor-three-view" style={viewStyle} index={1}>
          <EditorScene
            scene={scene}
            selectedId={selectedId}
            onSelect={onSelect}
            toolMode={toolMode}
            snapEnabled={snapEnabled}
            onCommitTransform={onCommitTransform}
            registerExporter={registerExporter}
            transformOverrides={transformOverrides}
            onTransformStart={handleTransformStart}
            onTransformDraft={handleTransformDraft}
            onTransformCommit={handleTransformCommit}
            editorDomElement={editorDomElement}
          />
        </View>
      </section>

      <aside
        id="compact-shot-panel"
        style={shotColumnStyle}
        data-testid="shot-preview-column"
        aria-label="Final shot preview column"
      >
        <section
          style={shotFrameStyle}
          data-testid="shot-preview"
          aria-label="Locked 16 by 9 shot preview"
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
              toolMode={toolMode}
              snapEnabled={snapEnabled}
              onCommitTransform={onCommitTransform}
              registerExporter={registerExporter}
              transformOverrides={transformOverrides}
            />
          </View>
        </section>
      </aside>

      <Canvas
        data-testid="viewport-webgl-canvas"
        aria-label="Shared WebGL renderer for editor and shot views"
        style={canvasStyle}
        eventSource={eventSourceRef}
        eventPrefix="client"
        dpr={[1, 2]}
        shadows="basic"
        gl={{ antialias: true, alpha: true }}
      >
        <View.Port />
      </Canvas>
    </div>
  );
};
