import { deflateSync } from "node:zlib";
import {
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import {
  type AnyActorEntity,
  type CameraEntity,
  type QuaternionTuple,
  type SceneEntity,
  type SceneSpec,
  type TransformSpec,
  type Vec3,
} from "../src/domain/scene-schema";
import {
  resolveActorProjection,
  type ActorProjectionPrimitive,
} from "../src/domain/actor-projection";
import { parseSceneSpecInput } from "../src/domain/scene-migrations";
import { deriveBoundaryWallBoxes } from "../src/domain/spatial-layout";

export class SoftwarePngError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SoftwarePngError";
    this.code = code;
  }
}

export interface SoftwarePngResult {
  png: Buffer;
  warnings: string[];
  diagnostics: {
    actorPrimitiveIds: Record<string, string[]>;
  };
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface Stroke {
  start: ProjectedPoint;
  end: ProjectedPoint;
  color: readonly [number, number, number, number];
  thickness: number;
}

interface Disc {
  center: ProjectedPoint;
  radius: number;
  color: readonly [number, number, number, number];
}

const identityQuaternion: QuaternionTuple = [0, 0, 0, 1];

const quaternion = (
  value: QuaternionTuple | undefined,
): Quaternion =>
  value === undefined
    ? new Quaternion()
    : new Quaternion(value[0], value[1], value[2], value[3]);

const transformMatrix = (transform: TransformSpec): Matrix4 =>
  new Matrix4().compose(
    new Vector3(...transform.positionM),
    quaternion(transform.rotation),
    new Vector3(...transform.scale),
  );

const localMatrix = (
  position: Vec3,
  rotation: QuaternionTuple = identityQuaternion,
): Matrix4 =>
  new Matrix4().compose(
    new Vector3(...position),
    quaternion(rotation),
    new Vector3(1, 1, 1),
  );

const pointFromMatrix = (
  matrix: Matrix4,
  point: Vec3 = [0, 0, 0],
): Vector3 => new Vector3(...point).applyMatrix4(matrix);

const hexColor = (
  source: string,
  alpha = 255,
): readonly [number, number, number, number] => {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(source)
    ? source.slice(1)
    : "aeb7c2";
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  ];
};

const blendPixel = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
): void => {
  const pixelX = Math.round(x);
  const pixelY = Math.round(y);
  if (
    pixelX < 0 ||
    pixelY < 0 ||
    pixelX >= width ||
    pixelY >= height
  ) {
    return;
  }
  const offset = (pixelY * width + pixelX) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  pixels[offset] = Math.round(color[0] * alpha + pixels[offset] * inverse);
  pixels[offset + 1] = Math.round(
    color[1] * alpha + pixels[offset + 1] * inverse,
  );
  pixels[offset + 2] = Math.round(
    color[2] * alpha + pixels[offset + 2] * inverse,
  );
  pixels[offset + 3] = 255;
};

const drawDisc = (
  pixels: Uint8Array,
  width: number,
  height: number,
  disc: Disc,
): void => {
  const radius = Math.max(1, Math.min(64, disc.radius));
  const left = Math.floor(disc.center.x - radius);
  const right = Math.ceil(disc.center.x + radius);
  const top = Math.floor(disc.center.y - radius);
  const bottom = Math.ceil(disc.center.y + radius);
  const radiusSquared = radius * radius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x - disc.center.x;
      const dy = y - disc.center.y;
      if (dx * dx + dy * dy <= radiusSquared) {
        blendPixel(pixels, width, height, x, y, disc.color);
      }
    }
  }
};

const drawStroke = (
  pixels: Uint8Array,
  width: number,
  height: number,
  stroke: Stroke,
): void => {
  const deltaX = stroke.end.x - stroke.start.x;
  const deltaY = stroke.end.y - stroke.start.y;
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY))),
  );
  const radius = Math.max(0.75, stroke.thickness / 2);
  for (let index = 0; index <= steps; index += 1) {
    const amount = index / steps;
    drawDisc(pixels, width, height, {
      center: {
        x: stroke.start.x + deltaX * amount,
        y: stroke.start.y + deltaY * amount,
        depth:
          stroke.start.depth +
          (stroke.end.depth - stroke.start.depth) * amount,
      },
      radius,
      color: stroke.color,
    });
  }
};

const fillBackground = (
  pixels: Uint8Array,
  width: number,
  height: number,
): void => {
  for (let y = 0; y < height; y += 1) {
    const shade = Math.round(18 + (y / Math.max(1, height - 1)) * 16);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = shade;
      pixels[offset + 1] = shade + 4;
      pixels[offset + 2] = shade + 10;
      pixels[offset + 3] = 255;
    }
  }
};

const createWorldMatrices = (
  scene: SceneSpec,
): Map<string, Matrix4> => {
  const entityById = new Map(
    scene.entities.map((entity) => [entity.id, entity] as const),
  );
  const matrices = new Map<string, Matrix4>();
  const resolving = new Set<string>();

  const resolve = (entity: SceneEntity): Matrix4 => {
    const cached = matrices.get(entity.id);
    if (cached) {
      return cached;
    }
    if (resolving.has(entity.id)) {
      return transformMatrix(entity.transform);
    }
    resolving.add(entity.id);
    const local = transformMatrix(entity.transform);
    const world =
      entity.parentId === null
        ? local
        : resolve(entityById.get(entity.parentId) ?? entity)
            .clone()
            .multiply(local);
    resolving.delete(entity.id);
    matrices.set(entity.id, world);
    return world;
  };

  for (const entity of scene.entities) {
    resolve(entity);
  }
  return matrices;
};

const createProjector = (
  camera: CameraEntity,
  cameraWorldMatrix: Matrix4,
  width: number,
  height: number,
): {
  project: (point: Vector3) => ProjectedPoint | null;
  cameraRight: Vector3;
} => {
  const cameraPosition = new Vector3();
  const cameraRotation = new Quaternion();
  const cameraScale = new Vector3();
  cameraWorldMatrix.decompose(
    cameraPosition,
    cameraRotation,
    cameraScale,
  );
  const inverseRotation = cameraRotation.clone().invert();
  const aspect = width / height;
  const horizontalHalfTangent =
    camera.lens.sensorWidthMm /
    (2 * camera.lens.focalLengthMm);
  const verticalHalfTangent = horizontalHalfTangent / aspect;

  return {
    project: (point) => {
      const local = point
        .clone()
        .sub(cameraPosition)
        .applyQuaternion(inverseRotation);
      const depth = -local.z;
      if (
        depth <= camera.lens.nearM ||
        depth >= camera.lens.farM
      ) {
        return null;
      }
      const ndcX = local.x / (depth * horizontalHalfTangent);
      const ndcY = local.y / (depth * verticalHalfTangent);
      if (
        !Number.isFinite(ndcX) ||
        !Number.isFinite(ndcY) ||
        Math.abs(ndcX) > 8 ||
        Math.abs(ndcY) > 8
      ) {
        return null;
      }
      return {
        x: ((ndcX + 1) * width) / 2,
        y: ((1 - ndcY) * height) / 2,
        depth,
      };
    },
    cameraRight: new Vector3(1, 0, 0).applyQuaternion(cameraRotation),
  };
};

const boxCorners = (
  size: Vec3,
): Vector3[] => {
  const halfX = size[0] / 2;
  const halfY = size[1] / 2;
  const halfZ = size[2] / 2;
  return [
    new Vector3(-halfX, -halfY, -halfZ),
    new Vector3(halfX, -halfY, -halfZ),
    new Vector3(halfX, halfY, -halfZ),
    new Vector3(-halfX, halfY, -halfZ),
    new Vector3(-halfX, -halfY, halfZ),
    new Vector3(halfX, -halfY, halfZ),
    new Vector3(halfX, halfY, halfZ),
    new Vector3(-halfX, halfY, halfZ),
  ];
};

const boxEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

const numericParameter = (
  parameters: Record<string, unknown>,
  name: string,
  fallback: number,
): number => {
  const value = parameters[name];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
};

const addActorGeometry = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  actorWorld: Matrix4,
  addStroke: (
    start: Vector3,
    end: Vector3,
    color: readonly [number, number, number, number],
    thickness: number,
  ) => void,
  addDisc: (
    center: Vector3,
    radiusM: number,
    color: readonly [number, number, number, number],
  ) => void,
): string[] => {
  const actorColor = hexColor(actor.color, 245);
  const actorScale = new Vector3();
  actorWorld.decompose(
    new Vector3(),
    new Quaternion(),
    actorScale,
  );
  const radialScale = Math.max(
    Math.abs(actorScale.x),
    Math.abs(actorScale.y),
    Math.abs(actorScale.z),
  );
  const projection = resolveActorProjection(scene, actor);

  const primitiveMatrix = (
    primitive: ActorProjectionPrimitive,
  ): Matrix4 =>
    actorWorld
      .clone()
      .multiply(
        localMatrix(
          primitive.frame.position,
          primitive.frame.rotation,
        ),
      );

  for (const primitive of projection.primitives) {
    const frame = primitiveMatrix(primitive);
    if (primitive.kind === "sphere") {
      addDisc(
        pointFromMatrix(frame, primitive.center),
        primitive.radius * radialScale,
        actorColor,
      );
      continue;
    }
    if (
      primitive.kind === "capsule" ||
      primitive.kind === "cylinder"
    ) {
      const length =
        primitive.kind === "capsule"
          ? primitive.cylinderLength
          : primitive.length;
      const first: Vec3 = [
        primitive.center[0],
        primitive.center[1] - length / 2,
        primitive.center[2],
      ];
      const second: Vec3 = [
        primitive.center[0],
        primitive.center[1] + length / 2,
        primitive.center[2],
      ];
      const firstWorld = pointFromMatrix(frame, first);
      const secondWorld = pointFromMatrix(frame, second);
      addStroke(firstWorld, secondWorld, actorColor, 5);
      addDisc(
        firstWorld,
        primitive.radius * radialScale,
        actorColor,
      );
      addDisc(
        secondWorld,
        primitive.radius * radialScale,
        actorColor,
      );
      continue;
    }

    const centerMatrix = frame
      .clone()
      .multiply(localMatrix(primitive.center));
    const corners = boxCorners([...primitive.size]).map((corner) =>
      corner.applyMatrix4(centerMatrix),
    );
    for (const [start, end] of boxEdges) {
      addStroke(corners[start], corners[end], actorColor, 3);
    }
  }

  return projection.primitives.map(({ id }) => id);
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) === 1
          ? 0xedb88320 ^ (value >>> 1)
          : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const value of data) {
    crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const chunk = Buffer.allocUnsafe(12 + body.byteLength);
  chunk.writeUInt32BE(body.byteLength, 0);
  typeBytes.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, body])),
    8 + body.byteLength,
  );
  return chunk;
};

const encodePng = (
  pixels: Uint8Array,
  width: number,
  height: number,
): Buffer => {
  const scanlineBytes = width * 4 + 1;
  const scanlines = Buffer.allocUnsafe(scanlineBytes * height);
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * scanlineBytes;
    scanlines[targetOffset] = 0;
    scanlines.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      targetOffset + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

export const renderSceneToPng = (
  input: SceneSpec,
  width: number,
  height: number,
): SoftwarePngResult => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 7680 ||
    height > 7680 ||
    width * height > 7680 * 4320
  ) {
    throw new SoftwarePngError(
      "EXPORT_RESOLUTION_INVALID",
      "The requested export resolution is unsupported.",
    );
  }
  const scene = parseSceneSpecInput(input);
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" &&
      entity.id === scene.activeCameraId,
  );
  if (!camera) {
    throw new SoftwarePngError(
      "EXPORT_CAMERA_MISSING",
      "The scene does not contain its active perspective camera.",
    );
  }

  const worldMatrices = createWorldMatrices(scene);
  const cameraWorld = worldMatrices.get(camera.id);
  if (!cameraWorld) {
    throw new SoftwarePngError(
      "EXPORT_CAMERA_MISSING",
      "The scene does not contain its active perspective camera.",
    );
  }
  const { project, cameraRight } = createProjector(
    camera,
    cameraWorld,
    width,
    height,
  );
  const pixels = new Uint8Array(width * height * 4);
  fillBackground(pixels, width, height);
  const strokes: Stroke[] = [];
  const discs: Disc[] = [];
  const actorPrimitiveIds: Record<string, string[]> = {};
  let clippedPrimitiveCount = 0;

  const addStroke = (
    startWorld: Vector3,
    endWorld: Vector3,
    color: readonly [number, number, number, number],
    thickness: number,
  ): void => {
    const start = project(startWorld);
    const end = project(endWorld);
    if (!start || !end) {
      clippedPrimitiveCount += 1;
      return;
    }
    strokes.push({
      start,
      end,
      color,
      thickness: Math.max(1, thickness * Math.sqrt(width / 1920)),
    });
  };
  const addDisc = (
    centerWorld: Vector3,
    radiusM: number,
    color: readonly [number, number, number, number],
  ): void => {
    const center = project(centerWorld);
    const edge = project(
      centerWorld.clone().addScaledVector(cameraRight, radiusM),
    );
    if (!center || !edge) {
      clippedPrimitiveCount += 1;
      return;
    }
    discs.push({
      center,
      radius: Math.max(
        1,
        Math.hypot(edge.x - center.x, edge.y - center.y),
      ),
      color,
    });
  };

  if (scene.spatialLayout !== null) {
    const layout = scene.spatialLayout;
    for (const region of layout.regions) {
      if (!region.visible) {
        continue;
      }
      for (let index = 0; index < region.footprintXZ.length; index += 1) {
        const [startX, startZ] = region.footprintXZ[index];
        const [endX, endZ] =
          region.footprintXZ[(index + 1) % region.footprintXZ.length];
        addStroke(
          new Vector3(startX, layout.floorY + 0.006, startZ),
          new Vector3(endX, layout.floorY + 0.006, endZ),
          hexColor("#7896a8", 150),
          1.25,
        );
      }
    }
    for (const boundary of layout.boundaries) {
      if (
        !boundary.visible ||
        !boundary.regionIds.some(
          (regionId) =>
            layout.regions.find((region) => region.id === regionId)
              ?.visible === true,
        )
      ) {
        continue;
      }
      for (const wall of deriveBoundaryWallBoxes(layout, boundary)) {
        const wallMatrix = new Matrix4()
          .makeRotationY(wall.rotationY)
          .setPosition(new Vector3(...wall.position));
        const corners = boxCorners(wall.size).map((corner) =>
          corner.applyMatrix4(wallMatrix),
        );
        for (const [start, end] of boxEdges) {
          addStroke(
            corners[start],
            corners[end],
            hexColor("#8b949f", 175),
            1.35,
          );
        }
      }
    }
  }

  for (const entity of scene.entities) {
    if (!entity.visible || entity.kind === "camera") {
      continue;
    }
    const world = worldMatrices.get(entity.id);
    if (!world) {
      continue;
    }
    if (entity.kind === "environment") {
      const parameters = entity.preset.parameters as Record<string, unknown>;
      const roomWidth = numericParameter(parameters, "widthM", 5);
      const roomDepth = numericParameter(parameters, "depthM", 4);
      const roomHeight = numericParameter(parameters, "heightM", 2.8);
      const corners = boxCorners([
        roomWidth,
        roomHeight,
        roomDepth,
      ]).map((corner) => {
        corner.y += roomHeight / 2;
        return corner.applyMatrix4(world);
      });
      for (const [start, end] of boxEdges) {
        addStroke(
          corners[start],
          corners[end],
          hexColor(entity.color, 105),
          1.4,
        );
      }
      continue;
    }
    if (entity.kind === "prop") {
      const size = entity.geometry.sizeM;
      const color = hexColor(entity.color, 210);
      if (
        entity.geometry.primitive === "cylinder" ||
        entity.geometry.primitive === "capsule"
      ) {
        const radius = Math.max(size[0], size[2]) / 2;
        const segments = 16;
        const topY = size[1] / 2;
        const bottomY = -size[1] / 2;
        for (let index = 0; index < segments; index += 1) {
          const next = (index + 1) % segments;
          const angle = (index / segments) * Math.PI * 2;
          const nextAngle = (next / segments) * Math.PI * 2;
          const bottom = new Vector3(
            Math.cos(angle) * radius,
            bottomY,
            Math.sin(angle) * radius,
          ).applyMatrix4(world);
          const bottomNext = new Vector3(
            Math.cos(nextAngle) * radius,
            bottomY,
            Math.sin(nextAngle) * radius,
          ).applyMatrix4(world);
          const top = new Vector3(
            Math.cos(angle) * radius,
            topY,
            Math.sin(angle) * radius,
          ).applyMatrix4(world);
          const topNext = new Vector3(
            Math.cos(nextAngle) * radius,
            topY,
            Math.sin(nextAngle) * radius,
          ).applyMatrix4(world);
          addStroke(bottom, bottomNext, color, 2);
          addStroke(top, topNext, color, 2);
          if (index % 4 === 0) {
            addStroke(bottom, top, color, 2);
          }
        }
      } else {
        const propSize: Vec3 =
          entity.geometry.primitive === "plane"
            ? [size[0], Math.min(size[1], 0.025), size[2]]
            : size;
        const corners = boxCorners(propSize).map((corner) =>
          corner.applyMatrix4(world),
        );
        for (const [start, end] of boxEdges) {
          addStroke(corners[start], corners[end], color, 2.2);
        }
      }
      continue;
    }
    if (entity.kind === "actor") {
      actorPrimitiveIds[entity.id] = addActorGeometry(
        scene,
        entity,
        world,
        addStroke,
        addDisc,
      );
    }
  }

  strokes.sort(
    (left, right) =>
      (right.start.depth + right.end.depth) / 2 -
      (left.start.depth + left.end.depth) / 2,
  );
  discs.sort(
    (left, right) => right.center.depth - left.center.depth,
  );
  for (const stroke of strokes) {
    drawStroke(pixels, width, height, stroke);
  }
  for (const disc of discs) {
    drawDisc(pixels, width, height, disc);
  }

  const warnings =
    clippedPrimitiveCount === 0
      ? []
      : [
          `${clippedPrimitiveCount} projected primitives were outside the camera clipping range.`,
        ];
  return {
    png: encodePng(pixels, width, height),
    warnings,
    diagnostics: { actorPrimitiveIds },
  };
};
