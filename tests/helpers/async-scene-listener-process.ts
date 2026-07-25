import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApiApp } from "../../server/api";
import { SceneSession } from "../../server/scene-session";
import {
  createPatchSubmission,
  createStructuredScene,
} from "./structured-fixtures";

const listenOnLoopback = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const initial = createStructuredScene();
const session = new SceneSession(initial);
session.subscribe(async () => {
  await Promise.resolve();
  throw new Error("async_private_listener");
});
let laterListenerCount = 0;
session.subscribe(() => {
  laterListenerCount += 1;
});

const app = createApiApp(session, {
  uiUrl: "http://127.0.0.1:5173",
  instanceId: "instance_0123456789abcdef0123456789abcdef",
  requestShutdown: () => undefined,
});
const server = createServer(app);
const port = await listenOnLoopback(server);

try {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/submissions/patch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPatchSubmission(initial)),
    },
  );
  const body = (await response.json()) as unknown;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const scene = session.snapshot();
  process.stdout.write(
    `${JSON.stringify({
      status: response.status,
      body,
      scene: {
        sceneId: scene.sceneId,
        revision: scene.revision,
        title: scene.title,
      },
      history: session.historyStatus(),
      laterListenerCount,
    })}\n`,
  );
} finally {
  await closeServer(server);
}
