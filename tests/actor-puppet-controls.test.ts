import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { createDefaultScene } from "../src/domain/default-scene";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import {
  isBlueprintActorEntity,
  sceneSpecSchema,
  type AnyActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { Inspector, type InspectorProps } from "../src/editor/Inspector";
import { ActorJointControls } from "../src/editor/ActorJointControls";
import { ActorStatureControls } from "../src/editor/ActorStatureControls";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const blueprintScene = (): SceneSpec => {
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  scene.entities = scene.entities.filter(
    (entity) => entity.kind !== "actor",
  );
  scene.constraints = [];
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(createGenericActorBlueprintDocument()),
  ];
  scene.entities.push(createBlueprintActor());
  return sceneSpecSchema.parse(scene);
};

const requireActor = (scene: SceneSpec): AnyActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is AnyActorEntity => entity.kind === "actor",
  );
  if (!actor) throw new Error("Actor control fixture is missing an actor.");
  return actor;
};

const callbacks = (): Pick<
  InspectorProps,
  | "onSetHeight"
  | "onSetLimbPresence"
  | "onApplyPose"
  | "onApplyRelationship"
  | "onSetGroundContact"
  | "onSetJointRotation"
  | "onSetVariant"
> => ({
  onSetHeight: () => undefined,
  onSetLimbPresence: () => undefined,
  onApplyPose: () => undefined,
  onApplyRelationship: () => undefined,
  onSetGroundContact: () => undefined,
  onSetJointRotation: () => undefined,
  onSetVariant: () => undefined,
});

const missingCallbacks = (): Partial<InspectorProps> => ({
  onSetHeight: undefined,
  onSetLimbPresence: undefined,
  onApplyPose: undefined,
  onApplyRelationship: undefined,
  onSetGroundContact: undefined,
  onSetJointRotation: undefined,
  onSetVariant: undefined,
});

const renderActorInspector = (
  scene: SceneSpec,
  props: Partial<InspectorProps> = {},
): string => {
  const actor = requireActor(scene);
  return renderToStaticMarkup(
    createElement(Inspector, {
      scene,
      selectedId: actor.id,
      disabled: false,
      ...callbacks(),
      ...props,
    }),
  );
};

const actorEditControls = (markup: string): string[] =>
  [...markup.matchAll(/<(?:input|select|button)(?=[^>]*data-actor-edit)[^>]*>/gu)]
    .map((match) => match[0]);

const createComponentRenderer = (
  element: ReturnType<typeof createElement>,
): ReactTestRenderer => {
  const originalConsoleError = console.error;
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    originalConsoleError(...args);
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(element);
    });
  } finally {
    errorSpy.mockRestore();
  }
  if (!renderer) throw new Error("React component renderer was not created.");
  return renderer;
};

const findInputs = (
  renderer: ReactTestRenderer,
  attribute: string,
): ReactTestInstance[] =>
  renderer.root.findAll(
    (node) => node.type === "input" && attribute in node.props,
  );

const expectUnifiedControls = (markup: string): void => {
  expect(
    markup.match(/<input(?=[^>]*data-actor-height)[^>]*>/gu),
  ).toHaveLength(2);
  expect(
    markup.match(/<select(?=[^>]*data-limb-part=)[^>]*>/gu),
  ).toHaveLength(12);
  expect(
    markup.match(/<option(?=[^>]*data-action-id=)[^>]*>/gu),
  ).toHaveLength(8);
  expect(
    markup.match(/<option(?=[^>]*data-joint-id=)[^>]*>/gu),
  ).toHaveLength(15);
  expect(markup.match(/data-joint-axis="[xyz]"/gu)).toHaveLength(3);
  expect(
    markup.match(/<input(?=[^>]*data-joint-angle-number)[^>]*>/gu),
  ).toHaveLength(3);
  expect(
    markup.match(/<input(?=[^>]*data-joint-angle-range)[^>]*>/gu),
  ).toHaveLength(3);
  expect(markup.match(/<button(?=[^>]*data-joint-reset)[^>]*>/gu))
    .toHaveLength(1);
};

describe("unified authoritative actor Inspector controls", () => {
  it("renders stature, twelve limbs, eight actions, and fifteen joints for a legacy actor", () => {
    expectUnifiedControls(renderActorInspector(createDefaultScene()));
  });

  it("renders the same puppet controls while retaining Blueprint metadata and variants", () => {
    const scene = blueprintScene();
    const actor = requireActor(scene);
    expect(isBlueprintActorEntity(actor)).toBe(true);

    const markup = renderActorInspector(scene);
    expectUnifiedControls(markup);
    expect(markup).toContain("Actor Blueprint");
    expect(markup).toContain("actor_blueprint_1");
    expect(markup).toContain(
      scene.actorBlueprints[0].contentSha256.slice(0, 12),
    );
    expect(markup).toContain('aria-label="Actor blueprint variant"');
    expect(markup).toContain(">damaged</option>");
    expect(markup).toContain(">repaired</option>");
  });

  it.each([
    ["global disabled", "none", true, callbacks()],
    ["workflow lock", "workflow", false, callbacks()],
    ["user lock", "user", false, callbacks()],
    ["missing callbacks", "none", false, missingCallbacks()],
  ] as const)(
    "disables every actor edit control for %s",
    (_label, lockMode, disabled, actorCallbacks) => {
      for (const scene of [createDefaultScene(), blueprintScene()]) {
        requireActor(scene).lockMode = lockMode;
        const markup = renderActorInspector(scene, {
          ...actorCallbacks,
          disabled,
        });
        const controls = actorEditControls(markup);
        expect(controls.length).toBeGreaterThan(20);
        for (const control of controls) {
          expect(control).toContain("disabled");
        }
      }
    },
  );

  it("returns the stature draft to the accepted SceneSpec value after submit without a new revision", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    const onSetHeight = vi.fn();
    const renderer = createComponentRenderer(
      createElement(ActorStatureControls, {
        scene,
        actor,
        disabled: false,
        onSetHeight,
      }),
    );
    const numberInput = findInputs(renderer, "data-actor-height").find(
      (input) => input.props.type === "number",
    );
    if (!numberInput) throw new Error("Stature number input is missing.");

    act(() => {
      numberInput.props.onChange({ currentTarget: { value: "1.55" } });
      numberInput.props.onKeyDown({
        key: "Enter",
        currentTarget: { blur: vi.fn() },
      });
    });

    expect(onSetHeight).toHaveBeenCalledOnce();
    expect(onSetHeight).toHaveBeenCalledWith(actor.id, 1.55);
    expect(numberInput.props.value).toBe("1.72");
    act(() => renderer.unmount());
  });

  it.each(["legacy", "blueprint"] as const)(
    "does not submit quantized %s stature values from focus-only number or range interaction",
    (actorKind) => {
      const scene = actorKind === "legacy" ? createDefaultScene() : blueprintScene();
      const actor = requireActor(scene);
      if (isBlueprintActorEntity(actor)) {
        actor.blueprintInstance.heightScale = 1.001851851851852;
      } else {
        actor.body.heightM = 1.723;
      }

      for (const inputType of ["number", "range"] as const) {
        const onSetHeight = vi.fn();
        const renderer = createComponentRenderer(
          createElement(ActorStatureControls, {
            scene,
            actor,
            disabled: false,
            onSetHeight,
          }),
        );
        const input = findInputs(renderer, "data-actor-height").find(
          (candidate) => candidate.props.type === inputType,
        );
        if (!input) throw new Error(`Stature ${inputType} input is missing.`);

        act(() => {
          input.props.onFocus?.({ currentTarget: { select: vi.fn() } });
          input.props.onKeyUp?.({ key: "ArrowRight" });
          input.props.onBlur();
        });

        expect(onSetHeight).not.toHaveBeenCalled();
        act(() => renderer.unmount());
      }
    },
  );

  it("returns a submitted joint draft to the accepted quaternion until a new revision arrives", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    const onSetJointRotation = vi.fn();
    const renderer = createComponentRenderer(
      createElement(ActorJointControls, {
        scene,
        actor,
        disabled: false,
        onSetJointRotation,
      }),
    );
    const numberInputs = findInputs(renderer, "data-joint-angle-number");

    act(() => {
      numberInputs[0].props.onChange({ currentTarget: { value: "30" } });
      numberInputs[0].props.onKeyDown({
        key: "Enter",
        currentTarget: { blur: vi.fn() },
      });
    });

    expect(onSetJointRotation).toHaveBeenCalledOnce();
    expect(onSetJointRotation.mock.calls[0][0]).toBe(actor.id);
    expect(onSetJointRotation.mock.calls[0][1]).toBe("pelvis");
    expect(numberInputs[0].props.value).toBe("0.0");
    act(() => renderer.unmount());
  });

  it("reset emits identity but keeps showing the accepted joint quaternion", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    actor.pose.joints.pelvis = quaternionFromEulerDegrees([20, 0, 0]);
    const onSetJointRotation = vi.fn();
    const renderer = createComponentRenderer(
      createElement(ActorJointControls, {
        scene,
        actor,
        disabled: false,
        onSetJointRotation,
      }),
    );
    const numberInputs = findInputs(renderer, "data-joint-angle-number");
    const reset = renderer.root.find(
      (node) => node.type === "button" && "data-joint-reset" in node.props,
    );

    act(() => reset.props.onClick());

    expect(onSetJointRotation).toHaveBeenCalledWith(
      actor.id,
      "pelvis",
      [0, 0, 0, 1],
    );
    expect(numberInputs[0].props.value).toBe("20.0");
    act(() => renderer.unmount());
  });

  it("does not submit a quantized joint value from focus-only number or range interaction", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    actor.pose.joints.pelvis = quaternionFromEulerDegrees([20.04, 0, 0]);

    for (const inputType of ["number", "range"] as const) {
      const onSetJointRotation = vi.fn();
      const renderer = createComponentRenderer(
        createElement(ActorJointControls, {
          scene,
          actor,
          disabled: false,
          onSetJointRotation,
        }),
      );
      const input = findInputs(
        renderer,
        inputType === "number"
          ? "data-joint-angle-number"
          : "data-joint-angle-range",
      )[0];

      act(() => {
        input.props.onFocus?.({ currentTarget: { select: vi.fn() } });
        input.props.onKeyUp?.({ key: "ArrowRight" });
        input.props.onBlur();
      });

      expect(onSetJointRotation).not.toHaveBeenCalled();
      act(() => renderer.unmount());
    }
  });

  it("rejects a blank joint axis on Enter, then restores accepted state on blur or Escape", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    actor.pose.joints.pelvis = quaternionFromEulerDegrees([20, 0, 0]);
    const onSetJointRotation = vi.fn();
    const renderer = createComponentRenderer(
      createElement(ActorJointControls, {
        scene,
        actor,
        disabled: false,
        onSetJointRotation,
      }),
    );
    const numberInput = findInputs(renderer, "data-joint-angle-number")[0];

    act(() => {
      numberInput.props.onChange({ currentTarget: { value: "" } });
      numberInput.props.onKeyDown({
        key: "Enter",
        currentTarget: { blur: vi.fn() },
      });
    });

    expect(onSetJointRotation).not.toHaveBeenCalled();
    expect(numberInput.props.value).toBe("");
    expect(numberInput.props["aria-invalid"]).toBe(true);

    act(() => numberInput.props.onBlur());
    expect(numberInput.props.value).toBe("20.0");
    expect(numberInput.props["aria-invalid"]).toBe(false);

    act(() => {
      numberInput.props.onChange({ currentTarget: { value: "" } });
      numberInput.props.onKeyDown({
        key: "Escape",
        currentTarget: { blur: vi.fn() },
      });
    });
    expect(numberInput.props.value).toBe("20.0");
    expect(numberInput.props["aria-invalid"]).toBe(false);
    expect(onSetJointRotation).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("labels XYZ controls as bend, twist, and side-bend axes", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    const renderer = createComponentRenderer(
      createElement(ActorJointControls, {
        scene,
        actor,
        disabled: false,
        onSetJointRotation: () => undefined,
      }),
    );
    const labels = findInputs(renderer, "data-joint-angle-number").map(
      (input) => input.props["aria-label"],
    );

    expect(labels).toEqual([
      "骨盆 X 弯曲，单位度",
      "骨盆 Y 扭转，单位度",
      "骨盆 Z 侧弯，单位度",
    ]);
    act(() => renderer.unmount());
  });
});
