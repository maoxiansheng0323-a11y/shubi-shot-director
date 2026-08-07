import {
  Edges,
  PerspectiveCamera,
  TransformControls,
} from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import type {
  BufferGeometry,
  Group,
  PerspectiveCamera as ThreePerspectiveCamera,
} from "three";
import { DoubleSide, Shape, Vector2, Vector3 } from "three";
import {
  resolveActorProjection,
  resolveActorJointParentRotations,
  type ActorRigPrimitive,
} from "../domain/actor-projection";
import { deriveBoundaryWallBoxes } from "../domain/spatial-layout";
import type {
  SpatialBoundary,
  SpatialLayout,
  SpatialRegion,
} from "../domain/spatial-layout";
import {
  deriveSpatialPreview,
  type SpatialPreviewMode,
  type SpatialPreviewProjection,
} from "../editor/spatial-preview";
import {
  beginGroundDrag,
  beginEntityRotationDrag,
  beginJointDrag,
  directEntityDragMode,
  shouldCommitDirectEntityDrag,
  shouldShowStudioTransformControls,
  updateGroundDrag,
  updateEntityRotationDrag,
  updateJointDrag,
  rotationDragAxesInLocalSpace,
  type GroundDragCapture,
  type StudioEntityRotationDragCapture,
  type StudioJointDragCapture,
  type StudioRotationDragAxes,
} from "../editor/studio-interaction-math";
import { subscribeStudioPointerCancellation } from "../editor/studio-pointer-events";
import { hasStudioPointerExceededDragThreshold } from "../editor/studio-selection";
import {
  deriveHiddenShotWallBoxKey,
  shotWallBoxKey,
} from "../editor/shot-wall-visibility";
import {
  type AnyActorEntity,
  type CameraEntity,
  type JsonValue,
  type SceneEntity,
  type SceneSpec,
  type QuaternionTuple,
  type TransformSpec,
} from "../domain/scene-schema";
import {
  multiplyQuaternions,
  rotateVector,
} from "../domain/scene-math";
import type { CanonicalPuppetJointId } from "../domain/actor-joints";
import {
  RefinedMannequin,
  type RefinedPrimitiveRenderDescriptor,
} from "./RefinedMannequin";

export interface SceneWorldProps {
  scene: SceneSpec;
  view: "editor" | "shot";
  selectedEntityId: string | null;
  focusedEntityId?: string | null;
  focusedActorJointId?: CanonicalPuppetJointId | null;
  actorJointOverrides?: Readonly<
    Record<string, Partial<Record<CanonicalPuppetJointId, QuaternionTuple>>>
  >;
  onSelectEntity: (entityId: string | null) => void;
  onFocusEntity?: (entityId: string) => void;
  onFocusActorJoint?: (jointId: CanonicalPuppetJointId) => void;
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
  selectedRegionId?: string | null;
  onSelectRegion?: (regionId: string) => void;
  spatialPreview?: SpatialPreviewProjection;
  previewMode?: SpatialPreviewMode;
  toolMode?: "select" | "translate" | "rotate";
  snapEnabled?: boolean;
  transformOverrides?: Readonly<
    Record<string, TransformSpec | undefined>
  >;
  shotCameraTransform?: TransformSpec;
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
  transformDomElement?: HTMLElement;
}

export const toCappedLathePoints = (
  points: readonly { readonly y: number; readonly radius: number }[],
): Vector2[] => {
  const rendered = points.map(
    ({ radius, y }) => new Vector2(radius, y),
  );
  const first = points[0];
  const last = points.at(-1);
  if (first && first.radius > 0) {
    rendered.unshift(new Vector2(0, first.y));
  }
  if (last && last.radius > 0) {
    rendered.push(new Vector2(0, last.y));
  }
  return rendered;
};

const numberParameter = (
  parameters: Record<string, JsonValue>,
  key: string,
  fallback: number,
): number => {
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
};

const entityTransformProps = (transform: TransformSpec) => ({
  position: transform.positionM,
  quaternion: transform.rotation,
  scale: transform.scale,
});

const transformFromGroup = (group: Group): TransformSpec => {
  group.quaternion.normalize();
  return {
    positionM: [group.position.x, group.position.y, group.position.z],
    rotation: [
      group.quaternion.x,
      group.quaternion.y,
      group.quaternion.z,
      group.quaternion.w,
    ],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  };
};

interface PointerMoveCompatibleControls {
  pointerMove: (pointer: {
    x: number;
    y: number;
    button: number;
  }) => void;
}

interface ThreePointerCaptureTarget {
  hasPointerCapture: (pointerId: number) => boolean;
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
}

interface ToggleableEditorCameraControls {
  enabled: boolean;
}

const pointerCaptureTarget = (
  event: ThreeEvent<PointerEvent>,
): ThreePointerCaptureTarget =>
  event.currentTarget as unknown as ThreePointerCaptureTarget;

const editorScreenRotationAxes = (
  rotation: QuaternionTuple,
): StudioRotationDragAxes => ({
  right: rotateVector([1, 0, 0], rotation),
  up: rotateVector([0, 1, 0], rotation),
  forward: rotateVector([0, 0, -1], rotation),
});

const SelectionEdges = ({
  selected,
  color = "#9fd0ff",
}: {
  selected: boolean;
  color?: string;
}) =>
  selected ? (
    <Edges
      threshold={18}
      color={color}
      scale={1.015}
      renderOrder={20}
    />
  ) : null;

const EntityFocusContext = createContext(false);
const ActorJointFocusContext = createContext<CanonicalPuppetJointId | null>(null);

interface GrayMeshProps {
  color: string;
  selected: boolean;
  children?: ReactNode;
  geometry?: BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  opacity?: number;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerCancel?: (event: ThreeEvent<PointerEvent>) => void;
  onLostPointerCapture?: (event: ThreeEvent<PointerEvent>) => void;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}

const EntityOpacityContext = createContext(1);

const GrayMesh = ({
  color,
  selected,
  children,
  geometry,
  position,
  rotation,
  scale,
  castShadow = true,
  receiveShadow = true,
  opacity,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onClick,
}: GrayMeshProps) => {
  const inheritedOpacity = useContext(EntityOpacityContext);
  const focused = useContext(EntityFocusContext);
  const focusedJointId = useContext(ActorJointFocusContext);
  const resolvedOpacity = opacity ?? inheritedOpacity;
  return (
    <mesh
      geometry={geometry}
      position={position}
      rotation={rotation}
      scale={scale}
      castShadow={castShadow && resolvedOpacity >= 0.99}
      receiveShadow={receiveShadow}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onClick={onClick}
    >
      {children}
      <meshStandardMaterial
        color={focusedJointId ? "#4ade80" : focused ? "#ef6a6a" : selected ? "#a9c8e8" : color}
        roughness={0.84}
        metalness={0.02}
        transparent={resolvedOpacity < 0.99}
        opacity={resolvedOpacity}
        depthWrite={resolvedOpacity >= 0.99}
      />
      <SelectionEdges
        selected={selected || focused || focusedJointId !== null}
        color={focusedJointId ? "#4ade80" : focused ? "#ef4444" : undefined}
      />
    </mesh>
  );
};

const RoomEnvironment = ({
  entity,
  selected,
}: {
  entity: Extract<SceneEntity, { kind: "environment" }>;
  selected: boolean;
}) => {
  const width = numberParameter(entity.preset.parameters, "widthM", 5);
  const depth = numberParameter(entity.preset.parameters, "depthM", 4);
  const height = numberParameter(entity.preset.parameters, "heightM", 2.8);
  const thickness = numberParameter(
    entity.preset.parameters,
    "wallThicknessM",
    0.08,
  );

  return (
    <>
      <GrayMesh
        color={entity.color}
        selected={selected}
        position={[0, -thickness / 2, 0]}
        castShadow={false}
      >
        <boxGeometry args={[width, thickness, depth]} />
      </GrayMesh>
      <GrayMesh
        color={entity.color}
        selected={selected}
        position={[0, height / 2, -depth / 2]}
        castShadow={false}
      >
        <boxGeometry args={[width, height, thickness]} />
      </GrayMesh>
      <GrayMesh
        color={entity.color}
        selected={selected}
        position={[-width / 2, height / 2, 0]}
        castShadow={false}
      >
        <boxGeometry args={[thickness, height, depth]} />
      </GrayMesh>
    </>
  );
};

const REGION_COLORS = [
  "#7896a8",
  "#8d86a8",
  "#6f9b8d",
  "#a38b72",
  "#7f8fa6",
] as const;

const SpatialRegionFloor = ({
  region,
  floorY,
  color,
  opacity,
  selected,
  onSelect,
}: {
  region: SpatialRegion;
  floorY: number;
  color: string;
  opacity: number;
  selected: boolean;
  onSelect?: (regionId: string) => void;
}) => {
  const shape = useMemo(() => {
    const nextShape = new Shape();
    const [first, ...rest] = region.footprintXZ;
    nextShape.moveTo(first[0], first[1]);
    for (const [x, z] of rest) {
      nextShape.lineTo(x, z);
    }
    nextShape.closePath();
    return nextShape;
  }, [region.footprintXZ]);

  if (opacity <= 0) {
    return null;
  }
  return (
    <mesh
      name={`spatial-region-${region.id}`}
      position={[0, floorY + 0.006, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow
      onClick={(event) => {
        if (event.delta > 2) return;
        event.stopPropagation();
        onSelect?.(region.id);
      }}
    >
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        color={selected ? "#9fd0ff" : color}
        roughness={0.92}
        metalness={0}
        side={DoubleSide}
        transparent={opacity < 0.99}
        opacity={opacity}
        depthWrite={opacity >= 0.99}
      />
      <SelectionEdges selected={selected} />
    </mesh>
  );
};

const SpatialBoundaryWalls = ({
  layout,
  boundary,
  opacity,
  hiddenWallBoxKey,
}: {
  layout: SpatialLayout;
  boundary: SpatialBoundary;
  opacity: number;
  hiddenWallBoxKey: string | null;
}) =>
  opacity <= 0
    ? null
    : deriveBoundaryWallBoxes(layout, boundary).map((wall, index) => {
        const wallBoxKey = shotWallBoxKey(boundary.id, index);
        if (wallBoxKey === hiddenWallBoxKey) {
          return null;
        }
        return (
          <GrayMesh
            key={wallBoxKey}
            color="#8b949f"
            selected={false}
            position={wall.position}
            rotation={[0, wall.rotationY, 0]}
            castShadow={false}
            opacity={opacity}
          >
            <boxGeometry args={wall.size} />
          </GrayMesh>
        );
      });

const SpatialConnectionMarkers = ({
  layout,
  opacityByBoundary,
}: {
  layout: SpatialLayout;
  opacityByBoundary: ReadonlyMap<string, number>;
}) =>
  layout.connections.flatMap((connection) => {
    if (!connection.enabled) {
      return [];
    }
    const opening = layout.openings.find(
      (candidate) => candidate.id === connection.openingId,
    );
    const boundary = opening
      ? layout.boundaries.find(
          (candidate) => candidate.id === opening.boundaryId,
        )
      : undefined;
    if (!opening || !boundary || !opening.visible || !boundary.visible) {
      return [];
    }
    const deltaX = boundary.endXZ[0] - boundary.startXZ[0];
    const deltaZ = boundary.endXZ[1] - boundary.startXZ[1];
    const length = Math.hypot(deltaX, deltaZ);
    const directionX = deltaX / length;
    const directionZ = deltaZ / length;
    const centerM = opening.offsetM + opening.widthM / 2;
    const opacity = opacityByBoundary.get(boundary.id) ?? 1;
    return [
      <GrayMesh
        key={connection.id}
        color={connection.allowsPassage ? "#62b6a5" : "#bd8e6c"}
        selected={false}
        position={[
          boundary.startXZ[0] + directionX * centerM,
          layout.floorY + 0.018,
          boundary.startXZ[1] + directionZ * centerM,
        ]}
        rotation={[0, Math.atan2(-directionZ, directionX), 0]}
        castShadow={false}
        receiveShadow={false}
        opacity={Math.min(0.82, opacity)}
      >
        <boxGeometry
          args={[
            opening.widthM,
            0.025,
            Math.max(boundary.thicknessM * 2.5, 0.16),
          ]}
        />
      </GrayMesh>,
    ];
  });

const SpatialLayoutProjection = ({
  layout,
  preview,
  selectedRegionId,
  onSelectRegion,
  showConnectionMarkers,
  hiddenWallBoxKey,
}: {
  layout: SpatialLayout;
  preview: SpatialPreviewProjection;
  selectedRegionId: string | null;
  onSelectRegion?: (regionId: string) => void;
  showConnectionMarkers: boolean;
  hiddenWallBoxKey: string | null;
}) => (
  <group name="spatial-layout">
    {layout.regions.map((region, index) => (
      <SpatialRegionFloor
        key={region.id}
        region={region}
        floorY={layout.floorY}
        color={REGION_COLORS[index % REGION_COLORS.length]}
        opacity={preview.regionOpacity.get(region.id) ?? 0}
        selected={selectedRegionId === region.id}
        onSelect={onSelectRegion}
      />
    ))}
    {layout.boundaries.map((boundary) => (
      <SpatialBoundaryWalls
        key={boundary.id}
        layout={layout}
        boundary={boundary}
        opacity={preview.boundaryOpacity.get(boundary.id) ?? 0}
        hiddenWallBoxKey={hiddenWallBoxKey}
      />
    ))}
    {showConnectionMarkers ? (
      <SpatialConnectionMarkers
        layout={layout}
        opacityByBoundary={preview.boundaryOpacity}
      />
    ) : null}
  </group>
);

const PropEntity = ({
  entity,
  selected,
}: {
  entity: Extract<SceneEntity, { kind: "prop" }>;
  selected: boolean;
}) => {
  const [width, height, depth] = entity.geometry.sizeM;
  let geometry: ReactNode;
  switch (entity.geometry.primitive) {
    case "cylinder":
      geometry = (
        <cylinderGeometry
          args={[Math.max(width, depth) / 2, Math.max(width, depth) / 2, height, 24]}
        />
      );
      break;
    case "capsule":
      geometry = (
        <capsuleGeometry
          args={[
            Math.min(width, depth) / 2,
            Math.max(0.01, height - Math.min(width, depth)),
            8,
            16,
          ]}
        />
      );
      break;
    case "plane":
      geometry = <boxGeometry args={[width, Math.min(height, 0.025), depth]} />;
      break;
    case "box":
      geometry = <boxGeometry args={[width, height, depth]} />;
      break;
  }

  return (
    <GrayMesh color={entity.color} selected={selected}>
      {geometry}
    </GrayMesh>
  );
};

const ActorRigPrimitiveMesh = ({
  primitive,
  color,
  selected,
  focusedActorJointId,
  onFocusActorJoint,
  actorId,
  currentJointRotation,
  jointParentRotation,
  actorTransform,
  editorDomElement,
  onActorJointStart,
  onActorJointDraft,
  onActorJointCommit,
  refinedGeometry,
  refinedTransform,
}: {
  primitive: ActorRigPrimitive;
  color: string;
  selected: boolean;
  focusedActorJointId: CanonicalPuppetJointId | null;
  onFocusActorJoint?: (jointId: CanonicalPuppetJointId) => void;
  actorId?: string;
  currentJointRotation?: QuaternionTuple;
  jointParentRotation?: QuaternionTuple;
  actorTransform: TransformSpec;
  editorDomElement?: HTMLElement;
  onActorJointStart?: SceneWorldProps["onActorJointStart"];
  onActorJointDraft?: SceneWorldProps["onActorJointDraft"];
  onActorJointCommit?: SceneWorldProps["onActorJointCommit"];
  refinedGeometry?: BufferGeometry;
  refinedTransform?: RefinedPrimitiveRenderDescriptor["transform"];
}) => {
  const jointId = primitiveToJointId(primitive.id);
  const canFocusJoint = jointId !== null && onFocusActorJoint !== undefined;
  const jointDragRef = useRef<{
    capture: StudioJointDragCapture;
    moved: boolean;
  } | null>(null);
  const jointPointerIdRef = useRef<number | null>(null);
  const jointDocumentCleanupRef = useRef<(() => void) | null>(null);
  const editorCameraControls = useThree(
    (state) => state.controls,
  ) as unknown as ToggleableEditorCameraControls | null;
  const editorCamera = useThree((state) => state.camera);
  const ownerDocument = useThree(
    (state) => state.gl.domElement.ownerDocument,
  );

  const clearJointDocumentListeners = (): void => {
    const cleanup = jointDocumentCleanupRef.current;
    jointDocumentCleanupRef.current = null;
    cleanup?.();
  };
  const cancelJointPointer = (pointerId: number): void => {
    if (jointPointerIdRef.current !== pointerId) return;
    jointPointerIdRef.current = null;
    jointDragRef.current = null;
    clearJointDocumentListeners();
    if (editorCameraControls) editorCameraControls.enabled = true;
  };
  const updateJointPointer = (
    pointerId: number,
    clientX: number,
    clientY: number,
  ): boolean => {
    const active = jointDragRef.current;
    if (
      jointId === null ||
      !active ||
      !actorId ||
      jointPointerIdRef.current !== pointerId
    ) {
      return false;
    }
    if (
      !active.moved &&
      !hasStudioPointerExceededDragThreshold(
        active.capture.startPointerPx,
        [clientX, clientY],
      )
    ) {
      return false;
    }
    if (!active.moved) {
      active.moved = true;
      onActorJointStart?.(actorId, jointId);
    }
    onActorJointDraft?.(
      actorId,
      jointId,
      updateJointDrag(active.capture, [clientX, clientY]),
    );
    return true;
  };
  const finishJointPointer = (
    pointerId: number,
    clientX: number,
    clientY: number,
  ): boolean => {
    const active = jointDragRef.current;
    if (
      jointId === null ||
      !active ||
      !actorId ||
      jointPointerIdRef.current !== pointerId
    ) {
      return false;
    }
    jointPointerIdRef.current = null;
    jointDragRef.current = null;
    clearJointDocumentListeners();
    if (editorCameraControls) editorCameraControls.enabled = true;
    if (active.moved) {
      onActorJointCommit?.(
        actorId,
        jointId,
        updateJointDrag(active.capture, [clientX, clientY]),
      );
    }
    return true;
  };
  const bindJointDocumentListeners = (): void => {
    clearJointDocumentListeners();
    const handleDocumentPointerMove = (event: PointerEvent): void => {
      updateJointPointer(event.pointerId, event.clientX, event.clientY);
    };
    const handleDocumentPointerUp = (event: PointerEvent): void => {
      finishJointPointer(event.pointerId, event.clientX, event.clientY);
    };
    const handleDocumentPointerCancel = (event: PointerEvent): void => {
      cancelJointPointer(event.pointerId);
    };
    ownerDocument.addEventListener("pointermove", handleDocumentPointerMove, true);
    ownerDocument.addEventListener("pointerup", handleDocumentPointerUp, true);
    ownerDocument.addEventListener("pointercancel", handleDocumentPointerCancel, true);
    jointDocumentCleanupRef.current = () => {
      ownerDocument.removeEventListener("pointermove", handleDocumentPointerMove, true);
      ownerDocument.removeEventListener("pointerup", handleDocumentPointerUp, true);
      ownerDocument.removeEventListener("pointercancel", handleDocumentPointerCancel, true);
    };
  };

  useEffect(
    () => () => {
      clearJointDocumentListeners();
      jointPointerIdRef.current = null;
      jointDragRef.current = null;
      if (editorCameraControls) editorCameraControls.enabled = true;
    },
    [editorCameraControls],
  );

  const onJointPointerDown = (event: ThreeEvent<PointerEvent>): void => {
    if (
      !canFocusJoint ||
      jointId === null ||
      event.button !== 0 ||
      !actorId ||
      !currentJointRotation ||
      !jointParentRotation ||
      !editorDomElement ||
      !event.object.parent
    ) {
      return;
    }
    event.stopPropagation();
    onFocusActorJoint(jointId);
    const pivotWorld = event.object.parent.getWorldPosition(new Vector3());
    const pivotNdc = pivotWorld.project(editorCamera);
    const editorBounds = editorDomElement.getBoundingClientRect();
    const pivotPointerPx = [
      editorBounds.left + ((pivotNdc.x + 1) * editorBounds.width) / 2,
      editorBounds.top + ((1 - pivotNdc.y) * editorBounds.height) / 2,
    ] as const;
    jointDragRef.current = {
      capture: beginJointDrag(
        jointId,
        currentJointRotation,
        [event.nativeEvent.clientX, event.nativeEvent.clientY],
        rotationDragAxesInLocalSpace(
          editorScreenRotationAxes([
            editorCamera.quaternion.x,
            editorCamera.quaternion.y,
            editorCamera.quaternion.z,
            editorCamera.quaternion.w,
          ]),
          multiplyQuaternions(
            actorTransform.rotation,
            jointParentRotation,
          ),
        ),
        pivotPointerPx,
      ),
      moved: false,
    };
    jointPointerIdRef.current = event.pointerId;
    bindJointDocumentListeners();
    if (editorCameraControls) editorCameraControls.enabled = false;
  };
  const onJointPointerMove = (event: ThreeEvent<PointerEvent>): void => {
    if (
      updateJointPointer(
        event.pointerId,
        event.nativeEvent.clientX,
        event.nativeEvent.clientY,
      )
    ) {
      event.stopPropagation();
    }
  };
  const onJointPointerUp = (event: ThreeEvent<PointerEvent>): void => {
    if (
      finishJointPointer(
        event.pointerId,
        event.nativeEvent.clientX,
        event.nativeEvent.clientY,
      )
    ) {
      event.stopPropagation();
    }
  };
  const cancelJointDrag = (event: ThreeEvent<PointerEvent>): void => {
    cancelJointPointer(event.pointerId);
  };
  const onJointClick = (event: ThreeEvent<MouseEvent>): void => {
    if (!canFocusJoint || jointId === null) return;
    event.stopPropagation();
    onFocusActorJoint(jointId);
  };
  let geometry: ReactNode;
  switch (primitive.kind) {
    case "sphere":
      geometry = (
        <sphereGeometry
          args={[
            primitive.radius,
            primitive.widthSegments,
            primitive.heightSegments,
          ]}
        />
      );
      break;
    case "capsule":
      geometry = (
        <capsuleGeometry
          args={[
            primitive.radius,
            primitive.cylinderLength,
            primitive.capSegments,
            primitive.radialSegments,
          ]}
        />
      );
      break;
    case "box":
      geometry = <boxGeometry args={[...primitive.size]} />;
      break;
    case "cylinder":
      geometry = (
        <cylinderGeometry
          args={[
            primitive.radius,
            primitive.radius,
            primitive.length,
            primitive.radialSegments,
          ]}
        />
      );
      break;
    case "profile":
      geometry = (
        <latheGeometry
          args={[
            toCappedLathePoints(primitive.points),
            primitive.radialSegments,
          ]}
        />
      );
      break;
    case "ellipsoid":
      geometry = (
        <sphereGeometry
          args={[1, primitive.widthSegments, primitive.heightSegments]}
        />
      );
      break;
  }

  return (
    <group
      position={primitive.frame.position}
      quaternion={primitive.frame.rotation}
    >
      <ActorJointFocusContext.Provider
        value={focusedActorJointId === jointId ? jointId : null}
      >
        <GrayMesh
          color={primitive.id === "face" && !selected ? "#aab4bf" : color}
          selected={selected}
          geometry={refinedGeometry}
          position={refinedTransform?.position ?? primitive.center}
          onPointerDown={onJointPointerDown}
          onPointerMove={onJointPointerMove}
          onPointerUp={onJointPointerUp}
          onPointerCancel={cancelJointDrag}
          onClick={onJointClick}
          scale={
            refinedTransform?.scale ??
            (primitive.kind === "profile"
              ? [1, 1, primitive.depthScale]
              : primitive.kind === "ellipsoid"
                ? [...primitive.radii]
                : undefined)
          }
        >
          {refinedGeometry ? null : geometry}
        </GrayMesh>
      </ActorJointFocusContext.Provider>
    </group>
  );
};

const MannequinActor = ({
  scene,
  actor,
  selected,
  focusedActorJointId = null,
  onFocusActorJoint,
  actorJointOverride,
  onActorJointStart,
  onActorJointDraft,
  onActorJointCommit,
  editorDomElement,
}: {
  scene: SceneSpec;
  actor: AnyActorEntity;
  selected: boolean;
  focusedActorJointId?: CanonicalPuppetJointId | null;
  onFocusActorJoint?: (jointId: CanonicalPuppetJointId) => void;
  actorJointOverride?: Partial<Record<CanonicalPuppetJointId, QuaternionTuple>>;
  onActorJointStart?: SceneWorldProps["onActorJointStart"];
  onActorJointDraft?: SceneWorldProps["onActorJointDraft"];
  onActorJointCommit?: SceneWorldProps["onActorJointCommit"];
  editorDomElement?: HTMLElement;
}) => {
  const effectiveActor = actorJointOverride
    ? {
        ...actor,
        pose: {
          ...actor.pose,
          joints: { ...actor.pose.joints, ...actorJointOverride },
        },
      }
    : actor;
  const projection = actorJointOverride
    ? resolveActorProjection(scene, effectiveActor)
    : resolveActorProjection(scene, actor);
  const jointParentRotations = resolveActorJointParentRotations(
    scene,
    effectiveActor,
  );
  const primitiveProps = (primitive: ActorRigPrimitive) => {
    const jointId = primitiveToJointId(primitive.id);
    return {
      actorId: actor.id,
      currentJointRotation: jointId
        ? effectiveActor.pose.joints[jointId]
        : undefined,
      jointParentRotation: jointId
        ? jointParentRotations[jointId]
        : undefined,
      actorTransform: effectiveActor.transform,
      editorDomElement,
      onActorJointStart,
      onActorJointDraft,
      onActorJointCommit,
    };
  };
  const procedural = (
    <>
      {projection.primitives.map((primitive) => (
        <ActorRigPrimitiveMesh
          key={primitive.id}
          primitive={primitive}
          color={actor.color}
          selected={selected}
          focusedActorJointId={focusedActorJointId}
          onFocusActorJoint={onFocusActorJoint}
          {...primitiveProps(primitive)}
        />
      ))}
    </>
  );
  const renderProcedural = (primitive: ActorRigPrimitive) => (
    <ActorRigPrimitiveMesh
      key={primitive.id}
      primitive={primitive}
      color={actor.color}
      selected={selected}
      focusedActorJointId={focusedActorJointId}
      onFocusActorJoint={onFocusActorJoint}
      {...primitiveProps(primitive)}
    />
  );
  const renderRefined = ({
    primitive,
    geometry,
    transform,
  }: RefinedPrimitiveRenderDescriptor) => (
    <ActorRigPrimitiveMesh
      key={primitive.id}
      primitive={primitive}
      color={actor.color}
      selected={selected}
      focusedActorJointId={focusedActorJointId}
      onFocusActorJoint={onFocusActorJoint}
      refinedGeometry={geometry}
      refinedTransform={transform}
      {...primitiveProps(primitive)}
    />
  );
  return (
    <RefinedMannequin
      primitives={projection.primitives}
      fallback={procedural}
      renderProcedural={renderProcedural}
      renderRefined={renderRefined}
    />
  );
};

const CameraProxy = ({
  selected,
}: {
  selected: boolean;
}) => (
  <>
    <GrayMesh color="#c2a96f" selected={selected}>
      <boxGeometry args={[0.28, 0.18, 0.2]} />
    </GrayMesh>
    <GrayMesh
      color="#c2a96f"
      selected={selected}
      position={[0, 0, -0.2]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      <coneGeometry args={[0.13, 0.25, 4]} />
    </GrayMesh>
  </>
);

const primitiveToJointId = (
  primitiveId: ActorRigPrimitive["id"],
): CanonicalPuppetJointId | null => {
  if (
    primitiveId === "neck" ||
    primitiveId === "head" ||
    primitiveId === "face"
  ) {
    return "neck";
  }
  if (primitiveId === "pelvis" || primitiveId === "torso") return null;
  if (primitiveId === "upper_arm_l" || primitiveId === "shoulder_l") return "upper_arm_l";
  if (primitiveId === "forearm_l" || primitiveId === "elbow_l") return "forearm_l";
  if (primitiveId === "hand_l") return "hand_l";
  if (primitiveId === "upper_arm_r" || primitiveId === "shoulder_r") return "upper_arm_r";
  if (primitiveId === "forearm_r" || primitiveId === "elbow_r") return "forearm_r";
  if (primitiveId === "hand_r") return "hand_r";
  if (primitiveId === "upper_leg_l" || primitiveId === "hip_l") return "upper_leg_l";
  if (primitiveId === "lower_leg_l" || primitiveId === "knee_l") return "lower_leg_l";
  if (primitiveId === "foot_l") return "foot_l";
  if (primitiveId === "upper_leg_r" || primitiveId === "hip_r") return "upper_leg_r";
  if (primitiveId === "lower_leg_r" || primitiveId === "knee_r") return "lower_leg_r";
  if (primitiveId === "foot_r") return "foot_r";
  return null;
};

const EntityProjection = ({
  scene,
  entity,
  view,
  selected,
  focused,
  focusedActorJointId,
  actorJointOverride,
  opacity = 1,
  onSelectEntity,
  onFocusEntity,
  onFocusActorJoint,
  onActorJointStart,
  onActorJointDraft,
  onActorJointCommit,
  toolMode = "select",
  snapEnabled = true,
  transformOverride,
  onTransformStart,
  onTransformCancel,
  onTransformDraft,
  onTransformCommit,
  transformDomElement,
}: {
  scene: SceneSpec;
  entity: SceneEntity;
  view: SceneWorldProps["view"];
  selected: boolean;
  focused: boolean;
  focusedActorJointId?: CanonicalPuppetJointId | null;
  actorJointOverride?: Partial<Record<CanonicalPuppetJointId, QuaternionTuple>>;
  opacity?: number;
  onSelectEntity: SceneWorldProps["onSelectEntity"];
  onFocusEntity?: SceneWorldProps["onFocusEntity"];
  onFocusActorJoint?: SceneWorldProps["onFocusActorJoint"];
  onActorJointStart?: SceneWorldProps["onActorJointStart"];
  onActorJointDraft?: SceneWorldProps["onActorJointDraft"];
  onActorJointCommit?: SceneWorldProps["onActorJointCommit"];
  toolMode?: SceneWorldProps["toolMode"];
  snapEnabled?: boolean;
  transformOverride?: TransformSpec;
  onTransformStart?: SceneWorldProps["onTransformStart"];
  onTransformCancel?: SceneWorldProps["onTransformCancel"];
  onTransformDraft?: SceneWorldProps["onTransformDraft"];
  onTransformCommit?: SceneWorldProps["onTransformCommit"];
  transformDomElement?: HTMLElement;
}) => {
  const groupRef = useRef<Group>(null!);
  const controlsRef =
    useRef<ComponentRef<typeof TransformControls>>(null);
  const editorCameraControls = useThree(
    (state) => state.controls,
  ) as unknown as ToggleableEditorCameraControls | null;
  const editorCamera = useThree((state) => state.camera);
  const directDragRef = useRef<{
    pointerId: number;
    capture:
      | { mode: "translate"; value: GroundDragCapture }
      | { mode: "rotate"; value: StudioEntityRotationDragCapture };
    startTransform: TransformSpec;
    startPointerPx: readonly [number, number];
    moved: boolean;
  } | null>(null);
  const onTransformCancelRef = useRef(onTransformCancel);
  onTransformCancelRef.current = onTransformCancel;
  const showTransformControls = shouldShowStudioTransformControls({
    selected,
    view,
    lockMode: entity.lockMode,
    toolMode,
  });
  const transformMode = toolMode === "rotate" ? "rotate" : "translate";
  const setEditorCameraControlsEnabled = (enabled: boolean): void => {
    if (view === "editor" && editorCameraControls) {
      editorCameraControls.enabled = enabled;
    }
  };

  const cancelDirectDrag = useCallback(
    (pointerId: number): void => {
      const active = directDragRef.current;
      if (!active || active.pointerId !== pointerId) return;
      directDragRef.current = null;
      if (view === "editor" && editorCameraControls) {
        editorCameraControls.enabled = true;
      }
      if (active.moved) {
        onTransformCancelRef.current?.(entity.id);
      }
    },
    [editorCameraControls, entity.id, view],
  );

  useEffect(() => {
    if (!transformDomElement) return;
    const unsubscribe = subscribeStudioPointerCancellation(
      transformDomElement.ownerDocument,
      cancelDirectDrag,
    );
    return () => {
      unsubscribe();
      const active = directDragRef.current;
      if (active) cancelDirectDrag(active.pointerId);
    };
  }, [cancelDirectDrag, transformDomElement]);

  useEffect(() => {
    if (!showTransformControls || !transformDomElement) {
      return;
    }

    const ownerDocument = transformDomElement.ownerDocument;
    const handleEmbeddedPointerMove = (event: PointerEvent): void => {
      // Standard pointermove events report button=-1. Some embedded Chromium
      // input bridges report button=0 while the primary button is held; the
      // upstream controls ignore those moves. Normalize only that case.
      if (event.button !== 0 || (event.buttons & 1) === 0) {
        return;
      }
      const controls = controlsRef.current as unknown as
        | PointerMoveCompatibleControls
        | null;
      if (!controls) {
        return;
      }
      const rect = transformDomElement.getBoundingClientRect();
      controls.pointerMove({
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
        button: -1,
      });
    };

    ownerDocument.addEventListener(
      "pointermove",
      handleEmbeddedPointerMove,
      true,
    );
    return () =>
      ownerDocument.removeEventListener(
        "pointermove",
        handleEmbeddedPointerMove,
        true,
      );
  }, [showTransformControls, transformDomElement]);

  if (!entity.visible || opacity <= 0) {
    return null;
  }
  const onSelect = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    onSelectEntity(entity.id);
  };
  const onDoubleClick = (event: ThreeEvent<MouseEvent>): void => {
    if (view !== "editor") return;
    event.stopPropagation();
    onFocusEntity?.(entity.id);
  };
  const onPointerDown = (event: ThreeEvent<PointerEvent>): void => {
    const mode = directEntityDragMode({
      view,
      button: event.button,
      toolMode,
      lockMode: entity.lockMode,
      entityKind: entity.kind,
      focused,
    });
    if (!mode) return;
    event.stopPropagation();
    if (!focused) onSelectEntity(entity.id);
    const startTransform = transformOverride ?? entity.transform;
    const startPointerPx = [
      event.nativeEvent.clientX,
      event.nativeEvent.clientY,
    ] as const;
    const capture =
      mode === "rotate"
        ? {
            mode,
            value: beginEntityRotationDrag(
              startTransform.rotation,
              startPointerPx,
              editorScreenRotationAxes([
                editorCamera.quaternion.x,
                editorCamera.quaternion.y,
                editorCamera.quaternion.z,
                editorCamera.quaternion.w,
              ]),
            ),
          } as const
        : (() => {
            const groundCapture = beginGroundDrag(
              startTransform.positionM,
              {
                originM: [
                  event.ray.origin.x,
                  event.ray.origin.y,
                  event.ray.origin.z,
                ],
                directionM: [
                  event.ray.direction.x,
                  event.ray.direction.y,
                  event.ray.direction.z,
                ],
              },
              startTransform.positionM[1],
            );
            return groundCapture
              ? ({ mode, value: groundCapture } as const)
              : null;
          })();
    if (!capture) return;
    directDragRef.current = {
      pointerId: event.pointerId,
      capture,
      startTransform,
      startPointerPx,
      moved: false,
    };
    pointerCaptureTarget(event).setPointerCapture(event.pointerId);
    setEditorCameraControlsEnabled(false);
  };
  const onPointerMove = (event: ThreeEvent<PointerEvent>): void => {
    const active = directDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (
      !active.moved &&
      !hasStudioPointerExceededDragThreshold(active.startPointerPx, [
        event.nativeEvent.clientX,
        event.nativeEvent.clientY,
      ])
    ) {
      return;
    }
    const nextTransform =
      active.capture.mode === "rotate"
        ? {
            ...active.startTransform,
            rotation: updateEntityRotationDrag(active.capture.value, [
              event.nativeEvent.clientX,
              event.nativeEvent.clientY,
            ]),
          }
        : (() => {
            const nextPosition = updateGroundDrag(active.capture.value, {
              originM: [
                event.ray.origin.x,
                event.ray.origin.y,
                event.ray.origin.z,
              ],
              directionM: [
                event.ray.direction.x,
                event.ray.direction.y,
                event.ray.direction.z,
              ],
            });
            return nextPosition
              ? { ...active.startTransform, positionM: nextPosition }
              : null;
          })();
    if (!nextTransform) return;
    if (!active.moved) {
      active.moved = true;
      onTransformStart?.(entity.id);
    }
    event.stopPropagation();
    onTransformDraft?.(entity.id, nextTransform);
  };
  const onPointerUp = (event: ThreeEvent<PointerEvent>): void => {
    const active = directDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    directDragRef.current = null;
    const capturedTarget = pointerCaptureTarget(event);
    if (capturedTarget.hasPointerCapture(event.pointerId)) {
      capturedTarget.releasePointerCapture(event.pointerId);
    }
    setEditorCameraControlsEnabled(true);
    const nextTransform =
      active.capture.mode === "rotate"
        ? {
            ...active.startTransform,
            rotation: updateEntityRotationDrag(active.capture.value, [
              event.nativeEvent.clientX,
              event.nativeEvent.clientY,
            ]),
          }
        : (() => {
            const nextPosition = updateGroundDrag(active.capture.value, {
              originM: [
                event.ray.origin.x,
                event.ray.origin.y,
                event.ray.origin.z,
              ],
              directionM: [
                event.ray.direction.x,
                event.ray.direction.y,
                event.ray.direction.z,
              ],
            });
            return nextPosition
              ? { ...active.startTransform, positionM: nextPosition }
              : null;
          })();
    event.stopPropagation();
    if (nextTransform && shouldCommitDirectEntityDrag(active.moved)) {
      void onTransformCommit?.(entity.id, nextTransform);
    }
  };

  const selectedInEditor = selected && view === "editor";
  let content: ReactNode;
  switch (entity.kind) {
    case "environment":
      content = (
        <RoomEnvironment
          entity={entity}
          selected={selectedInEditor}
        />
      );
      break;
    case "prop":
      content = (
        <PropEntity
          entity={entity}
          selected={selectedInEditor}
        />
      );
      break;
    case "actor": {
      const canDirectPoseActor =
        view === "editor" && entity.lockMode !== "user";
      content = (
        <MannequinActor
          scene={scene}
          actor={entity}
          selected={selectedInEditor}
          focusedActorJointId={focused ? focusedActorJointId : null}
          onFocusActorJoint={
            canDirectPoseActor
              ? (jointId) => {
                  if (!focused) onFocusEntity?.(entity.id);
                  onFocusActorJoint?.(jointId);
                }
              : undefined
          }
          actorJointOverride={actorJointOverride}
          onActorJointStart={canDirectPoseActor ? onActorJointStart : undefined}
          onActorJointDraft={canDirectPoseActor ? onActorJointDraft : undefined}
          onActorJointCommit={canDirectPoseActor ? onActorJointCommit : undefined}
          editorDomElement={transformDomElement}
        />
      );
      break;
    }
    case "camera":
      content =
        view === "editor" ? <CameraProxy selected={selected} /> : null;
      break;
  }

  if (content === null) {
    return null;
  }

  const publishDraft = (): TransformSpec | null => {
    const group = groupRef.current;
    if (!group) {
      return null;
    }
    const transform = transformFromGroup(group);
    onTransformDraft?.(entity.id, transform);
    return transform;
  };

  return (
    <>
      <group
        ref={groupRef}
        name={`entity-${entity.id}`}
        {...entityTransformProps(transformOverride ?? entity.transform)}
        onClick={onSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(event) => {
          const capturedTarget = pointerCaptureTarget(event);
          if (capturedTarget.hasPointerCapture(event.pointerId)) {
            capturedTarget.releasePointerCapture(event.pointerId);
          }
          cancelDirectDrag(event.pointerId);
        }}
        onDoubleClick={onDoubleClick}
      >
        <EntityFocusContext.Provider value={focused}>
          <EntityOpacityContext.Provider value={opacity}>
            {content}
          </EntityOpacityContext.Provider>
        </EntityFocusContext.Provider>
      </group>
      {showTransformControls ? (
        <TransformControls
          ref={controlsRef}
          object={groupRef}
          mode={transformMode}
          space={toolMode === "rotate" ? "local" : "world"}
          translationSnap={snapEnabled ? 0.1 : null}
          rotationSnap={snapEnabled ? Math.PI / 36 : null}
          size={0.82}
          domElement={transformDomElement}
          onMouseDown={() => onTransformStart?.(entity.id)}
          onObjectChange={publishDraft}
          onMouseUp={() => {
            const transform = publishDraft();
            if (transform) {
              void onTransformCommit?.(entity.id, transform);
            }
          }}
        />
      ) : null}
    </>
  );
};

export const SceneWorld = ({
  scene,
  view,
  selectedEntityId,
  focusedEntityId = null,
  focusedActorJointId = null,
  actorJointOverrides,
  onSelectEntity,
  onFocusEntity,
  onFocusActorJoint,
  onActorJointStart,
  onActorJointDraft,
  onActorJointCommit,
  selectedRegionId = null,
  onSelectRegion,
  spatialPreview,
  previewMode = "overview",
  toolMode,
  snapEnabled,
  transformOverrides,
  shotCameraTransform,
  onTransformStart,
  onTransformCancel,
  onTransformDraft,
  onTransformCommit,
  transformDomElement,
}: SceneWorldProps) => {
  const resolvedSpatialPreview = useMemo(
    () =>
      spatialPreview ??
      deriveSpatialPreview(
        scene.spatialLayout,
        view === "shot" ? "overview" : previewMode,
        selectedRegionId,
      ),
    [
      previewMode,
      scene.spatialLayout,
      selectedRegionId,
      spatialPreview,
      view,
    ],
  );
  const membershipByEntity = useMemo(
    () =>
      new Map(
        scene.spatialLayout?.memberships.map(
          ({ entityId, regionId }) => [entityId, regionId] as const,
        ) ?? [],
      ),
    [scene.spatialLayout],
  );
  const hiddenShotWallBoxKey = useMemo(
    () =>
      view === "shot"
        ? deriveHiddenShotWallBoxKey(
            scene.spatialLayout,
            shotCameraTransform,
          )
        : null,
    [scene.spatialLayout, shotCameraTransform, view],
  );

  return (
    <group
      name={`scene-world-${scene.revision}-${view}`}
      onPointerMissed={(event) => {
        if (view === "editor" && event.button === 0) onSelectEntity(null);
      }}
    >
      <ambientLight intensity={1.35} />
      <hemisphereLight args={["#f4f7fb", "#46505d", 1.25]} />
      <directionalLight
        castShadow
        position={[4, 7, 5]}
        intensity={2.2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-radius={3}
        shadow-camera-near={0.1}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      {scene.spatialLayout ? (
        <SpatialLayoutProjection
          layout={scene.spatialLayout}
          preview={resolvedSpatialPreview}
          selectedRegionId={selectedRegionId}
          onSelectRegion={onSelectRegion}
          showConnectionMarkers={view === "editor"}
          hiddenWallBoxKey={hiddenShotWallBoxKey}
        />
      ) : null}
      {scene.entities.map((entity) => {
        const regionId = membershipByEntity.get(entity.id);
        const opacity =
          view === "shot" || scene.spatialLayout === null
            ? 1
            : regionId === undefined
              ? 0.22
              : (resolvedSpatialPreview.regionOpacity.get(regionId) ?? 0);
        return (
          <EntityProjection
            key={entity.id}
            scene={scene}
            entity={entity}
            view={view}
            selected={entity.id === selectedEntityId}
            focused={entity.id === focusedEntityId}
            focusedActorJointId={
              entity.id === focusedEntityId ? focusedActorJointId : null
            }
            actorJointOverride={
              entity.kind === "actor" ? actorJointOverrides?.[entity.id] : undefined
            }
            opacity={opacity}
            onSelectEntity={onSelectEntity}
            onFocusEntity={onFocusEntity}
            onFocusActorJoint={onFocusActorJoint}
            onActorJointStart={onActorJointStart}
            onActorJointDraft={onActorJointDraft}
            onActorJointCommit={onActorJointCommit}
            toolMode={toolMode}
            snapEnabled={snapEnabled}
            transformOverride={transformOverrides?.[entity.id]}
            onTransformStart={onTransformStart}
            onTransformCancel={onTransformCancel}
            onTransformDraft={onTransformDraft}
            onTransformCommit={onTransformCommit}
            transformDomElement={transformDomElement}
          />
        );
      })}
    </group>
  );
};

export const ShotCamera = ({
  scene,
  makeDefault = true,
  transformOverride,
  focalLengthOverrideMm,
}: {
  scene: SceneSpec;
  makeDefault?: boolean;
  transformOverride?: TransformSpec;
  focalLengthOverrideMm?: number;
}) => {
  const cameraEntity = useMemo(
    () =>
      scene.entities.find(
        (entity): entity is CameraEntity =>
          entity.kind === "camera" && entity.id === scene.activeCameraId,
      ),
    [scene],
  );
  const cameraRef = useRef<ThreePerspectiveCamera>(null);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !cameraEntity) {
      return;
    }
    camera.filmGauge = cameraEntity.lens.sensorWidthMm;
    camera.setFocalLength(
      focalLengthOverrideMm ?? cameraEntity.lens.focalLengthMm,
    );
    camera.aspect = 16 / 9;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [cameraEntity, focalLengthOverrideMm]);

  if (!cameraEntity) {
    return null;
  }

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault={makeDefault}
      manual
      aspect={16 / 9}
      position={
        (transformOverride ?? cameraEntity.transform).positionM
      }
      quaternion={
        (transformOverride ?? cameraEntity.transform).rotation
      }
      near={cameraEntity.lens.nearM}
      far={cameraEntity.lens.farM}
    />
  );
};
