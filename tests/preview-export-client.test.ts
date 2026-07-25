import { describe, expect, it, vi } from "vitest";
import type { SceneSpec } from "../src/domain/scene-schema";
import { createDefaultScene } from "../src/domain/default-scene";
import { connectPreviewExportBridge } from "../src/three/preview-export-client";

describe("connectPreviewExportBridge", () => {
  it("uploads the exact Shot Preview blob at the requested dimensions", async () => {
    const scene: SceneSpec = {
      ...createDefaultScene(),
      sceneId: "scene_preview_contract",
      revision: 7,
    };
    const png = new Blob(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      { type: "image/png" },
    );
    const exportPng = vi.fn(async () => ({
      width: 1920,
      height: 1080,
      fileName: "perspective.png",
      blob: png,
    }));
    const fetchFn = vi.fn(async () => new Response("", { status: 200 }));
    let pngListener: ((event: MessageEvent<string>) => void) | undefined;
    const eventSource = {
      addEventListener: (
        type: string,
        listener: (event: MessageEvent<string>) => void,
      ) => {
        if (type === "png") {
          pngListener = listener as (event: MessageEvent<string>) => void;
        }
      },
      close: vi.fn(),
    };

    const disconnect = connectPreviewExportBridge({
      getScene: () => scene,
      getExporter: () => ({ exportPng }),
      fetchFn,
      createEventSource: () => eventSource,
    });

    pngListener?.(
      new MessageEvent("png", {
        data: JSON.stringify({
          requestId: "export_0123456789abcdef0123456789abcdef",
          sceneId: scene.sceneId,
          revision: scene.revision,
          width: 1920,
          height: 1080,
        }),
      }),
    );
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    expect(exportPng).toHaveBeenCalledWith({
      download: false,
      width: 1920,
      height: 1080,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/v1/preview-exports/export_0123456789abcdef0123456789abcdef/result",
      expect.objectContaining({
        method: "POST",
        body: png,
        headers: {
          "Content-Type": "image/png",
          "X-Shubi-Shot-Scene-Id": scene.sceneId,
          "X-Shubi-Shot-Revision": String(scene.revision),
        },
      }),
    );

    disconnect();
    expect(eventSource.close).toHaveBeenCalledTimes(1);
  });
});
