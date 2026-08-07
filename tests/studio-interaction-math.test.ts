import { describe, expect, it } from "vitest";
import { Euler, MathUtils, Quaternion } from "three";
import { createDefaultScene } from "../src/domain/default-scene";
import { rotateVector } from "../src/domain/scene-math";
import {
  beginEntityRotationDrag,
  beginGroundDrag,
  beginJointDrag,
  canBeginDirectEntityDrag,
  directEntityDragMode,
  shouldCommitDirectEntityDrag,
  shouldShowStudioTransformControls,
  editorGroundAxes,
  frameSelectedBound,
  followFocusedCenter,
  intersectGroundPlane,
  moveEntityByEditorKey,
  resolveEntityWorldBound,
  rotationDragAxesInLocalSpace,
  updateGroundDrag,
  updateEntityRotationDrag,
  updateJointDrag,
} from "../src/editor/studio-interaction-math";

describe("studio interaction math", () => {
  it("uses rotation instead of translation for a focused camera proxy", () => {
    expect(
      directEntityDragMode({
        view: "editor",
        button: 0,
        toolMode: "select",
        lockMode: "none",
        entityKind: "camera",
        focused: true,
      }),
    ).toBe("rotate");
    expect(
      directEntityDragMode({
        view: "editor",
        button: 0,
        toolMode: "select",
        lockMode: "none",
        entityKind: "camera",
        focused: false,
      }),
    ).toBe("translate");
  });

  it("turns a focused camera proxy drag into a normalized rotation", () => {
    const capture = beginEntityRotationDrag(
      [0, 0, 0, 1],
      [10, 10],
      { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] },
    );
    const rotation = updateEntityRotationDrag(capture, [30, 10]);
    expect(rotation[0]).toBeCloseTo(0);
    expect(rotation[1]).toBeLessThan(0);
    expect(Math.hypot(...rotation)).toBeCloseTo(1);
  });

  it("rotates a camera around the captured editor-screen axes", () => {
    const capture = beginEntityRotationDrag(
      [0, 0, 0, 1],
      [0, 0],
      { right: [0, 1, 0], up: [0, 0, -1], forward: [-1, 0, 0] },
    );
    const horizontal = updateEntityRotationDrag(capture, [20, 0]);
    const vertical = updateEntityRotationDrag(capture, [0, -20]);
    expect(horizontal[2]).toBeGreaterThan(0);
    expect(horizontal[0]).toBeCloseTo(0);
    expect(vertical[1]).toBeGreaterThan(0);
    expect(vertical[0]).toBeCloseTo(0);
  });

  it("converts editor-screen axes into a rotated joint parent's local space", () => {
    const halfTurn = Math.sqrt(0.5);
    const axes = rotationDragAxesInLocalSpace(
      { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] },
      [0, 0, halfTurn, halfTurn],
    );
    expect(axes.right[0]).toBeCloseTo(0);
    expect(axes.right[1]).toBeCloseTo(-1);
    expect(axes.up[0]).toBeCloseTo(1);
    expect(axes.up[1]).toBeCloseTo(0);
    expect(axes.forward).toEqual([0, 0, -1]);
  });

  it("allows ordinary editor selection to begin an entity drag", () => {
    expect(
      canBeginDirectEntityDrag({
        view: "editor",
        button: 0,
        toolMode: "select",
        lockMode: "none",
        entityKind: "prop",
      }),
    ).toBe(true);
    expect(
      canBeginDirectEntityDrag({
        view: "editor",
        button: 0,
        toolMode: "select",
        lockMode: "user",
        entityKind: "prop",
      }),
    ).toBe(false);
  });

  it("does not submit a transform for a click without movement", () => {
    expect(shouldCommitDirectEntityDrag(false)).toBe(false);
    expect(shouldCommitDirectEntityDrag(true)).toBe(true);
  });

  it("keeps transform gizmos out of direct-manipulation select mode", () => {
    expect(
      shouldShowStudioTransformControls({
        selected: true,
        view: "editor",
        lockMode: "none",
        toolMode: "select",
      }),
    ).toBe(false);
    expect(
      shouldShowStudioTransformControls({
        selected: true,
        view: "editor",
        lockMode: "none",
        toolMode: "rotate",
      }),
    ).toBe(true);
  });

  it("resolves finite actor, prop, and camera bounds", () => {
    const scene = createDefaultScene();
    for (const entityId of [
      "actor_generic_1",
      "prop_block_1",
      "camera_shot_1",
    ]) {
      const bound = resolveEntityWorldBound(scene, entityId);
      expect(bound).not.toBeNull();
      expect(bound?.radiusM).toBeGreaterThan(0);
      expect(bound?.centerM.every(Number.isFinite)).toBe(true);
    }
    expect(resolveEntityWorldBound(scene, "environment_room_1")).toBeNull();
  });

  it("frames a bound along the current view direction and fits both axes", () => {
    const frame = frameSelectedBound(
      { centerM: [2, 1, -3], radiusM: 1 },
      [0, 0, -1],
      50,
      16 / 9,
    );
    expect(frame).not.toBeNull();
    expect(frame?.targetM).toEqual([2, 1, -3]);
    expect(frame?.positionM[0]).toBeCloseTo(2);
    expect(frame?.positionM[1]).toBeCloseTo(1);
    expect(frame?.positionM[2]).toBeGreaterThan(-3);
  });

  it("follows an accepted center delta without changing camera distance", () => {
    const frame = { positionM: [5, 3, 4] as [number, number, number], targetM: [0, 1, 0] as [number, number, number] };
    const next = followFocusedCenter(frame, [0, 1, 0], [2, 2, -1]);
    expect(next).toEqual({
      positionM: [7, 4, 3],
      targetM: [2, 2, -1],
    });
  });

  it("returns normalized horizontal editor axes", () => {
    const axes = editorGroundAxes([1, -2, -3]);
    expect(axes.forward).toEqual([1 / Math.sqrt(10), 0, -3 / Math.sqrt(10)]);
    expect(axes.right[1]).toBe(0);
    expect(Math.hypot(axes.right[0], axes.right[2])).toBeCloseTo(1);
  });

  it("preserves the pointer offset during ground-plane dragging", () => {
    const ray = { originM: [0, 2, 2] as [number, number, number], directionM: [0, -1, -1] as [number, number, number] };
    expect(intersectGroundPlane(ray, 0)).toEqual([0, 0, 0]);
    const capture = beginGroundDrag([2, 0, 3], ray, 0);
    expect(capture).not.toBeNull();
    const nextRay = { originM: [1, 2, 2] as [number, number, number], directionM: [0, -1, -1] as [number, number, number] };
    expect(updateGroundDrag(capture!, nextRay)).toEqual([3, 0, 3]);
  });

  it("moves in editor-relative axes with modifier step precedence", () => {
    const transform = {
      positionM: [0, 1, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const view = [0, 0, -1] as [number, number, number];
    expect(moveEntityByEditorKey(transform, "ArrowUp", view, {} ).positionM).toEqual([0, 1, -0.1]);
    expect(moveEntityByEditorKey(transform, "ArrowRight", view, { shiftKey: true }).positionM).toEqual([0.5, 1, 0]);
    expect(moveEntityByEditorKey(transform, "PageUp", view, { altKey: true }).positionM).toEqual([0, 1.02, 0]);
  });

  it.each([
    "upper_leg_l",
    "lower_leg_l",
    "upper_leg_r",
    "lower_leg_r",
  ] as const)("moves %s toward the pointer around its screen pivot", (jointId) => {
    const axes = {
      right: [1, 0, 0] as [number, number, number],
      up: [0, 1, 0] as [number, number, number],
      forward: [0, 0, -1] as [number, number, number],
    };
    const startPointer = [10, 30] as const;
    const pivotPointer = [10, 10] as const;
    const capture = beginJointDrag(
      jointId,
      [0, 0, 0, 1],
      startPointer,
      axes,
      pivotPointer,
    );

    const rightRotation = updateJointDrag(capture, [30, 30]);
    const leftRotation = updateJointDrag(capture, [-10, 30]);
    expect(rotateVector([0, -1, 0], rightRotation)[0]).toBeGreaterThan(0);
    expect(rotateVector([0, -1, 0], leftRotation)[0]).toBeLessThan(0);
    expect(Math.hypot(...rightRotation)).toBeCloseTo(1);
  });

  it("maps head dragging to turn and nod without rolling around the screen", () => {
    const capture = beginJointDrag(
      "neck",
      [0, 0, 0, 1],
      [0, 0],
      {
        right: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, -1],
      },
      [0, 20],
    );

    const turned = updateJointDrag(capture, [80, 0]);
    const nodded = updateJointDrag(capture, [0, 80]);
    const turnedForward = rotateVector([0, 0, 1], turned);
    const turnedUp = rotateVector([0, 1, 0], turned);
    const noddedForward = rotateVector([0, 0, 1], nodded);

    expect(turnedForward[0]).toBeGreaterThan(0);
    expect(turnedUp[0]).toBeCloseTo(0);
    expect(turnedUp[2]).toBeCloseTo(0);
    expect(noddedForward[1]).toBeLessThan(0);
  });

  it("clamps head dragging to a usable cervical range", () => {
    const capture = beginJointDrag(
      "neck",
      [0, 0, 0, 1],
      [0, 0],
      {
        right: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, -1],
      },
      [0, 20],
    );
    const rotation = updateJointDrag(capture, [1000, 1000]);
    const euler = new Euler().setFromQuaternion(
      new Quaternion(...rotation),
      "XYZ",
    );

    expect(Math.abs(MathUtils.radToDeg(euler.x))).toBeLessThanOrEqual(50.00001);
    expect(Math.abs(MathUtils.radToDeg(euler.y))).toBeLessThanOrEqual(75.00001);
    expect(Math.abs(MathUtils.radToDeg(euler.z))).toBeLessThanOrEqual(25.00001);
  });
});
