import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import type { ScenePatch } from "../src/domain/scene-patch";
import {
  sceneSpecSchema,
  type SceneSpec,
  type TransformSpec,
} from "../src/domain/scene-schema";
import {
  createTransformDragSession,
  decideTransformDragCommit,
  TRANSFORM_CONFLICT_MESSAGE,
  useEditorStore,
} from "../src/editor/editor-store";
import { createTransformPatch } from "../src/editor/manual-patches";
import {
  sceneClient,
  SceneClientError,
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
  vi.unstubAllGlobals();
});

const installDownloadRecorder = (): {
  blob: () => Blob | null;
  downloads: () => Array<{ fileName: string; blob: Blob }>;
  createObjectUrl: ReturnType<typeof vi.fn>;
} => {
  let downloadedBlob: Blob | null = null;
  let objectUrlSequence = 0;
  const blobsByUrl = new Map<string, Blob>();
  const downloads: Array<{ fileName: string; blob: Blob }> = [];
  const createObjectUrl = vi.fn((blob: Blob | MediaSource) => {
    if (!(blob instanceof Blob)) {
      throw new Error("Scene download did not create a Blob.");
    }
    downloadedBlob = blob;
    const url = `blob:workflow-save-${objectUrlSequence++}`;
    blobsByUrl.set(url, blob);
    return url;
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal(
    "document",
    {
      createElement: () => {
        const anchor = {
          hidden: false,
          href: "",
          download: "",
          click: () => {
            const blob = blobsByUrl.get(anchor.href);
            if (!blob) {
              throw new Error("Scene download URL was not recorded.");
            }
            downloads.push({
              fileName: anchor.download,
              blob,
            });
          },
          remove: vi.fn(),
        };
        return anchor;
      },
      body: {
        append: vi.fn(),
      },
    } as unknown as Document,
  );
  return {
    blob: () => downloadedBlob,
    downloads: () => downloads,
    createObjectUrl,
  };
};

describe("editor authoritative revision handling", () => {
  it("commits an ordinary accepted patch response", async () => {
    const initial = atRevision(4);
    const target = actorTransform(initial);
    const patch = createTransformPatch(
      initial,
      target.entityId,
      target.transform,
    );
    const accepted = applyScenePatch(initial, patch).next;
    vi.spyOn(sceneClient, "applyPatch").mockResolvedValue({
      scene: accepted,
      history: { canUndo: true, canRedo: false },
    });
    useEditorStore.setState({
      scene: initial,
      history: HISTORY_IDLE,
    });

    await expect(
      useEditorStore.getState().applyPatch(patch),
    ).resolves.toEqual(accepted);
    expect(useEditorStore.getState().scene).toEqual(accepted);
    expect(useEditorStore.getState().history).toEqual({
      canUndo: true,
      canRedo: false,
    });
  });

  it("returns the accepted patch response without rolling the page backward", async () => {
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
    expect(returned.revision).toBe(5);
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

  it("releases the live scene stream while a mutation request is in flight", async () => {
    const initial = atRevision(4);
    const target = actorTransform(initial);
    const patch = createTransformPatch(
      initial,
      target.entityId,
      target.transform,
    );
    const accepted = applyScenePatch(initial, patch).next;
    const update = deferredUpdate();
    const lifecycle: string[] = [];
    let subscriptionCount = 0;

    vi.spyOn(sceneClient, "getScene").mockResolvedValue({
      scene: initial,
      history: HISTORY_IDLE,
    });
    vi.spyOn(sceneClient, "subscribe").mockImplementation((handlers) => {
      subscriptionCount += 1;
      const subscriptionId = subscriptionCount;
      lifecycle.push(`subscribe:${subscriptionId}`);
      handlers.onConnectionChange?.("connected");
      return () => {
        lifecycle.push(`unsubscribe:${subscriptionId}`);
        handlers.onConnectionChange?.("disconnected");
      };
    });
    vi.spyOn(sceneClient, "applyPatch").mockImplementation(() => {
      lifecycle.push("request");
      return update.promise;
    });

    const cleanup = useEditorStore.getState().initialize();
    await vi.waitFor(() => expect(subscriptionCount).toBe(1));

    const mutation = useEditorStore.getState().applyPatch(patch);
    await vi.waitFor(() => expect(lifecycle).toContain("request"));
    expect(lifecycle).toEqual([
      "subscribe:1",
      "unsubscribe:1",
      "request",
    ]);

    update.resolve({
      scene: accepted,
      history: { canUndo: true, canRedo: false },
    });
    await expect(mutation).resolves.toEqual(accepted);
    expect(lifecycle).toEqual([
      "subscribe:1",
      "unsubscribe:1",
      "request",
      "subscribe:2",
    ]);
    cleanup();
  });
});

describe("explicit editor save checkpoint", () => {
  it("waits for the accepted checkpoint and downloads that current revision", async () => {
    const initial = atRevision(7);
    const recorder = installDownloadRecorder();
    let resolveUpdate:
      | ((update: SceneSessionSnapshot) => void)
      | undefined;
    let submittedPatch: ScenePatch | null = null;
    vi.spyOn(sceneClient, "applyPatch").mockImplementation((patch) => {
      submittedPatch = patch;
      return new Promise<SceneSessionSnapshot>((resolve) => {
        resolveUpdate = resolve;
      });
    });
    useEditorStore.setState({
      scene: initial,
      connectionStatus: "connected",
    });

    const saving = useEditorStore.getState().saveScene("accepted");

    expect(recorder.createObjectUrl).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(submittedPatch).not.toBeNull());
    if (!submittedPatch || !resolveUpdate) {
      throw new Error("Save checkpoint was not submitted.");
    }
    const accepted = applyScenePatch(initial, submittedPatch).next;
    resolveUpdate({
      scene: accepted,
      history: { canUndo: true, canRedo: false },
    });

    await expect(saving).resolves.toBe("accepted.scene.json");
    const blob = recorder.blob();
    expect(blob).not.toBeNull();
    const downloaded = sceneSpecSchema.parse(
      JSON.parse(await blob!.text()) as unknown,
    );
    expect(downloaded).toEqual(accepted);
    expect(
      downloaded.entities.every(
        (entity) => entity.lockMode !== "none",
      ),
    ).toBe(true);
  });

  it("does not download when the checkpoint patch fails", async () => {
    const initial = atRevision(2);
    const recorder = installDownloadRecorder();
    vi.spyOn(sceneClient, "applyPatch").mockRejectedValue(
      new SceneClientError(
        "WORKFLOW_LOCKED",
        "Internal workflow lock wording.",
      ),
    );
    useEditorStore.setState({
      scene: initial,
      connectionStatus: "connected",
    });

    await expect(
      useEditorStore.getState().saveScene(),
    ).resolves.toBeNull();

    expect(recorder.createObjectUrl).not.toHaveBeenCalled();
    expect(useEditorStore.getState().error).toBe(
      "目标处于流程锁定，请使用保留锁定的修改 · WORKFLOW_LOCKED",
    );
  });

  it("serializes an already locked scene without another patch", async () => {
    const scene = atRevision(5);
    scene.entities.forEach((entity, index) => {
      entity.lockMode = index === 0 ? "user" : "workflow";
    });
    const recorder = installDownloadRecorder();
    const applyPatch = vi.spyOn(sceneClient, "applyPatch");
    useEditorStore.setState({ scene, connectionStatus: "connected" });

    await expect(
      useEditorStore.getState().saveScene(),
    ).resolves.toBe("scene_starter.scene.json");

    expect(applyPatch).not.toHaveBeenCalled();
    const blob = recorder.blob();
    const downloaded = sceneSpecSchema.parse(
      JSON.parse(await blob!.text()) as unknown,
    );
    expect(downloaded).toEqual(scene);
  });

  it("queues simultaneous names and preserves each requested download", async () => {
    const initial = atRevision(3);
    const recorder = installDownloadRecorder();
    let submittedPatch: ScenePatch | null = null;
    const deferred = deferredUpdate();
    const applyPatch = vi
      .spyOn(sceneClient, "applyPatch")
      .mockImplementation((patch) => {
        submittedPatch = patch;
        return deferred.promise;
      });
    useEditorStore.setState({ scene: initial, connectionStatus: "connected" });

    const first = useEditorStore.getState().saveScene("first");
    const second = useEditorStore.getState().saveScene("second");

    await vi.waitFor(() => expect(applyPatch).toHaveBeenCalledTimes(1));
    if (!submittedPatch) {
      throw new Error("Save checkpoint was not submitted.");
    }
    deferred.resolve({
      scene: applyScenePatch(initial, submittedPatch).next,
      history: { canUndo: true, canRedo: false },
    });
    await expect(first).resolves.toBe("first.scene.json");
    await expect(second).resolves.toBe("second.scene.json");
    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(
      recorder.downloads().map((download) => download.fileName),
    ).toEqual(["first.scene.json", "second.scene.json"]);
  });

  it("does not let a failed queued save poison the next save", async () => {
    const initial = atRevision(4);
    const recorder = installDownloadRecorder();
    let callCount = 0;
    vi.spyOn(sceneClient, "applyPatch").mockImplementation((patch) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(
          new SceneClientError(
            "STALE_REVISION",
            "First queued save is stale.",
          ),
        );
      }
      return Promise.resolve({
        scene: applyScenePatch(initial, patch).next,
        history: { canUndo: true, canRedo: false },
      });
    });
    useEditorStore.setState({
      scene: initial,
      connectionStatus: "connected",
    });

    const failed = useEditorStore.getState().saveScene("failed");
    const successful = useEditorStore.getState().saveScene("successful");

    await expect(failed).resolves.toBeNull();
    await expect(successful).resolves.toBe(
      "successful.scene.json",
    );
    expect(callCount).toBe(2);
    expect(
      recorder.downloads().map((download) => download.fileName),
    ).toEqual(["successful.scene.json"]);
  });

  it("rejects an in-flight save after scene replacement and runs the queued save on the replacement", async () => {
    const initial = atRevision(3);
    const replacement = {
      ...atRevision(10),
      sceneId: "scene_replacement_queue",
    };
    const recorder = installDownloadRecorder();
    const firstResponse = deferredUpdate();
    const submittedPatches: ScenePatch[] = [];
    vi.spyOn(sceneClient, "applyPatch").mockImplementation((patch) => {
      submittedPatches.push(patch);
      if (submittedPatches.length === 1) {
        return firstResponse.promise;
      }
      return Promise.resolve({
        scene: applyScenePatch(replacement, patch).next,
        history: { canUndo: true, canRedo: false },
      });
    });
    useEditorStore.setState({
      scene: initial,
      connectionStatus: "connected",
    });

    const stale = useEditorStore.getState().saveScene("stale");
    const latest = useEditorStore.getState().saveScene("latest");
    await vi.waitFor(() => expect(submittedPatches).toHaveLength(1));
    useEditorStore.setState({ scene: replacement });
    firstResponse.resolve({
      scene: applyScenePatch(initial, submittedPatches[0]!).next,
      history: { canUndo: true, canRedo: false },
    });

    await expect(stale).resolves.toBeNull();
    await expect(latest).resolves.toBe("latest.scene.json");
    expect(submittedPatches).toHaveLength(2);
    expect(submittedPatches[1]).toMatchObject({
      sceneId: replacement.sceneId,
      baseRevision: replacement.revision,
    });
    expect(
      recorder.downloads().map((download) => download.fileName),
    ).toEqual(["latest.scene.json"]);
  });

  it("rejects a fully locked inconsistent checkpoint before mutating authoritative state", async () => {
    const initial = atRevision(6);
    const original = structuredClone(initial);
    const selectedEntityId = initial.entities[0]!.id;
    const originalHistory = { canUndo: false, canRedo: true };
    const recorder = installDownloadRecorder();
    vi.spyOn(sceneClient, "applyPatch").mockImplementation((patch) => {
      const changed = applyScenePatch(initial, patch).next;
      changed.entities[0]!.id = "prop_rejected_checkpoint";
      return Promise.resolve({
        scene: changed,
        history: HISTORY_IDLE,
      });
    });
    useEditorStore.setState({
      scene: initial,
      history: originalHistory,
      selectedEntityId,
      connectionStatus: "connected",
    });

    await expect(
      useEditorStore.getState().saveScene("invalid"),
    ).resolves.toBeNull();

    expect(recorder.downloads()).toEqual([]);
    expect(useEditorStore.getState().scene).toEqual(original);
    expect(useEditorStore.getState().scene?.revision).toBe(
      original.revision,
    );
    expect(useEditorStore.getState().history).toEqual(originalHistory);
    expect(useEditorStore.getState().selectedEntityId).toBe(
      selectedEntityId,
    );
    expect(useEditorStore.getState().error).toContain(
      "WORKFLOW_LOCK_CHECKPOINT_INVALID",
    );
  });

  it("does not let a queued save download a rejected fully locked response", async () => {
    const initial = atRevision(8);
    const original = structuredClone(initial);
    const recorder = installDownloadRecorder();
    const submittedPatches: ScenePatch[] = [];
    vi.spyOn(sceneClient, "applyPatch").mockImplementation((patch) => {
      submittedPatches.push(patch);
      const expected = applyScenePatch(initial, patch).next;
      if (submittedPatches.length === 1) {
        expected.entities[0]!.transform.positionM[0] += 1;
      }
      return Promise.resolve({
        scene: expected,
        history: { canUndo: true, canRedo: false },
      });
    });
    useEditorStore.setState({
      scene: initial,
      connectionStatus: "connected",
    });

    const rejected = useEditorStore.getState().saveScene("rejected");
    const valid = useEditorStore.getState().saveScene("valid");

    await expect(rejected).resolves.toBeNull();
    await expect(valid).resolves.toBe("valid.scene.json");
    expect(submittedPatches).toHaveLength(2);
    expect(submittedPatches[0]).toMatchObject({
      sceneId: original.sceneId,
      baseRevision: original.revision,
    });
    expect(submittedPatches[1]).toMatchObject({
      sceneId: original.sceneId,
      baseRevision: original.revision,
    });
    expect(
      recorder.downloads().map((download) => download.fileName),
    ).toEqual(["valid.scene.json"]);
    const downloaded = sceneSpecSchema.parse(
      JSON.parse(
        await recorder.downloads()[0]!.blob.text(),
      ) as unknown,
    );
    expect(downloaded).toEqual(
      applyScenePatch(original, submittedPatches[1]!).next,
    );
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
