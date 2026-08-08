type StudioPointerCancellationListener = (pointerId: number) => void;

export interface StudioPointerSample {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface StudioPointerDragListeners {
  onMove: (sample: StudioPointerSample) => boolean;
  onEnd: (sample: StudioPointerSample) => boolean;
}

const pointerSample = (event: Event): StudioPointerSample | null => {
  const pointer = event as Event & {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
  };
  if (
    typeof pointer.pointerId !== "number" ||
    typeof pointer.clientX !== "number" ||
    typeof pointer.clientY !== "number"
  ) {
    return null;
  }
  return {
    pointerId: pointer.pointerId,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
  };
};

export const subscribeStudioPointerDrag = (
  target: EventTarget,
  listeners: StudioPointerDragListeners,
): (() => void) => {
  const listenerOptions = { capture: true } as const;
  const handle = (
    listener: StudioPointerDragListeners["onMove"],
    event: Event,
  ): void => {
    const sample = pointerSample(event);
    if (!sample || !listener(sample)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const handleMove = (event: Event): void => handle(listeners.onMove, event);
  const handleEnd = (event: Event): void => handle(listeners.onEnd, event);

  target.addEventListener("pointermove", handleMove, listenerOptions);
  target.addEventListener("pointerup", handleEnd, listenerOptions);
  return () => {
    target.removeEventListener("pointermove", handleMove, listenerOptions);
    target.removeEventListener("pointerup", handleEnd, listenerOptions);
  };
};

export const subscribeStudioPointerCancellation = (
  target: EventTarget,
  onCancel: StudioPointerCancellationListener,
): (() => void) => {
  const listenerOptions = { capture: true } as const;
  const handleCancellation = (event: Event): void => {
    const pointerId = (event as Event & { pointerId?: number }).pointerId;
    if (typeof pointerId === "number") {
      onCancel(pointerId);
    }
  };

  target.addEventListener("pointercancel", handleCancellation, listenerOptions);
  target.addEventListener(
    "lostpointercapture",
    handleCancellation,
    listenerOptions,
  );
  return () => {
    target.removeEventListener(
      "pointercancel",
      handleCancellation,
      listenerOptions,
    );
    target.removeEventListener(
      "lostpointercapture",
      handleCancellation,
      listenerOptions,
    );
  };
};
