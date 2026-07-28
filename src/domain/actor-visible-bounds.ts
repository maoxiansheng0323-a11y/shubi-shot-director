import {
  actorAnchorLocalPoint,
  deriveActorRigProjection,
  type ActorRigFrame,
  type ActorRigPrimitiveId,
} from "./humanoid-rig";
import {
  addVectors,
  rotateVector,
  transformPoint,
} from "./scene-math";
import type {
  ActorEntity,
  TransformSpec,
  Vec3,
} from "./scene-schema";

export type ActorVisiblePrimitiveId = ActorRigPrimitiveId;

export interface ActorVisibleRigBounds {
  primitiveIds: ActorVisiblePrimitiveId[];
  localPoints: Vec3[];
  worldPoints: Vec3[];
  minLocal: Vec3;
  maxLocal: Vec3;
  minWorld: Vec3;
  maxWorld: Vec3;
  supportOffsetM: number;
}

const axisDirections: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const framePoint = (frame: ActorRigFrame, point: Vec3): Vec3 =>
  addVectors(frame.position, rotateVector(point, frame.rotation));

const affineWorldExtremaOffsets = (
  radius: number,
  transform: TransformSpec,
): Vec3[] => {
  const columns = [
    rotateVector([transform.scale[0], 0, 0], transform.rotation),
    rotateVector([0, transform.scale[1], 0], transform.rotation),
    rotateVector([0, 0, transform.scale[2]], transform.rotation),
  ] as const;
  const offsets: Vec3[] = [];
  for (let worldAxis = 0; worldAxis < 3; worldAxis += 1) {
    const gradient: Vec3 = [
      columns[0][worldAxis],
      columns[1][worldAxis],
      columns[2][worldAxis],
    ];
    const length = Math.hypot(...gradient);
    const offset = gradient.map(
      (component) => (component / length) * radius,
    ) as Vec3;
    offsets.push(offset, [-offset[0], -offset[1], -offset[2]]);
  }
  return offsets;
};

const spherePoints = (
  center: Vec3,
  radius: number,
  transform: TransformSpec,
): Vec3[] => [
  center,
  ...axisDirections.map((axis): Vec3 => [
    center[0] + axis[0] * radius,
    center[1] + axis[1] * radius,
    center[2] + axis[2] * radius,
  ]),
  ...affineWorldExtremaOffsets(radius, transform).map((offset): Vec3 => [
    center[0] + offset[0],
    center[1] + offset[1],
    center[2] + offset[2],
  ]),
];

const capsulePoints = (
  frame: ActorRigFrame,
  firstEndpoint: Vec3,
  secondEndpoint: Vec3,
  radius: number,
  transform: TransformSpec,
): Vec3[] => [
  ...spherePoints(framePoint(frame, firstEndpoint), radius, transform),
  ...spherePoints(framePoint(frame, secondEndpoint), radius, transform),
];

const boxPoints = (
  frame: ActorRigFrame,
  center: Vec3,
  size: readonly [number, number, number],
): Vec3[] => {
  const points: Vec3[] = [];
  for (const x of [-size[0] / 2, size[0] / 2]) {
    for (const y of [-size[1] / 2, size[1] / 2]) {
      for (const z of [-size[2] / 2, size[2] / 2]) {
        points.push(framePoint(frame, [center[0] + x, center[1] + y, center[2] + z]));
      }
    }
  }
  return points;
};

const pointBounds = (points: readonly Vec3[]): { min: Vec3; max: Vec3 } => ({
  min: [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.min(...points.map((point) => point[2])),
  ],
  max: [
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[2])),
  ],
});

export const actorVisibleRigBounds = (
  actor: ActorEntity,
  transform: TransformSpec = actor.transform,
): ActorVisibleRigBounds => {
  const { primitives } = deriveActorRigProjection(actor);
  const primitiveIds = primitives.map(({ id }) => id);
  const localPoints: Vec3[] = [];
  for (const primitive of primitives) {
    switch (primitive.kind) {
      case "sphere":
        localPoints.push(
          ...spherePoints(
            framePoint(primitive.frame, primitive.center),
            primitive.radius,
            transform,
          ),
        );
        break;
      case "capsule": {
        const halfCylinder = primitive.cylinderLength / 2;
        localPoints.push(
          ...capsulePoints(
            primitive.frame,
            [
              primitive.center[0],
              primitive.center[1] + halfCylinder,
              primitive.center[2],
            ],
            [
              primitive.center[0],
              primitive.center[1] - halfCylinder,
              primitive.center[2],
            ],
            primitive.radius,
            transform,
          ),
        );
        break;
      }
      case "box":
        localPoints.push(
          ...boxPoints(
            primitive.frame,
            primitive.center,
            primitive.size,
          ),
        );
        break;
    }
  }

  const worldPoints = localPoints.map((point) => transformPoint(transform, point));
  const localBounds = pointBounds(localPoints);
  const worldBounds = pointBounds(worldPoints);
  return {
    primitiveIds,
    localPoints,
    worldPoints,
    minLocal: localBounds.min,
    maxLocal: localBounds.max,
    minWorld: worldBounds.min,
    maxWorld: worldBounds.max,
    supportOffsetM: transform.positionM[1] - worldBounds.min[1],
  };
};

export const actorVisibleFramingPoints = (
  actor: ActorEntity,
  lowerFraction: number,
): Vec3[] => {
  const bounds = actorVisibleRigBounds(actor);
  const sliceY =
    bounds.minLocal[1] +
    (bounds.maxLocal[1] - bounds.minLocal[1]) * lowerFraction;
  const localPoints = bounds.localPoints.filter((point) => point[1] >= sliceY);
  localPoints.push(
    actorAnchorLocalPoint(actor, "face"),
    actorAnchorLocalPoint(actor, "head"),
  );
  return localPoints.map((point) => transformPoint(actor.transform, point));
};
