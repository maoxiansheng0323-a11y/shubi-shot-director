import {
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentRef,
} from "react";
import {
  MOUSE,
  type PerspectiveCamera as ThreePerspectiveCamera,
} from "three";
import type { EditorCameraFrame } from "./studio-interaction-math";

export const EDITOR_VIEW_MOUSE_BUTTONS = {
  LEFT: MOUSE.PAN,
  MIDDLE: MOUSE.DOLLY,
  RIGHT: MOUSE.ROTATE,
} as const;

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
  autoFrameArmed: boolean;
  currentDistance: number;
  requestedDistance: number;
}

export const EDITOR_AUTO_FRAME_REARM_RATIO = 1.35;

export const shouldApplyEditorCameraFrame = ({
  initialized,
  shouldFrame,
  previousRequestVersion,
  requestVersion,
  autoFrameArmed,
  currentDistance,
  requestedDistance,
}: EditorCameraFrameApplication): boolean =>
  !initialized ||
  (shouldFrame &&
    previousRequestVersion !== requestVersion &&
    autoFrameArmed &&
    currentDistance >= requestedDistance * EDITOR_AUTO_FRAME_REARM_RATIO);

export interface EditorAutoFrameState {
  initialized: boolean;
  armed: boolean;
  previousRequestVersion: number | null;
  lastFrameDistance: number | null;
}

export interface EditorCameraFrameDecision {
  applyFrame: boolean;
  state: EditorAutoFrameState;
}

export const createEditorAutoFrameState = (): EditorAutoFrameState => ({
  initialized: false,
  armed: true,
  previousRequestVersion: null,
  lastFrameDistance: null,
});

export const decideEditorCameraFrame = ({
  state,
  shouldFrame,
  requestVersion,
  currentDistance,
  requestedDistance,
}: {
  state: EditorAutoFrameState;
  shouldFrame: boolean;
  requestVersion: number;
  currentDistance: number;
  requestedDistance: number;
}): EditorCameraFrameDecision => {
  const applyFrame = shouldApplyEditorCameraFrame({
    initialized: state.initialized,
    shouldFrame,
    previousRequestVersion: state.previousRequestVersion,
    requestVersion,
    autoFrameArmed: state.armed,
    currentDistance,
    requestedDistance,
  });
  return {
    applyFrame,
    state: {
      initialized: true,
      armed: applyFrame && shouldFrame ? false : state.armed,
      previousRequestVersion: requestVersion,
      lastFrameDistance:
        applyFrame && shouldFrame
          ? requestedDistance
          : state.lastFrameDistance,
    },
  };
};

export const rearmEditorAutoFrameAfterWheel = (
  state: EditorAutoFrameState,
  {
    deltaY,
    currentDistance,
  }: {
    deltaY: number;
    currentDistance: number;
  },
): EditorAutoFrameState => {
  if (
    state.armed ||
    deltaY <= 0 ||
    state.lastFrameDistance === null ||
    currentDistance <
      state.lastFrameDistance * EDITOR_AUTO_FRAME_REARM_RATIO
  ) {
    return state;
  }
  return { ...state, armed: true };
};

const frameDistance = (frame: EditorCameraFrame): number =>
  Math.hypot(
    frame.positionM[0] - frame.targetM[0],
    frame.positionM[1] - frame.targetM[1],
    frame.positionM[2] - frame.targetM[2],
  );

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
  const autoFrameStateRef = useRef(createEditorAutoFrameState());
  const wheelFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const requestedDistance = frameDistance(frame);
    const decision = decideEditorCameraFrame({
      state: autoFrameStateRef.current,
      shouldFrame,
      requestVersion: frameRequestVersion,
      currentDistance: controls.getDistance(),
      requestedDistance,
    });
    autoFrameStateRef.current = decision.state;
    if (!decision.applyFrame) {
      return;
    }
    camera.position.set(...frame.positionM);
    camera.lookAt(...frame.targetM);
    camera.updateMatrixWorld(true);
    controls.target.set(...frame.targetM);
    controls.update();
  }, [frame, frameRequestVersion, shouldFrame]);

  useEffect(() => {
    const ownerWindow = domElement?.ownerDocument.defaultView;
    if (!domElement || !ownerWindow) return;
    const handleWheel = (event: WheelEvent): void => {
      if (event.deltaY <= 0) return;
      if (wheelFrameRef.current !== null) {
        ownerWindow.cancelAnimationFrame(wheelFrameRef.current);
      }
      wheelFrameRef.current = ownerWindow.requestAnimationFrame(() => {
        wheelFrameRef.current = null;
        const controls = controlsRef.current;
        if (!controls) return;
        autoFrameStateRef.current = rearmEditorAutoFrameAfterWheel(
          autoFrameStateRef.current,
          {
            deltaY: event.deltaY,
            currentDistance: controls.getDistance(),
          },
        );
      });
    };
    domElement.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      domElement.removeEventListener("wheel", handleWheel);
      if (wheelFrameRef.current !== null) {
        ownerWindow.cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
    };
  }, [domElement]);

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
        mouseButtons={EDITOR_VIEW_MOUSE_BUTTONS}
      />
    </>
  );
};
