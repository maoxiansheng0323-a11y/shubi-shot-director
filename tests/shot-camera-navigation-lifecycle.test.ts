import { act } from "react-test-renderer";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createDefaultScene } from "../src/domain/default-scene";
import type { SceneSpec } from "../src/domain/scene-schema";
import {
  activeCameraIn,
  chooseTarget,
  cleanupNavigationHarnesses,
  createNavigationHarness,
  drag,
  finishDrag,
  installNavigationTestEnvironment,
  latestDraft,
  pointerEvent,
  selectIn,
  surfaceIn,
} from "./helpers/shot-camera-navigation-harness";

let restoreEnvironment: () => void;

beforeAll(() => {
  restoreEnvironment = installNavigationTestEnvironment();
});

afterEach(() => {
  cleanupNavigationHarnesses();
});

afterAll(() => {
  restoreEnvironment();
});

describe("ShotCameraNavigation lifecycle", () => {
  it.each(["scene", "camera"] as const)(
    "resets the selected target when the %s context changes",
    (context) => {
      const scene = createDefaultScene();
      const harness = createNavigationHarness(scene);
      chooseTarget(harness.renderer, "actor_generic_1");
      const next = structuredClone(scene) as SceneSpec;
      if (context === "scene") {
        next.sceneId = "scene_replacement";
      } else {
        const camera = structuredClone(activeCameraIn(next));
        camera.id = "camera_shot_2";
        next.entities.push(camera);
        next.activeCameraId = camera.id;
      }

      harness.update(next);

      expect(selectIn(harness.renderer).props.value).toBe("");
    },
  );

  it.each(["hidden", "removed", "invalid"] as const)(
    "resets a %s target after an authoritative rerender",
    (mode) => {
      const scene = createDefaultScene();
      const harness = createNavigationHarness(scene);
      chooseTarget(harness.renderer, "actor_generic_1");
      const next = structuredClone(scene) as SceneSpec;
      next.revision += 1;
      const actorIndex = next.entities.findIndex(
        (entity) => entity.id === "actor_generic_1",
      );
      if (mode === "removed") {
        next.entities.splice(actorIndex, 1);
      } else if (mode === "hidden") {
        next.entities[actorIndex].visible = false;
      } else {
        next.entities[actorIndex].transform.positionM[0] = Number.NaN;
      }

      harness.update(next);

      expect(selectIn(harness.renderer).props.value).toBe("");
    },
  );

  it("preserves a valid target across own accepted and unrelated revisions", async () => {
    const scene = createDefaultScene();
    const accepted = structuredClone(scene) as SceneSpec;
    accepted.revision += 1;
    const onCommitTransform = vi.fn(async () => accepted);
    const harness = createNavigationHarness(scene, { onCommitTransform });
    chooseTarget(harness.renderer, "actor_generic_1");
    drag(harness, 2, [24, 8]);
    await finishDrag(harness);

    harness.update(accepted);
    expect(selectIn(harness.renderer).props.value).toBe("actor_generic_1");

    const unrelated = structuredClone(accepted) as SceneSpec;
    unrelated.revision += 1;
    harness.update(unrelated);
    expect(selectIn(harness.renderer).props.value).toBe("actor_generic_1");
  });

  it("cancels an external-revision draft without retrying and retains a valid target", () => {
    const scene = createDefaultScene();
    const harness = createNavigationHarness(scene);
    chooseTarget(harness.renderer, "actor_generic_1");
    drag(harness, 2, [35, -12]);
    const external = structuredClone(scene) as SceneSpec;
    external.revision += 1;

    harness.update(external);

    expect(latestDraft(harness.callbacks.onDraftChange)).toBeNull();
    expect(selectIn(harness.renderer).props.value).toBe("actor_generic_1");
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });
    expect(harness.callbacks.onCommitTransform).not.toHaveBeenCalled();
  });

  it("resets an invalid target even on the controller's own accepted revision", async () => {
    const scene = createDefaultScene();
    const accepted = structuredClone(scene) as SceneSpec;
    accepted.revision += 1;
    const actor = accepted.entities.find(
      (entity) => entity.id === "actor_generic_1",
    );
    if (!actor) throw new Error("Missing actor fixture.");
    actor.visible = false;
    const harness = createNavigationHarness(scene, {
      onCommitTransform: vi.fn(async () => accepted),
    });
    chooseTarget(harness.renderer, actor.id);
    drag(harness, 2, [22, 5]);
    await finishDrag(harness);

    harness.update(accepted);

    expect(selectIn(harness.renderer).props.value).toBe("");
  });
});
