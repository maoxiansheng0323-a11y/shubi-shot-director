import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  STUDIO_DOUBLE_CLICK_MS,
  STUDIO_POINTER_DRAG_THRESHOLD_PX,
  classifyStudioPointer,
  createStudioFocusState,
  focusStudioEntity,
  hasStudioPointerExceededDragThreshold,
  reconcileStudioFocus,
  clearStudioFocus,
} from "../src/editor/studio-selection";

describe("studio selection and focus", () => {
  it("supports actor, prop, and camera edit focus but not environments", () => {
    const scene = createDefaultScene();
    const state = createStudioFocusState();

    expect(focusStudioEntity(state, scene, "actor_generic_1").focusedEntityId).toBe(
      "actor_generic_1",
    );
    expect(focusStudioEntity(state, scene, "prop_block_1").focusedEntityId).toBe(
      "prop_block_1",
    );
    expect(focusStudioEntity(state, scene, "camera_shot_1").focusedEntityId).toBe(
      "camera_shot_1",
    );
    expect(focusStudioEntity(state, scene, "environment_room_1").focusedEntityId).toBe(
      null,
    );
  });

  it("classifies movement above threshold as drag and a close second click as focus", () => {
    expect(STUDIO_POINTER_DRAG_THRESHOLD_PX).toBe(5);
    expect(STUDIO_DOUBLE_CLICK_MS).toBe(300);
    expect(hasStudioPointerExceededDragThreshold([10, 10], [15, 10])).toBe(
      false,
    );
    expect(hasStudioPointerExceededDragThreshold([10, 10], [16, 10])).toBe(
      true,
    );
    expect(
      classifyStudioPointer({
        button: 0,
        down: [10, 10],
        up: [16, 10],
        elapsedMs: 40,
        previousClickAtMs: 0,
        nowMs: 100,
      }),
    ).toBe("drag");
    expect(
      classifyStudioPointer({
        button: 0,
        down: [10, 10],
        up: [12, 12],
        elapsedMs: 40,
        previousClickAtMs: 0,
        nowMs: 200,
      }),
    ).toBe("double-click");
  });

  it("treats a short right click as clear and a right drag as orbit", () => {
    expect(
      classifyStudioPointer({
        button: 2,
        down: [10, 10],
        up: [15, 10],
        elapsedMs: 40,
        previousClickAtMs: null,
        nowMs: 100,
      }),
    ).toBe("clear");
    expect(
      classifyStudioPointer({
        button: 2,
        down: [10, 10],
        up: [16, 10],
        elapsedMs: 40,
        previousClickAtMs: null,
        nowMs: 100,
      }),
    ).toBe("orbit");
  });

  it("clears all transient focus and reconciles scene replacement or missing entities", () => {
    const scene = createDefaultScene();
    const focused = focusStudioEntity(
      createStudioFocusState(),
      scene,
      "actor_generic_1",
    );
    const withJoint = { ...focused, focusedActorJointId: "neck" as const };
    expect(clearStudioFocus(withJoint)).toMatchObject({
      selectedEntityId: null,
      focusedEntityId: null,
      focusedActorJointId: null,
    });

    const replacement = structuredClone(scene);
    replacement.sceneId = "scene_replacement";
    expect(reconcileStudioFocus(withJoint, scene, replacement)).toMatchObject({
      focusedEntityId: null,
      focusedActorJointId: null,
    });

    const missing = structuredClone(scene);
    missing.entities = missing.entities.filter(
      (entity) => entity.id !== "actor_generic_1",
    );
    expect(reconcileStudioFocus(withJoint, scene, missing).focusedEntityId).toBe(
      null,
    );
  });
});
