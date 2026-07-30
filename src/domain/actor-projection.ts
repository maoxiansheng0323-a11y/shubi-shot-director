import {
  ACTOR_LIMB_CHAINS,
  deriveActorAnatomyDimensions,
  deriveBlueprintActorAnatomyDimensions,
  type ActorAnatomyDimensions,
  type ActorLimbPartId,
  type ActorLimbPresence,
} from "./actor-anatomy";
import {
  resolveActorBlueprintVariant,
  type ActorBlueprintMountId,
  type ActorBlueprintSnapshot,
} from "./actor-blueprint";
import {
  multiplyQuaternions,
  rotateVector,
  transformPoint,
} from "./scene-math";
import {
  isBlueprintActorEntity,
  type AnyActorEntity,
  type LegacyActorEntity,
  type QuaternionTuple,
  type SceneSpec,
  type Vec3,
} from "./scene-schema";

export type ActorAnchor =
  | "face"
  | "head"
  | "chest"
  | "pelvis"
  | "root";

export type ActorProjectionPrimitiveId =
  | "pelvis"
  | "torso"
  | "head"
  | "face"
  | "shoulder_l"
  | "elbow_l"
  | "hip_l"
  | "knee_l"
  | "shoulder_r"
  | "elbow_r"
  | "hip_r"
  | "knee_r"
  | ActorLimbPartId
  | `module:${string}:${string}`;

export interface ActorRigFrame {
  readonly position: Vec3;
  readonly rotation: QuaternionTuple;
}

interface ActorProjectionPrimitiveBase {
  readonly id: ActorProjectionPrimitiveId;
  readonly frame: ActorRigFrame;
  readonly center: Vec3;
}

export interface ActorProjectionSpherePrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "sphere";
  readonly radius: number;
  readonly widthSegments: number;
  readonly heightSegments: number;
}

export interface ActorProjectionCapsulePrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "capsule";
  readonly length: number;
  readonly cylinderLength: number;
  readonly radius: number;
  readonly capSegments: number;
  readonly radialSegments: number;
}

export interface ActorProjectionBoxPrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "box";
  readonly size: readonly [number, number, number];
}

export interface ActorProjectionCylinderPrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "cylinder";
  readonly radius: number;
  readonly length: number;
  readonly radialSegments: number;
}

export type ActorProjectionPrimitive =
  | ActorProjectionSpherePrimitive
  | ActorProjectionCapsulePrimitive
  | ActorProjectionBoxPrimitive
  | ActorProjectionCylinderPrimitive;

export interface ResolvedActorProjection {
  readonly primitives: readonly ActorProjectionPrimitive[];
  readonly mountFrames: Readonly<
    Record<ActorBlueprintMountId, ActorRigFrame>
  >;
  readonly anchors: Readonly<Record<ActorAnchor, Vec3>>;
  readonly dimensions: ActorAnatomyDimensions;
  readonly effective: {
    readonly limbPresence: ActorLimbPresence;
    readonly moduleVisibility: Readonly<Record<string, boolean>>;
  };
}

export type ActorRigPrimitiveId = ActorProjectionPrimitiveId;
export type ActorRigPrimitive = ActorProjectionPrimitive;
export type ActorRigProjection = ResolvedActorProjection;

const identityRotation: QuaternionTuple = [0, 0, 0, 1];

const add = (left: Vec3, right: Vec3): Vec3 => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
];

const jointRotation = (
  actor: AnyActorEntity,
  ...jointIds: string[]
): QuaternionTuple => {
  for (const jointId of jointIds) {
    const rotation = actor.pose.joints[jointId];
    if (rotation) return rotation;
  }
  return identityRotation;
};

const framePoint = (frame: ActorRigFrame, point: Vec3): Vec3 =>
  add(frame.position, rotateVector(point, frame.rotation));

const childFrame = (
  parent: ActorRigFrame,
  position: Vec3,
  rotation: QuaternionTuple = identityRotation,
): ActorRigFrame => ({
  position: framePoint(parent, position),
  rotation: multiplyQuaternions(parent.rotation, rotation),
});

const capsuleCylinderLength = (
  length: number,
  radius: number,
): number => Math.max(0.01, length - radius * 2);

const anatomicalSideDirectionX = (side: "l" | "r"): number =>
  side === "l" ? 1 : -1;

interface ProjectionDefinition {
  readonly dimensions: ActorAnatomyDimensions;
  readonly limbPresence: ActorLimbPresence;
  readonly snapshot?: ActorBlueprintSnapshot;
  readonly moduleVisibility: Readonly<Record<string, boolean>>;
}

interface ComputedFrames {
  readonly pelvis: ActorRigFrame;
  readonly spine: ActorRigFrame;
  readonly head: ActorRigFrame;
  readonly mounts: Record<ActorBlueprintMountId, ActorRigFrame>;
  readonly armFrames: Record<
    "l" | "r",
    {
      shoulder: ActorRigFrame;
      upper: ActorRigFrame;
      middle: ActorRigFrame;
      terminal: ActorRigFrame;
    }
  >;
  readonly legFrames: Record<
    "l" | "r",
    {
      hip: ActorRigFrame;
      upper: ActorRigFrame;
      middle: ActorRigFrame;
      terminal: ActorRigFrame;
    }
  >;
}

const computeFrames = (
  actor: AnyActorEntity,
  dimensions: ActorAnatomyDimensions,
): ComputedFrames => {
  const pelvis: ActorRigFrame = {
    position: [0, 0, 0],
    rotation: jointRotation(actor, "pelvis", "root"),
  };
  const spine = childFrame(
    pelvis,
    [0, dimensions.spineOriginY, 0],
    jointRotation(actor, "spine", "chest"),
  );
  const head = childFrame(
    spine,
    [0, dimensions.headOriginY, 0],
    jointRotation(actor, "neck", "head"),
  );

  const armFrames = {} as ComputedFrames["armFrames"];
  const legFrames = {} as ComputedFrames["legFrames"];
  const mounts = {} as Record<ActorBlueprintMountId, ActorRigFrame>;

  for (const side of ["l", "r"] as const) {
    const direction = anatomicalSideDirectionX(side);
    const [upperId, middleId] =
      ACTOR_LIMB_CHAINS[side === "l" ? "leftArm" : "rightArm"];
    const shoulderId = `shoulder_${side}`;
    const elbowId = `elbow_${side}`;
    const shoulder = childFrame(spine, [
      direction * dimensions.shoulderOffsetX,
      dimensions.shoulderOriginY,
      0,
    ]);
    const upper = childFrame(
      shoulder,
      [0, 0, 0],
      jointRotation(actor, upperId, shoulderId),
    );
    const elbowBase = childFrame(upper, [
      0,
      -dimensions.upperArmLength,
      0,
    ]);
    const middle = childFrame(
      elbowBase,
      [0, 0, 0],
      jointRotation(actor, middleId, elbowId),
    );
    const terminal = childFrame(middle, [
      0,
      -dimensions.forearmLength,
      0,
    ]);
    armFrames[side] = { shoulder, upper, middle, terminal };
    mounts[`shoulder_${side}`] = shoulder;
    mounts[`elbow_${side}`] = middle;
    mounts[`wrist_${side}`] = terminal;
  }

  for (const side of ["l", "r"] as const) {
    const direction = anatomicalSideDirectionX(side);
    const [upperId, middleId] =
      ACTOR_LIMB_CHAINS[side === "l" ? "leftLeg" : "rightLeg"];
    const hipId = `hip_${side}`;
    const kneeId = `knee_${side}`;
    const hip = childFrame(pelvis, [
      direction * dimensions.hipOffsetX,
      dimensions.hipOriginY,
      0,
    ]);
    const upper = childFrame(
      hip,
      [0, 0, 0],
      jointRotation(actor, upperId, hipId),
    );
    const kneeBase = childFrame(upper, [
      0,
      -dimensions.upperLegLength,
      0,
    ]);
    const middle = childFrame(
      kneeBase,
      [0, 0, 0],
      jointRotation(actor, middleId, kneeId),
    );
    const terminal = childFrame(middle, [
      0,
      -dimensions.lowerLegLength,
      0,
    ]);
    legFrames[side] = { hip, upper, middle, terminal };
    mounts[`hip_${side}`] = hip;
    mounts[`knee_${side}`] = middle;
  }

  return { pelvis, spine, head, mounts, armFrames, legFrames };
};

const bodyPrimitives = (
  definition: ProjectionDefinition,
  frames: ComputedFrames,
): ActorProjectionPrimitive[] => {
  const { dimensions, limbPresence } = definition;
  const primitives: ActorProjectionPrimitive[] = [
    {
      id: "pelvis",
      kind: "box",
      frame: frames.pelvis,
      center: [0, 0, 0],
      size: [
        dimensions.pelvisWidth,
        dimensions.pelvisHeight,
        dimensions.pelvisDepth,
      ],
    },
    {
      id: "torso",
      kind: "capsule",
      frame: frames.spine,
      center: [0, dimensions.torsoLength / 2, 0],
      length: dimensions.torsoLength,
      cylinderLength: dimensions.torsoCapsuleLength,
      radius: dimensions.torsoRadius,
      capSegments: 8,
      radialSegments: 16,
    },
    {
      id: "head",
      kind: "sphere",
      frame: frames.head,
      center: [0, 0, 0],
      radius: dimensions.headRadius,
      widthSegments: 20,
      heightSegments: 14,
    },
    {
      id: "face",
      kind: "sphere",
      frame: frames.head,
      center: [...dimensions.faceOffset],
      radius: dimensions.faceRadius,
      widthSegments: 12,
      heightSegments: 8,
    },
  ];

  for (const side of ["l", "r"] as const) {
    const [upperId, middleId, terminalId] =
      ACTOR_LIMB_CHAINS[side === "l" ? "leftArm" : "rightArm"];
    const { shoulder, upper, middle, terminal } = frames.armFrames[side];
    if (limbPresence[upperId] !== "present") continue;
    primitives.push(
      {
        id: `shoulder_${side}`,
        kind: "sphere",
        frame: shoulder,
        center: [0, 0, 0],
        radius: dimensions.shoulderRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: upperId,
        kind: "capsule",
        frame: upper,
        center: [0, -dimensions.upperArmLength / 2, 0],
        length: dimensions.upperArmLength,
        cylinderLength: capsuleCylinderLength(
          dimensions.upperArmLength,
          dimensions.armRadius,
        ),
        radius: dimensions.armRadius,
        capSegments: 6,
        radialSegments: 12,
      },
    );
    if (limbPresence[middleId] !== "present") continue;
    primitives.push(
      {
        id: `elbow_${side}`,
        kind: "sphere",
        frame: middle,
        center: [0, 0, 0],
        radius: dimensions.elbowRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: middleId,
        kind: "capsule",
        frame: middle,
        center: [0, -dimensions.forearmLength / 2, 0],
        length: dimensions.forearmLength,
        cylinderLength: capsuleCylinderLength(
          dimensions.forearmLength,
          dimensions.forearmRadius,
        ),
        radius: dimensions.forearmRadius,
        capSegments: 6,
        radialSegments: 12,
      },
    );
    if (limbPresence[terminalId] !== "present") continue;
    primitives.push({
      id: terminalId,
      kind: "box",
      frame: terminal,
      center: [...dimensions.handOffset],
      size: dimensions.handSize,
    });
  }

  for (const side of ["l", "r"] as const) {
    const [upperId, middleId, terminalId] =
      ACTOR_LIMB_CHAINS[side === "l" ? "leftLeg" : "rightLeg"];
    const { hip, upper, middle, terminal } = frames.legFrames[side];
    if (limbPresence[upperId] !== "present") continue;
    primitives.push(
      {
        id: `hip_${side}`,
        kind: "sphere",
        frame: hip,
        center: [0, 0, 0],
        radius: dimensions.hipRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: upperId,
        kind: "capsule",
        frame: upper,
        center: [0, -dimensions.upperLegLength / 2, 0],
        length: dimensions.upperLegLength,
        cylinderLength: capsuleCylinderLength(
          dimensions.upperLegLength,
          dimensions.legRadius,
        ),
        radius: dimensions.legRadius,
        capSegments: 6,
        radialSegments: 12,
      },
    );
    if (limbPresence[middleId] !== "present") continue;
    primitives.push(
      {
        id: `knee_${side}`,
        kind: "sphere",
        frame: middle,
        center: [0, 0, 0],
        radius: dimensions.kneeRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: middleId,
        kind: "capsule",
        frame: middle,
        center: [0, -dimensions.lowerLegLength / 2, 0],
        length: dimensions.lowerLegLength,
        cylinderLength: capsuleCylinderLength(
          dimensions.lowerLegLength,
          dimensions.lowerLegRadius,
        ),
        radius: dimensions.lowerLegRadius,
        capSegments: 6,
        radialSegments: 12,
      },
    );
    if (limbPresence[terminalId] !== "present") continue;
    primitives.push({
      id: terminalId,
      kind: "box",
      frame: terminal,
      center: [...dimensions.footOffset],
      size: dimensions.footSize,
    });
  }

  return primitives;
};

const scaleTuple = (
  value: readonly [number, number, number],
  scale: readonly [number, number, number],
): readonly [number, number, number] => [
  value[0] * scale[0],
  value[1] * scale[1],
  value[2] * scale[2],
];

const modulePrimitives = (
  definition: ProjectionDefinition,
  mounts: Readonly<Record<ActorBlueprintMountId, ActorRigFrame>>,
): ActorProjectionPrimitive[] => {
  if (!definition.snapshot) return [];
  const primitives: ActorProjectionPrimitive[] = [];
  for (const module of definition.snapshot.modules) {
    if (!definition.moduleVisibility[module.moduleId]) continue;
    const mount = mounts[module.mount];
    for (const part of module.parts) {
      const frame = childFrame(
        mount,
        part.transform.positionM,
        part.transform.rotation,
      );
      const id =
        `module:${module.moduleId}:${part.partId}` as const;
      if (part.primitive === "box") {
        primitives.push({
          id,
          kind: "box",
          frame,
          center: [0, 0, 0],
          size: scaleTuple(part.sizeM, part.transform.scale),
        });
      } else if (part.primitive === "sphere") {
        primitives.push({
          id,
          kind: "sphere",
          frame,
          center: [0, 0, 0],
          radius:
            part.radiusM * Math.max(...part.transform.scale),
          widthSegments: 16,
          heightSegments: 12,
        });
      } else {
        primitives.push({
          id,
          kind: "cylinder",
          frame,
          center: [0, 0, 0],
          radius:
            part.radiusM *
            Math.max(
              part.transform.scale[0],
              part.transform.scale[2],
            ),
          length: part.lengthM * part.transform.scale[1],
          radialSegments: 16,
        });
      }
    }
  }
  return primitives;
};

const resolveDefinition = (
  scene: SceneSpec,
  actor: AnyActorEntity,
): ProjectionDefinition => {
  if (!isBlueprintActorEntity(actor)) {
    return {
      dimensions: deriveActorAnatomyDimensions(actor.body),
      limbPresence: actor.body.limbPresence,
      moduleVisibility: {},
    };
  }

  const snapshot = scene.actorBlueprints.find(
    ({ blueprintId }) =>
      blueprintId === actor.blueprintInstance.blueprintId,
  );
  if (!snapshot) {
    throw new Error("ACTOR_BLUEPRINT_REFERENCE_INVALID");
  }
  const effective = resolveActorBlueprintVariant(
    snapshot,
    actor.blueprintInstance.variantId,
  );
  return {
    dimensions: deriveBlueprintActorAnatomyDimensions(snapshot),
    limbPresence: effective.limbPresence,
    moduleVisibility: effective.moduleVisibility,
    snapshot,
  };
};

const resolveProjection = (
  actor: AnyActorEntity,
  definition: ProjectionDefinition,
): ResolvedActorProjection => {
  const frames = computeFrames(actor, definition.dimensions);
  const anchors: Record<ActorAnchor, Vec3> = {
    root: [0, 0, 0],
    pelvis: [0, 0, 0],
    chest: framePoint(frames.spine, [
      0,
      definition.dimensions.torsoLength * 0.58,
      0,
    ]),
    head: [...frames.head.position],
    face: framePoint(frames.head, [
      ...definition.dimensions.faceOffset,
    ]),
  };

  return {
    primitives: [
      ...bodyPrimitives(definition, frames),
      ...modulePrimitives(definition, frames.mounts),
    ],
    mountFrames: frames.mounts,
    anchors,
    dimensions: definition.dimensions,
    effective: {
      limbPresence: definition.limbPresence,
      moduleVisibility: definition.moduleVisibility,
    },
  };
};

export const resolveActorProjection = (
  scene: SceneSpec,
  actor: AnyActorEntity,
): ResolvedActorProjection =>
  resolveProjection(actor, resolveDefinition(scene, actor));

export const resolveLegacyActorProjection = (
  actor: LegacyActorEntity,
): ResolvedActorProjection =>
  resolveProjection(actor, {
    dimensions: deriveActorAnatomyDimensions(actor.body),
    limbPresence: actor.body.limbPresence,
    moduleVisibility: {},
  });

export function actorAnchorLocalPoint(
  scene: SceneSpec,
  actor: AnyActorEntity,
  anchor: ActorAnchor,
): Vec3;
export function actorAnchorLocalPoint(
  actor: LegacyActorEntity,
  anchor: ActorAnchor,
): Vec3;
export function actorAnchorLocalPoint(
  sceneOrActor: SceneSpec | LegacyActorEntity,
  actorOrAnchor: AnyActorEntity | ActorAnchor,
  anchorOverride?: ActorAnchor,
): Vec3 {
  if ("sceneId" in sceneOrActor) {
    return [
      ...resolveActorProjection(
        sceneOrActor,
        actorOrAnchor as AnyActorEntity,
      ).anchors[anchorOverride as ActorAnchor],
    ];
  }
  return [
    ...resolveLegacyActorProjection(sceneOrActor).anchors[
      actorOrAnchor as ActorAnchor
    ],
  ];
}

export function actorAnchorWorldPoint(
  scene: SceneSpec,
  actor: AnyActorEntity,
  anchor: ActorAnchor,
): Vec3;
export function actorAnchorWorldPoint(
  actor: LegacyActorEntity,
  anchor: ActorAnchor,
): Vec3;
export function actorAnchorWorldPoint(
  sceneOrActor: SceneSpec | LegacyActorEntity,
  actorOrAnchor: AnyActorEntity | ActorAnchor,
  anchorOverride?: ActorAnchor,
): Vec3 {
  if ("sceneId" in sceneOrActor) {
    const actor = actorOrAnchor as AnyActorEntity;
    return transformPoint(
      actor.transform,
      actorAnchorLocalPoint(
        sceneOrActor,
        actor,
        anchorOverride as ActorAnchor,
      ),
    );
  }
  return transformPoint(
    sceneOrActor.transform,
    actorAnchorLocalPoint(
      sceneOrActor,
      actorOrAnchor as ActorAnchor,
    ),
  );
}
