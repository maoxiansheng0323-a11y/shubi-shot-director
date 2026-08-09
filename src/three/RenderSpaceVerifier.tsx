import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from "three";
import type { RenderSpaceEvidence } from "../domain/render-space-verification";
import type { ShotIntentPlan } from "../domain/shot-intent";

interface RenderSpaceVerifierProps {
  solveId: string;
  candidateId: string;
  sceneSha256: string;
  plan: ShotIntentPlan;
  onEvidence: (evidence: RenderSpaceEvidence) => void | Promise<void>;
}

interface MeshRecord {
  mesh: Mesh;
  entityId: string | null;
  actorPartId: string | null;
  material: Material | Material[];
  visible: boolean;
  key: string | null;
}

interface PixelAccumulator {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const WIDTH = 320;
const HEIGHT = 180;

const ancestorData = (object: Object3D, key: string): string | null => {
  let current: Object3D | null = object;
  while (current) {
    const value = current.userData[key];
    if (typeof value === "string") return value;
    current = current.parent;
  }
  return null;
};

const entityKey = (entityId: string): string => `entity:${entityId}`;
const partKey = (actorId: string, partId: string): string =>
  `part:${actorId}:${partId}`;

const colorForId = (id: number): Color =>
  new Color(
    (id & 0xff) / 255,
    ((id >>> 8) & 0xff) / 255,
    ((id >>> 16) & 0xff) / 255,
  );

const readPixelAccumulators = (
  renderer: WebGLRenderer,
  target: WebGLRenderTarget,
  idToKey: Map<number, string>,
): Map<string, PixelAccumulator> => {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
  const accumulators = new Map<string, PixelAccumulator>();
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const id = pixels[offset] | (pixels[offset + 1] << 8) | (pixels[offset + 2] << 16);
      const key = idToKey.get(id);
      if (!key) continue;
      const topY = HEIGHT - 1 - y;
      const current = accumulators.get(key) ?? {
        count: 0,
        minX: WIDTH,
        minY: HEIGHT,
        maxX: -1,
        maxY: -1,
      };
      current.count += 1;
      current.minX = Math.min(current.minX, x);
      current.minY = Math.min(current.minY, topY);
      current.maxX = Math.max(current.maxX, x);
      current.maxY = Math.max(current.maxY, topY);
      accumulators.set(key, current);
    }
  }
  return accumulators;
};

const renderIdPass = (
  renderer: WebGLRenderer,
  scene: Object3D & { background: unknown },
  camera: Object3D,
  target: WebGLRenderTarget,
  records: MeshRecord[],
  idToKey: Map<number, string>,
  include: (record: MeshRecord) => boolean,
): Map<string, PixelAccumulator> => {
  for (const record of records) record.mesh.visible = record.visible && include(record);
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, WIDTH, HEIGHT);
  renderer.setScissor(0, 0, WIDTH, HEIGHT);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, true);
  renderer.render(scene as never, camera as never);
  return readPixelAccumulators(renderer, target, idToKey);
};

const boundsFrom = (entries: PixelAccumulator[]) =>
  entries.length === 0
    ? null
    : {
        minX: Math.min(...entries.map(({ minX }) => minX)),
        minY: Math.min(...entries.map(({ minY }) => minY)),
        maxX: Math.max(...entries.map(({ maxX }) => maxX)),
        maxY: Math.max(...entries.map(({ maxY }) => maxY)),
      };

const objectDepth = (
  scene: Object3D,
  camera: Object3D,
  entityId: string,
): number => {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const entity = scene.getObjectByName(`entity-${entityId}`);
  if (!entity) return -1;
  const position = entity.getWorldPosition(new Vector3());
  const cameraPosition = camera.getWorldPosition(new Vector3());
  const forward = camera.getWorldDirection(new Vector3());
  return position.sub(cameraPosition).dot(forward);
};

const requiredEntityIds = (plan: ShotIntentPlan): string[] => [
  ...new Set([
    ...plan.primaryTargetIds,
    ...plan.hardConstraints.flatMap((constraint) => {
      if (constraint.kind === "visibility") return [constraint.entityId];
      if (constraint.kind === "framing") return constraint.targetEntityIds;
      if (constraint.kind === "depth-ordering") {
        return [constraint.foregroundEntityId, constraint.backgroundEntityId];
      }
      return [];
    }),
  ]),
];

const requiredParts = (plan: ShotIntentPlan): Array<{ actorId: string; partId: string }> =>
  plan.hardConstraints.flatMap((constraint) =>
    constraint.kind === "visibility"
      ? constraint.requiredPartIds.map((partId) => ({ actorId: constraint.entityId, partId }))
      : [],
  );

export const RenderSpaceVerifier = ({
  solveId,
  candidateId,
  sceneSha256,
  plan,
  onEvidence,
}: RenderSpaceVerifierProps) => {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (cancelled) return;
        const records: MeshRecord[] = [];
        scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const entityId = ancestorData(object, "shubiEntityId");
          const actorPartId = ancestorData(object, "shubiActorPartId");
          const key = entityId === null
            ? null
            : actorPartId === null
              ? entityKey(entityId)
              : partKey(entityId, actorPartId);
          records.push({
            mesh: object,
            entityId,
            actorPartId,
            material: object.material,
            visible: object.visible,
            key,
          });
        });

        const keys = [...new Set(records.flatMap(({ key }) => key ? [key] : []))].sort();
        const keyToId = new Map(keys.map((key, index) => [key, index + 1] as const));
        const idToKey = new Map([...keyToId].map(([key, id]) => [id, key] as const));
        const materials = new Map(
          [...keyToId].map(([key, id]) => [
            key,
            new MeshBasicMaterial({
              color: colorForId(id),
              toneMapped: false,
              side: DoubleSide,
              depthTest: true,
              depthWrite: true,
            }),
          ] as const),
        );
        const black = new MeshBasicMaterial({
          color: new Color(0, 0, 0),
          toneMapped: false,
          side: DoubleSide,
          depthTest: true,
          depthWrite: true,
        });
        for (const record of records) {
          record.mesh.material = record.key ? (materials.get(record.key) ?? black) : black;
        }

        const previousTarget = renderer.getRenderTarget();
        const previousViewport = renderer.getViewport(new Vector4());
        const previousScissor = renderer.getScissor(new Vector4());
        const previousScissorTest = renderer.getScissorTest();
        const previousClearColor = renderer.getClearColor(new Color());
        const previousClearAlpha = renderer.getClearAlpha();
        const previousBackground = scene.background;
        const target = new WebGLRenderTarget(WIDTH, HEIGHT, {
          format: RGBAFormat,
          type: UnsignedByteType,
          depthBuffer: true,
          stencilBuffer: false,
          samples: 0,
        });
        target.texture.colorSpace = NoColorSpace;
        scene.background = null;

        try {
          const full = renderIdPass(
            renderer,
            scene,
            camera,
            target,
            records,
            idToKey,
            () => true,
          );
          const entities = requiredEntityIds(plan).map((entityId) => {
            const entityKeys = records
              .filter((record) => record.entityId === entityId && record.key !== null)
              .map(({ key }) => key as string);
            const fullEntries = [...new Set(entityKeys)]
              .map((key) => full.get(key))
              .filter((entry): entry is PixelAccumulator => entry !== undefined);
            const isolated = renderIdPass(
              renderer,
              scene,
              camera,
              target,
              records,
              idToKey,
              (record) => record.entityId === entityId,
            );
            return {
              entityId,
              visiblePixelCount: fullEntries.reduce((sum, entry) => sum + entry.count, 0),
              isolatedPixelCount: [...new Set(entityKeys)].reduce(
                (sum, key) => sum + (isolated.get(key)?.count ?? 0),
                0,
              ),
              boundsPx: boundsFrom(fullEntries),
              centerDepthM: objectDepth(scene, camera, entityId),
            };
          });
          const actorParts = requiredParts(plan).map(({ actorId, partId }) => {
            const key = partKey(actorId, partId);
            const visible = full.get(key);
            const isolated = renderIdPass(
              renderer,
              scene,
              camera,
              target,
              records,
              idToKey,
              (record) => record.entityId === actorId && record.actorPartId === partId,
            ).get(key);
            return {
              actorId,
              partId,
              visiblePixelCount: visible?.count ?? 0,
              isolatedPixelCount: isolated?.count ?? 0,
              boundsPx: visible
                ? {
                    minX: visible.minX,
                    minY: visible.minY,
                    maxX: visible.maxX,
                    maxY: visible.maxY,
                  }
                : null,
              centerDepthM: objectDepth(scene, camera, actorId),
            };
          });
          if (!cancelled) {
            void onEvidence({
              schemaVersion: 1,
              solveId,
              candidateId,
              sceneSha256,
              width: WIDTH,
              height: HEIGHT,
              entities,
              actorParts,
            });
          }
        } finally {
          for (const record of records) {
            record.mesh.material = record.material;
            record.mesh.visible = record.visible;
          }
          for (const material of materials.values()) material.dispose();
          black.dispose();
          scene.background = previousBackground;
          renderer.setRenderTarget(previousTarget);
          renderer.setViewport(previousViewport);
          renderer.setScissor(previousScissor);
          renderer.setScissorTest(previousScissorTest);
          renderer.setClearColor(previousClearColor, previousClearAlpha);
          target.dispose();
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [camera, candidateId, onEvidence, plan, renderer, scene, sceneSha256, solveId]);

  return null;
};
