import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import type { SceneSpec, TransformSpec } from "../src/domain/scene-schema";
import {
  createTransformDragSession,
  decideTransformDragCommit,
  TRANSFORM_CONFLICT_MESSAGE,
  useEditorStore,
} from "../src/editor/editor-store";
import { createTransformPatch } from "../src/editor/manual-patches";
import {
  sceneClient,
  type SceneEventHandlers,
  type SceneSessionSnapshot,
} from "../src/editor/scene-client";

const HISTORY_IDLE = { canUndo: false, canRedo: false };

const atRevision = (revision: number): SceneSpec => ({
  ...structuredClone(createDefaultScene()),
  revision,
});

const actorTransform = (scene: SceneSpec): {
  entityId: string;
  transform: TransformSpec;
} => {
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  if (!actor) {
    throw new Error("Concurrency fixture is missing an actor.");
  }
  return {
    entityId: actor.id,
    transform: {
      ...structuredClone(actor.transform),
      positionM: [
        actor.transform.positionM[0] + 0.5,
        actor.transform.positionM[1],
        actor.transform.positionM[2],
      ],
    },
  };
};

const deferredUpdate = (): {
  promise: Promise<SceneSessionSnapshot>;
  resolve: (update: SceneSessionSnapshot) => void;
} => {
  let resolvePromise:
    | ((update: SceneSessionSnapshot) => void)
    | undefined;
  const promise = new Promise<SceneSessionSnapshot>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (update) => {
      if (!resolvePromise) {
        throw new Error("Deferred scene update is not ready.");
      }
      resolvePromise(update);
    },
  };
};

beforeEach(() => {
  useEditorStore.getState().disconnect();
  useEditorStore.setState({
    scene: null,
    history: HISTORY_IDLE,
    loading: false,
    isMutating: false,
    error: null,
    connectionStatus: "idle",
    selectedEntityId: null,
    toolMode: "select",
    lastSceneEvent: null,
  });
});

afterEach(() => {
  useEditorStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe("editor authoritative revision handling", () => {
  it("does not let a delayed patch response roll the page backward", async () => {
    const initial = atRevision(4);
    const delayed = atRevision(5);
    const external = atRevision(6);
    const target = actorTransform(initial);
    const patch = createTransformPatch(
      initial,
      target.entityId,
      target.transform,
    );
    const response = deferredUpdate();
    vi.spyOn(sceneClient, "applyPatch").mockReturnValue(response.promise);
    useEditorStore.setState({ scene: initial });

    const pending = useEditorStore.getState().applyPatch(patch);
    useEditorStore.setState({
      scene: external,
      history: { canUndo: true, canRedo: false },
    });
    response.resolve({ scene: delayed, history: HISTORY_IDLE });

    const returned = await pending;
    expect(returned.revision).toBe(6);
    expect(useEditorStore.getState().scene?.revision).toBe(6);
    expect(useEditorStore.getState().history).toEqual({
      canUndo: true,
      canRedo: false,
    });
  });

  it("does not let replace or refresh responses lower the current revision", async () => {
    const current = atRevision(9);
    const staleReplace = atRevision(7);
    const staleRefresh = atRevision(8);
    useEditorStore.setState({
      scene: current,
      history: { canUndo: true, canRedo: false },
    });
    vi.spyOn(sceneClient, "replaceScene").mockResolvedValue({
      scene: staleReplace,
      history: HISTORY_IDLE,
    });
    vi.spyOn(sceneClient, "getScene").mockResolvedValue({
      scene: staleRefresh,
      history: HISTORY_IDLE,
    });

    const replaceResult = await useEditorStore
      .getState()
      .replaceScene(structuredClone(current));
    const refreshResult = await useEditorStore.getState().refresh();

    expect(replaceResult.revision).toBe(9);
    expect(refreshResult?.revision).toBe(9);
    expect(useEditorStore.getState().scene?.revision).toBe(9);
    expect(useEditorStore.getState().history).toEqual({
      canUndo: true,
      canRedo: false,
    });
  });

  it("keeps an accepted SSE summary and ignores an older event", async () => {
    const initial = atRevision(2);
    const external = atRevision(3);
    const older = {
      ...atRevision(1),
      sceneId: "scene_older_instance",
    };
    const handlerBox: { current: SceneEventHandlers | null } = {
      current: null,
    };
    vi.spyOn(sceneClient, "getScene").mockResolvedValue({
      scene: initial,
      history: HISTORY_IDLE,
    });
    vi.spyOn(sceneClient, "subscribe").mockImplementation((nextHandlers) => {
      handlerBox.current = nextHandlers;
      return () => undefined;
    });
    useEditorStore.setState({ scene: initial });

    const cleanup = useEditorStore.getState().initialize();
    await vi.waitFor(() => expect(handlerBox.current).not.toBeNull());
    const handlers = handlerBox.current;
    if (!handlers) {
      throw new Error("Scene event handlers were not attached.");
    }

    handlers.onScene({
      eventId: "event_external_patch",
      reason: "patch",
      scene: external,
    });
    expect(useEditorStore.getState().scene?.revision).toBe(3);
    expect(useEditorStore.getState().lastSceneEvent).toEqual({
      reason: "patch",
      revision: 3,
      text: "External patch · REV 3",
    });

    handlers.onScene({
      eventId: "event_stale_patch",
      reason: "patch",
      scene: older,
    });
    expect(useEditorStore.getState().scene?.revision).toBe(3);
    expect(useEditorStore.getState().lastSceneEvent?.revision).toBe(3);
    cleanup();
  });
});

describe("transform drag revision guard", () => {
  it("accepts an unchanged revision and rejects a drag after external revision", () => {
    const start = atRevision(10);
    const session = createTransformDragSession(start, "actor_generic_1");
    const external = {
      ...structuredClone(start),
      revision: 11,
    };

    expect(
      decideTransformDragCommit(session, start, "actor_generic_1"),
    ).toEqual({ status: "commit" });
    expect(
      decideTransformDragCommit(
        session,
        external,
        "actor_generic_1",
      ),
    ).toEqual({
      status: "conflict",
      code: "TRANSFORM_DRAG_REVISION_CONFLICT",
    });
  });

  it("reports a readable conflict without storing any source instruction", () => {
    const scene = atRevision(3);
    const session = createTransformDragSession(scene, "actor_generic_1");
    session.cancelled = true;

    expect(
      decideTransformDragCommit(session, scene, "actor_generic_1"),
    ).toMatchObject({ status: "conflict" });
    useEditorStore.getState().reportTransformConflict();
    expect(useEditorStore.getState().error).toBe(
      TRANSFORM_CONFLICT_MESSAGE,
    );
    expect(useEditorStore.getState().error).not.toContain(
      "source instruction",
    );
  });
});
