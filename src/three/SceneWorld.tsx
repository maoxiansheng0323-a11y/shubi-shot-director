import {
  Edges,
  PerspectiveCamera,
  TransformControls,
} from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import {
  createContext,
  useEffect,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import type {
  Group,
  PerspectiveCamera as ThreePerspectiveCamera,
} from "three";
import { DoubleSide, Shape } from "three";
import {
  deriveActorRigProjection,
  type ActorRigPrimitive,
} from "../domain/humanoid-rig";
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
  deriveHiddenShotWallBoxKey,
  shotWallBoxKey,
} from "../editor/shot-wall-visibility";
import type {
  ActorEntity,
  CameraEntity,
  JsonValue,
  SceneEntity,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";

export interface SceneWorldProps {
  scene: SceneSpec;
  view: "editor" | "shot";
  selectedEntityId: string | null;
  onSelectEntity: (entityId: string | null) => void;
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
  onTransformCommit?: (
    entityId: string,
    transform: TransformSpec,
  ) => void | Promise<void>;
  transformDomElement?: HTMLElement;
}

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

const SelectionEdges = ({ selected }: { selected: boolean }) =>
  selected ? (
    <Edges
      threshold={18}
      color="#9fd0ff"
      scale={1.015}
      renderOrder={20}
    />
  ) : null;

interface GrayMeshProps {
  color: string;
  selected: boolean;
  children: ReactNode;
  position?: [number, number, number];
  rotation?: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  opacity?: number;
}

const EntityOpacityContext = createContext(1);

const GrayMesh = ({
  color,
  selected,
  children,
  position,
  rotation,
  castShadow = true,
  receiveShadow = true,
  opacity,
}: GrayMeshProps) => {
  const inheritedOpacity = useContext(EntityOpacityContext);
  const resolvedOpacity = opacity ?? inheritedOpacity;
  return (
    <mesh
      position={position}
      rotation={rotation}
      castShadow={castShadow && resolvedOpacity >= 0.99}
      receiveShadow={receiveShadow}
    >
      {children}
      <meshStandardMaterial
        color={selected ? "#a9c8e8" : color}
        roughness={0.84}
        metalness={0.02}
        transparent={resolvedOpacity < 0.99}
        opacity={resolvedOpacity}
        depthWrite={resolvedOpacity >= 0.99}
      />
      <SelectionEdges selected={selected} />
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
}: {
  primitive: ActorRigPrimitive;
  color: string;
  selected: boolean;
}) => {
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
  }

  return (
    <group
      position={primitive.frame.position}
      quaternion={primitive.frame.rotation}
    >
      <GrayMesh
        color={primitive.id === "face" && !selected ? "#aab4bf" : color}
        selected={selected}
        position={primitive.center}
      >
        {geometry}
      </GrayMesh>
    </group>
  );
};

const MannequinActor = ({
  actor,
  selected,
}: {
  actor: ActorEntity;
  selected: boolean;
}) => {
  const projection = deriveActorRigProjection(actor);
  return (
    <>
      {projection.primitives.map((primitive) => (
        <ActorRigPrimitiveMesh
          key={primitive.id}
          primitive={primitive}
          color={actor.color}
          selected={selected}
        />
      ))}
    </>
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

const EntityProjection = ({
  entity,
  view,
  selected,
  opacity = 1,
  onSelectEntity,
  toolMode = "select",
  snapEnabled = true,
  transformOverride,
  onTransformStart,
  onTransformDraft,
  onTransformCommit,
  transformDomElement,
}: {
  entity: SceneEntity;
  view: SceneWorldProps["view"];
  selected: boolean;
  opacity?: number;
  onSelectEntity: SceneWorldProps["onSelectEntity"];
  toolMode?: SceneWorldProps["toolMode"];
  snapEnabled?: boolean;
  transformOverride?: TransformSpec;
  onTransformStart?: SceneWorldProps["onTransformStart"];
  onTransformDraft?: SceneWorldProps["onTransformDraft"];
  onTransformCommit?: SceneWorldProps["onTransformCommit"];
  transformDomElement?: HTMLElement;
}) => {
  const groupRef = useRef<Group>(null!);
  const controlsRef =
    useRef<ComponentRef<typeof TransformControls>>(null);
  const showTransformControls =
    selected &&
    view === "editor" &&
    entity.lockMode === "none" &&
    toolMode !== "select";

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
    case "actor":
      content = (
        <MannequinActor
          actor={entity}
          selected={selectedInEditor}
        />
      );
      break;
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
      >
        <EntityOpacityContext.Provider value={opacity}>
          {content}
        </EntityOpacityContext.Provider>
      </group>
      {showTransformControls ? (
        <TransformControls
          ref={controlsRef}
          object={groupRef}
          mode={toolMode}
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
  onSelectEntity,
  selectedRegionId = null,
  onSelectRegion,
  spatialPreview,
  previewMode = "overview",
  toolMode,
  snapEnabled,
  transformOverrides,
  shotCameraTransform,
  onTransformStart,
  onTransformDraft,
  onTransformCommit,
  transformDomElement,
}: SceneWorldProps) => {
  const resolvedSpatialPreview = useMemo(
    () =>
      spatialPreview ??
      deriveSpatialPreview(
        scene.spatialLayout,
        view === "shot" ? "shot" : previewMode,
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
      onPointerMissed={() => onSelectEntity(null)}
    >
      <ambientLight intensity={1.35} />
      <hemisphereLight args={["#f4f7fb", "#46505d", 1.25]} />
      <directionalLight
        castShadow
        position={[4, 7, 5]}
        intensity={2.2}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
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
            entity={entity}
            view={view}
            selected={entity.id === selectedEntityId}
            opacity={opacity}
            onSelectEntity={onSelectEntity}
            toolMode={toolMode}
            snapEnabled={snapEnabled}
            transformOverride={transformOverrides?.[entity.id]}
            onTransformStart={onTransformStart}
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
