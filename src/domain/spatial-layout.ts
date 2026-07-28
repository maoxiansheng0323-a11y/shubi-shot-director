import { z } from "zod";
import {
  entityIdSchema,
  finiteNumberSchema,
  positiveFiniteNumberSchema,
} from "./schema-primitives";

export const xzSchema = z.tuple([
  finiteNumberSchema,
  finiteNumberSchema,
]);

const cross2d = (a: XzPoint, b: XzPoint, c: XzPoint): number =>
  (b[0] - a[0]) * (c[1] - a[1]) -
  (b[1] - a[1]) * (c[0] - a[0]);

const pointOnSegment = (
  point: XzPoint,
  start: XzPoint,
  end: XzPoint,
): boolean =>
  Math.abs(cross2d(start, end, point)) < 1e-8 &&
  point[0] >= Math.min(start[0], end[0]) - 1e-8 &&
  point[0] <= Math.max(start[0], end[0]) + 1e-8 &&
  point[1] >= Math.min(start[1], end[1]) - 1e-8 &&
  point[1] <= Math.max(start[1], end[1]) + 1e-8;

const segmentsIntersect = (
  aStart: XzPoint,
  aEnd: XzPoint,
  bStart: XzPoint,
  bEnd: XzPoint,
): boolean => {
  const abStart = cross2d(aStart, aEnd, bStart);
  const abEnd = cross2d(aStart, aEnd, bEnd);
  const baStart = cross2d(bStart, bEnd, aStart);
  const baEnd = cross2d(bStart, bEnd, aEnd);

  if (
    ((abStart > 0 && abEnd < 0) || (abStart < 0 && abEnd > 0)) &&
    ((baStart > 0 && baEnd < 0) || (baStart < 0 && baEnd > 0))
  ) {
    return true;
  }

  return (
    (Math.abs(abStart) < 1e-8 && pointOnSegment(bStart, aStart, aEnd)) ||
    (Math.abs(abEnd) < 1e-8 && pointOnSegment(bEnd, aStart, aEnd)) ||
    (Math.abs(baStart) < 1e-8 && pointOnSegment(aStart, bStart, bEnd)) ||
    (Math.abs(baEnd) < 1e-8 && pointOnSegment(aEnd, bStart, bEnd))
  );
};

const footprintSelfIntersects = (points: XzPoint[]): boolean => {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          points[first],
          points[firstNext],
          points[second],
          points[secondNext],
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

const footprintSignedArea = (points: XzPoint[]): number =>
  points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;

const pointOnFootprintEdge = (
  point: XzPoint,
  footprint: XzPoint[],
): boolean =>
  footprint.some((start, index) =>
    pointOnSegment(point, start, footprint[(index + 1) % footprint.length]),
  );

export const spatialRegionSchema = z
  .object({
    id: entityIdSchema,
    label: z.string().min(1).max(80),
    footprintXZ: z.array(xzSchema).min(3).max(32),
    heightM: positiveFiniteNumberSchema.min(0.2).max(100),
    visible: z.boolean(),
  })
  .strict()
  .superRefine((region, context) => {
    if (Math.abs(footprintSignedArea(region.footprintXZ)) < 1e-8) {
      context.addIssue({
        code: "custom",
        message: `Zero-area region footprint: ${region.id}`,
        path: ["footprintXZ"],
      });
    }
    if (footprintSelfIntersects(region.footprintXZ)) {
      context.addIssue({
        code: "custom",
        message: `Self-intersecting region footprint: ${region.id}`,
        path: ["footprintXZ"],
      });
    }
  });

export const spatialBoundarySchema = z
  .object({
    id: entityIdSchema,
    label: z.string().min(1).max(80),
    regionIds: z.union([
      z.tuple([entityIdSchema]),
      z.tuple([entityIdSchema, entityIdSchema]),
    ]),
    startXZ: xzSchema,
    endXZ: xzSchema,
    heightM: positiveFiniteNumberSchema.min(0.2).max(100),
    thicknessM: positiveFiniteNumberSchema.min(0.01).max(10),
    visible: z.boolean(),
  })
  .strict();

export const spatialOpeningSchema = z
  .object({
    id: entityIdSchema,
    label: z.string().min(1).max(80),
    boundaryId: entityIdSchema,
    offsetM: finiteNumberSchema.nonnegative(),
    widthM: positiveFiniteNumberSchema.min(0.01).max(100),
    bottomM: finiteNumberSchema.nonnegative(),
    heightM: positiveFiniteNumberSchema.min(0.01).max(100),
    visible: z.boolean(),
  })
  .strict();

export const spatialConnectionSchema = z
  .object({
    id: entityIdSchema,
    label: z.string().min(1).max(80),
    regionIds: z.tuple([entityIdSchema, entityIdSchema]),
    openingId: entityIdSchema,
    allowsPassage: z.boolean(),
    allowsSight: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();

export const entityRegionMembershipSchema = z
  .object({
    entityId: entityIdSchema,
    regionId: entityIdSchema,
  })
  .strict();

export const spatialLayoutSchema = z
  .object({
    floorY: finiteNumberSchema.min(-1000).max(1000),
    regions: z.array(spatialRegionSchema).min(1).max(64),
    boundaries: z.array(spatialBoundarySchema).max(256),
    openings: z.array(spatialOpeningSchema).max(256),
    connections: z.array(spatialConnectionSchema).max(256),
    memberships: z.array(entityRegionMembershipSchema).max(256),
  })
  .strict()
  .superRefine((layout, context) => {
    const seenSpatialIds = new Set<string>();
    const spatialCollections = [
      ["regions", layout.regions],
      ["boundaries", layout.boundaries],
      ["openings", layout.openings],
      ["connections", layout.connections],
    ] as const;
    for (const [collectionName, values] of spatialCollections) {
      for (const [valueIndex, value] of values.entries()) {
        if (seenSpatialIds.has(value.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate spatial id: ${value.id}`,
            path: [collectionName, valueIndex, "id"],
          });
        }
        seenSpatialIds.add(value.id);
      }
    }

    const regionById = new Map(
      layout.regions.map((region) => [region.id, region] as const),
    );
    const boundaryById = new Map(
      layout.boundaries.map((boundary) => [boundary.id, boundary] as const),
    );
    const openingById = new Map(
      layout.openings.map((opening) => [opening.id, opening] as const),
    );

    for (const [boundaryIndex, boundary] of layout.boundaries.entries()) {
      if (
        boundary.regionIds.length === 2 &&
        boundary.regionIds[0] === boundary.regionIds[1]
      ) {
        context.addIssue({
          code: "custom",
          message: `Boundary region ids must be distinct: ${boundary.id}`,
          path: ["boundaries", boundaryIndex, "regionIds"],
        });
      }
      if (
        Math.hypot(
          boundary.endXZ[0] - boundary.startXZ[0],
          boundary.endXZ[1] - boundary.startXZ[1],
        ) <
        1e-8
      ) {
        context.addIssue({
          code: "custom",
          message: `Zero-length boundary: ${boundary.id}`,
          path: ["boundaries", boundaryIndex],
        });
      }
      for (const regionId of boundary.regionIds) {
        const region = regionById.get(regionId);
        if (!region) {
          context.addIssue({
            code: "custom",
            message: `Boundary references missing region: ${regionId}`,
            path: ["boundaries", boundaryIndex, "regionIds"],
          });
          continue;
        }
        if (
          !pointOnFootprintEdge(boundary.startXZ, region.footprintXZ) ||
          !pointOnFootprintEdge(boundary.endXZ, region.footprintXZ)
        ) {
          context.addIssue({
            code: "custom",
            message: `Boundary endpoint is not on region footprint: ${boundary.id}`,
            path: ["boundaries", boundaryIndex],
          });
        }
      }
    }

    for (const [openingIndex, opening] of layout.openings.entries()) {
      const boundary = boundaryById.get(opening.boundaryId);
      if (!boundary) {
        context.addIssue({
          code: "custom",
          message: `Opening references missing boundary: ${opening.boundaryId}`,
          path: ["openings", openingIndex, "boundaryId"],
        });
        continue;
      }
      const boundaryLength = Math.hypot(
        boundary.endXZ[0] - boundary.startXZ[0],
        boundary.endXZ[1] - boundary.startXZ[1],
      );
      if (
        opening.offsetM + opening.widthM > boundaryLength + 1e-8 ||
        opening.bottomM + opening.heightM > boundary.heightM + 1e-8
      ) {
        context.addIssue({
          code: "custom",
          message: `Opening extends past boundary: ${opening.id}`,
          path: ["openings", openingIndex],
        });
      }
    }

    for (let first = 0; first < layout.openings.length; first += 1) {
      const firstOpening = layout.openings[first];
      for (
        let second = first + 1;
        second < layout.openings.length;
        second += 1
      ) {
        const secondOpening = layout.openings[second];
        if (firstOpening.boundaryId !== secondOpening.boundaryId) {
          continue;
        }
        const horizontalOverlap =
          Math.max(firstOpening.offsetM, secondOpening.offsetM) <
          Math.min(
            firstOpening.offsetM + firstOpening.widthM,
            secondOpening.offsetM + secondOpening.widthM,
          ) -
            1e-8;
        const verticalOverlap =
          Math.max(firstOpening.bottomM, secondOpening.bottomM) <
          Math.min(
            firstOpening.bottomM + firstOpening.heightM,
            secondOpening.bottomM + secondOpening.heightM,
          ) -
            1e-8;
        if (horizontalOverlap && verticalOverlap) {
          context.addIssue({
            code: "custom",
            message: `Overlapping openings: ${firstOpening.id}, ${secondOpening.id}`,
            path: ["openings", second],
          });
        }
      }
    }

    for (const [connectionIndex, connection] of layout.connections.entries()) {
      if (connection.regionIds[0] === connection.regionIds[1]) {
        context.addIssue({
          code: "custom",
          message: `Connection region ids must be distinct: ${connection.id}`,
          path: ["connections", connectionIndex, "regionIds"],
        });
      }
      const opening = openingById.get(connection.openingId);
      const boundary = opening
        ? boundaryById.get(opening.boundaryId)
        : undefined;
      if (!opening || !boundary) {
        context.addIssue({
          code: "custom",
          message: `Connection references missing opening: ${connection.openingId}`,
          path: ["connections", connectionIndex, "openingId"],
        });
        continue;
      }
      const connectionRegions = new Set(connection.regionIds);
      const boundaryRegions = new Set(boundary.regionIds);
      if (
        connectionRegions.size !== 2 ||
        boundaryRegions.size !== 2 ||
        [...connectionRegions].some(
          (regionId) => !boundaryRegions.has(regionId),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `Connection regions do not match opening boundary: ${connection.id}`,
          path: ["connections", connectionIndex, "regionIds"],
        });
      }
    }

    const membershipEntityIds = new Set<string>();
    for (const [membershipIndex, membership] of layout.memberships.entries()) {
      if (membershipEntityIds.has(membership.entityId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate region membership: ${membership.entityId}`,
          path: ["memberships", membershipIndex, "entityId"],
        });
      }
      membershipEntityIds.add(membership.entityId);
      if (!regionById.has(membership.regionId)) {
        context.addIssue({
          code: "custom",
          message: `Membership references missing region: ${membership.regionId}`,
          path: ["memberships", membershipIndex, "regionId"],
        });
      }
    }
  });

export const spatialAdjacency = (
  layout: SpatialLayout,
): Map<string, Set<string>> => {
  const adjacency = new Map(
    layout.regions.map((region) => [region.id, new Set<string>()] as const),
  );
  for (const connection of layout.connections) {
    if (!connection.enabled) {
      continue;
    }
    const [firstRegionId, secondRegionId] = connection.regionIds;
    adjacency.get(firstRegionId)?.add(secondRegionId);
    adjacency.get(secondRegionId)?.add(firstRegionId);
  }
  return adjacency;
};

export interface SpatialLayoutBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export const spatialLayoutBounds = (
  layout: SpatialLayout,
): SpatialLayoutBounds => {
  const points = layout.regions.flatMap((region) => region.footprintXZ);
  const maxHeight = Math.max(
    ...layout.regions.map((region) => region.heightM),
  );
  return {
    min: [
      Math.min(...points.map(([x]) => x)),
      layout.floorY,
      Math.min(...points.map(([, z]) => z)),
    ],
    max: [
      Math.max(...points.map(([x]) => x)),
      layout.floorY + maxHeight,
      Math.max(...points.map(([, z]) => z)),
    ],
  };
};

interface WallRectangle {
  startM: number;
  endM: number;
  bottomM: number;
  topM: number;
}

export interface SpatialWallBox {
  boundaryId: string;
  regionIds: SpatialBoundary["regionIds"];
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

const rounded = (value: number): number =>
  Math.round(value * 1_000_000_000) / 1_000_000_000;

const subtractOpening = (
  rectangle: WallRectangle,
  opening: SpatialOpening,
): WallRectangle[] => {
  const openingEnd = opening.offsetM + opening.widthM;
  const openingTop = opening.bottomM + opening.heightM;
  const overlapStart = Math.max(rectangle.startM, opening.offsetM);
  const overlapEnd = Math.min(rectangle.endM, openingEnd);
  const overlapBottom = Math.max(rectangle.bottomM, opening.bottomM);
  const overlapTop = Math.min(rectangle.topM, openingTop);
  if (overlapStart >= overlapEnd || overlapBottom >= overlapTop) {
    return [rectangle];
  }

  return [
    {
      ...rectangle,
      endM: overlapStart,
    },
    {
      ...rectangle,
      startM: overlapEnd,
    },
    {
      startM: overlapStart,
      endM: overlapEnd,
      bottomM: rectangle.bottomM,
      topM: overlapBottom,
    },
    {
      startM: overlapStart,
      endM: overlapEnd,
      bottomM: overlapTop,
      topM: rectangle.topM,
    },
  ].filter(
    (candidate) =>
      candidate.endM - candidate.startM > 1e-8 &&
      candidate.topM - candidate.bottomM > 1e-8,
  );
};

export const deriveBoundaryWallBoxes = (
  layout: SpatialLayout,
  boundary: SpatialBoundary,
  openingCutsWall: (opening: SpatialOpening) => boolean = () => true,
): SpatialWallBox[] => {
  if (!boundary.visible) {
    return [];
  }
  const deltaX = boundary.endXZ[0] - boundary.startXZ[0];
  const deltaZ = boundary.endXZ[1] - boundary.startXZ[1];
  const length = Math.hypot(deltaX, deltaZ);
  const directionX = deltaX / length;
  const directionZ = deltaZ / length;
  const openings = layout.openings
    .filter(
      (opening) =>
        opening.boundaryId === boundary.id &&
        opening.visible &&
        openingCutsWall(opening),
    )
    .sort((first, second) => first.offsetM - second.offsetM);

  let rectangles: WallRectangle[] = [
    {
      startM: 0,
      endM: length,
      bottomM: 0,
      topM: boundary.heightM,
    },
  ];
  for (const opening of openings) {
    rectangles = rectangles.flatMap((rectangle) =>
      subtractOpening(rectangle, opening),
    );
  }

  return rectangles.map((rectangle) => {
    const centerM = (rectangle.startM + rectangle.endM) / 2;
    const centerHeightM = (rectangle.bottomM + rectangle.topM) / 2;
    return {
      boundaryId: boundary.id,
      regionIds: boundary.regionIds,
      position: [
        rounded(boundary.startXZ[0] + directionX * centerM),
        rounded(layout.floorY + centerHeightM),
        rounded(boundary.startXZ[1] + directionZ * centerM),
      ],
      size: [
        rounded(rectangle.endM - rectangle.startM),
        rounded(rectangle.topM - rectangle.bottomM),
        boundary.thicknessM,
      ],
      rotationY: Math.atan2(-directionZ, directionX),
    };
  });
};

export type XzPoint = z.infer<typeof xzSchema>;
export type SpatialRegion = z.infer<typeof spatialRegionSchema>;
export type SpatialBoundary = z.infer<typeof spatialBoundarySchema>;
export type SpatialOpening = z.infer<typeof spatialOpeningSchema>;
export type SpatialConnection = z.infer<typeof spatialConnectionSchema>;
export type EntityRegionMembership = z.infer<
  typeof entityRegionMembershipSchema
>;
export type SpatialLayout = z.infer<typeof spatialLayoutSchema>;
