import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  quaternionFromEulerDegrees,
  rotateVector,
  uprightCameraRotation,
} from "../src/domain/scene-math";
import type {
  CameraEntity,
  TransformSpec,
  Vec3,
} from "../src/domain/scene-schema";
import { Inspector } from "../src/editor/Inspector";
import { transformsEqual } from "../src/editor/manual-patches";

const expectVectorClose = (actual: Vec3, expected: Vec3): void => {
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 8);
  });
};

const normalize = (vector: Vec3): Vec3 => {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length) as Vec3;
};

const expectedWorldUp = (forward: Vec3): Vec3 => {
  const dot = forward[1];
  return normalize([
    -forward[0] * dot,
    1 - forward[1] * dot,
    -forward[2] * dot,
  ]);
};

const selectedCamera = (): {
  scene: ReturnType<typeof createDefaultScene>;
  camera: CameraEntity;
} => {
  const scene = createDefaultScene();
  const camera = scene.entities.find(
    (entity): entity is CameraEntity => entity.kind === "camera",
  );
  if (!camera) throw new Error("Camera fixture is missing.");
  return { scene, camera };
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  const originalConsoleError = console.error;
  consoleError = vi.spyOn(console, "error").mockImplementation((...args) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    originalConsoleError(...args);
  });
});

afterAll(() => {
  consoleError.mockRestore();
});

describe("camera upright control", () => {
  it("removes roll while preserving the exact viewing direction", () => {
    const rolled = quaternionFromEulerDegrees([23, -37, 146]);
    const forward = rotateVector([0, 0, -1], rolled);
    const upright = uprightCameraRotation(rolled);

    expectVectorClose(rotateVector([0, 0, -1], upright), forward);
    expectVectorClose(rotateVector([0, 1, 0], upright), expectedWorldUp(forward));
  });

  it("uses a deterministic upright result for a vertical camera", () => {
    const vertical = quaternionFromEulerDegrees([90, 0, 173]);
    const forward = rotateVector([0, 0, -1], vertical);
    const upright = uprightCameraRotation(vertical);

    expectVectorClose(rotateVector([0, 0, -1], upright), forward);
    expectVectorClose(rotateVector([0, 1, 0], upright), [0, 0, 1]);
  });

  it("keeps an already upright transform a no-op", () => {
    const transform: TransformSpec = {
      positionM: [2, 3, 4],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const next = {
      ...transform,
      rotation: uprightCameraRotation(transform.rotation),
    };

    expect(transformsEqual(transform, next)).toBe(true);
  });

  it("commits one position-preserving transform for a workflow-locked camera", () => {
    const { scene, camera } = selectedCamera();
    camera.lockMode = "workflow";
    camera.transform.rotation = quaternionFromEulerDegrees([0, 0, 180]);
    const onCommitTransform = vi.fn();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        createElement(Inspector, {
          scene,
          selectedId: camera.id,
          onCommitTransform,
        }),
      );
    });
    const button = renderer!.root.findByProps({ "aria-label": "镜头回正" });
    expect(button.props.disabled).toBe(false);

    act(() => button.props.onClick());

    expect(onCommitTransform).toHaveBeenCalledTimes(1);
    const [entityId, transform] = onCommitTransform.mock.calls[0] as [
      string,
      TransformSpec,
    ];
    expect(entityId).toBe(camera.id);
    expect(transform.positionM).toEqual(camera.transform.positionM);
    expect(transform.scale).toEqual(camera.transform.scale);
    expectVectorClose(rotateVector([0, 0, -1], transform.rotation), [0, 0, -1]);
    expectVectorClose(rotateVector([0, 1, 0], transform.rotation), [0, 1, 0]);
    act(() => renderer!.unmount());
  });

  it("disables the control for a user-protected camera", () => {
    const { scene, camera } = selectedCamera();
    camera.lockMode = "user";
    const onCommitTransform = vi.fn();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        createElement(Inspector, {
          scene,
          selectedId: camera.id,
          onCommitTransform,
        }),
      );
    });
    const button = renderer!.root.findByProps({ "aria-label": "镜头回正" });

    expect(button.props.disabled).toBe(true);
    expect(onCommitTransform).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });
});
