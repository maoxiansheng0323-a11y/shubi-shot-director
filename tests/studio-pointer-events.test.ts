import { describe, expect, it, vi } from "vitest";
import {
  subscribeStudioPointerCancellation,
  subscribeStudioPointerDrag,
} from "../src/editor/studio-pointer-events";

const pointerEvent = (type: string, pointerId: number): Event => {
  const event = new Event(type);
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
};

const positionedPointerEvent = (
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): Event => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
};

describe("studio pointer event cancellation", () => {
  it("keeps an accepted drag alive on the document until pointer-up", () => {
    const target = new EventTarget();
    const onMove = vi.fn(() => true);
    const onEnd = vi.fn(() => true);
    const unsubscribe = subscribeStudioPointerDrag(target, { onMove, onEnd });
    const move = positionedPointerEvent("pointermove", 3, 120, 240);
    const up = positionedPointerEvent("pointerup", 3, 160, 260);

    target.dispatchEvent(move);
    target.dispatchEvent(up);

    expect(onMove).toHaveBeenCalledWith({
      pointerId: 3,
      clientX: 120,
      clientY: 240,
    });
    expect(onEnd).toHaveBeenCalledWith({
      pointerId: 3,
      clientX: 160,
      clientY: 260,
    });
    expect(move.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);

    unsubscribe();
    target.dispatchEvent(positionedPointerEvent("pointermove", 3, 200, 300));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated pointer events untouched", () => {
    const target = new EventTarget();
    const unsubscribe = subscribeStudioPointerDrag(target, {
      onMove: () => false,
      onEnd: () => false,
    });
    const move = positionedPointerEvent("pointermove", 8, 20, 30);

    target.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(false);
    unsubscribe();
  });

  it("observes DOM pointer cancellation and lost capture until unsubscribed", () => {
    const target = new EventTarget();
    const onCancel = vi.fn();
    const unsubscribe = subscribeStudioPointerCancellation(target, onCancel);

    target.dispatchEvent(pointerEvent("pointercancel", 4));
    target.dispatchEvent(pointerEvent("lostpointercapture", 7));
    expect(onCancel.mock.calls).toEqual([[4], [7]]);

    unsubscribe();
    target.dispatchEvent(pointerEvent("pointercancel", 9));
    expect(onCancel.mock.calls).toEqual([[4], [7]]);
  });
});
