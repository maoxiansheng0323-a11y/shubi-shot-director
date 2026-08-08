import { describe, expect, it } from "vitest";
import { MOUSE } from "three";
import {
  createEditorAutoFrameState,
  decideEditorCameraFrame,
  EDITOR_VIEW_MOUSE_BUTTONS,
  rearmEditorAutoFrameAfterWheel,
} from "../src/editor/EditorCameraRig";

describe("editor camera frame application", () => {
  it("maps studio mouse buttons to pan, dolly, and orbit", () => {
    expect(EDITOR_VIEW_MOUSE_BUTTONS).toEqual({
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.ROTATE,
    });
  });

  it("applies the initial overview without consuming auto focus", () => {
    const decision = decideEditorCameraFrame({
      state: createEditorAutoFrameState(),
      shouldFrame: false,
      targetId: null,
      requestVersion: 0,
      currentDistance: 20,
      requestedDistance: 4,
    });

    expect(decision.applyFrame).toBe(true);
    expect(decision.state).toEqual({
      initialized: true,
      armed: true,
      previousRequestVersion: 0,
      previousTargetId: null,
      lastFrameDistance: null,
    });
  });

  it("frames the first focused target at a deterministic editing scale", () => {
    const initial = {
      initialized: true,
      armed: true,
      previousRequestVersion: 0,
      previousTargetId: null,
      lastFrameDistance: null,
    };
    const distant = decideEditorCameraFrame({
      state: initial,
      shouldFrame: true,
      targetId: "camera_a",
      requestVersion: 1,
      currentDistance: 12,
      requestedDistance: 4,
    });
    const nearby = decideEditorCameraFrame({
      state: initial,
      shouldFrame: true,
      targetId: "camera_a",
      requestVersion: 1,
      currentDistance: 5,
      requestedDistance: 4,
    });

    expect(distant.applyFrame).toBe(true);
    expect(distant.state.armed).toBe(false);
    expect(distant.state.lastFrameDistance).toBe(4);
    expect(nearby.applyFrame).toBe(true);
  });

  it("consumes repeated focus requests without resetting the camera", () => {
    const decision = decideEditorCameraFrame({
      state: {
        initialized: true,
        armed: false,
        previousRequestVersion: 1,
        previousTargetId: "camera_a",
        lastFrameDistance: 4,
      },
      shouldFrame: true,
      targetId: "camera_a",
      requestVersion: 2,
      currentDistance: 9,
      requestedDistance: 4,
    });

    expect(decision.applyFrame).toBe(false);
    expect(decision.state.previousRequestVersion).toBe(2);
    expect(decision.state.armed).toBe(false);
  });

  it("frames a different focused entity even while repeated focus is disarmed", () => {
    const decision = decideEditorCameraFrame({
      state: {
        initialized: true,
        armed: false,
        previousRequestVersion: 1,
        previousTargetId: "camera_a",
        lastFrameDistance: 4,
      },
      shouldFrame: true,
      targetId: "camera_b",
      requestVersion: 2,
      currentDistance: 4,
      requestedDistance: 4,
    });

    expect(decision.applyFrame).toBe(true);
    expect(decision.state.previousTargetId).toBe("camera_b");
    expect(decision.state.armed).toBe(false);
  });

  it("keeps auto focus disarmed when transient focus is cleared", () => {
    const decision = decideEditorCameraFrame({
      state: {
        initialized: true,
        armed: false,
        previousRequestVersion: 1,
        previousTargetId: "camera_a",
        lastFrameDistance: 4,
      },
      shouldFrame: false,
      targetId: null,
      requestVersion: 2,
      currentDistance: 9,
      requestedDistance: 9,
    });

    expect(decision.applyFrame).toBe(false);
    expect(decision.state).toMatchObject({
      armed: false,
      previousRequestVersion: 2,
      lastFrameDistance: 4,
    });
  });

  it("rearms only after an outward wheel zoom crosses the distance threshold", () => {
    const disarmed = {
      initialized: true,
      armed: false,
      previousRequestVersion: 1,
      previousTargetId: "camera_a",
      lastFrameDistance: 4,
    };

    expect(
      rearmEditorAutoFrameAfterWheel(disarmed, {
        deltaY: -100,
        currentDistance: 8,
      }).armed,
    ).toBe(false);
    expect(
      rearmEditorAutoFrameAfterWheel(disarmed, {
        deltaY: 100,
        currentDistance: 5.3,
      }).armed,
    ).toBe(false);
    expect(
      rearmEditorAutoFrameAfterWheel(disarmed, {
        deltaY: 100,
        currentDistance: 5.4,
      }).armed,
    ).toBe(true);
  });
});
