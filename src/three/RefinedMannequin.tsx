import { useGLTF } from "@react-three/drei";
import {
  Component,
  Suspense,
  useMemo,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { BufferGeometry, Object3D } from "three";
import type { ActorRigPrimitive } from "../domain/actor-projection";
import {
  BUILT_IN_REFINED_MANNEQUIN_URL,
  createRefinedGeometryCatalog,
  refinedPrimitiveTransform,
  refinedSectionForPrimitive,
  type RefinedGeometryCatalog,
  type RefinedPrimitiveTransform,
  type RefinedSectionId,
} from "./mannequin-asset";

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

const geometryCatalogCache = new WeakMap<
  Object3D,
  RefinedGeometryCatalog
>();

const LoadedRefinedMannequin = ({
  primitives,
  renderRefined,
  renderProcedural,
}: Omit<RefinedMannequinProps, "fallback">) => {
  const { scene } = useGLTF(BUILT_IN_REFINED_MANNEQUIN_URL);
  const catalog = useMemo(() => {
    const cached = geometryCatalogCache.get(scene);
    if (cached) return cached;
    const created = createRefinedGeometryCatalog(scene);
    geometryCatalogCache.set(scene, created);
    return created;
  }, [scene]);

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

export class RefinedMannequinBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  public state: BoundaryState = { failed: false };

  public static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo): void {
    if (fallbackDiagnosticEmitted) return;
    fallbackDiagnosticEmitted = true;
    console.warn("REFINED_MANNEQUIN_FALLBACK");
  }

  public render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const RefinedMannequin = (props: RefinedMannequinProps) => {
  const { fallback } = props;
  return (
    <RefinedMannequinBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LoadedRefinedMannequin {...props} />
      </Suspense>
    </RefinedMannequinBoundary>
  );
};
