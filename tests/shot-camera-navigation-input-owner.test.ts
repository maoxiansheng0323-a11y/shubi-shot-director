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
  cleanupNavigationHarnesses,
  createNavigationHarness,
  drag,
  expectTransformEqual,
  finishDrag,
  installNavigationTestEnvironment,
  latestDraft,
  nudgeIn,
  pointerEvent,
  selectIn,
  surfaceIn,
  unmountNavigationHarness,
  wheelEvent,
} from "./helpers/shot-camera-navigation-harness";
import { rotateShotCameraFree } from "../src/editor/shot-camera-navigation";

let restoreEnvironment: () => void;

beforeAll(() => {
  restoreEnvironment = installNavigationTestEnvironment();
});

afterEach(() => {
  cleanupNavigationHarnesses();
  vi.useRealTimers();
});

afterAll(() => {
  restoreEnvironment();
});

describe("ShotCameraNavigation input ownership", () => {
  it("disables the selector for disabled, protected, active, and pending states", async () => {
    const scene = createDefaultScene();
    const disabledHarness = createNavigationHarness(scene, { disabled: true });
    expect(selectIn(disabledHarness.renderer).props.disabled).toBe(true);

    const protectedScene = structuredClone(scene) as SceneSpec;
    activeCameraIn(protectedScene).lockMode = "user";
    const protectedHarness = createNavigationHarness(protectedScene);
    expect(selectIn(protectedHarness.renderer).props.disabled).toBe(true);

    const keyHarness = createNavigationHarness(scene);
    act(() => {
      keyHarness.ownerDocument.dispatch("keydown", {
        key: "ArrowUp",
        target: keyHarness.surface,
        preventDefault: vi.fn(),
      });
    });
    expect(selectIn(keyHarness.renderer).props.disabled).toBe(true);
    await act(async () => {
      keyHarness.ownerDocument.dispatch("keyup", {
        key: "ArrowUp",
        target: keyHarness.surface,
        preventDefault: vi.fn(),
      });
      await Promise.resolve();
    });

    let resolveCommit: ((value: SceneSpec | void) => void) | undefined;
    const commitPromise = new Promise<SceneSpec | void>((resolve) => {
      resolveCommit = resolve;
    });
    const harness = createNavigationHarness(scene, {
      onCommitTransform: vi.fn(() => commitPromise),
    });
    const surface = surfaceIn(harness.renderer);
    act(() => {
      surface.props.onPointerDown(pointerEvent(harness.surface));
    });
    expect(selectIn(harness.renderer).props.disabled).toBe(true);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerMove(
        pointerEvent(harness.surface, { clientX: 140 }),
      );
    });
    expect(selectIn(harness.renderer).props.disabled).toBe(true);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });
    expect(selectIn(harness.renderer).props.disabled).toBe(true);
    const captureCount = harness.surface.setPointerCapture.mock.calls.length;

    act(() => {
      surfaceIn(harness.renderer).props.onPointerDown(
        pointerEvent(harness.surface, { pointerId: 9 }),
      );
    });
    expect(harness.surface.setPointerCapture).toHaveBeenCalledTimes(captureCount);

    await act(async () => {
      resolveCommit?.(undefined);
      await commitPromise;
      await Promise.resolve();
    });
  });

  it("keeps pointer transform isolated from Arrow input", async () => {
    const scene = createDefaultScene() as SceneSpec;
    const harness = createNavigationHarness(scene);
    const camera = activeCameraIn(scene);
    const delta = [48, -11] as const;
    drag(harness, 2, delta);
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => harness.ownerDocument.dispatch("keydown", keyEvent));
    act(() => harness.ownerDocument.dispatch("keyup", keyEvent));

    await finishDrag(harness);

    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledOnce();
    expectTransformEqual(
      harness.callbacks.onCommitTransform.mock.calls[0][1],
      rotateShotCameraFree(camera, delta),
    );
  });

  it("keeps pointer transform isolated from wheel input", async () => {
    const scene = createDefaultScene() as SceneSpec;
    const harness = createNavigationHarness(scene);
    const camera = activeCameraIn(scene);
    const delta = [37, 9] as const;
    drag(harness, 2, delta);

    act(() => harness.surface.dispatch("wheel", wheelEvent(harness.surface)));
    await finishDrag(harness);

    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledOnce();
    expect(harness.callbacks.onCommitFocalLength).not.toHaveBeenCalled();
    expectTransformEqual(
      harness.callbacks.onCommitTransform.mock.calls[0][1],
      rotateShotCameraFree(camera, delta),
    );
  });

  it("keeps pointer transform isolated from movement-pad input", async () => {
    const scene = createDefaultScene() as SceneSpec;
    const harness = createNavigationHarness(scene);
    const camera = activeCameraIn(scene);
    const delta = [31, -7] as const;
    drag(harness, 2, delta);

    act(() => nudgeIn(harness.renderer).props.onClick());
    await finishDrag(harness);

    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledOnce();
    expectTransformEqual(
      harness.callbacks.onCommitTransform.mock.calls[0][1],
      rotateShotCameraFree(camera, delta),
    );
  });

  it("ignores pointer, wheel, and pad while keyboard input owns the session", async () => {
    const harness = createNavigationHarness();
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => harness.ownerDocument.dispatch("keydown", keyEvent));
    act(() => {
      surfaceIn(harness.renderer).props.onPointerDown(
        pointerEvent(harness.surface),
      );
      harness.surface.dispatch("wheel", wheelEvent(harness.surface));
      nudgeIn(harness.renderer).props.onClick();
    });
    await act(async () => {
      harness.ownerDocument.dispatch("keyup", keyEvent);
      await Promise.resolve();
    });

    expect(harness.surface.setPointerCapture).not.toHaveBeenCalled();
    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledOnce();
    expect(harness.callbacks.onCommitFocalLength).not.toHaveBeenCalled();
  });

  it("ignores pointer, keyboard, and pad while wheel input owns the session", async () => {
    vi.useFakeTimers();
    const harness = createNavigationHarness();
    act(() => harness.surface.dispatch("wheel", wheelEvent(harness.surface)));
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => {
      surfaceIn(harness.renderer).props.onPointerDown(
        pointerEvent(harness.surface),
      );
      harness.ownerDocument.dispatch("keydown", keyEvent);
      nudgeIn(harness.renderer).props.onClick();
    });
    await act(async () => {
      vi.advanceTimersByTime(180);
      await Promise.resolve();
    });

    expect(harness.surface.setPointerCapture).not.toHaveBeenCalled();
    expect(harness.callbacks.onCommitTransform).not.toHaveBeenCalled();
    expect(harness.callbacks.onCommitFocalLength).toHaveBeenCalledOnce();
  });

  it("ignores every new input while a transform commit is pending", async () => {
    let resolveCommit: ((value: SceneSpec | void) => void) | undefined;
    const pending = new Promise<SceneSpec | void>((resolve) => {
      resolveCommit = resolve;
    });
    const onCommitTransform = vi.fn(() => pending);
    const harness = createNavigationHarness(undefined, { onCommitTransform });
    drag(harness, 2, [29, 6]);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });
    const pendingDraft = latestDraft(harness.callbacks.onDraftChange);
    const captureCount = harness.surface.setPointerCapture.mock.calls.length;
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => {
      surfaceIn(harness.renderer).props.onPointerDown(
        pointerEvent(harness.surface, { pointerId: 9 }),
      );
      harness.surface.dispatch("wheel", wheelEvent(harness.surface));
      harness.ownerDocument.dispatch("keydown", keyEvent);
      nudgeIn(harness.renderer).props.onClick();
    });

    expect(onCommitTransform).toHaveBeenCalledOnce();
    expect(harness.surface.setPointerCapture).toHaveBeenCalledTimes(captureCount);
    expect(harness.callbacks.onCommitFocalLength).not.toHaveBeenCalled();
    expect(latestDraft(harness.callbacks.onDraftChange)).toEqual(pendingDraft);

    await act(async () => {
      resolveCommit?.(undefined);
      await pending;
      await Promise.resolve();
    });
  });

  it("does not let an externally cancelled commit release a newer owner", async () => {
    let resolveOldCommit: ((value: SceneSpec | void) => void) | undefined;
    const oldCommit = new Promise<SceneSpec | void>((resolve) => {
      resolveOldCommit = resolve;
    });
    const onCommitTransform = vi
      .fn()
      .mockImplementationOnce(() => oldCommit)
      .mockImplementation(async () => undefined);
    const scene = createDefaultScene() as SceneSpec;
    const harness = createNavigationHarness(scene, { onCommitTransform });
    drag(harness, 2, [25, 4]);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });

    const external = structuredClone(scene) as SceneSpec;
    external.revision += 2;
    harness.update(external);
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => harness.ownerDocument.dispatch("keydown", keyEvent));
    const newerDraft = latestDraft(harness.callbacks.onDraftChange);
    expect(newerDraft?.transform).toBeDefined();

    await act(async () => {
      resolveOldCommit?.(undefined);
      await oldCommit;
      await Promise.resolve();
    });

    expect(latestDraft(harness.callbacks.onDraftChange)).toEqual(newerDraft);
    await act(async () => {
      harness.ownerDocument.dispatch("keyup", keyEvent);
      await Promise.resolve();
    });
    expect(onCommitTransform).toHaveBeenCalledTimes(2);
  });

  it("keeps commit ownership when its exact next revision arrives before the response", async () => {
    let resolveCommit: ((value: SceneSpec | void) => void) | undefined;
    const pending = new Promise<SceneSpec | void>((resolve) => {
      resolveCommit = resolve;
    });
    const onCommitTransform = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockImplementation(async () => undefined);
    const scene = createDefaultScene() as SceneSpec;
    const harness = createNavigationHarness(scene, { onCommitTransform });
    drag(harness, 2, [27, -3]);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });
    const pendingDraft = latestDraft(harness.callbacks.onDraftChange);

    const acceptedEvent = structuredClone(scene) as SceneSpec;
    acceptedEvent.revision += 1;
    harness.update(acceptedEvent);
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => harness.ownerDocument.dispatch("keydown", keyEvent));
    expect(latestDraft(harness.callbacks.onDraftChange)).toEqual(pendingDraft);
    expect(onCommitTransform).toHaveBeenCalledOnce();

    await act(async () => {
      resolveCommit?.(acceptedEvent);
      await pending;
      await Promise.resolve();
    });
    expect(latestDraft(harness.callbacks.onDraftChange)).toBeNull();

    act(() => harness.ownerDocument.dispatch("keydown", keyEvent));
    await act(async () => {
      harness.ownerDocument.dispatch("keyup", keyEvent);
      await Promise.resolve();
    });
    expect(onCommitTransform).toHaveBeenCalledTimes(2);
  });

  it("releases pointer ownership after pointercancel", async () => {
    const harness = createNavigationHarness();
    drag(harness, 2, [21, 5]);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerCancel(
        pointerEvent(harness.surface),
      );
    });
    const keyEvent = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    act(() => harness.ownerDocument.dispatch("keydown", keyEvent));
    await act(async () => {
      harness.ownerDocument.dispatch("keyup", keyEvent);
      await Promise.resolve();
    });

    expect(harness.surface.releasePointerCapture).toHaveBeenCalled();
    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledOnce();
  });

  it("does not publish after unmount when a commit settles", async () => {
    let resolveCommit: ((value: SceneSpec | void) => void) | undefined;
    const pending = new Promise<SceneSpec | void>((resolve) => {
      resolveCommit = resolve;
    });
    const onDraftChange = vi.fn();
    const harness = createNavigationHarness(undefined, {
      onDraftChange,
      onCommitTransform: vi.fn(() => pending),
    });
    drag(harness, 2, [18, -4]);
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });
    unmountNavigationHarness(harness);
    const callCountAfterUnmount = onDraftChange.mock.calls.length;

    await act(async () => {
      resolveCommit?.(undefined);
      await pending;
      await Promise.resolve();
    });

    expect(onDraftChange).toHaveBeenCalledTimes(callCountAfterUnmount);
  });
});
