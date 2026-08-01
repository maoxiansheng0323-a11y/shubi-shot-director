import {
  ACTOR_LIMB_CHAINS,
  deriveActorAnatomyDimensions,
  deriveBlueprintActorAnatomyDimensions,
  scaleActorAnatomyDimensions,
  type ActorAnatomyDimensions,
  type ActorLimbPartId,
  type ActorLimbPresence,
} from "./actor-anatomy";
import {
  resolveActorBlueprintInstance,
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
  | "neck"
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

export interface ActorProjectionProfilePrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "profile";
  readonly points: readonly { readonly y: number; readonly radius: number }[];
  readonly depthScale: number;
  readonly radialSegments: number;
}

export interface ActorProjectionEllipsoidPrimitive
  extends ActorProjectionPrimitiveBase {
  readonly kind: "ellipsoid";
  readonly radii: readonly [number, number, number];
  readonly widthSegments: number;
  readonly heightSegments: number;
}

export type ActorProjectionPrimitive =
  | ActorProjectionSpherePrimitive
  | ActorProjectionCapsulePrimitive
  | ActorProjectionBoxPrimitive
  | ActorProjectionCylinderPrimitive
  | ActorProjectionProfilePrimitive
  | ActorProjectionEllipsoidPrimitive;

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
  const joints = actor.pose.joints as Readonly<
    Record<string, QuaternionTuple | undefined>
  >;
  for (const jointId of jointIds) {
    const rotation = joints[jointId];
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

const anatomicalSideDirectionX = (side: "l" | "r"): number =>
  side === "l" ? 1 : -1;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const interpolateProfileRadius = (
  points: readonly { readonly y: number; readonly radius: number }[],
  y: number,
): number => {
  for (let index = 1; index < points.length; index += 1) {
    const lower = points[index - 1];
    const upper = points[index];
    if (!lower || !upper || y > upper.y) continue;
    const amount = (y - lower.y) / (upper.y - lower.y);
    return lower.radius + (upper.radius - lower.radius) * amount;
  }
  return points.at(-1)?.radius ?? 0;
};

interface ProjectionDefinition {
  readonly dimensions: ActorAnatomyDimensions;
  readonly limbPresence: ActorLimbPresence;
  readonly snapshot?: ActorBlueprintSnapshot;
  readonly moduleScale: number;
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
    const [upperId, middleId, terminalId] =
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
    const terminalBase = childFrame(middle, [
      0,
      -dimensions.forearmLength,
      0,
    ]);
    const terminal = childFrame(
      terminalBase,
      [0, 0, 0],
      jointRotation(actor, terminalId, `wrist_${side}`),
    );
    armFrames[side] = { shoulder, upper, middle, terminal };
    mounts[`shoulder_${side}`] = shoulder;
    mounts[`elbow_${side}`] = middle;
    mounts[`wrist_${side}`] = terminal;
  }

  for (const side of ["l", "r"] as const) {
    const direction = anatomicalSideDirectionX(side);
    const [upperId, middleId, terminalId] =
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
    const terminalBase = childFrame(middle, [
      0,
      -dimensions.lowerLegLength,
      0,
    ]);
    const terminal = childFrame(
      terminalBase,
      [0, 0, 0],
      jointRotation(actor, terminalId, `ankle_${side}`),
    );
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
  const torsoShoulderRadius = Math.max(
    dimensions.torsoRadius * 1.12,
    dimensions.shoulderWidthM * 0.38,
  );
  const torsoDepthScale = clamp(
    dimensions.torsoDepth / (torsoShoulderRadius * 2),
    0.32,
    0.82,
  );
  const pelvisRadius = dimensions.pelvisWidth / 2;
  const pelvisDepthScale = clamp(
    dimensions.pelvisDepth / dimensions.pelvisWidth,
    0.32,
    0.78,
  );
  const neckBaseY = dimensions.torsoLength - dimensions.headRadius * 0.12;
  const neckTopY = dimensions.headOriginY;
  const headDepthScale = 0.86;
  const headPoints = [
    { y: -dimensions.headRadius * 0.4, radius: dimensions.headRadius * 0.26 },
    { y: -dimensions.headRadius * 0.18, radius: dimensions.headRadius * 0.44 },
    { y: dimensions.headRadius * 0.08, radius: dimensions.headRadius * 0.62 },
    { y: dimensions.headRadius * 0.38, radius: dimensions.headRadius * 0.72 },
    { y: dimensions.headRadius * 0.72, radius: dimensions.headRadius * 0.7 },
    { y: dimensions.headRadius, radius: dimensions.headRadius * 0.48 },
    { y: dimensions.headRadius * 1.12, radius: dimensions.headRadius * 0.02 },
  ];
  const faceRadii: readonly [number, number, number] = [
    dimensions.headRadius * 0.09,
    dimensions.headRadius * 0.07,
    dimensions.headRadius * 0.03,
  ];
  const faceCenterX = 0;
  const faceCenterY = dimensions.headRadius * 0.06;
  const headFrontAtFace =
    interpolateProfileRadius(headPoints, faceCenterY) * headDepthScale;
  const faceCenterZ =
    headFrontAtFace + dimensions.headRadius * 0.022 - faceRadii[2];
  const shoulderIndicatorRadius = Math.min(
    dimensions.shoulderRadius,
    dimensions.armRadius * 1.12 * 0.82,
  );
  const elbowIndicatorRadius = Math.min(
    dimensions.elbowRadius,
    Math.max(
      dimensions.armRadius * 0.68,
      dimensions.forearmRadius * 0.86,
    ) * 0.78,
  );
  const hipIndicatorRadius = Math.min(
    dimensions.hipRadius,
    dimensions.legRadius * 1.14 * 0.8,
  );
  const kneeIndicatorRadius = Math.min(
    dimensions.kneeRadius,
    Math.max(
      dimensions.legRadius * 0.66,
      dimensions.lowerLegRadius * 0.82,
    ) * 0.76,
  );
  const primitives: ActorProjectionPrimitive[] = [
    {
      id: "pelvis",
      kind: "profile",
      frame: frames.pelvis,
      center: [0, 0, 0],
      points: [
        { y: -dimensions.pelvisHeight / 2, radius: pelvisRadius * 0.82 },
        { y: -dimensions.pelvisHeight * 0.18, radius: pelvisRadius },
        { y: dimensions.pelvisHeight * 0.18, radius: pelvisRadius * 0.96 },
        { y: dimensions.pelvisHeight / 2, radius: pelvisRadius * 0.74 },
      ],
      depthScale: pelvisDepthScale,
      radialSegments: 18,
    },
    {
      id: "torso",
      kind: "profile",
      frame: frames.spine,
      center: [0, 0, 0],
      points: [
        { y: 0, radius: dimensions.pelvisWidth * 0.34 },
        { y: dimensions.torsoLength * 0.22, radius: dimensions.torsoRadius * 0.82 },
        { y: dimensions.torsoLength * 0.52, radius: torsoShoulderRadius * 0.82 },
        { y: dimensions.torsoLength * 0.72, radius: torsoShoulderRadius * 0.94 },
        { y: dimensions.torsoLength * 0.82, radius: torsoShoulderRadius },
        { y: dimensions.torsoLength * 0.94, radius: torsoShoulderRadius * 0.93 },
        { y: dimensions.torsoLength * 0.985, radius: torsoShoulderRadius * 0.62 },
        { y: dimensions.torsoLength, radius: dimensions.headRadius * 0.35 },
      ],
      depthScale: torsoDepthScale,
      radialSegments: 20,
    },
    {
      id: "neck",
      kind: "profile",
      frame: frames.spine,
      center: [0, 0, 0],
      points: [
        {
          y: neckBaseY,
          radius: dimensions.headRadius * 0.35,
        },
        {
          y: (neckBaseY + neckTopY) / 2,
          radius: dimensions.headRadius * 0.31,
        },
        {
          y: neckTopY,
          radius: dimensions.headRadius * 0.28,
        },
      ],
      depthScale: 0.82,
      radialSegments: 16,
    },
    {
      id: "head",
      kind: "profile",
      frame: frames.head,
      center: [0, 0, 0],
      points: headPoints,
      depthScale: headDepthScale,
      radialSegments: 24,
    },
    {
      id: "face",
      kind: "ellipsoid",
      frame: frames.head,
      center: [faceCenterX, faceCenterY, faceCenterZ],
      radii: faceRadii,
      widthSegments: 16,
      heightSegments: 12,
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
        radius: shoulderIndicatorRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: upperId,
        kind: "profile",
        frame: upper,
        center: [0, 0, 0],
        points: [
          { y: -dimensions.upperArmLength, radius: dimensions.armRadius * 0.68 },
          { y: -dimensions.upperArmLength * 0.72, radius: dimensions.armRadius * 0.88 },
          { y: -dimensions.upperArmLength * 0.22, radius: dimensions.armRadius * 1.05 },
          { y: 0, radius: dimensions.armRadius * 1.12 },
        ],
        depthScale: 0.88,
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
        radius: elbowIndicatorRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: middleId,
        kind: "profile",
        frame: middle,
        center: [0, 0, 0],
        points: [
          { y: -dimensions.forearmLength, radius: dimensions.forearmRadius * 0.55 },
          { y: -dimensions.forearmLength * 0.72, radius: dimensions.forearmRadius * 0.78 },
          { y: -dimensions.forearmLength * 0.32, radius: dimensions.forearmRadius },
          { y: 0, radius: dimensions.forearmRadius * 0.86 },
        ],
        depthScale: 0.78,
        radialSegments: 12,
      },
    );
    if (limbPresence[terminalId] !== "present") continue;
    primitives.push({
      id: terminalId,
      kind: "ellipsoid",
      frame: terminal,
      center: [...dimensions.handOffset],
      radii: dimensions.handSize.map((value) => value / 2) as [
        number,
        number,
        number,
      ],
      widthSegments: 14,
      heightSegments: 10,
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
        radius: hipIndicatorRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: upperId,
        kind: "profile",
        frame: upper,
        center: [0, 0, 0],
        points: [
          { y: -dimensions.upperLegLength, radius: dimensions.legRadius * 0.66 },
          { y: -dimensions.upperLegLength * 0.72, radius: dimensions.legRadius * 0.9 },
          { y: -dimensions.upperLegLength * 0.22, radius: dimensions.legRadius * 1.05 },
          { y: 0, radius: dimensions.legRadius * 1.14 },
        ],
        depthScale: 0.86,
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
        radius: kneeIndicatorRadius,
        widthSegments: 12,
        heightSegments: 8,
      },
      {
        id: middleId,
        kind: "profile",
        frame: middle,
        center: [0, 0, 0],
        points: [
          { y: -dimensions.lowerLegLength, radius: dimensions.lowerLegRadius * 0.54 },
          { y: -dimensions.lowerLegLength * 0.7, radius: dimensions.lowerLegRadius * 0.82 },
          { y: -dimensions.lowerLegLength * 0.34, radius: dimensions.lowerLegRadius * 1.08 },
          { y: 0, radius: dimensions.lowerLegRadius * 0.82 },
        ],
        depthScale: 0.78,
        radialSegments: 12,
      },
    );
    if (limbPresence[terminalId] !== "present") continue;
    primitives.push({
      id: terminalId,
      kind: "ellipsoid",
      frame: terminal,
      center: [...dimensions.footOffset],
      radii: dimensions.footSize.map((value) => value / 2) as [
        number,
        number,
        number,
      ],
      widthSegments: 16,
      heightSegments: 10,
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

const scaleTupleByScalar = (
  value: readonly [number, number, number],
  scalar: number,
): Vec3 => [
  value[0] * scalar,
  value[1] * scalar,
  value[2] * scalar,
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
        scaleTupleByScalar(
          part.transform.positionM,
          definition.moduleScale,
        ),
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
          size: scaleTupleByScalar(
            scaleTuple(part.sizeM, part.transform.scale),
            definition.moduleScale,
          ),
        });
      } else if (part.primitive === "sphere") {
        primitives.push({
          id,
          kind: "sphere",
          frame,
          center: [0, 0, 0],
          radius:
            part.radiusM *
            Math.max(...part.transform.scale) *
            definition.moduleScale,
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
            ) *
            definition.moduleScale,
          length:
            part.lengthM *
            part.transform.scale[1] *
            definition.moduleScale,
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
      moduleScale: 1,
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
  const effective = resolveActorBlueprintInstance(
    snapshot,
    actor.blueprintInstance.variantId,
    actor.blueprintInstance.limbPresenceOverrides,
  );
  const moduleScale = actor.blueprintInstance.heightScale;
  return {
    dimensions: scaleActorAnatomyDimensions(
      deriveBlueprintActorAnatomyDimensions(snapshot),
      moduleScale,
    ),
    limbPresence: effective.limbPresence,
    moduleScale,
    moduleVisibility: effective.moduleVisibility,
    snapshot,
  };
};

const resolveProjection = (
  actor: AnyActorEntity,
  definition: ProjectionDefinition,
): ResolvedActorProjection => {
  const frames = computeFrames(actor, definition.dimensions);
  const body = bodyPrimitives(definition, frames);
  const head = body.find(({ id }) => id === "head");
  const face = body.find(({ id }) => id === "face");
  if (!head || head.kind !== "profile" || !face) {
    throw new Error("ACTOR_BODY_PROJECTION_INVALID");
  }
  const headCenterY =
    ((head.points[0]?.y ?? 0) + (head.points.at(-1)?.y ?? 0)) / 2;
  const anchors: Record<ActorAnchor, Vec3> = {
    root: [0, 0, 0],
    pelvis: [0, 0, 0],
    chest: framePoint(frames.spine, [
      0,
      definition.dimensions.torsoLength * 0.58,
      0,
    ]),
    head: framePoint(head.frame, [
      head.center[0],
      head.center[1] + headCenterY,
      head.center[2],
    ]),
    face: framePoint(face.frame, [...face.center]),
  };

  return {
    primitives: [
      ...body,
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
    moduleScale: 1,
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
