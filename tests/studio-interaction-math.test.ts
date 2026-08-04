import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  editorGroundAxes,
  frameSelectedBound,
  followFocusedCenter,
  resolveEntityWorldBound,
} from "../src/editor/studio-interaction-math";

describe("studio interaction math", () => {
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
});
