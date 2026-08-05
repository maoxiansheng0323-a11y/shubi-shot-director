import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type {
  CameraEntity,
  SceneSpec,
  TransformSpec,
  Vec3,
} from "../domain/scene-schema";
import {
  adjustShotFocalLength,
  deriveShotPanReferenceDistance,
  moveShotCameraByKey,
  orbitShotCamera,
  panShotCamera,
  rotateShotCameraFree,
  type ShotNavigationKey,
} from "./shot-camera-navigation";
import {
  listShotOrbitTargets,
  reconcileShotOrbitTargetId,
  resolveShotOrbitTargetCenter,
} from "./shot-camera-target-lock";
import {
  createShotCameraGestureSession,
  decideShotCameraGesture,
  type ShotCameraGestureSession,
} from "./shot-camera-session";

export const WHEEL_COMMIT_DELAY_MS = 180;

export interface ShotCameraDraft {
  cameraId: string;
  transform?: TransformSpec;
  focalLengthMm?: number;
  pending: boolean;
}

export interface ShotCameraNavigationProps {
  scene: SceneSpec;
  disabled: boolean;
  onUnlockUserProtectedCamera: () => void | Promise<void>;
  onDraftChange: (draft: ShotCameraDraft | null) => void;
  onCommitTransform: (
    session: ShotCameraGestureSession,
    transform: TransformSpec,
  ) => Promise<SceneSpec | void>;
  onCommitFocalLength: (
    session: ShotCameraGestureSession,
    focalLengthMm: number,
  ) => Promise<SceneSpec | void>;
}

interface PointerGesture {
  pointerId: number;
  button: 0 | 2;
  startX: number;
  startY: number;
  camera: CameraEntity;
  session: ShotCameraGestureSession;
  targetEntityId: string | null;
  targetM: Vec3 | null;
  panReferenceDistanceM: number;
  transform: TransformSpec | null;
}

interface TransformGesture {
  camera: CameraEntity;
  session: ShotCameraGestureSession;
  transform: TransformSpec;
}

interface FocalGesture {
  camera: CameraEntity;
  session: ShotCameraGestureSession;
  focalLengthMm: number;
}

type ShotCameraInputOwner =
  | "idle"
  | "pointer"
  | "wheel"
  | "key"
  | "commit";

type TransformCommitOwner = "idle" | "pointer" | "key";

const navigationKeys = new Set<ShotNavigationKey>([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
]);

const isNavigationKey = (key: string): key is ShotNavigationKey =>
  navigationKeys.has(key as ShotNavigationKey);

const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable ||
      element?.closest("input, textarea, select, [contenteditable='true']"),
  );
};

const cloneTransform = (transform: TransformSpec): TransformSpec => ({
  positionM: [...transform.positionM],
  rotation: [...transform.rotation],
  scale: [...transform.scale],
});

const cloneCamera = (camera: CameraEntity): CameraEntity => ({
  ...camera,
  transform: cloneTransform(camera.transform),
  lens: { ...camera.lens },
});

const cameraWithTransform = (
  camera: CameraEntity,
  transform: TransformSpec,
): CameraEntity => ({
  ...camera,
  transform,
});

const activeCameraFrom = (scene: SceneSpec): CameraEntity | null =>
  scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  ) ?? null;

export const ShotCameraNavigation = ({
  scene,
  disabled,
  onUnlockUserProtectedCamera,
  onDraftChange,
  onCommitTransform,
  onCommitFocalLength,
}: ShotCameraNavigationProps) => {
  const camera = useMemo(() => activeCameraFrom(scene), [scene]);
  const targetOptions = useMemo(
    () => listShotOrbitTargets(scene),
    [scene],
  );
  const [targetEntityId, setTargetEntityId] =
    useState<string | null>(null);
  const [draft, setDraft] = useState<ShotCameraDraft | null>(null);
  const [dragging, setDragging] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const keyGestureRef = useRef<TransformGesture | null>(null);
  const wheelGestureRef = useRef<FocalGesture | null>(null);
  const heldKeysRef = useRef(new Set<ShotNavigationKey>());
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputOwnerRef = useRef<ShotCameraInputOwner>("idle");
  const commitGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const expectedOwnRevisionRef = useRef<number | null>(null);
  const previousSceneRef = useRef({
    sceneId: scene.sceneId,
    revision: scene.revision,
    cameraId: scene.activeCameraId,
  });

  const publishDraft = useCallback(
    (nextDraft: ShotCameraDraft | null): void => {
      if (!mountedRef.current) {
        return;
      }
      setDraft(nextDraft);
      onDraftChange(nextDraft);
    },
    [onDraftChange],
  );

  const releaseCapturedPointer = useCallback((): void => {
    const gesture = pointerGestureRef.current;
    const surface = surfaceRef.current;
    if (
      gesture &&
      surface?.hasPointerCapture(gesture.pointerId)
    ) {
      surface.releasePointerCapture(gesture.pointerId);
    }
  }, []);

  const cancelGestures = useCallback((): void => {
    if (wheelTimerRef.current !== null) {
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
    releaseCapturedPointer();
    if (pointerGestureRef.current) {
      pointerGestureRef.current.session.cancelled = true;
    }
    if (keyGestureRef.current) {
      keyGestureRef.current.session.cancelled = true;
    }
    if (wheelGestureRef.current) {
      wheelGestureRef.current.session.cancelled = true;
    }
    pointerGestureRef.current = null;
    keyGestureRef.current = null;
    wheelGestureRef.current = null;
    heldKeysRef.current.clear();
    commitGenerationRef.current += 1;
    inputOwnerRef.current = "idle";
    expectedOwnRevisionRef.current = null;
    setDragging(false);
    publishDraft(null);
  }, [publishDraft, releaseCapturedPointer]);

  const focusSurface = (): void => {
    surfaceRef.current?.focus({ preventScroll: true });
  };

  const rememberAcceptedRevision = (
    session: ShotCameraGestureSession,
    accepted: SceneSpec | void,
  ): void => {
    if (accepted?.sceneId === session.sceneId) {
      expectedOwnRevisionRef.current = accepted.revision;
    } else if (!accepted) {
      expectedOwnRevisionRef.current = null;
    }
  };

  const commitTransform = useCallback(
    async (
      gesture: TransformGesture,
      owner: TransformCommitOwner,
    ): Promise<void> => {
      if (inputOwnerRef.current !== owner) {
        return;
      }
      if (
        decideShotCameraGesture(
          gesture.session,
          scene,
          gesture.camera.id,
        ).status !== "commit"
      ) {
        inputOwnerRef.current = "idle";
        publishDraft(null);
        return;
      }
      inputOwnerRef.current = "commit";
      const commitGeneration = ++commitGenerationRef.current;
      expectedOwnRevisionRef.current = gesture.session.baseRevision + 1;
      publishDraft({
        cameraId: gesture.camera.id,
        transform: gesture.transform,
        pending: true,
      });
      try {
        const accepted = await onCommitTransform(
          gesture.session,
          gesture.transform,
        );
        if (
          mountedRef.current &&
          commitGenerationRef.current === commitGeneration
        ) {
          rememberAcceptedRevision(gesture.session, accepted);
        }
      } catch {
        if (commitGenerationRef.current === commitGeneration) {
          expectedOwnRevisionRef.current = null;
        }
      } finally {
        if (
          mountedRef.current &&
          commitGenerationRef.current === commitGeneration
        ) {
          inputOwnerRef.current = "idle";
          publishDraft(null);
        }
      }
    },
    [onCommitTransform, publishDraft, scene],
  );

  const commitFocalLength = useCallback(
    async (gesture: FocalGesture): Promise<void> => {
      if (inputOwnerRef.current !== "wheel") {
        return;
      }
      if (
        decideShotCameraGesture(
          gesture.session,
          scene,
          gesture.camera.id,
        ).status !== "commit"
      ) {
        inputOwnerRef.current = "idle";
        publishDraft(null);
        return;
      }
      inputOwnerRef.current = "commit";
      const commitGeneration = ++commitGenerationRef.current;
      expectedOwnRevisionRef.current = gesture.session.baseRevision + 1;
      publishDraft({
        cameraId: gesture.camera.id,
        focalLengthMm: gesture.focalLengthMm,
        pending: true,
      });
      try {
        const accepted = await onCommitFocalLength(
          gesture.session,
          gesture.focalLengthMm,
        );
        if (
          mountedRef.current &&
          commitGenerationRef.current === commitGeneration
        ) {
          rememberAcceptedRevision(gesture.session, accepted);
        }
      } catch {
        if (commitGenerationRef.current === commitGeneration) {
          expectedOwnRevisionRef.current = null;
        }
      } finally {
        if (
          mountedRef.current &&
          commitGenerationRef.current === commitGeneration
        ) {
          inputOwnerRef.current = "idle";
          publishDraft(null);
        }
      }
    },
    [onCommitFocalLength, publishDraft, scene],
  );

  useEffect(() => {
    const previous = previousSceneRef.current;
    previousSceneRef.current = {
      sceneId: scene.sceneId,
      revision: scene.revision,
      cameraId: scene.activeCameraId,
    };
    const reconciledTargetEntityId = reconcileShotOrbitTargetId(
      scene,
      scene.activeCameraId,
      {
        sceneId: previous.sceneId,
        activeCameraId: previous.cameraId,
        entityId: targetEntityId,
      },
    );
    if (reconciledTargetEntityId !== targetEntityId) {
      setTargetEntityId(reconciledTargetEntityId);
    }
    if (!camera || disabled || camera.lockMode === "user") {
      cancelGestures();
      return;
    }
    const cameraChanged =
      previous.sceneId !== scene.sceneId ||
      previous.cameraId !== scene.activeCameraId;
    if (cameraChanged) {
      cancelGestures();
      requestAnimationFrame(focusSurface);
      return;
    }
    if (previous.revision === scene.revision) {
      return;
    }
    if (expectedOwnRevisionRef.current === scene.revision) {
      expectedOwnRevisionRef.current = null;
      return;
    }
    cancelGestures();
  }, [
    camera,
    cancelGestures,
    disabled,
    scene,
    targetEntityId,
  ]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        commitGenerationRef.current += 1;
        if (wheelTimerRef.current !== null) {
          clearTimeout(wheelTimerRef.current);
        }
        releaseCapturedPointer();
        inputOwnerRef.current = "idle";
        onDraftChange(null);
      };
    },
    [onDraftChange, releaseCapturedPointer],
  );

  const handlePointerDown = (
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button === 2) {
      event.preventDefault();
    }
    if (
      disabled ||
      !camera ||
      camera.lockMode === "user" ||
      inputOwnerRef.current !== "idle" ||
      (event.button !== 0 && event.button !== 2) ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    event.preventDefault();
    focusSurface();
    inputOwnerRef.current = "pointer";
    const baseCamera = cloneCamera(camera);
    const selectedTargetM = targetEntityId
      ? resolveShotOrbitTargetCenter(scene, targetEntityId)
      : null;
    const capturedTargetEntityId = selectedTargetM
      ? targetEntityId
      : null;
    if (targetEntityId && !selectedTargetM) {
      setTargetEntityId(null);
    }
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      camera: baseCamera,
      session: createShotCameraGestureSession(scene, camera.id),
      targetEntityId: capturedTargetEntityId,
      targetM: selectedTargetM,
      panReferenceDistanceM: deriveShotPanReferenceDistance(
        scene,
        baseCamera,
        selectedTargetM,
      ),
      transform: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    const gesture = pointerGestureRef.current;
    if (
      inputOwnerRef.current !== "pointer" ||
      !gesture ||
      gesture.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const delta: readonly [number, number] = [
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    ];
    const transform =
      gesture.button === 0
        ? panShotCamera(
            gesture.camera,
            gesture.panReferenceDistanceM,
            delta,
            event.currentTarget.clientHeight,
          )
        : gesture.targetEntityId && gesture.targetM
          ? orbitShotCamera(gesture.camera, gesture.targetM, delta)
          : rotateShotCameraFree(gesture.camera, delta);
    gesture.transform = transform;
    publishDraft({
      cameraId: gesture.camera.id,
      transform,
      pending: false,
    });
  };

  const finishPointerGesture = (
    event: PointerEvent<HTMLDivElement>,
    commit: boolean,
  ): void => {
    const gesture = pointerGestureRef.current;
    if (
      inputOwnerRef.current !== "pointer" ||
      !gesture ||
      gesture.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerGestureRef.current = null;
    setDragging(false);
    if (commit && gesture.transform) {
      void commitTransform(
        {
          camera: gesture.camera,
          session: gesture.session,
          transform: gesture.transform,
        },
        "pointer",
      );
    } else {
      gesture.session.cancelled = true;
      inputOwnerRef.current = "idle";
      publishDraft(null);
    }
  };

  const handleWheel = useCallback(
    (event: globalThis.WheelEvent): void => {
      if (
        disabled ||
        !camera ||
        camera.lockMode === "user" ||
        isEditableTarget(event.target) ||
        event.deltaY === 0 ||
        (inputOwnerRef.current !== "idle" &&
          inputOwnerRef.current !== "wheel")
      ) {
        return;
      }
      event.preventDefault();
      if (inputOwnerRef.current === "idle") {
        inputOwnerRef.current = "wheel";
      }
      const gesture =
        wheelGestureRef.current ?? {
          camera: cloneCamera(camera),
          session: createShotCameraGestureSession(scene, camera.id),
          focalLengthMm: camera.lens.focalLengthMm,
        };
      gesture.focalLengthMm = adjustShotFocalLength(
        gesture.focalLengthMm,
        event.deltaY,
        event,
      );
      wheelGestureRef.current = gesture;
      publishDraft({
        cameraId: camera.id,
        focalLengthMm: gesture.focalLengthMm,
        pending: false,
      });
      if (wheelTimerRef.current !== null) {
        clearTimeout(wheelTimerRef.current);
      }
      wheelTimerRef.current = setTimeout(() => {
        wheelTimerRef.current = null;
        const finalGesture = wheelGestureRef.current;
        wheelGestureRef.current = null;
        if (finalGesture) {
          void commitFocalLength(finalGesture);
        } else if (inputOwnerRef.current === "wheel") {
          inputOwnerRef.current = "idle";
          publishDraft(null);
        }
      }, WHEEL_COMMIT_DELAY_MS);
    },
    [camera, commitFocalLength, disabled, publishDraft, scene],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (
        inputOwnerRef.current !== "idle" &&
        inputOwnerRef.current !== "commit"
      ) {
        event.preventDefault();
        cancelGestures();
      }
      return;
    }
    if (
      disabled ||
      !camera ||
      camera.lockMode === "user" ||
      !isNavigationKey(event.key) ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    if (
      inputOwnerRef.current !== "idle" &&
      inputOwnerRef.current !== "key"
    ) {
      return;
    }
    event.preventDefault();
    if (inputOwnerRef.current === "idle") {
      inputOwnerRef.current = "key";
    }
    heldKeysRef.current.add(event.key);
    const gesture =
      keyGestureRef.current ?? {
        camera: cloneCamera(camera),
        session: createShotCameraGestureSession(scene, camera.id),
        transform: cloneTransform(camera.transform),
      };
    gesture.transform = moveShotCameraByKey(
      cameraWithTransform(gesture.camera, gesture.transform),
      event.key,
      event,
    );
    keyGestureRef.current = gesture;
    publishDraft({
      cameraId: camera.id,
      transform: gesture.transform,
      pending: false,
    });
  }, [camera, cancelGestures, disabled, publishDraft, scene]);

  const handleKeyUp = useCallback((event: globalThis.KeyboardEvent): void => {
    if (
      inputOwnerRef.current !== "key" ||
      !isNavigationKey(event.key) ||
      !heldKeysRef.current.has(event.key)
    ) {
      return;
    }
    event.preventDefault();
    heldKeysRef.current.delete(event.key);
    if (heldKeysRef.current.size > 0) {
      return;
    }
    const gesture = keyGestureRef.current;
    keyGestureRef.current = null;
    if (gesture) {
      void commitTransform(gesture, "key");
    } else {
      inputOwnerRef.current = "idle";
      publishDraft(null);
    }
  }, [commitTransform]);

  useEffect(() => {
    const ownerDocument = surfaceRef.current?.ownerDocument;
    if (!ownerDocument) {
      return;
    }
    ownerDocument.addEventListener("keydown", handleKeyDown);
    ownerDocument.addEventListener("keyup", handleKeyUp);
    return () => {
      ownerDocument.removeEventListener("keydown", handleKeyDown);
      ownerDocument.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  const controlsDisabled =
    disabled || !camera || camera.lockMode === "user";
  const navigationInputBusy = inputOwnerRef.current !== "idle";
  const targetSelectorDisabled =
    controlsDisabled || navigationInputBusy;
  const nudgeCamera = (key: ShotNavigationKey): void => {
    if (controlsDisabled || !camera || inputOwnerRef.current !== "idle") {
      return;
    }
    const baseCamera = cloneCamera(camera);
    void commitTransform(
      {
        camera: baseCamera,
        session: createShotCameraGestureSession(scene, camera.id),
        transform: moveShotCameraByKey(baseCamera, key, {}),
      },
      "idle",
    );
  };

  const focalLengthMm =
    draft?.focalLengthMm ?? camera?.lens.focalLengthMm ?? 0;

  return (
    <>
      <div
        className="shot-camera-controls"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div
          className="shot-camera-move-pad"
          role="group"
          aria-label="镜头移动"
        >
          <button
            type="button"
            className="shot-camera-nudge is-forward"
            aria-label="镜头前移"
            title="镜头前移"
            disabled={controlsDisabled || navigationInputBusy}
            onClick={() => nudgeCamera("ArrowUp")}
          >
            ↑
          </button>
          <button
            type="button"
            className="shot-camera-nudge is-backward"
            aria-label="镜头后移"
            title="镜头后移"
            disabled={controlsDisabled || navigationInputBusy}
            onClick={() => nudgeCamera("ArrowDown")}
          >
            ↓
          </button>
          <button
            type="button"
            className="shot-camera-nudge is-left"
            aria-label="镜头左移"
            title="镜头左移"
            disabled={controlsDisabled || navigationInputBusy}
            onClick={() => nudgeCamera("ArrowLeft")}
          >
            ←
          </button>
          <button
            type="button"
            className="shot-camera-nudge is-right"
            aria-label="镜头右移"
            title="镜头右移"
            disabled={controlsDisabled || navigationInputBusy}
            onClick={() => nudgeCamera("ArrowRight")}
          >
            →
          </button>
          <button
            type="button"
            className="shot-camera-nudge is-up"
            aria-label="镜头上移"
            title="镜头上移"
            disabled={controlsDisabled || navigationInputBusy}
            onClick={() => nudgeCamera("PageUp")}
          >
            ⇧
          </button>
          <button
            type="button"
            className="shot-camera-nudge is-down"
            aria-label="镜头下移"
            title="镜头下移"
            disabled={controlsDisabled || navigationInputBusy}
            onClick={() => nudgeCamera("PageDown")}
          >
            ⇩
          </button>
        </div>
        <output className="shot-camera-focal-readout">
          {focalLengthMm.toFixed(1)} mm
        </output>
        <label className="shot-camera-target-control">
          <span>Target lock</span>
          <select
            aria-label="Right-drag orbit target"
            data-shot-navigation-exempt
            value={targetEntityId ?? ""}
            disabled={targetSelectorDisabled}
            onChange={(event) =>
              setTargetEntityId(event.currentTarget.value || null)
            }
          >
            <option value="">Off (free rotation)</option>
            {targetOptions.map((option) => (
              <option key={option.entityId} value={option.entityId}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {camera?.lockMode === "user" ? (
          <div className="shot-camera-lock-notice" role="status">
            <span>镜头已被用户保护</span>
            <button
              type="button"
              className="shot-camera-unlock"
              disabled={disabled || draft?.pending}
              onClick={() => void onUnlockUserProtectedCamera()}
            >
              解除保护并调整
            </button>
          </div>
        ) : null}
      </div>
      <div
        ref={surfaceRef}
        className={
          dragging
            ? "shot-camera-surface is-dragging"
            : "shot-camera-surface"
        }
        tabIndex={controlsDisabled ? -1 : 0}
        aria-disabled={controlsDisabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointerGesture(event, true)}
        onPointerCancel={(event) => finishPointerGesture(event, false)}
        onContextMenu={(event) => event.preventDefault()}
      />
    </>
  );
};
