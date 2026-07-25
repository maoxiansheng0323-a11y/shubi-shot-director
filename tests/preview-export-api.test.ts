import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { requestPreviewPng } from "../cli/bridge";
import { createApiApp } from "../server/api";
import { PreviewExportBroker } from "../server/preview-export-broker";
import { SceneSession } from "../server/scene-session";
import { createDefaultScene } from "../src/domain/default-scene";

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
};

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

describe("Shot Preview PNG bridge", () => {
  it("returns the exact browser-rendered PNG for the current scene revision", async () => {
    const scene = createDefaultScene();
    const session = new SceneSession(scene);
    const previewExports = new PreviewExportBroker({ timeoutMs: 1_000 });
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0,
    ]);
    const unsubscribe = previewExports.subscribe((request) => {
      expect(request).toMatchObject({
        sceneId: scene.sceneId,
        revision: scene.revision,
        width: 1920,
        height: 1080,
      });
      previewExports.complete({
        requestId: request.requestId,
        sceneId: request.sceneId,
        revision: request.revision,
        png,
      });
    });
    const app = createApiApp(session, {
      uiUrl: "http://127.0.0.1:4317",
      instanceId: "instance_0123456789abcdef0123456789abcdef",
      requestShutdown: () => undefined,
      previewExports,
    });
    const server = createServer(app);
    const port = await listen(server);

    try {
      const origin = `http://127.0.0.1:${port}`;
      await expect(
        requestPreviewPng(
          {
            baseUrl: new URL(origin),
            port,
            originSource: origin,
          },
          1920,
          1080,
        ),
      ).resolves.toEqual({
        sceneId: scene.sceneId,
        revision: scene.revision,
        png,
      });
    } finally {
      unsubscribe();
      await close(server);
    }
  });
});
