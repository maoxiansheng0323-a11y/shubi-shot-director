import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { BufferGeometry } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ActorRigPrimitive } from "../domain/actor-projection";
import { sceneClient } from "../editor/scene-client";
import {
  parseBuiltInRefinedMannequinManifest,
  refinedPrimitiveTransform,
  refinedSectionForPrimitive,
  validateRefinedMannequinFileBytes,
  type RefinedGeometryCatalog,
  type RefinedPrimitiveTransform,
  type RefinedSectionId,
} from "./mannequin-asset";
import { createRefinedMannequinResource } from "./refined-mannequin-resource";

export interface RefinedPrimitiveRenderDescriptor {
  readonly primitive: ActorRigPrimitive;
  readonly sectionId: RefinedSectionId;
  readonly geometry: BufferGeometry;
  readonly transform: RefinedPrimitiveTransform;
}

interface RefinedMannequinProps {
  readonly primitives: readonly ActorRigPrimitive[];
  readonly fallback: ReactNode;
  readonly renderRefined: (
    descriptor: RefinedPrimitiveRenderDescriptor,
  ) => ReactNode;
  readonly renderProcedural: (
    primitive: ActorRigPrimitive,
  ) => ReactNode;
}

const LoadedRefinedMannequin = ({
  catalog,
  primitives,
  renderRefined,
  renderProcedural,
}: Omit<RefinedMannequinProps, "fallback"> & {
  readonly catalog: RefinedGeometryCatalog;
}) => {
  return (
    <>
      {primitives.map((primitive) => {
        const sectionId = refinedSectionForPrimitive(primitive);
        const transform = refinedPrimitiveTransform(primitive);
        if (!sectionId || !transform) {
          return renderProcedural(primitive);
        }
        return renderRefined({
          primitive,
          sectionId,
          geometry: catalog[sectionId],
          transform,
        });
      })}
    </>
  );
};

interface BoundaryProps {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
}

let fallbackDiagnosticEmitted = false;

const emitFallbackDiagnostic = (): void => {
  if (fallbackDiagnosticEmitted) return;
  fallbackDiagnosticEmitted = true;
  console.warn("REFINED_MANNEQUIN_FALLBACK");
};

const refinedMannequinLoader = new GLTFLoader();
const refinedMannequinResource = createRefinedMannequinResource({
  loadAsset: async () => {
    const manifest = parseBuiltInRefinedMannequinManifest(
      await sceneClient.getBuiltInRefinedMannequinManifest(),
    );
    const bytes = await sceneClient.getBuiltInRefinedMannequinBytes();
    await validateRefinedMannequinFileBytes(
      new Uint8Array(bytes),
      manifest,
    );
    const loaded = await refinedMannequinLoader.parseAsync(bytes, "");
    if (loaded.animations.length !== 0) {
      throw new Error("REFINED_MANNEQUIN_ASSET_INVALID");
    }
    return { scene: loaded.scene, manifest };
  },
  onFallback: emitFallbackDiagnostic,
});

export class RefinedMannequinBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  public state: BoundaryState = { failed: false };

  public static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo): void {
    emitFallbackDiagnostic();
  }

  public render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const RefinedMannequin = (props: RefinedMannequinProps) => {
  const { fallback } = props;
  const [resource, setResource] = useState(() =>
    refinedMannequinResource.getSnapshot(),
  );
  useEffect(() => {
    if (resource.status !== "loading") return undefined;
    let active = true;
    void refinedMannequinResource.load().then((next) => {
      if (active) setResource(next);
    });
    return () => {
      active = false;
    };
  }, [resource.status]);

  if (resource.status !== "ready") return fallback;
  return (
    <RefinedMannequinBoundary fallback={fallback}>
      <LoadedRefinedMannequin {...props} catalog={resource.catalog} />
    </RefinedMannequinBoundary>
  );
};
