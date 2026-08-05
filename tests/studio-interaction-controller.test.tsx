import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { StudioInteractionController } from "../src/editor/StudioInteractionController";

class TestSurface {
  readonly listeners = new Map<string, EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
}

const renderers: ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.unmount();
});

describe("studio interaction controller", () => {
  it("commits editor-relative movement for the focused entity", () => {
    const scene = createDefaultScene();
    const surface = new TestSurface();
    const commit = vi.fn();
    const clear = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <StudioInteractionController
          scene={scene}
          surface={surface as unknown as HTMLElement}
          selectedEntityId="actor_generic_1"
          focusedEntityId="actor_generic_1"
          editorViewDirection={[0, 0, -1]}
          onCommitTransform={commit}
          onClearFocus={clear}
        >
          <div />
        </StudioInteractionController>,
      );
    });
    renderers.push(renderer);

    const event = {
      key: "ArrowUp",
      shiftKey: false,
      altKey: false,
      target: surface,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    act(() => surface.listeners.get("keydown")?.(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0]).toBe("actor_generic_1");
    const actor = scene.entities.find((entity) => entity.id === "actor_generic_1")!;
    expect(commit.mock.calls[0][1].positionM[2]).toBeCloseTo(
      actor.transform.positionM[2] - 0.1,
    );
  });

  it("leaves form controls alone and uses Escape to clear focus", () => {
    const scene = createDefaultScene();
    const surface = new TestSurface();
    const commit = vi.fn();
    const clear = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <StudioInteractionController
          scene={scene}
          surface={surface as unknown as HTMLElement}
          selectedEntityId="prop_block_1"
          focusedEntityId="prop_block_1"
          editorViewDirection={[0, 0, -1]}
          onCommitTransform={commit}
          onClearFocus={clear}
        >
          <div />
        </StudioInteractionController>,
      );
    });
    renderers.push(renderer);

    const inputTarget = { closest: () => ({}) };
    const arrow = {
      key: "ArrowRight",
      target: inputTarget,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    act(() => surface.listeners.get("keydown")?.(arrow));
    expect(arrow.preventDefault).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();

    const escape = {
      key: "Escape",
      target: surface,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    act(() => surface.listeners.get("keydown")?.(escape));
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });
});
