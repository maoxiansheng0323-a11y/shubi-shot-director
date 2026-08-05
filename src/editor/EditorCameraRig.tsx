import {
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { useLayoutEffect, useRef, type ComponentRef } from "react";
import type { PerspectiveCamera as ThreePerspectiveCamera } from "three";
import type { EditorCameraFrame } from "./studio-interaction-math";

export interface EditorCameraRigProps {
  frame: EditorCameraFrame;
  frameRequestVersion: number;
  shouldFrame?: boolean;
  domElement?: HTMLElement;
  fov?: number;
}

export interface EditorCameraFrameApplication {
  initialized: boolean;
  shouldFrame: boolean;
  previousRequestVersion: number | null;
  requestVersion: number;
}

export const shouldApplyEditorCameraFrame = ({
  initialized,
  shouldFrame,
  previousRequestVersion,
  requestVersion,
}: EditorCameraFrameApplication): boolean =>
  !initialized ||
  (shouldFrame && previousRequestVersion !== requestVersion);

/** UI-only editor camera. It never writes a SceneSpec camera entity. */
export const EditorCameraRig = ({
  frame,
  frameRequestVersion,
  shouldFrame = false,
  domElement,
  fov = 50,
}: EditorCameraRigProps) => {
  const initialFrameRef = useRef(frame);
  const cameraRef = useRef<ThreePerspectiveCamera>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const initializedRef = useRef(false);
  const previousRequestVersionRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (
      !shouldApplyEditorCameraFrame({
        initialized: initializedRef.current,
        shouldFrame,
        previousRequestVersion: previousRequestVersionRef.current,
        requestVersion: frameRequestVersion,
      })
    ) {
      return;
    }
    camera.position.set(...frame.positionM);
    camera.lookAt(...frame.targetM);
    camera.updateMatrixWorld(true);
    controls.target.set(...frame.targetM);
    controls.update();
    initializedRef.current = true;
    previousRequestVersionRef.current = frameRequestVersion;
  }, [frame, frameRequestVersion, shouldFrame]);

  return (
    <>
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        position={initialFrameRef.current.positionM}
        fov={fov}
        near={0.02}
        far={500}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        domElement={domElement}
        target={initialFrameRef.current.targetM}
        enableDamping
        dampingFactor={0.08}
        minDistance={0.5}
        maxDistance={80}
      />
    </>
  );
};
