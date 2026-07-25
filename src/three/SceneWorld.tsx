import {
  Edges,
  PerspectiveCamera,
  TransformControls,
} from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
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
import type {
  ActorEntity,
  CameraEntity,
  JsonValue,
  QuaternionTuple,
  SceneEntity,
  SceneSpec,
  TransformSpec,
} from "../domain/scene-schema";

export interface SceneWorldProps {
  scene: SceneSpec;
  view: "editor" | "shot";
  selectedEntityId: string | null;
  onSelectEntity: (entityId: string | null) => void;
  toolMode?: "select" | "translate" | "rotate";
  snapEnabled?: boolean;
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

const getJointRotation = (
  actor: ActorEntity,
  ...names: string[]
): QuaternionTuple => {
  for (const name of names) {
    const rotation = actor.pose.joints[name];
    if (rotation) {
      return rotation;
    }
  }
  return [0, 0, 0, 1];
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
}

const GrayMesh = ({
  color,
  selected,
  children,
  position,
  rotation,
  castShadow = true,
  receiveShadow = true,
}: GrayMeshProps) => (
  <mesh
    position={position}
    rotation={rotation}
    castShadow={castShadow}
    receiveShadow={receiveShadow}
  >
    {children}
    <meshStandardMaterial
      color={selected ? "#a9c8e8" : color}
      roughness={0.84}
      metalness={0.02}
    />
    <SelectionEdges selected={selected} />
  </mesh>
);

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

interface LimbProps {
  color: string;
  selected: boolean;
  length: number;
  radius: number;
  jointRotation: QuaternionTuple;
  childRotation?: QuaternionTuple;
  childLength?: number;
  childRadius?: number;
  terminal?: ReactNode;
}

const DownwardLimb = ({
  color,
  selected,
  length,
  radius,
  jointRotation,
  childRotation,
  childLength,
  childRadius,
  terminal,
}: LimbProps) => (
  <group quaternion={jointRotation}>
    <GrayMesh
      color={color}
      selected={selected}
      position={[0, -length / 2, 0]}
    >
      <capsuleGeometry
        args={[radius, Math.max(0.01, length - radius * 2), 6, 12]}
      />
    </GrayMesh>
    <group position={[0, -length, 0]} quaternion={childRotation}>
      <GrayMesh color={color} selected={selected}>
        <sphereGeometry args={[radius * 1.08, 12, 8]} />
      </GrayMesh>
      {childLength && childRadius ? (
        <>
          <GrayMesh
            color={color}
            selected={selected}
            position={[0, -childLength / 2, 0]}
          >
            <capsuleGeometry
              args={[
                childRadius,
                Math.max(0.01, childLength - childRadius * 2),
                6,
                12,
              ]}
            />
          </GrayMesh>
          <group position={[0, -childLength, 0]}>{terminal}</group>
        </>
      ) : (
        terminal
      )}
    </group>
  </group>
);

const MannequinActor = ({
  actor,
  selected,
}: {
  actor: ActorEntity;
  selected: boolean;
}) => {
  const height = actor.body.heightM;
  const shoulderWidth = actor.body.shoulderWidthM;
  const buildScale =
    actor.body.build === "broad"
      ? 1.12
      : actor.body.build === "slim"
        ? 0.9
        : 1;
  const torsoLength = height * 0.31;
  const pelvisWidth = shoulderWidth * 0.72;
  const torsoDepth = height * 0.115 * buildScale;
  const upperArmLength = height * 0.19;
  const forearmLength = height * 0.17;
  const upperLegLength = height * 0.245;
  const lowerLegLength = height * 0.235;
  const headRadius = height * 0.075;
  const armRadius = height * 0.035 * buildScale;
  const legRadius = height * 0.045 * buildScale;
  const color = actor.color;

  const hand = (
    <GrayMesh
      color={color}
      selected={selected}
      position={[0, -height * 0.035, 0.012]}
    >
      <boxGeometry args={[height * 0.055, height * 0.085, height * 0.035]} />
    </GrayMesh>
  );
  const foot = (
    <GrayMesh
      color={color}
      selected={selected}
      position={[0, -height * 0.025, height * 0.055]}
    >
      <boxGeometry args={[height * 0.075, height * 0.055, height * 0.16]} />
    </GrayMesh>
  );

  return (
    <group quaternion={getJointRotation(actor, "pelvis", "root")}>
        <GrayMesh color={color} selected={selected}>
          <boxGeometry
            args={[pelvisWidth, height * 0.12, torsoDepth * 0.86]}
          />
        </GrayMesh>

        <group
          position={[0, height * 0.035, 0]}
          quaternion={getJointRotation(actor, "spine", "chest")}
        >
          <GrayMesh
            color={color}
            selected={selected}
            position={[0, torsoLength / 2, 0]}
          >
            <capsuleGeometry
              args={[
                shoulderWidth * 0.28,
                Math.max(0.02, torsoLength - shoulderWidth * 0.48),
                8,
                16,
              ]}
            />
          </GrayMesh>

          <group
            position={[0, torsoLength + height * 0.055, 0]}
            quaternion={getJointRotation(actor, "neck", "head")}
          >
            <GrayMesh color={color} selected={selected}>
              <sphereGeometry args={[headRadius, 20, 14]} />
            </GrayMesh>
            <GrayMesh
              color={selected ? "#c8def4" : "#aab4bf"}
              selected={selected}
              position={[0, -headRadius * 0.05, headRadius * 0.84]}
            >
              <sphereGeometry args={[headRadius * 0.34, 12, 8]} />
            </GrayMesh>
          </group>

          {(["l", "r"] as const).map((side) => {
            const direction = side === "l" ? -1 : 1;
            return (
              <group
                key={side}
                position={[
                  direction * shoulderWidth * 0.52,
                  torsoLength * 0.78,
                  0,
                ]}
              >
                <GrayMesh color={color} selected={selected}>
                  <sphereGeometry args={[armRadius * 1.28, 12, 8]} />
                </GrayMesh>
                <DownwardLimb
                  color={color}
                  selected={selected}
                  length={upperArmLength}
                  radius={armRadius}
                  jointRotation={getJointRotation(
                    actor,
                    `upper_arm_${side}`,
                    `shoulder_${side}`,
                  )}
                  childRotation={getJointRotation(
                    actor,
                    `forearm_${side}`,
                    `elbow_${side}`,
                  )}
                  childLength={forearmLength}
                  childRadius={armRadius * 0.82}
                  terminal={hand}
                />
              </group>
            );
          })}
        </group>

        {(["l", "r"] as const).map((side) => {
          const direction = side === "l" ? -1 : 1;
          return (
            <group
              key={side}
              position={[direction * pelvisWidth * 0.31, -height * 0.035, 0]}
            >
              <GrayMesh color={color} selected={selected}>
                <sphereGeometry args={[legRadius * 1.3, 12, 8]} />
              </GrayMesh>
              <DownwardLimb
                color={color}
                selected={selected}
                length={upperLegLength}
                radius={legRadius}
                jointRotation={getJointRotation(
                  actor,
                  `upper_leg_${side}`,
                  `hip_${side}`,
                )}
                childRotation={getJointRotation(
                  actor,
                  `lower_leg_${side}`,
                  `knee_${side}`,
                )}
                childLength={lowerLegLength}
                childRadius={legRadius * 0.82}
                terminal={foot}
              />
            </group>
          );
        })}
    </group>
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
    selected && view === "editor" && !entity.locked && toolMode !== "select";

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

  if (!entity.visible) {
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
        {content}
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
  toolMode,
  snapEnabled,
  transformOverrides,
  onTransformStart,
  onTransformDraft,
  onTransformCommit,
  transformDomElement,
}: SceneWorldProps) => (
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
    {scene.entities.map((entity) => (
      <EntityProjection
        key={entity.id}
        entity={entity}
        view={view}
        selected={entity.id === selectedEntityId}
        onSelectEntity={onSelectEntity}
        toolMode={toolMode}
        snapEnabled={snapEnabled}
        transformOverride={transformOverrides?.[entity.id]}
        onTransformStart={onTransformStart}
        onTransformDraft={onTransformDraft}
        onTransformCommit={onTransformCommit}
        transformDomElement={transformDomElement}
      />
    ))}
  </group>
);

export const ShotCamera = ({
  scene,
  makeDefault = true,
  transformOverride,
}: {
  scene: SceneSpec;
  makeDefault?: boolean;
  transformOverride?: TransformSpec;
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
    camera.setFocalLength(cameraEntity.lens.focalLengthMm);
    camera.aspect = 16 / 9;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [cameraEntity]);

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
