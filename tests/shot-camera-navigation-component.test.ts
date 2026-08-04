import { createElement } from "react";
import {
  act,
  create,
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
import type { SceneSpec } from "../src/domain/scene-schema";
import {
  deriveShotPanReferenceDistance,
  orbitShotCamera,
  panShotCamera,
  rotateShotCameraFree,
} from "../src/editor/shot-camera-navigation";
import { resolveShotOrbitTargetCenter } from "../src/editor/shot-camera-target-lock";
import { ViewportWorkspace } from "../src/editor/ViewportWorkspace";
import {
  MockHtmlElement,
  MockOwnerDocument,
  MockSurface,
  activeCameraIn,
  chooseTarget,
  cleanupNavigationHarnesses,
  createNavigationHarness,
  drag,
  expectTransformEqual,
  finishDrag,
  installNavigationTestEnvironment,
  latestDraft,
  pointerEvent,
  surfaceIn,
  unmountNavigationHarness,
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

describe("ShotCameraNavigation routing and layout", () => {
  it("routes free right-drag to free rotation and commits one patch", async () => {
    const scene = createDefaultScene();
    const harness = createNavigationHarness(scene);
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
    const harness = createNavigationHarness(scene);
    const camera = activeCameraIn(scene);
    const actorId = "actor_generic_1";
    const center = resolveShotOrbitTargetCenter(scene, actorId);
    if (!center) throw new Error("Missing actor target center.");
    chooseTarget(harness.renderer, actorId);
    const select = harness.renderer.root.findByProps({
      "aria-label": "Right-drag orbit target",
    });
    const staleSelectHandler = select.props.onChange;
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
    const harness = createNavigationHarness(scene);
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

  it("leaves Arrow and Page keys native for select/input targets", () => {
    const harness = createNavigationHarness();
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
    const harness = createNavigationHarness();
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
    unmountNavigationHarness(harness);
    expect(harness.ownerDocument.listeners.get("keydown")?.size).toBe(0);
    expect(harness.ownerDocument.listeners.get("keyup")?.size).toBe(0);
    expect(harness.surface.listeners.get("wheel")?.size).toBe(0);
  });

  it("does not commit a no-op pointer gesture", () => {
    const harness = createNavigationHarness();
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
    act(() => renderer?.unmount());
  });
});
