import {
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { useLayoutEffect, useRef, type ComponentRef } from "react";
import type { PerspectiveCamera as ThreePerspectiveCamera } from "three";
import type { EditorCameraFrame } from "./studio-interaction-math";

export interface EditorCameraRigProps {
  frame: EditorCameraFrame;
  domElement?: HTMLElement;
  fov?: number;
}

/** UI-only editor camera. It never writes a SceneSpec camera entity. */
export const EditorCameraRig = ({
  frame,
  domElement,
  fov = 50,
}: EditorCameraRigProps) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(...frame.positionM);
    camera.lookAt(...frame.targetM);
    camera.updateMatrixWorld(true);
    controls.target.set(...frame.targetM);
    controls.update();
  }, [frame]);

  return (
    <>
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        position={frame.positionM}
        fov={fov}
        near={0.02}
        far={500}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        domElement={domElement}
        target={frame.targetM}
        enableDamping
        dampingFactor={0.08}
        minDistance={0.5}
        maxDistance={80}
      />
    </>
  );
};
