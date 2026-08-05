import { afterEach, describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { useEditorStore } from "../src/editor/editor-store";

afterEach(() => {
  useEditorStore.setState({
    scene: null,
    selectedEntityId: null,
    focusedEntityId: null,
    focusedActorJointId: null,
    focusRequestVersion: 0,
  });
});

describe("editor focus state", () => {
  it("focuses an editable entity and selects it at the same time", () => {
    useEditorStore.setState({ scene: createDefaultScene() });

    useEditorStore.getState().focusEntity("actor_generic_1");

    expect(useEditorStore.getState()).toMatchObject({
      selectedEntityId: "actor_generic_1",
      focusedEntityId: "actor_generic_1",
      focusedActorJointId: null,
    });
  });

  it("only exposes an actor joint while an actor owns focus", () => {
    useEditorStore.setState({ scene: createDefaultScene() });
    const store = useEditorStore.getState();

    store.focusEntity("actor_generic_1");
    store.focusActorJoint("neck");
    expect(useEditorStore.getState().focusedActorJointId).toBe("neck");

    store.focusEntity("prop_block_1");
    expect(useEditorStore.getState().focusedActorJointId).toBeNull();
    store.focusActorJoint("neck");
    expect(useEditorStore.getState().focusedActorJointId).toBeNull();
  });

  it("clears focus on scene replacement but retains compatible focus across a revision", () => {
    const scene = createDefaultScene();
    useEditorStore.setState({ scene });
    const store = useEditorStore.getState();
    store.focusEntity("actor_generic_1");
    store.focusActorJoint("neck");

    const revised = structuredClone(scene);
    revised.revision = 1;
    useEditorStore.setState({ scene: revised });
    store.reconcileStudioFocus(scene, revised);
    expect(useEditorStore.getState()).toMatchObject({
      focusedEntityId: "actor_generic_1",
      focusedActorJointId: "neck",
    });

    const replacement = structuredClone(revised);
    replacement.sceneId = "scene_replacement";
    useEditorStore.getState().reconcileStudioFocus(revised, replacement);
    expect(useEditorStore.getState()).toMatchObject({
      focusedEntityId: null,
      focusedActorJointId: null,
    });
  });
});
