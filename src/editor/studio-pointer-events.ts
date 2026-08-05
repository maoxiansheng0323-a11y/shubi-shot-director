type StudioPointerCancellationListener = (pointerId: number) => void;

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
