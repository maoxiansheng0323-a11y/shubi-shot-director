import {
  actorAnchorLocalPoint,
  resolveLegacyActorProjection,
  resolveActorProjection,
  type ActorProjectionEllipsoidPrimitive,
  type ActorProjectionProfilePrimitive,
  type ActorProjectionCylinderPrimitive,
  type ActorRigFrame,
  type ActorRigPrimitiveId,
} from "./actor-projection";
import {
  addVectors,
  rotateVector,
  transformPoint,
} from "./scene-math";
import type {
  AnyActorEntity,
  LegacyActorEntity,
  SceneSpec,
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

const actorLinearVector = (
  transform: TransformSpec,
  vector: Vec3,
): Vec3 => rotateVector([
  vector[0] * transform.scale[0],
  vector[1] * transform.scale[1],
  vector[2] * transform.scale[2],
], transform.rotation);

const primitiveAxes = (frame: ActorRigFrame): readonly [Vec3, Vec3, Vec3] => [
  rotateVector([1, 0, 0], frame.rotation),
  rotateVector([0, 1, 0], frame.rotation),
  rotateVector([0, 0, 1], frame.rotation),
];

const axisGradients = (
  frame: ActorRigFrame,
  transform: TransformSpec,
): Vec3[] => {
  const axes = primitiveAxes(frame);
  const worldAxes = axes.map((axis) => actorLinearVector(transform, axis));
  const gradients: Vec3[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    gradients.push(
      [axes[0][axis], axes[1][axis], axes[2][axis]],
      [worldAxes[0][axis], worldAxes[1][axis], worldAxes[2][axis]],
    );
  }
  return gradients;
};

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

const cylinderPoints = (
  primitive: ActorProjectionCylinderPrimitive,
): Vec3[] => {
  const points: Vec3[] = [];
  const halfLength = primitive.length / 2;
  for (const y of [-halfLength, halfLength]) {
    points.push(framePoint(primitive.frame, [
      primitive.center[0],
      primitive.center[1] + y,
      primitive.center[2],
    ]));
    for (
      let segment = 0;
      segment < primitive.radialSegments;
      segment += 1
    ) {
      const angle = (segment / primitive.radialSegments) * Math.PI * 2;
      points.push(framePoint(primitive.frame, [
        primitive.center[0] + Math.sin(angle) * primitive.radius,
        primitive.center[1] + y,
        primitive.center[2] + Math.cos(angle) * primitive.radius,
      ]));
    }
  }
  return points;
};

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

const profilePoints = (
  primitive: ActorProjectionProfilePrimitive,
  transform: TransformSpec,
): Vec3[] => {
  const points: Vec3[] = [];
  const gradients = axisGradients(primitive.frame, transform);
  for (const ring of primitive.points) {
    const radiusZ = ring.radius * primitive.depthScale;
    for (let segment = 0; segment < primitive.radialSegments; segment += 1) {
      const angle = (segment / primitive.radialSegments) * Math.PI * 2;
      points.push(framePoint(primitive.frame, [
        primitive.center[0] + Math.cos(angle) * ring.radius,
        primitive.center[1] + ring.y,
        primitive.center[2] + Math.sin(angle) * radiusZ,
      ]));
    }
    for (const gradient of gradients) {
      const denominator = Math.hypot(
        ring.radius * gradient[0],
        radiusZ * gradient[2],
      );
      if (denominator === 0) continue;
      const offset: Vec3 = [
        (ring.radius * ring.radius * gradient[0]) / denominator,
        0,
        (radiusZ * radiusZ * gradient[2]) / denominator,
      ];
      for (const sign of [-1, 1]) {
        points.push(framePoint(primitive.frame, [
          primitive.center[0] + offset[0] * sign,
          primitive.center[1] + ring.y,
          primitive.center[2] + offset[2] * sign,
        ]));
      }
    }
  }
  return points;
};

const ellipsoidPoints = (
  primitive: ActorProjectionEllipsoidPrimitive,
  transform: TransformSpec,
): Vec3[] => {
  const points = [framePoint(primitive.frame, [...primitive.center])];
  for (const gradient of axisGradients(primitive.frame, transform)) {
    const denominator = Math.hypot(
      primitive.radii[0] * gradient[0],
      primitive.radii[1] * gradient[1],
      primitive.radii[2] * gradient[2],
    );
    if (denominator === 0) continue;
    const offset: Vec3 = [
      (primitive.radii[0] ** 2 * gradient[0]) / denominator,
      (primitive.radii[1] ** 2 * gradient[1]) / denominator,
      (primitive.radii[2] ** 2 * gradient[2]) / denominator,
    ];
    for (const sign of [-1, 1]) {
      points.push(framePoint(primitive.frame, [
        primitive.center[0] + offset[0] * sign,
        primitive.center[1] + offset[1] * sign,
        primitive.center[2] + offset[2] * sign,
      ]));
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
  sceneOrActor: SceneSpec | LegacyActorEntity,
  actorOrTransform?: AnyActorEntity | TransformSpec,
  transformOverride?: TransformSpec,
): ActorVisibleRigBounds => {
  const scene =
    "sceneId" in sceneOrActor ? sceneOrActor : null;
  const actor = (
    scene === null ? sceneOrActor : actorOrTransform
  ) as AnyActorEntity;
  const transform =
    transformOverride ??
    (scene === null && actorOrTransform && "positionM" in actorOrTransform
      ? actorOrTransform
      : actor.transform);
  const { primitives } =
    scene === null
      ? resolveLegacyActorProjection(actor as LegacyActorEntity)
      : resolveActorProjection(scene, actor);
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
      case "cylinder": {
        localPoints.push(...cylinderPoints(primitive));
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
      case "profile":
        localPoints.push(...profilePoints(primitive, transform));
        break;
      case "ellipsoid":
        localPoints.push(...ellipsoidPoints(primitive, transform));
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
  sceneOrActor: SceneSpec | LegacyActorEntity,
  actorOrLowerFraction: AnyActorEntity | number,
  lowerFractionOverride?: number,
): Vec3[] => {
  const scene =
    "sceneId" in sceneOrActor ? sceneOrActor : null;
  const actor = (
    scene === null ? sceneOrActor : actorOrLowerFraction
  ) as AnyActorEntity;
  const lowerFraction =
    lowerFractionOverride ??
    (typeof actorOrLowerFraction === "number"
      ? actorOrLowerFraction
      : 0);
  const bounds =
    scene === null
      ? actorVisibleRigBounds(actor as LegacyActorEntity)
      : actorVisibleRigBounds(scene, actor);
  const sliceY =
    bounds.minLocal[1] +
    (bounds.maxLocal[1] - bounds.minLocal[1]) * lowerFraction;
  const localPoints = bounds.localPoints.filter((point) => point[1] >= sliceY);
  localPoints.push(
    scene === null
      ? [...resolveLegacyActorProjection(actor as LegacyActorEntity).anchors.face]
      : actorAnchorLocalPoint(scene, actor, "face"),
    scene === null
      ? [...resolveLegacyActorProjection(actor as LegacyActorEntity).anchors.head]
      : actorAnchorLocalPoint(scene, actor, "head"),
  );
  return localPoints.map((point) => transformPoint(actor.transform, point));
};
