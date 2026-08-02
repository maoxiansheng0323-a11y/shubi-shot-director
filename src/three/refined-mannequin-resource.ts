import type { Object3D } from "three";
import {
  createRefinedGeometryCatalog,
  type RefinedGeometryCatalog,
  type RefinedMannequinManifest,
} from "./mannequin-asset";

export type RefinedMannequinResourceSnapshot =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; catalog: RefinedGeometryCatalog }>
  | Readonly<{ status: "fallback" }>;

export interface RefinedMannequinResource {
  readonly getSnapshot: () => RefinedMannequinResourceSnapshot;
  readonly load: () => Promise<RefinedMannequinResourceSnapshot>;
}

export interface CreateRefinedMannequinResourceOptions {
  readonly loadAsset: () => Promise<{
    readonly scene: Object3D;
    readonly manifest: RefinedMannequinManifest;
  }>;
  readonly onFallback: () => void;
}

export const createRefinedMannequinResource = (
  options: CreateRefinedMannequinResourceOptions,
): RefinedMannequinResource => {
  const loading = Object.freeze({ status: "loading" } as const);
  const fallback = Object.freeze({ status: "fallback" } as const);
  let snapshot: RefinedMannequinResourceSnapshot = loading;
  let pending: Promise<RefinedMannequinResourceSnapshot> | undefined;

  const load = (): Promise<RefinedMannequinResourceSnapshot> => {
    if (snapshot.status !== "loading") {
      return Promise.resolve(snapshot);
    }
    if (pending) return pending;
    pending = options
      .loadAsset()
      .then(({ scene, manifest }) => {
        snapshot = Object.freeze({
          status: "ready" as const,
          catalog: createRefinedGeometryCatalog(scene, manifest),
        });
        return snapshot;
      })
      .catch(() => {
        snapshot = fallback;
        options.onFallback();
        return snapshot;
      });
    return pending;
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    load,
  });
};
