import { describe, expect, it, vi } from "vitest";
import { subscribeStudioPointerCancellation } from "../src/editor/studio-pointer-events";

const pointerEvent = (type: string, pointerId: number): Event => {
  const event = new Event(type);
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
};

describe("studio pointer event cancellation", () => {
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
