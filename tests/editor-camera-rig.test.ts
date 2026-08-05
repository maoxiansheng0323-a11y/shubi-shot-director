import { describe, expect, it } from "vitest";
import { MOUSE } from "three";
import {
  EDITOR_VIEW_MOUSE_BUTTONS,
  shouldApplyEditorCameraFrame,
} from "../src/editor/EditorCameraRig";

describe("editor camera frame application", () => {
  it("maps studio mouse buttons to pan, dolly, and orbit", () => {
    expect(EDITOR_VIEW_MOUSE_BUTTONS).toEqual({
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.ROTATE,
    });
  });

  it("applies the initial frame exactly once", () => {
    expect(
      shouldApplyEditorCameraFrame({
        initialized: false,
        shouldFrame: false,
        previousRequestVersion: null,
        requestVersion: 0,
      }),
    ).toBe(true);
  });

  it("frames only when an explicit focused request changes", () => {
    expect(
      shouldApplyEditorCameraFrame({
        initialized: true,
        shouldFrame: true,
        previousRequestVersion: 1,
        requestVersion: 2,
      }),
    ).toBe(true);
    expect(
      shouldApplyEditorCameraFrame({
        initialized: true,
        shouldFrame: true,
        previousRequestVersion: 2,
        requestVersion: 2,
      }),
    ).toBe(false);
    expect(
      shouldApplyEditorCameraFrame({
        initialized: true,
        shouldFrame: false,
        previousRequestVersion: 2,
        requestVersion: 3,
      }),
    ).toBe(false);
  });
});
