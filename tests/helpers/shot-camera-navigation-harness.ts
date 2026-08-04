import { createElement, type ComponentProps } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { expect, vi } from "vitest";

import { createDefaultScene } from "../../src/domain/default-scene";
import type {
  CameraEntity,
  SceneSpec,
  TransformSpec,
} from "../../src/domain/scene-schema";
import {
  ShotCameraNavigation,
  type ShotCameraDraft,
} from "../../src/editor/ShotCameraNavigation";

type NavigationProps = ComponentProps<typeof ShotCameraNavigation>;

export class MockHtmlElement {
  readonly isContentEditable = false;

  constructor(readonly tagName: string) {}

  closest(): MockHtmlElement | null {
    return ["input", "textarea", "select"].includes(
      this.tagName.toLowerCase(),
    )
      ? this
      : null;
  }
}

export class MockOwnerDocument {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener = (
    type: string,
    listener: (event: unknown) => void,
  ): void => {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  };

  removeEventListener = (
    type: string,
    listener: (event: unknown) => void,
  ): void => {
    this.listeners.get(type)?.delete(listener);
  };

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

export class MockSurface extends MockHtmlElement {
  readonly ownerDocument: MockOwnerDocument;
  readonly clientHeight = 720;
  readonly capturedPointers = new Set<number>();
  readonly focus = vi.fn();
  readonly setPointerCapture = vi.fn((pointerId: number) => {
    this.capturedPointers.add(pointerId);
  });
  readonly releasePointerCapture = vi.fn((pointerId: number) => {
    this.capturedPointers.delete(pointerId);
  });
  readonly hasPointerCapture = vi.fn((pointerId: number) =>
    this.capturedPointers.has(pointerId),
  );
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(ownerDocument: MockOwnerDocument) {
    super("div");
    this.ownerDocument = ownerDocument;
  }

  addEventListener = (
    type: string,
    listener: (event: unknown) => void,
  ): void => {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  };

  removeEventListener = (
    type: string,
    listener: (event: unknown) => void,
  ): void => {
    this.listeners.get(type)?.delete(listener);
  };

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

export interface NavigationHarness {
  renderer: ReactTestRenderer;
  ownerDocument: MockOwnerDocument;
  surface: MockSurface;
  callbacks: {
    onDraftChange: ReturnType<typeof vi.fn>;
    onCommitTransform: ReturnType<typeof vi.fn>;
    onCommitFocalLength: ReturnType<typeof vi.fn>;
  };
  update: (scene: SceneSpec, props?: Partial<NavigationProps>) => void;
}

const mountedRenderers = new Set<ReactTestRenderer>();

export const installNavigationTestEnvironment = (): (() => void) => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const hadOwnActEnvironment = Object.prototype.hasOwnProperty.call(
    actEnvironment,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("HTMLElement", MockHtmlElement);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  return () => {
    vi.unstubAllGlobals();
    if (hadOwnActEnvironment) {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    } else {
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    }
  };
};

export const cleanupNavigationHarnesses = (): void => {
  for (const renderer of mountedRenderers) {
    act(() => renderer.unmount());
  }
  mountedRenderers.clear();
};

export const activeCameraIn = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (!camera) throw new Error("Missing active camera fixture.");
  return camera;
};

export const createNavigationHarness = (
  scene: SceneSpec = createDefaultScene() as SceneSpec,
  props: Partial<NavigationProps> = {},
): NavigationHarness => {
  const ownerDocument = new MockOwnerDocument();
  const surface = new MockSurface(ownerDocument);
  const onDraftChange = vi.fn();
  const onCommitTransform = vi.fn(async () => undefined);
  const onCommitFocalLength = vi.fn(async () => undefined);
  let currentProps: NavigationProps = {
    scene,
    disabled: false,
    onUnlockUserProtectedCamera: () => undefined,
    onDraftChange,
    onCommitTransform,
    onCommitFocalLength,
    ...props,
  };
  const render = () => createElement(ShotCameraNavigation, currentProps);
  const originalConsoleError = console.error;
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    originalConsoleError(...args);
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(render(), {
        createNodeMock: (element) =>
          (element.props as { className?: string }).className?.includes(
            "shot-camera-surface",
          )
            ? surface
            : new MockHtmlElement(String(element.type)),
      });
    });
  } finally {
    errorSpy.mockRestore();
  }
  if (!renderer) throw new Error("Navigation renderer was not created.");
  mountedRenderers.add(renderer);
  return {
    renderer,
    ownerDocument,
    surface,
    callbacks: {
      onDraftChange,
      onCommitTransform,
      onCommitFocalLength,
    },
    update: (nextScene, nextProps = {}) => {
      currentProps = {
        ...currentProps,
        ...nextProps,
        scene: nextScene,
      };
      act(() => renderer?.update(render()));
    },
  };
};

export const unmountNavigationHarness = (
  harness: NavigationHarness,
): void => {
  act(() => harness.renderer.unmount());
  mountedRenderers.delete(harness.renderer);
};

export const selectIn = (
  renderer: ReactTestRenderer,
): ReactTestInstance =>
  renderer.root.findByProps({
    "aria-label": "Right-drag orbit target",
  });

export const surfaceIn = (
  renderer: ReactTestRenderer,
): ReactTestInstance =>
  renderer.root.find(
    (node) =>
      node.type === "div" &&
      String(node.props.className).includes("shot-camera-surface"),
  );

export const pointerEvent = (
  surface: MockSurface,
  overrides: Partial<{
    button: number;
    pointerId: number;
    clientX: number;
    clientY: number;
  }> = {},
) => ({
  button: 2,
  pointerId: 7,
  clientX: 100,
  clientY: 100,
  target: surface,
  currentTarget: surface,
  preventDefault: vi.fn(),
  ...overrides,
});

export const wheelEvent = (surface: MockSurface) => ({
  deltaY: -120,
  target: surface,
  preventDefault: vi.fn(),
});

export const nudgeIn = (
  renderer: ReactTestRenderer,
): ReactTestInstance =>
  renderer.root.find(
    (node) =>
      node.type === "button" &&
      String(node.props.className).includes("is-forward"),
  );

export const latestDraft = (
  callback: ReturnType<typeof vi.fn>,
): ShotCameraDraft | null | undefined =>
  callback.mock.calls.at(-1)?.[0] as ShotCameraDraft | null | undefined;

export const expectTransformEqual = (
  actual: TransformSpec,
  expected: TransformSpec,
): void => {
  expect(actual.positionM).toEqual(expected.positionM);
  expect(actual.scale).toEqual(expected.scale);
  const dot = actual.rotation.reduce(
    (sum, value, index) => sum + value * expected.rotation[index],
    0,
  );
  expect(Math.abs(dot)).toBeCloseTo(1, 8);
};

export const chooseTarget = (
  renderer: ReactTestRenderer,
  entityId: string,
): void => {
  act(() => {
    selectIn(renderer).props.onChange({ currentTarget: { value: entityId } });
  });
};

export const drag = (
  harness: NavigationHarness,
  button: 0 | 2,
  delta: readonly [number, number],
): void => {
  const surface = surfaceIn(harness.renderer);
  act(() => {
    surface.props.onPointerDown(pointerEvent(harness.surface, { button }));
  });
  act(() => {
    surfaceIn(harness.renderer).props.onPointerMove(
      pointerEvent(harness.surface, {
        button,
        clientX: 100 + delta[0],
        clientY: 100 + delta[1],
      }),
    );
  });
};

export const finishDrag = async (
  harness: NavigationHarness,
): Promise<void> => {
  await act(async () => {
    surfaceIn(harness.renderer).props.onPointerUp(
      pointerEvent(harness.surface),
    );
    await Promise.resolve();
  });
};
