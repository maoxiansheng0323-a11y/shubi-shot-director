import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  beginGroundDrag,
  beginJointDrag,
  canBeginDirectEntityDrag,
  shouldCommitDirectEntityDrag,
  editorGroundAxes,
  frameSelectedBound,
  followFocusedCenter,
  intersectGroundPlane,
  moveEntityByEditorKey,
  resolveEntityWorldBound,
  updateGroundDrag,
  updateJointDrag,
} from "../src/editor/studio-interaction-math";

describe("studio interaction math", () => {
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

  it("turns a limb drag into one normalized local joint rotation", () => {
    const capture = beginJointDrag("upper_arm_r", [0, 0, 0, 1], [10, 10]);
    const rotation = updateJointDrag(capture, [30, 0]);
    expect(rotation[1]).not.toBe(0);
    expect(Math.hypot(...rotation)).toBeCloseTo(1);
  });
});
