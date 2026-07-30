import {
  actorAnchorWorldPoint,
  resolveActorProjection,
  type ActorAnchor,
} from "./actor-projection";
import {
  actorVisibleFramingPoints,
  actorVisibleRigBounds,
} from "./actor-visible-bounds";
import { addVectors, rotateVector, transformPoint } from "./scene-math";
import {
  deriveBoundaryWallBoxes,
  type SpatialRegion,
} from "./spatial-layout";
import {
  type AnyActorEntity,
  type CameraEntity,
  type CompositionFramingMode,
  type QuaternionTuple,
  type SceneEntity,
  type SceneSpec,
  type TransformSpec,
  type Vec3,
} from "./scene-schema";

type PropEntity = Extract<SceneEntity, { kind: "prop" }>;
type KeepVisibleConstraint = Extract<
  SceneSpec["constraints"][number],
  { type: "keep-visible" }
>;

export const COMPOSITION_SAFE_NDC_LIMIT = 0.8;
const FRAMING_SAFE_NDC_LIMIT = 0.9;
const OCCLUSION_CHECK_RATIO = 0.05;

export const compositionCategories = [
  "anchor",
  "framing",
  "caption",
  "occlusion",
  "topology",
  "cameraCollision",
] as const;

export type CompositionCategory = (typeof compositionCategories)[number];

export const compositionIssueCodes = [
  "ACTIVE_CAMERA_MISSING",
  "KEEP_VISIBLE_CAMERA_MISSING",
  "KEEP_VISIBLE_SUBJECT_MISSING",
  "KEEP_VISIBLE_SUBJECT_HIDDEN",
  "ANCHOR_BEHIND_CAMERA",
  "ANCHOR_BEFORE_NEAR_CLIP",
  "ANCHOR_BEYOND_FAR_CLIP",
  "ANCHOR_OUT_OF_FRAME",
  "ANCHOR_NEAR_SAFE_EDGE",
  "ANCHOR_OCCLUDED_APPROXIMATE",
  "FRAMING_SUBJECT_MISSING",
  "FRAMING_SUBJECT_HIDDEN",
  "FRAMING_BOUNDS_OUT_OF_FRAME",
  "FRAMING_BOUNDS_NEAR_EDGE",
  "HEADROOM_INSUFFICIENT",
  "EYELINE_OUTSIDE_GUIDE",
  "RESERVED_ZONE_TARGET_UNPROJECTABLE",
  "SUBJECT_OVERLAPS_CAPTION_ZONE",
  "SUBJECT_OVERLAPS_SIDE_UI_ZONE",
  "SUBJECT_OCCLUDED_APPROXIMATE",
  "TOPOLOGY_ENVIRONMENT_UNAVAILABLE",
  "CRITICAL_ENTITY_OUTSIDE_ROOM",
  "CRITICAL_ENTITY_OUTSIDE_REGION",
  "CRITICAL_ENTITY_REGION_UNASSIGNED",
  "SIGHTLINE_INTERSECTS_WALL",
  "CAMERA_COLLIDES_WALL",
  "CAMERA_INSIDE_ACTOR_PROXY",
  "CAMERA_INSIDE_PROP",
] as const;

export type CompositionIssueCode = (typeof compositionIssueCodes)[number];
export type CompositionCheckStatus =
  | "pass"
  | "check"
  | "fail"
  | "unchecked";

export interface CompositionIssue {
  code: CompositionIssueCode;
  category: CompositionCategory;
  severity: "warning" | "error";
  message: string;
  approximate: boolean;
  relatedEntityIds: string[];
  evidence?: string;
  constraintId?: string;
  cameraId?: string;
  subjectEntityId?: string;
  occluderEntityId?: string;
  occlusionRatio?: number;
}

export interface CompositionCheckResult {
  status: CompositionCheckStatus;
  required: boolean;
  approximate: boolean;
  confidence: number;
  issueCodes: CompositionIssueCode[];
  evidence: string[];
}

export interface CompositionReport {
  /**
   * Compatibility status for existing callers. New UI and automation should
   * use overallStatus and the six category results below.
   */
  status: "safe" | "warning";
  overallStatus: "safe" | "check" | "fail" | "unchecked";
  activeCameraId: string;
  anchorSafe: CompositionCheckResult;
  framingSafe: CompositionCheckResult;
  captionSafe: CompositionCheckResult;
  occlusionSafe: CompositionCheckResult;
  topologySafe: CompositionCheckResult;
  cameraCollisionSafe: CompositionCheckResult;
  issues: CompositionIssue[];
}

interface Projection {
  depthM: number;
  ndcX: number;
  ndcY: number;
}

interface ProjectedBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minDepthM: number;
  maxDepthM: number;
}

interface OcclusionProxy {
  center: Vec3;
  radiusM: number;
}

interface ProjectedProxy {
  bounds: ProjectedBounds;
  depthM: number;
}

interface Aabb {
  min: Vec3;
  max: Vec3;
}

interface RoomProxy {
  entityId: string;
  transform: TransformSpec;
  widthM: number;
  depthM: number;
  heightM: number;
  wallThicknessM: number;
}

interface SpatialWallProxy {
  boundaryId: string;
  transform: TransformSpec;
  bounds: Aabb;
}

interface CheckState {
  required: boolean;
  checked: boolean;
  approximate: boolean;
  confidence: number;
  evidence: string[];
  issues: CompositionIssue[];
}

const createCheckState = (
  required: boolean,
  confidence: number,
): CheckState => ({
  required,
  checked: false,
  approximate: false,
  confidence,
  evidence: [],
  issues: [],
});

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

const subtractVectors = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const divideVectors = (left: Vec3, right: Vec3): Vec3 => [
  left[0] / right[0],
  left[1] / right[1],
  left[2] / right[2],
];

const vectorLength = (vector: Vec3): number =>
  Math.hypot(vector[0], vector[1], vector[2]);

const dotVectors = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const inverseRotation = (rotation: QuaternionTuple): QuaternionTuple => [
  -rotation[0],
  -rotation[1],
  -rotation[2],
  rotation[3],
];

const worldToLocalPoint = (
  transform: TransformSpec,
  point: Vec3,
): Vec3 =>
  divideVectors(
    rotateVector(
      subtractVectors(point, transform.positionM),
      inverseRotation(transform.rotation),
    ),
    transform.scale,
  );

const resolveAnchor = (
  scene: SceneSpec,
  entity: SceneEntity,
  anchor: ActorAnchor,
): Vec3 =>
  entity.kind === "actor"
    ? actorAnchorWorldPoint(scene, entity, anchor)
    : [...entity.transform.positionM];

const projectPoint = (
  camera: CameraEntity,
  point: Vec3,
  aspect: number,
): Projection => {
  const cameraRelative = subtractVectors(point, camera.transform.positionM);
  const cameraLocal = rotateVector(
    cameraRelative,
    inverseRotation(camera.transform.rotation),
  );
  const depthM = -cameraLocal[2];
  const horizontalHalfTangent =
    camera.lens.sensorWidthMm / (2 * camera.lens.focalLengthMm);
  const verticalHalfTangent = horizontalHalfTangent / aspect;

  return {
    depthM,
    ndcX: cameraLocal[0] / (depthM * horizontalHalfTangent),
    ndcY: cameraLocal[1] / (depthM * verticalHalfTangent),
  };
};

const projectBounds = (
  camera: CameraEntity,
  points: Vec3[],
  aspect: number,
): ProjectedBounds | null => {
  const projections = points.map((point) =>
    projectPoint(camera, point, aspect),
  );
  if (
    projections.length === 0 ||
    projections.some(
      (projection) =>
        !Number.isFinite(projection.ndcX) ||
        !Number.isFinite(projection.ndcY) ||
        projection.depthM <= camera.lens.nearM ||
        projection.depthM >= camera.lens.farM,
    )
  ) {
    return null;
  }

  return {
    minX: Math.min(...projections.map((projection) => projection.ndcX)),
    maxX: Math.max(...projections.map((projection) => projection.ndcX)),
    minY: Math.min(...projections.map((projection) => projection.ndcY)),
    maxY: Math.max(...projections.map((projection) => projection.ndcY)),
    minDepthM: Math.min(
      ...projections.map((projection) => projection.depthM),
    ),
    maxDepthM: Math.max(
      ...projections.map((projection) => projection.depthM),
    ),
  };
};

const boxCorners = (min: Vec3, max: Vec3): Vec3[] => {
  const corners: Vec3[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push([x, y, z]);
      }
    }
  }
  return corners;
};

const numberParameter = (
  parameters: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
};

const actorFullBoundsPoints = (
  scene: SceneSpec,
  actor: AnyActorEntity,
): Vec3[] => {
  const bounds = actorVisibleRigBounds(scene, actor);
  return [
    ...bounds.worldPoints,
    actorAnchorWorldPoint(scene, actor, "face"),
    actorAnchorWorldPoint(scene, actor, "head"),
    actorAnchorWorldPoint(scene, actor, "chest"),
    actorAnchorWorldPoint(scene, actor, "pelvis"),
  ];
};

const actorFramingBoundsPoints = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  mode: Exclude<CompositionFramingMode, "whole-prop">,
): Vec3[] => {
  const lowerFraction: Record<
    Exclude<CompositionFramingMode, "whole-prop">,
    number
  > = {
    close: 0.72,
    "medium-close": 0.5,
    medium: 0.3,
    full: 0,
  };
  return actorVisibleFramingPoints(scene, actor, lowerFraction[mode]);
};

const propFullBoundsPoints = (prop: PropEntity): Vec3[] => {
  const half: Vec3 = [
    prop.geometry.sizeM[0] / 2,
    prop.geometry.sizeM[1] / 2,
    prop.geometry.sizeM[2] / 2,
  ];
  return boxCorners(
    [-half[0], -half[1], -half[2]],
    [half[0], half[1], half[2]],
  ).map((point) => transformPoint(prop.transform, point));
};

const entityFullBoundsPoints = (
  scene: SceneSpec,
  entity: SceneEntity,
): Vec3[] => {
  if (entity.kind === "actor") {
    return actorFullBoundsPoints(scene, entity);
  }
  if (entity.kind === "prop") {
    return propFullBoundsPoints(entity);
  }
  return [[...entity.transform.positionM]];
};

const createOcclusionProxy = (
  scene: SceneSpec,
  entity: SceneEntity,
): OcclusionProxy | null => {
  if (entity.kind === "actor") {
    const bounds = actorVisibleRigBounds(scene, entity);
    const center: Vec3 = [
      (bounds.minWorld[0] + bounds.maxWorld[0]) / 2,
      (bounds.minWorld[1] + bounds.maxWorld[1]) / 2,
      (bounds.minWorld[2] + bounds.maxWorld[2]) / 2,
    ];
    return {
      center,
      radiusM: Math.hypot(
        bounds.maxWorld[0] - center[0],
        bounds.maxWorld[1] - center[1],
        bounds.maxWorld[2] - center[2],
      ),
    };
  }

  if (entity.kind === "prop") {
    const halfSize: Vec3 = [
      (entity.geometry.sizeM[0] * entity.transform.scale[0]) / 2,
      (entity.geometry.sizeM[1] * entity.transform.scale[1]) / 2,
      (entity.geometry.sizeM[2] * entity.transform.scale[2]) / 2,
    ];
    return {
      center: [...entity.transform.positionM],
      radiusM: vectorLength(halfSize),
    };
  }

  return null;
};

const projectProxy = (
  camera: CameraEntity,
  proxy: OcclusionProxy,
  aspect: number,
): ProjectedProxy | null => {
  const center = projectPoint(camera, proxy.center, aspect);
  if (
    center.depthM <= camera.lens.nearM ||
    center.depthM >= camera.lens.farM
  ) {
    return null;
  }
  const horizontalHalfTangent =
    camera.lens.sensorWidthMm / (2 * camera.lens.focalLengthMm);
  const verticalHalfTangent = horizontalHalfTangent / aspect;
  const radiusX =
    proxy.radiusM / (center.depthM * horizontalHalfTangent);
  const radiusY = proxy.radiusM / (center.depthM * verticalHalfTangent);
  return {
    depthM: center.depthM,
    bounds: {
      minX: center.ndcX - radiusX,
      maxX: center.ndcX + radiusX,
      minY: center.ndcY - radiusY,
      maxY: center.ndcY + radiusY,
      minDepthM: center.depthM - proxy.radiusM,
      maxDepthM: center.depthM + proxy.radiusM,
    },
  };
};

const projectedOverlapRatio = (
  subject: ProjectedBounds,
  occluder: ProjectedBounds,
): number => {
  const width = Math.max(0, Math.min(subject.maxX, occluder.maxX) -
    Math.max(subject.minX, occluder.minX));
  const height = Math.max(0, Math.min(subject.maxY, occluder.maxY) -
    Math.max(subject.minY, occluder.minY));
  const subjectArea =
    Math.max(1e-8, subject.maxX - subject.minX) *
    Math.max(1e-8, subject.maxY - subject.minY);
  return clamp01((width * height) / subjectArea);
};

const proxyIntersectsSightline = (
  cameraPosition: Vec3,
  anchorPosition: Vec3,
  proxy: OcclusionProxy,
  nearM: number,
): boolean => {
  const sightline = subtractVectors(anchorPosition, cameraPosition);
  const anchorDistance = vectorLength(sightline);
  if (anchorDistance <= 1e-8) {
    return false;
  }

  const direction: Vec3 = [
    sightline[0] / anchorDistance,
    sightline[1] / anchorDistance,
    sightline[2] / anchorDistance,
  ];
  const centerOffset = subtractVectors(proxy.center, cameraPosition);
  const distanceAlongRay = dotVectors(centerOffset, direction);
  if (distanceAlongRay <= nearM || distanceAlongRay >= anchorDistance) {
    return false;
  }

  const closestPoint: Vec3 = [
    cameraPosition[0] + direction[0] * distanceAlongRay,
    cameraPosition[1] + direction[1] * distanceAlongRay,
    cameraPosition[2] + direction[2] * distanceAlongRay,
  ];
  return (
    vectorLength(subtractVectors(proxy.center, closestPoint)) <=
    proxy.radiusM
  );
};

const issue = (
  category: CompositionCategory,
  code: CompositionIssueCode,
  severity: CompositionIssue["severity"],
  message: string,
  relatedEntityIds: string[],
  details: Partial<
    Pick<
      CompositionIssue,
      | "constraintId"
      | "cameraId"
      | "subjectEntityId"
      | "occluderEntityId"
      | "occlusionRatio"
      | "evidence"
    >
  > = {},
  approximate = false,
): CompositionIssue => ({
  category,
  code,
  severity,
  message,
  approximate,
  relatedEntityIds,
  ...details,
});

const addIssue = (state: CheckState, value: CompositionIssue): void => {
  state.issues.push(value);
  state.approximate ||= value.approximate;
  if (value.evidence) {
    state.evidence.push(value.evidence);
  }
};

const finalizeCheck = (state: CheckState): CompositionCheckResult => {
  const status: CompositionCheckStatus =
    !state.required || !state.checked
      ? "unchecked"
      : state.issues.some((entry) => entry.severity === "error")
        ? "fail"
        : state.issues.length > 0
          ? "check"
          : "pass";
  return {
    status,
    required: state.required,
    approximate: state.approximate,
    confidence: state.checked ? clamp01(state.confidence) : 0,
    issueCodes: [...new Set(state.issues.map((entry) => entry.code))],
    evidence: [...new Set(state.evidence)],
  };
};

const roomProxy = (entity: SceneEntity): RoomProxy | null => {
  if (entity.kind !== "environment" || !entity.visible) {
    return null;
  }
  return {
    entityId: entity.id,
    transform: entity.transform,
    widthM: numberParameter(entity.preset.parameters, "widthM", 5),
    depthM: numberParameter(entity.preset.parameters, "depthM", 4),
    heightM: numberParameter(entity.preset.parameters, "heightM", 2.8),
    wallThicknessM: numberParameter(
      entity.preset.parameters,
      "wallThicknessM",
      0.08,
    ),
  };
};

const roomWalls = (room: RoomProxy): Aabb[] => {
  const halfWidth = room.widthM / 2;
  const halfDepth = room.depthM / 2;
  const halfThickness = room.wallThicknessM / 2;
  return [
    {
      min: [-halfWidth, -room.wallThicknessM, -halfDepth],
      max: [halfWidth, 0, halfDepth],
    },
    {
      min: [-halfWidth, 0, -halfDepth - halfThickness],
      max: [halfWidth, room.heightM, -halfDepth + halfThickness],
    },
    {
      min: [-halfWidth - halfThickness, 0, -halfDepth],
      max: [-halfWidth + halfThickness, room.heightM, halfDepth],
    },
  ];
};

const spatialWallProxies = (
  scene: SceneSpec,
  openingMode: "sight" | "passage",
): SpatialWallProxy[] => {
  const layout = scene.spatialLayout;
  if (layout === null) {
    return [];
  }
  return layout.boundaries.flatMap((boundary) => {
    if (
      !boundary.visible ||
      !boundary.regionIds.some(
        (regionId) =>
          layout.regions.find((region) => region.id === regionId)
            ?.visible === true,
      )
    ) {
      return [];
    }
    return deriveBoundaryWallBoxes(
      layout,
      boundary,
      (opening) => {
        const connection = layout.connections.find(
          (candidate) => candidate.openingId === opening.id,
        );
        return (
          connection?.enabled === true &&
          (openingMode === "sight"
            ? connection.allowsSight
            : connection.allowsPassage)
        );
      },
    ).map((wall) => ({
      boundaryId: wall.boundaryId,
      transform: {
        positionM: wall.position,
        rotation: [
          0,
          Math.sin(wall.rotationY / 2),
          0,
          Math.cos(wall.rotationY / 2),
        ],
        scale: [1, 1, 1],
      },
      bounds: {
        min: [
          -wall.size[0] / 2,
          -wall.size[1] / 2,
          -wall.size[2] / 2,
        ],
        max: [
          wall.size[0] / 2,
          wall.size[1] / 2,
          wall.size[2] / 2,
        ],
      },
    }));
  });
};

const pointInsideSpatialRegion = (
  point: Vec3,
  floorY: number,
  region: SpatialRegion,
): boolean => {
  if (point[1] < floorY || point[1] > floorY + region.heightM) {
    return false;
  }
  let inside = false;
  const [x, , z] = point;
  for (
    let current = 0, previous = region.footprintXZ.length - 1;
    current < region.footprintXZ.length;
    previous = current, current += 1
  ) {
    const [currentX, currentZ] = region.footprintXZ[current];
    const [previousX, previousZ] = region.footprintXZ[previous];
    const crosses =
      currentZ > z !== previousZ > z &&
      x <
        ((previousX - currentX) * (z - currentZ)) /
          (previousZ - currentZ) +
          currentX;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
};

const pointInsideAabb = (point: Vec3, bounds: Aabb): boolean =>
  point[0] >= bounds.min[0] &&
  point[0] <= bounds.max[0] &&
  point[1] >= bounds.min[1] &&
  point[1] <= bounds.max[1] &&
  point[2] >= bounds.min[2] &&
  point[2] <= bounds.max[2];

const segmentIntersectsAabb = (
  start: Vec3,
  end: Vec3,
  bounds: Aabb,
): boolean => {
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-9) {
      if (
        start[axis] < bounds.min[axis] ||
        start[axis] > bounds.max[axis]
      ) {
        return false;
      }
      continue;
    }
    const first = (bounds.min[axis] - start[axis]) / delta;
    const second = (bounds.max[axis] - start[axis]) / delta;
    const axisNear = Math.min(first, second);
    const axisFar = Math.max(first, second);
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (near > far) {
      return false;
    }
  }
  return far >= 0 && near <= 1;
};

const insideRoomVolume = (point: Vec3, room: RoomProxy): boolean =>
  point[0] >= -room.widthM / 2 &&
  point[0] <= room.widthM / 2 &&
  point[1] >= 0 &&
  point[1] <= room.heightM &&
  point[2] >= -room.depthM / 2 &&
  point[2] <= room.depthM / 2;

const cameraInsideProp = (
  cameraPosition: Vec3,
  prop: PropEntity,
): { inside: boolean; approximate: boolean } => {
  const local = worldToLocalPoint(prop.transform, cameraPosition);
  const half: Vec3 = [
    prop.geometry.sizeM[0] / 2,
    prop.geometry.sizeM[1] / 2,
    prop.geometry.sizeM[2] / 2,
  ];

  if (prop.geometry.primitive === "cylinder") {
    const normalizedRadius =
      (local[0] / Math.max(half[0], 1e-8)) ** 2 +
      (local[2] / Math.max(half[2], 1e-8)) ** 2;
    return {
      inside: normalizedRadius <= 1 && Math.abs(local[1]) <= half[1],
      approximate: false,
    };
  }

  const renderedHalfY =
    prop.geometry.primitive === "plane"
      ? Math.min(half[1], 0.0125)
      : half[1];
  return {
    inside:
      Math.abs(local[0]) <= half[0] &&
      Math.abs(local[1]) <= renderedHalfY &&
      Math.abs(local[2]) <= half[2],
    approximate: prop.geometry.primitive === "capsule",
  };
};

const targetEntityIds = (scene: SceneSpec): string[] => {
  const ids = new Set<string>(
    scene.compositionGoals?.criticalEntityIds ?? [],
  );
  for (
    const id of
      scene.compositionGoals?.framing?.targetEntityIds ?? []
  ) {
    ids.add(id);
  }
  for (const constraint of scene.constraints) {
    if (
      constraint.type === "keep-visible" &&
      constraint.enabled &&
      constraint.cameraId === scene.activeCameraId
    ) {
      ids.add(constraint.subjectEntityId);
    }
  }
  return [...ids];
};

const boundsEvidence = (
  entityId: string,
  bounds: ProjectedBounds,
): string =>
  `${entityId} NDC bounds x=${bounds.minX.toFixed(2)}..${bounds.maxX.toFixed(2)}, y=${bounds.minY.toFixed(2)}..${bounds.maxY.toFixed(2)}`;

export const analyzeComposition = (scene: SceneSpec): CompositionReport => {
  const aspect = scene.output.aspect.width / scene.output.aspect.height;
  const allIssues: CompositionIssue[] = [];
  const activeCamera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.id === scene.activeCameraId && entity.kind === "camera",
  );
  const activeVisibilityConstraints = scene.constraints.filter(
    (constraint): constraint is KeepVisibleConstraint =>
      constraint.type === "keep-visible" &&
      constraint.enabled &&
      constraint.cameraId === scene.activeCameraId,
  );
  const analysisTargetIds = targetEntityIds(scene);
  const analysisTargets = analysisTargetIds
    .map((id) => scene.entities.find((entity) => entity.id === id))
    .filter((entity): entity is SceneEntity => entity !== undefined);

  const anchorState = createCheckState(
    activeVisibilityConstraints.length > 0,
    0.96,
  );
  const framingState = createCheckState(
    scene.compositionGoals?.framing !== undefined,
    0.82,
  );
  const captionState = createCheckState(
    scene.compositionGoals?.captionZone !== undefined ||
      scene.compositionGoals?.sideUiZone !== undefined,
    0.82,
  );
  const occlusionState = createCheckState(analysisTargets.length > 0, 0.62);
  const topologyState = createCheckState(analysisTargets.length > 0, 0.92);
  const cameraCollisionState = createCheckState(true, 0.96);

  if (!activeCamera) {
    const missingCameraIssue = issue(
      "cameraCollision",
      "ACTIVE_CAMERA_MISSING",
      "error",
      "The active camera does not reference an available camera entity.",
      [scene.activeCameraId],
      { cameraId: scene.activeCameraId },
    );
    addIssue(cameraCollisionState, missingCameraIssue);
    cameraCollisionState.checked = true;
    cameraCollisionState.evidence.push("No active camera was available.");
  } else {
    cameraCollisionState.checked = true;
    cameraCollisionState.evidence.push(
      `Active camera ${activeCamera.id} checked against visible boundaries and props.`,
    );
  }

  if (activeCamera && anchorState.required) {
    anchorState.checked = true;
    for (const constraint of activeVisibilityConstraints) {
      const subject = scene.entities.find(
        (entity) => entity.id === constraint.subjectEntityId,
      );
      const details = {
        constraintId: constraint.id,
        cameraId: activeCamera.id,
        subjectEntityId: constraint.subjectEntityId,
      };
      if (!subject) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "KEEP_VISIBLE_SUBJECT_MISSING",
            "error",
            "An active-camera keep-visible constraint has no subject.",
            [activeCamera.id, constraint.subjectEntityId],
            details,
          ),
        );
        continue;
      }
      if (!subject.visible) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "KEEP_VISIBLE_SUBJECT_HIDDEN",
            "error",
            "An active-camera keep-visible subject is hidden.",
            [activeCamera.id, subject.id],
            details,
          ),
        );
        continue;
      }

      const projection = projectPoint(
        activeCamera,
        resolveAnchor(scene, subject, constraint.anchor),
        aspect,
      );
      const evidence =
        `${subject.id}:${constraint.anchor} at NDC ` +
        `(${projection.ndcX.toFixed(2)}, ${projection.ndcY.toFixed(2)}), ` +
        `depth ${projection.depthM.toFixed(2)}m`;
      anchorState.evidence.push(evidence);
      const related = [activeCamera.id, subject.id];
      if (projection.depthM <= 0) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "ANCHOR_BEHIND_CAMERA",
            "error",
            "The required anchor is behind the active camera.",
            related,
            { ...details, evidence },
          ),
        );
      } else if (projection.depthM < activeCamera.lens.nearM) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "ANCHOR_BEFORE_NEAR_CLIP",
            "error",
            "The required anchor is closer than the near clipping plane.",
            related,
            { ...details, evidence },
          ),
        );
      } else if (projection.depthM > activeCamera.lens.farM) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "ANCHOR_BEYOND_FAR_CLIP",
            "error",
            "The required anchor is beyond the far clipping plane.",
            related,
            { ...details, evidence },
          ),
        );
      } else if (
        Math.abs(projection.ndcX) > 1 ||
        Math.abs(projection.ndcY) > 1
      ) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "ANCHOR_OUT_OF_FRAME",
            "error",
            "The required anchor is outside the active camera frame.",
            related,
            { ...details, evidence },
          ),
        );
      } else if (
        Math.abs(projection.ndcX) > COMPOSITION_SAFE_NDC_LIMIT ||
        Math.abs(projection.ndcY) > COMPOSITION_SAFE_NDC_LIMIT
      ) {
        addIssue(
          anchorState,
          issue(
            "anchor",
            "ANCHOR_NEAR_SAFE_EDGE",
            "warning",
            "The required anchor is outside the 10% safety margin.",
            related,
            { ...details, evidence },
          ),
        );
      }
    }
  }

  const framing = scene.compositionGoals?.framing;
  if (activeCamera && framing) {
    framingState.checked = true;
    for (const targetId of framing.targetEntityIds) {
      const target = scene.entities.find((entity) => entity.id === targetId);
      if (!target) {
        addIssue(
          framingState,
          issue(
            "framing",
            "FRAMING_SUBJECT_MISSING",
            "error",
            "A framing target is missing.",
            [activeCamera.id, targetId],
            {
              cameraId: activeCamera.id,
              subjectEntityId: targetId,
            },
          ),
        );
        continue;
      }
      if (!target.visible) {
        addIssue(
          framingState,
          issue(
            "framing",
            "FRAMING_SUBJECT_HIDDEN",
            "error",
            "A framing target is hidden.",
            [activeCamera.id, target.id],
            {
              cameraId: activeCamera.id,
              subjectEntityId: target.id,
            },
          ),
        );
        continue;
      }

      const points =
        target.kind === "actor" && framing.mode !== "whole-prop"
          ? actorFramingBoundsPoints(scene, target, framing.mode)
          : target.kind === "prop" && framing.mode === "whole-prop"
            ? propFullBoundsPoints(target)
            : [];
      const bounds = projectBounds(activeCamera, points, aspect);
      framingState.approximate ||= target.kind === "actor";
      if (!bounds) {
        addIssue(
          framingState,
          issue(
            "framing",
            "FRAMING_BOUNDS_OUT_OF_FRAME",
            "error",
            "The requested framing bounds cannot be projected inside the clip range.",
            [activeCamera.id, target.id],
            {
              cameraId: activeCamera.id,
              subjectEntityId: target.id,
            },
            target.kind === "actor",
          ),
        );
        continue;
      }
      const evidence = boundsEvidence(target.id, bounds);
      framingState.evidence.push(`${framing.mode}: ${evidence}`);
      if (
        bounds.minX < -1 ||
        bounds.maxX > 1 ||
        bounds.minY < -1 ||
        bounds.maxY > 1
      ) {
        addIssue(
          framingState,
          issue(
            "framing",
            "FRAMING_BOUNDS_OUT_OF_FRAME",
            "error",
            "The requested actor or whole-prop framing is cropped.",
            [activeCamera.id, target.id],
            {
              cameraId: activeCamera.id,
              subjectEntityId: target.id,
              evidence,
            },
            target.kind === "actor",
          ),
        );
      } else if (
        bounds.minX < -FRAMING_SAFE_NDC_LIMIT ||
        bounds.maxX > FRAMING_SAFE_NDC_LIMIT ||
        bounds.minY < -FRAMING_SAFE_NDC_LIMIT ||
        bounds.maxY > FRAMING_SAFE_NDC_LIMIT
      ) {
        addIssue(
          framingState,
          issue(
            "framing",
            "FRAMING_BOUNDS_NEAR_EDGE",
            "warning",
            "The requested framing fits but approaches the frame edge.",
            [activeCamera.id, target.id],
            {
              cameraId: activeCamera.id,
              subjectEntityId: target.id,
              evidence,
            },
            target.kind === "actor",
          ),
        );
      }

      if (target.kind === "actor") {
        const dimensions = resolveActorProjection(scene, target).dimensions;
        const localUp = rotateVector(
          [
            0,
            dimensions.heightM * target.transform.scale[1] * 0.08,
            0,
          ],
          target.transform.rotation,
        );
        const headTop = projectPoint(
          activeCamera,
          addVectors(
            actorAnchorWorldPoint(scene, target, "head"),
            localUp,
          ),
          aspect,
        );
        const eyeLine = projectPoint(
          activeCamera,
          actorAnchorWorldPoint(scene, target, "face"),
          aspect,
        );
        const headroomFraction = clamp01((1 - headTop.ndcY) / 2);
        framingState.evidence.push(
          `${target.id} headroom ${(headroomFraction * 100).toFixed(1)}%; eyeline NDC y=${eyeLine.ndcY.toFixed(2)}`,
        );
        if (headTop.ndcY > 0.9) {
          addIssue(
            framingState,
            issue(
              "framing",
              "HEADROOM_INSUFFICIENT",
              headTop.ndcY > 1 ? "error" : "warning",
              "The actor has insufficient headroom.",
              [activeCamera.id, target.id],
              {
                cameraId: activeCamera.id,
                subjectEntityId: target.id,
                evidence: `Headroom ${(headroomFraction * 100).toFixed(1)}%.`,
              },
              true,
            ),
          );
        }
        if (eyeLine.ndcY < -0.2 || eyeLine.ndcY > 0.75) {
          addIssue(
            framingState,
            issue(
              "framing",
              "EYELINE_OUTSIDE_GUIDE",
              "warning",
              "The actor eyeline falls outside the broad composition guide.",
              [activeCamera.id, target.id],
              {
                cameraId: activeCamera.id,
                subjectEntityId: target.id,
                evidence: `Eyeline NDC y=${eyeLine.ndcY.toFixed(2)}.`,
              },
              true,
            ),
          );
        }
      }
    }
  }

  const captionZone = scene.compositionGoals?.captionZone;
  const sideUiZone = scene.compositionGoals?.sideUiZone;
  if (activeCamera && captionState.required) {
    const reservedTargets =
      analysisTargets.length > 0 ? analysisTargets : [];
    if (reservedTargets.length > 0) {
      captionState.checked = true;
    }
    for (const target of reservedTargets) {
      if (!target.visible) {
        continue;
      }
      const bounds = projectBounds(
        activeCamera,
        entityFullBoundsPoints(scene, target),
        aspect,
      );
      captionState.approximate ||= target.kind === "actor";
      if (!bounds) {
        addIssue(
          captionState,
          issue(
            "caption",
            "RESERVED_ZONE_TARGET_UNPROJECTABLE",
            "warning",
            "A reserved-zone target cannot be projected.",
            [activeCamera.id, target.id],
            {
              cameraId: activeCamera.id,
              subjectEntityId: target.id,
            },
            target.kind === "actor",
          ),
        );
        continue;
      }
      captionState.evidence.push(boundsEvidence(target.id, bounds));
      if (captionZone) {
        const captionTopNdc = -1 + captionZone.bottomFraction * 2;
        captionState.evidence.push(
          `Caption zone occupies bottom ${(captionZone.bottomFraction * 100).toFixed(0)}% (top NDC y=${captionTopNdc.toFixed(2)}).`,
        );
        if (bounds.minY < captionTopNdc) {
          addIssue(
            captionState,
            issue(
              "caption",
              "SUBJECT_OVERLAPS_CAPTION_ZONE",
              "warning",
              "A critical actor or prop overlaps the bottom caption zone.",
              [activeCamera.id, target.id],
              {
                cameraId: activeCamera.id,
                subjectEntityId: target.id,
                evidence: `${target.id} minimum NDC y=${bounds.minY.toFixed(2)}; caption top=${captionTopNdc.toFixed(2)}.`,
              },
              target.kind === "actor",
            ),
          );
        }
      }
      if (sideUiZone) {
        const leftEdge = -1 + sideUiZone.widthFraction * 2;
        const rightEdge = 1 - sideUiZone.widthFraction * 2;
        const overlapsLeft =
          (sideUiZone.side === "left" || sideUiZone.side === "both") &&
          bounds.minX < leftEdge;
        const overlapsRight =
          (sideUiZone.side === "right" || sideUiZone.side === "both") &&
          bounds.maxX > rightEdge;
        captionState.evidence.push(
          `Side UI ${sideUiZone.side} occupies ${(sideUiZone.widthFraction * 100).toFixed(0)}% of each configured side.`,
        );
        if (overlapsLeft || overlapsRight) {
          addIssue(
            captionState,
            issue(
              "caption",
              "SUBJECT_OVERLAPS_SIDE_UI_ZONE",
              "warning",
              "A critical actor or prop overlaps the side UI zone.",
              [activeCamera.id, target.id],
              {
                cameraId: activeCamera.id,
                subjectEntityId: target.id,
                evidence: boundsEvidence(target.id, bounds),
              },
              target.kind === "actor",
            ),
          );
        }
      }
    }
  }

  if (activeCamera && occlusionState.required) {
    occlusionState.checked = true;
    occlusionState.approximate = true;
    occlusionState.evidence.push(
      "Occlusion uses conservative projected actor/prop proxy volumes and requires visual confirmation.",
    );
    const supportSurfaceBySubject = new Map<string, Set<string>>();
    for (const constraint of scene.constraints) {
      if (
        constraint.type === "ground-contact" &&
        constraint.enabled &&
        constraint.surfaceEntityId !== null
      ) {
        const surfaces =
          supportSurfaceBySubject.get(constraint.entityId) ?? new Set<string>();
        surfaces.add(constraint.surfaceEntityId);
        supportSurfaceBySubject.set(constraint.entityId, surfaces);
      }
    }

    for (const subject of analysisTargets) {
      if (!subject.visible) {
        continue;
      }
      const subjectProxy = createOcclusionProxy(scene, subject);
      const projectedSubject = subjectProxy
        ? projectProxy(activeCamera, subjectProxy, aspect)
        : null;
      if (!subjectProxy || !projectedSubject) {
        continue;
      }
      const activeConstraint = activeVisibilityConstraints.find(
        (constraint) => constraint.subjectEntityId === subject.id,
      );
      const anchorPosition = activeConstraint
        ? resolveAnchor(scene, subject, activeConstraint.anchor)
        : subjectProxy.center;
      for (const candidate of scene.entities) {
        if (
          candidate.id === subject.id ||
          !candidate.visible ||
          (candidate.kind !== "actor" && candidate.kind !== "prop") ||
          supportSurfaceBySubject.get(subject.id)?.has(candidate.id)
        ) {
          continue;
        }
        const candidateProxy = createOcclusionProxy(scene, candidate);
        const projectedCandidate = candidateProxy
          ? projectProxy(activeCamera, candidateProxy, aspect)
          : null;
        if (
          !candidateProxy ||
          !projectedCandidate ||
          projectedCandidate.depthM >= projectedSubject.depthM
        ) {
          continue;
        }
        const ratio = projectedOverlapRatio(
          projectedSubject.bounds,
          projectedCandidate.bounds,
        );
        const anchorBlocked =
          activeConstraint !== undefined &&
          proxyIntersectsSightline(
            activeCamera.transform.positionM,
            anchorPosition,
            candidateProxy,
            activeCamera.lens.nearM,
          );
        if (
          activeConstraint !== undefined
            ? !anchorBlocked
            : ratio < OCCLUSION_CHECK_RATIO
        ) {
          continue;
        }
        const roundedRatio = Number(ratio.toFixed(3));
        const evidence =
          `${subject.id} approximate projected occlusion ${(ratio * 100).toFixed(1)}% by ${candidate.id}.`;
        addIssue(
          occlusionState,
          issue(
            "occlusion",
            anchorBlocked
              ? "ANCHOR_OCCLUDED_APPROXIMATE"
              : "SUBJECT_OCCLUDED_APPROXIMATE",
            "warning",
            "A critical subject may be obscured by an approximate actor/prop proxy.",
            [activeCamera.id, subject.id, candidate.id],
            {
              constraintId: activeConstraint?.id,
              cameraId: activeCamera.id,
              subjectEntityId: subject.id,
              occluderEntityId: candidate.id,
              occlusionRatio: roundedRatio,
              evidence,
            },
            true,
          ),
        );
      }
    }
  }

  const rooms = scene.entities
    .map(roomProxy)
    .filter((room): room is RoomProxy => room !== null);
  const sightlineSpatialWalls = spatialWallProxies(scene, "sight");
  const collisionSpatialWalls = spatialWallProxies(scene, "passage");
  if (activeCamera && topologyState.required) {
    if (rooms.length === 0 && scene.spatialLayout === null) {
      addIssue(
        topologyState,
        issue(
          "topology",
          "TOPOLOGY_ENVIRONMENT_UNAVAILABLE",
          "warning",
          "No supported visible room is available for topology checks.",
          [activeCamera.id],
          { cameraId: activeCamera.id },
        ),
      );
    } else {
      topologyState.checked = true;
      for (const target of analysisTargets) {
        if (!target.visible) {
          continue;
        }
        const targetPoint =
          target.kind === "actor"
            ? actorAnchorWorldPoint(scene, target, "chest")
            : target.transform.positionM;
        for (const room of rooms) {
          const targetLocal = worldToLocalPoint(room.transform, targetPoint);
          if (!insideRoomVolume(targetLocal, room)) {
            addIssue(
              topologyState,
              issue(
                "topology",
                "CRITICAL_ENTITY_OUTSIDE_ROOM",
                "warning",
                "A critical actor or prop center lies outside the room volume.",
                [room.entityId, target.id],
                {
                  cameraId: activeCamera.id,
                  subjectEntityId: target.id,
                  evidence: `${target.id} room-local center (${targetLocal.map((value) => value.toFixed(2)).join(", ")}).`,
                },
              ),
            );
          }
          const cameraLocal = worldToLocalPoint(
            room.transform,
            activeCamera.transform.positionM,
          );
          const sightlineWalls = roomWalls(room).slice(1);
          if (
            sightlineWalls.some((wall) =>
              segmentIntersectsAabb(cameraLocal, targetLocal, wall),
            )
          ) {
            addIssue(
              topologyState,
              issue(
                "topology",
                "SIGHTLINE_INTERSECTS_WALL",
                "error",
                "The active-camera sightline to a critical target crosses a room wall.",
                [activeCamera.id, room.entityId, target.id],
                {
                  cameraId: activeCamera.id,
                  subjectEntityId: target.id,
                  evidence: `${activeCamera.id} to ${target.id} intersects ${room.entityId}.`,
                },
              ),
            );
          }
        }
        if (scene.spatialLayout !== null) {
          const membership = scene.spatialLayout.memberships.find(
            (candidate) => candidate.entityId === target.id,
          );
          const region = membership
            ? scene.spatialLayout.regions.find(
                (candidate) => candidate.id === membership.regionId,
              )
            : undefined;
          if (!membership || !region) {
            addIssue(
              topologyState,
              issue(
                "topology",
                "CRITICAL_ENTITY_REGION_UNASSIGNED",
                "warning",
                "A critical actor or prop has no valid region membership.",
                [target.id],
                {
                  cameraId: activeCamera.id,
                  subjectEntityId: target.id,
                },
              ),
            );
          } else if (
            !pointInsideSpatialRegion(
              targetPoint,
              scene.spatialLayout.floorY,
              region,
            )
          ) {
            addIssue(
              topologyState,
              issue(
                "topology",
                "CRITICAL_ENTITY_OUTSIDE_REGION",
                "warning",
                "A critical actor or prop center lies outside its assigned region.",
                [region.id, target.id],
                {
                  cameraId: activeCamera.id,
                  subjectEntityId: target.id,
                  evidence: `${target.id} is outside ${region.id}.`,
                },
              ),
            );
          }
          for (const wall of sightlineSpatialWalls) {
            const cameraLocal = worldToLocalPoint(
              wall.transform,
              activeCamera.transform.positionM,
            );
            const targetLocal = worldToLocalPoint(
              wall.transform,
              targetPoint,
            );
            if (
              segmentIntersectsAabb(
                cameraLocal,
                targetLocal,
                wall.bounds,
              )
            ) {
              addIssue(
                topologyState,
                issue(
                  "topology",
                  "SIGHTLINE_INTERSECTS_WALL",
                  "error",
                  "The active-camera sightline to a critical target crosses a spatial boundary.",
                  [activeCamera.id, wall.boundaryId, target.id],
                  {
                    cameraId: activeCamera.id,
                    subjectEntityId: target.id,
                    evidence: `${activeCamera.id} to ${target.id} intersects ${wall.boundaryId}.`,
                  },
                ),
              );
              break;
            }
          }
        }
      }
    }
  }

  if (activeCamera) {
    for (const room of rooms) {
      const cameraLocal = worldToLocalPoint(
        room.transform,
        activeCamera.transform.positionM,
      );
      if (roomWalls(room).some((wall) => pointInsideAabb(cameraLocal, wall))) {
        addIssue(
          cameraCollisionState,
          issue(
            "cameraCollision",
            "CAMERA_COLLIDES_WALL",
            "error",
            "The active camera is inside a room wall or floor slab.",
            [activeCamera.id, room.entityId],
            {
              cameraId: activeCamera.id,
              evidence: `${activeCamera.id} room-local position (${cameraLocal.map((value) => value.toFixed(2)).join(", ")}).`,
            },
          ),
        );
      }
    }
    for (const wall of collisionSpatialWalls) {
      const cameraLocal = worldToLocalPoint(
        wall.transform,
        activeCamera.transform.positionM,
      );
      if (pointInsideAabb(cameraLocal, wall.bounds)) {
        addIssue(
          cameraCollisionState,
          issue(
            "cameraCollision",
            "CAMERA_COLLIDES_WALL",
            "error",
            "The active camera is inside a spatial boundary.",
            [activeCamera.id, wall.boundaryId],
            {
              cameraId: activeCamera.id,
              evidence: `${activeCamera.id} intersects ${wall.boundaryId}.`,
            },
          ),
        );
      }
    }
    for (const entity of scene.entities) {
      if (entity.kind !== "actor" || !entity.visible) {
        continue;
      }
      const bounds = actorVisibleRigBounds(scene, entity);
      if (
        pointInsideAabb(activeCamera.transform.positionM, {
          min: bounds.minWorld,
          max: bounds.maxWorld,
        })
      ) {
        addIssue(
          cameraCollisionState,
          issue(
            "cameraCollision",
            "CAMERA_INSIDE_ACTOR_PROXY",
            "error",
            "The active camera is inside a visible actor AABB proxy and requires visual confirmation.",
            [activeCamera.id, entity.id],
            {
              cameraId: activeCamera.id,
              occluderEntityId: entity.id,
              evidence: `${activeCamera.id} is inside the visible proxy for ${entity.id}.`,
            },
            true,
          ),
        );
      }
    }
    for (const entity of scene.entities) {
      if (entity.kind !== "prop" || !entity.visible) {
        continue;
      }
      const collision = cameraInsideProp(
        activeCamera.transform.positionM,
        entity,
      );
      cameraCollisionState.approximate ||= collision.approximate;
      if (collision.inside) {
        addIssue(
          cameraCollisionState,
          issue(
            "cameraCollision",
            "CAMERA_INSIDE_PROP",
            "error",
            "The active camera is inside a visible prop volume.",
            [activeCamera.id, entity.id],
            {
              cameraId: activeCamera.id,
              occluderEntityId: entity.id,
              evidence: `${activeCamera.id} is inside ${entity.id}.`,
            },
            collision.approximate,
          ),
        );
      }
    }
  }

  const anchorSafe = finalizeCheck(anchorState);
  const framingSafe = finalizeCheck(framingState);
  const captionSafe = finalizeCheck(captionState);
  const occlusionSafe = finalizeCheck(occlusionState);
  const topologySafe = finalizeCheck(topologyState);
  const cameraCollisionSafe = finalizeCheck(cameraCollisionState);
  const categoryResults = [
    anchorSafe,
    framingSafe,
    captionSafe,
    occlusionSafe,
    topologySafe,
    cameraCollisionSafe,
  ];
  allIssues.push(
    ...anchorState.issues,
    ...framingState.issues,
    ...captionState.issues,
    ...occlusionState.issues,
    ...topologyState.issues,
    ...cameraCollisionState.issues,
  );

  const meaningfulCompositionRequired =
    anchorSafe.required ||
    framingSafe.required ||
    captionSafe.required ||
    occlusionSafe.required ||
    topologySafe.required;
  const requiredResults = categoryResults.filter((result) => result.required);
  const overallStatus: CompositionReport["overallStatus"] =
    requiredResults.some((result) => result.status === "fail")
      ? "fail"
      : !meaningfulCompositionRequired
        ? "unchecked"
        : requiredResults.some((result) => result.status === "unchecked")
          ? "check"
          : requiredResults.some(
                (result) =>
                  result.status === "check" || result.approximate,
              )
            ? "check"
            : "safe";

  return {
    status: allIssues.length === 0 ? "safe" : "warning",
    overallStatus,
    activeCameraId: scene.activeCameraId,
    anchorSafe,
    framingSafe,
    captionSafe,
    occlusionSafe,
    topologySafe,
    cameraCollisionSafe,
    issues: allIssues,
  };
};
