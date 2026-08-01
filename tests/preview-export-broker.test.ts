import { describe, expect, it, vi } from "vitest";
import { PreviewExportBroker } from "../server/preview-export-broker";

describe("PreviewExportBroker", () => {
  it("returns the exact PNG produced by the connected Shot Preview renderer", async () => {
    const broker = new PreviewExportBroker({ timeoutMs: 1_000 });
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0,
    ]);

    const unsubscribe = broker.subscribe((request) => {
      broker.complete({
        requestId: request.requestId,
        sceneId: request.sceneId,
        revision: request.revision,
        png,
      });
    });

    try {
      await expect(
        broker.request({
          sceneId: "scene_preview_contract",
          revision: 7,
          width: 1920,
          height: 1080,
        }),
      ).resolves.toEqual({
        sceneId: "scene_preview_contract",
        revision: 7,
        png,
      });
    } finally {
      unsubscribe();
    }
  });

  it("rejects export when no browser preview renderer is connected", async () => {
    const broker = new PreviewExportBroker({ timeoutMs: 1_000 });

    await expect(
      broker.request({
        sceneId: "scene_preview_contract",
        revision: 7,
        width: 1920,
        height: 1080,
      }),
    ).rejects.toMatchObject({
      code: "EXPORT_PREVIEW_UNAVAILABLE",
    });
  });

  it("prefers the most recently connected renderer over an older stale renderer", async () => {
    const broker = new PreviewExportBroker({ timeoutMs: 1_000 });
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0,
    ]);

    const staleRenderer = vi.fn((request: { requestId: string }) => {
      broker.fail(request.requestId);
    });
    const currentRenderer = vi.fn((request: {
      requestId: string;
      sceneId: string;
      revision: number;
    }) => {
      broker.complete({
        requestId: request.requestId,
        sceneId: request.sceneId,
        revision: request.revision,
        png,
      });
    });
    const unsubscribeStale = broker.subscribe(staleRenderer);
    const unsubscribeCurrent = broker.subscribe(currentRenderer);

    try {
      await expect(
        broker.request({
          sceneId: "scene_preview_contract",
          revision: 7,
          width: 1920,
          height: 1080,
        }),
      ).resolves.toEqual({
        sceneId: "scene_preview_contract",
        revision: 7,
        png,
      });
      expect(currentRenderer).toHaveBeenCalledTimes(1);
      expect(staleRenderer).not.toHaveBeenCalled();
    } finally {
      unsubscribeStale();
      unsubscribeCurrent();
    }
  });

  it("falls back to an older renderer only after the newest renderer fails", async () => {
    const broker = new PreviewExportBroker({ timeoutMs: 1_000 });
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0,
    ]);
    const calls: string[] = [];
    const unsubscribeOlder = broker.subscribe((request) => {
      calls.push("older");
      broker.complete({
        requestId: request.requestId,
        sceneId: request.sceneId,
        revision: request.revision,
        png,
      });
    });
    const unsubscribeNewest = broker.subscribe((request) => {
      calls.push("newest");
      broker.fail(request.requestId);
    });

    try {
      await expect(
        broker.request({
          sceneId: "scene_preview_contract",
          revision: 7,
          width: 1920,
          height: 1080,
        }),
      ).resolves.toMatchObject({ png });
      expect(calls).toEqual(["newest", "older"]);
    } finally {
      unsubscribeOlder();
      unsubscribeNewest();
    }
  });
});
