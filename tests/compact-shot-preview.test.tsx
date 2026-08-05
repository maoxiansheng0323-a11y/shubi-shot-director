import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import type { CameraEntity, SceneSpec } from "../src/domain/scene-schema";
import { CompactShotPreviewControls } from "../src/editor/CompactShotPreviewControls";

const addCameraAt = (
  scene: SceneSpec,
  index: number,
  id: string,
  label: string,
): void => {
  const source = scene.entities.find(
    (entity): entity is CameraEntity => entity.kind === "camera",
  );
  if (!source) throw new Error("Camera fixture is missing.");
  scene.entities.splice(index, 0, {
    ...structuredClone(source),
    id,
    label,
  });
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

describe("compact shot preview controls", () => {
  it("shows the active label, stable camera order, and output format", () => {
    const scene = createDefaultScene();
    addCameraAt(scene, 1, "camera_inserted_1", "Inserted camera");
    addCameraAt(scene, 4, "camera_middle_1", "Middle camera");

    const markup = renderToStaticMarkup(
      createElement(CompactShotPreviewControls, {
        scene,
        onActivateCamera: () => undefined,
        onExpand: () => undefined,
      }),
    );

    expect(markup).toContain("Active camera");
    expect(markup).toContain("Shot camera");
    expect(markup).toContain("1920 × 1080");
    expect(markup).toContain("16:9");
    expect(markup.indexOf("Inserted camera")).toBeLessThan(
      markup.indexOf("Middle camera"),
    );
    expect(markup.indexOf("Middle camera")).toBeLessThan(
      markup.lastIndexOf("Shot camera"),
    );
  });

  it("uses a labeled native selector and explicit expand button", () => {
    const scene = createDefaultScene();
    const markup = renderToStaticMarkup(
      createElement(CompactShotPreviewControls, {
        scene,
        onActivateCamera: () => undefined,
        onExpand: () => undefined,
      }),
    );

    expect(markup).toMatch(
      /<select[^>]*aria-label="Active shot camera"[^>]*>/u,
    );
    const expandButton = markup.match(
      /<button[^>]*aria-label="Expand shot preview"[^>]*>/u,
    )?.[0];
    expect(expandButton).toContain('type="button"');
  });

  it("routes selector activation without expanding or touching studio focus", () => {
    const scene = createDefaultScene();
    addCameraAt(scene, 1, "camera_select_1", "Selectable camera");
    const onActivateCamera = vi.fn();
    const onExpand = vi.fn();
    const studioSelect = vi.fn();
    const studioFocus = vi.fn();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        createElement(CompactShotPreviewControls, {
          scene,
          onActivateCamera,
          onExpand,
        }),
      );
    });
    const select = renderer!.root.findByProps({
      "aria-label": "Active shot camera",
    });

    act(() => {
      select.props.onChange({ currentTarget: { value: "camera_select_1" } });
    });

    expect(onActivateCamera).toHaveBeenCalledTimes(1);
    expect(onActivateCamera).toHaveBeenCalledWith("camera_select_1");
    expect(onExpand).not.toHaveBeenCalled();
    expect(studioSelect).not.toHaveBeenCalled();
    expect(studioFocus).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("expands only through the explicit button callback", () => {
    const scene = createDefaultScene();
    const onActivateCamera = vi.fn();
    const onExpand = vi.fn();
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        createElement(CompactShotPreviewControls, {
          scene,
          onActivateCamera,
          onExpand,
        }),
      );
    });
    const button = renderer!.root.findByProps({
      "aria-label": "Expand shot preview",
    });

    act(() => button.props.onClick());

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onActivateCamera).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });
});
