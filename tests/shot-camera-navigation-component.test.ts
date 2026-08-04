import { createElement, type ComponentProps } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
  type ReactTestRendererNode,
} from "react-test-renderer";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@react-three/fiber", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-three/fiber")>();
  return { ...actual, Canvas: () => null };
});

vi.mock("@react-three/drei", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-three/drei")>();
  const View = Object.assign(
    (props: { id?: string }) =>
      createElement("div", { "data-mock-view": props.id }),
    { Port: () => null },
  );
  return { ...actual, View };
});

import { createDefaultScene } from "../src/domain/default-scene";
import type {
  CameraEntity,
  SceneSpec,
  TransformSpec,
} from "../src/domain/scene-schema";
import {
  deriveShotPanReferenceDistance,
  orbitShotCamera,
  panShotCamera,
  rotateShotCameraFree,
} from "../src/editor/shot-camera-navigation";
import { resolveShotOrbitTargetCenter } from "../src/editor/shot-camera-target-lock";
import {
  ShotCameraNavigation,
  type ShotCameraDraft,
} from "../src/editor/ShotCameraNavigation";
import { ViewportWorkspace } from "../src/editor/ViewportWorkspace";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

class MockHtmlElement {
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

class MockOwnerDocument {
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

class MockSurface extends MockHtmlElement {
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
}

type NavigationProps = ComponentProps<typeof ShotCameraNavigation>;

interface Harness {
  renderer: ReactTestRenderer;
  ownerDocument: MockOwnerDocument;
  surface: MockSurface;
  callbacks: {
    onDraftChange: ReturnType<typeof vi.fn>;
    onCommitTransform: ReturnType<typeof vi.fn>;
  };
  update: (scene: SceneSpec, props?: Partial<NavigationProps>) => void;
}

const mountedRenderers = new Set<ReactTestRenderer>();

beforeAll(() => {
  vi.stubGlobal("HTMLElement", MockHtmlElement);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  for (const renderer of mountedRenderers) {
    act(() => renderer.unmount());
  }
  mountedRenderers.clear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const activeCameraIn = (scene: SceneSpec): CameraEntity => {
  const camera = scene.entities.find(
    (entity): entity is CameraEntity =>
      entity.kind === "camera" && entity.id === scene.activeCameraId,
  );
  if (!camera) throw new Error("Missing active camera fixture.");
  return camera;
};

const createHarness = (
  scene: SceneSpec = createDefaultScene() as SceneSpec,
  props: Partial<NavigationProps> = {},
): Harness => {
  const ownerDocument = new MockOwnerDocument();
  const surface = new MockSurface(ownerDocument);
  const onDraftChange = vi.fn();
  const onCommitTransform = vi.fn(async () => undefined);
  let currentProps: NavigationProps = {
    scene,
    disabled: false,
    onUnlockUserProtectedCamera: () => undefined,
    onDraftChange,
    onCommitTransform,
    onCommitFocalLength: async () => undefined,
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
    callbacks: { onDraftChange, onCommitTransform },
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

const selectIn = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.findByProps({
    "aria-label": "Right-drag orbit target",
  });

const surfaceIn = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.find(
    (node) =>
      node.type === "div" &&
      String(node.props.className).includes("shot-camera-surface"),
  );

const pointerEvent = (
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

const latestDraft = (
  callback: ReturnType<typeof vi.fn>,
): ShotCameraDraft | null | undefined =>
  callback.mock.calls.at(-1)?.[0] as ShotCameraDraft | null | undefined;

const expectTransformEqual = (
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

const findJsonByClassName = (
  node: ReactTestRendererNode | ReactTestRendererNode[] | null,
  className: string,
): ReactTestRendererJSON | null => {
  if (node === null || typeof node === "string") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findJsonByClassName(child, className);
      if (match) return match;
    }
    return null;
  }
  if (node.props.className === className) return node;
  return findJsonByClassName(node.children, className);
};

const chooseTarget = (
  renderer: ReactTestRenderer,
  entityId: string,
): void => {
  act(() => {
    selectIn(renderer).props.onChange({ currentTarget: { value: entityId } });
  });
};

const drag = (
  harness: Harness,
  button: 0 | 2,
  delta: readonly [number, number],
): void => {
  const surface = surfaceIn(harness.renderer);
  act(() => {
    surface.props.onPointerDown(
      pointerEvent(harness.surface, { button }),
    );
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

const finishDrag = async (harness: Harness): Promise<void> => {
  await act(async () => {
    surfaceIn(harness.renderer).props.onPointerUp(
      pointerEvent(harness.surface),
    );
    await Promise.resolve();
  });
};

describe("ShotCameraNavigation mounted interaction", () => {
  it("routes free right-drag to free rotation and commits one patch", async () => {
    const scene = createDefaultScene();
    const harness = createHarness(scene);
    const camera = activeCameraIn(scene);
    const delta = [80, -25] as const;

    drag(harness, 2, delta);
    const draft = latestDraft(harness.callbacks.onDraftChange);
    if (!draft?.transform) throw new Error("Missing free-rotation draft.");
    expectTransformEqual(draft.transform, rotateShotCameraFree(camera, delta));

    await finishDrag(harness);

    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledTimes(1);
    expectTransformEqual(
      harness.callbacks.onCommitTransform.mock.calls[0][1],
      rotateShotCameraFree(camera, delta),
    );
  });

  it("captures an explicit actor center and ignores selector changes mid-drag", async () => {
    const scene = createDefaultScene();
    const harness = createHarness(scene);
    const camera = activeCameraIn(scene);
    const actorId = "actor_generic_1";
    const center = resolveShotOrbitTargetCenter(scene, actorId);
    if (!center) throw new Error("Missing actor target center.");
    chooseTarget(harness.renderer, actorId);
    const staleSelectHandler = selectIn(harness.renderer).props.onChange;
    const surface = surfaceIn(harness.renderer);

    act(() => {
      surface.props.onPointerDown(pointerEvent(harness.surface));
    });
    act(() => {
      staleSelectHandler({ currentTarget: { value: "" } });
    });
    const delta = [54, 16] as const;
    act(() => {
      surfaceIn(harness.renderer).props.onPointerMove(
        pointerEvent(harness.surface, {
          clientX: 100 + delta[0],
          clientY: 100 + delta[1],
        }),
      );
    });
    const draft = latestDraft(harness.callbacks.onDraftChange);
    if (!draft?.transform) throw new Error("Missing orbit draft.");
    expectTransformEqual(draft.transform, orbitShotCamera(camera, center, delta));

    await finishDrag(harness);
    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledTimes(1);
  });

  it("routes left-drag through a captured scalar pan distance", () => {
    const scene = createDefaultScene();
    const harness = createHarness(scene);
    const camera = activeCameraIn(scene);
    const actorId = "actor_generic_1";
    const center = resolveShotOrbitTargetCenter(scene, actorId);
    if (!center) throw new Error("Missing actor target center.");
    chooseTarget(harness.renderer, actorId);
    const delta = [42, -19] as const;

    drag(harness, 0, delta);

    const draft = latestDraft(harness.callbacks.onDraftChange);
    if (!draft?.transform) throw new Error("Missing pan draft.");
    expectTransformEqual(
      draft.transform,
      panShotCamera(
        camera,
        deriveShotPanReferenceDistance(scene, camera, center),
        delta,
        720,
      ),
    );
  });

  it.each(["scene", "camera"] as const)(
    "resets the selected target when the %s context changes",
    (context) => {
      const scene = createDefaultScene();
      const harness = createHarness(scene);
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
      const harness = createHarness(scene);
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
    const harness = createHarness(scene, { onCommitTransform });
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
    const harness = createHarness(scene);
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
    const harness = createHarness(scene, {
      onCommitTransform: vi.fn(async () => accepted),
    });
    chooseTarget(harness.renderer, actor.id);
    drag(harness, 2, [22, 5]);
    await finishDrag(harness);

    harness.update(accepted);

    expect(selectIn(harness.renderer).props.value).toBe("");
  });

  it("disables the selector for disabled, protected, dragging, draft, and pending states", async () => {
    const scene = createDefaultScene();
    const disabledHarness = createHarness(scene, { disabled: true });
    expect(selectIn(disabledHarness.renderer).props.disabled).toBe(true);

    const protectedScene = structuredClone(scene) as SceneSpec;
    activeCameraIn(protectedScene).lockMode = "user";
    const protectedHarness = createHarness(protectedScene);
    expect(selectIn(protectedHarness.renderer).props.disabled).toBe(true);

    const keyDraftHarness = createHarness(scene);
    act(() => {
      keyDraftHarness.ownerDocument.dispatch("keydown", {
        key: "ArrowUp",
        target: keyDraftHarness.surface,
        preventDefault: vi.fn(),
      });
    });
    expect(selectIn(keyDraftHarness.renderer).props.disabled).toBe(true);
    await act(async () => {
      keyDraftHarness.ownerDocument.dispatch("keyup", {
        key: "ArrowUp",
        target: keyDraftHarness.surface,
        preventDefault: vi.fn(),
      });
      await Promise.resolve();
    });

    let resolveCommit: ((value: SceneSpec | void) => void) | undefined;
    const commitPromise = new Promise<SceneSpec | void>((resolve) => {
      resolveCommit = resolve;
    });
    const onCommitTransform = vi.fn(() => commitPromise);
    const harness = createHarness(scene, { onCommitTransform });
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

  it("leaves Arrow and Page keys native for select/input targets", () => {
    const harness = createHarness();
    for (const [tagName, key] of [
      ["select", "ArrowDown"],
      ["input", "PageUp"],
    ] as const) {
      const event = {
        key,
        target: new MockHtmlElement(tagName),
        preventDefault: vi.fn(),
      };
      act(() => harness.ownerDocument.dispatch("keydown", event));
      act(() => harness.ownerDocument.dispatch("keyup", event));
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(harness.callbacks.onDraftChange).not.toHaveBeenCalled();
    expect(harness.callbacks.onCommitTransform).not.toHaveBeenCalled();
  });

  it("keeps ordinary surface keyboard movement and cleans document listeners", async () => {
    const harness = createHarness();
    const down = {
      key: "ArrowUp",
      target: harness.surface,
      preventDefault: vi.fn(),
    };
    const up = { ...down, preventDefault: vi.fn() };

    act(() => harness.ownerDocument.dispatch("keydown", down));
    await act(async () => {
      harness.ownerDocument.dispatch("keyup", up);
      await Promise.resolve();
    });

    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(up.preventDefault).toHaveBeenCalledOnce();
    expect(harness.callbacks.onCommitTransform).toHaveBeenCalledOnce();
    expect(harness.ownerDocument.listeners.get("keydown")?.size).toBe(1);
    expect(harness.surface.listeners.get("wheel")?.size).toBe(1);
    act(() => harness.renderer.unmount());
    mountedRenderers.delete(harness.renderer);
    expect(harness.ownerDocument.listeners.get("keydown")?.size).toBe(0);
    expect(harness.ownerDocument.listeners.get("keyup")?.size).toBe(0);
    expect(harness.surface.listeners.get("wheel")?.size).toBe(0);
  });

  it("does not commit a no-op pointer gesture", () => {
    const harness = createHarness();
    const surface = surfaceIn(harness.renderer);
    act(() => {
      surface.props.onPointerDown(pointerEvent(harness.surface));
    });
    act(() => {
      surfaceIn(harness.renderer).props.onPointerUp(
        pointerEvent(harness.surface),
      );
    });

    expect(harness.callbacks.onCommitTransform).not.toHaveBeenCalled();
  });

  it("renders the control band as a sibling of the 16:9 image wrapper", () => {
    const ownerDocument = new MockOwnerDocument();
    const surface = new MockSurface(ownerDocument);
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const isRendererCompatibilityWarning = (message: unknown): boolean =>
      String(message).includes("react-test-renderer is deprecated") ||
      String(message).includes("`key` is not a prop") ||
      String(message).includes("Accessing element.ref was removed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      if (isRendererCompatibilityWarning(args[0])) return;
      originalConsoleError(...args);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      if (isRendererCompatibilityWarning(args[0])) return;
      originalConsoleWarn(...args);
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      act(() => {
        renderer = create(
          createElement(ViewportWorkspace, {
            scene: createDefaultScene() as SceneSpec,
            selectedId: null,
            onSelect: () => undefined,
            toolMode: "select",
            snapEnabled: true,
            onCommitTransform: () => undefined,
            registerExporter: () => undefined,
            previewMode: "shot",
            focusedRegionId: null,
            onPreviewModeChange: () => undefined,
            onFocusedRegionChange: () => undefined,
            interactionDisabled: false,
            onUnlockUserProtectedCamera: () => undefined,
            onCommitCameraTransform: async () => undefined,
            onCommitCameraFocalLength: async () => undefined,
            onCameraDraftChange: () => undefined,
          }),
          {
            createNodeMock: (element) =>
              (element.props as { className?: string }).className?.includes(
                "shot-camera-surface",
              )
                ? surface
                : new MockHtmlElement(String(element.type)),
          },
        );
      });
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
    if (!renderer) throw new Error("Viewport renderer was not created.");
    mountedRenderers.add(renderer);
    const panel = findJsonByClassName(
      renderer.toJSON(),
      "shot-preview-panel",
    );
    if (!panel) throw new Error("Missing rendered shot preview panel.");
    const directChildren = (panel.children ?? []).filter(
      (child): child is ReactTestRendererJSON => typeof child !== "string",
    );
    const image = directChildren.find(
      (child) => child.props.className === "shot-preview-image",
    );
    const controls = directChildren.find(
      (child) => child.props.className === "shot-camera-controls",
    );

    expect(image).toBeDefined();
    expect(controls).toBeDefined();
    expect(
      findJsonByClassName(image ?? null, "shot-camera-controls"),
    ).toBeNull();
  });
});
