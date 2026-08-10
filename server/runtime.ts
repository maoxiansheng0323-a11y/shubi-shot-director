import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApiApp } from "./api";
import { ScenePersistence } from "./scene-persistence";
import { SceneSession } from "./scene-session";

const INSTANCE_ID_PATTERN = /^instance_[0-9a-f]{32}$/u;

export const resolveViteCacheDirectory = (
  instanceId: string,
  temporaryRoot = os.tmpdir(),
): string => {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new Error("The bridge instance ID is invalid.");
  }
  return path.join(
    path.resolve(temporaryRoot),
    "shubi-shot-vite-cache",
    instanceId,
  );
};

export const startServer = async (options: {
  production: boolean;
}): Promise<void> => {
  const host = "127.0.0.1";
  const portSource = process.env.SHUBI_SHOT_PORT ?? "4317";
  if (!/^[1-9][0-9]*$/u.test(portSource)) {
    throw new Error("The configured bridge port is invalid.");
  }
  const port = Number(portSource);
  if (!Number.isInteger(port) || port > 65_535) {
    throw new Error("The configured bridge port is invalid.");
  }
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const uiUrl = `http://${host}:${port}`;
  const instanceId = `instance_${randomUUID().replaceAll("-", "")}`;
  const runtimeDirectory = process.env.SHUBI_SHOT_RUNTIME_DIR;
  const resolvedRuntimeDirectory =
    runtimeDirectory === undefined
      ? path.join(repositoryRoot, ".shubi-shot")
      : runtimeDirectory;
  const persistence = new ScenePersistence(resolvedRuntimeDirectory);
  const session = new SceneSession(await persistence.load());
  session.subscribe(({ scene }) => {
    void persistence.persist(scene).catch(() => {
      process.stderr.write("Failed to persist the current scene.\n");
    });
  });

  let vite: Awaited<ReturnType<typeof createViteServer>> | null = null;
  let viteCacheDirectory: string | null = null;
  let closing = false;
  const server = createServer();
  const closeApplication = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => {
        server.closeAllConnections();
      }, 50);
    });
    try {
      await vite?.close();
    } finally {
      if (viteCacheDirectory !== null) {
        await rm(viteCacheDirectory, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  };
  const app = createApiApp(session, {
    uiUrl,
    instanceId,
    requestShutdown: () => {
      void closeApplication().catch(() => {
        process.exitCode = 1;
      });
    },
  });
  server.on("request", app);

  if (options.production) {
    const distDirectory = path.join(repositoryRoot, "dist");
    if (!existsSync(distDirectory)) {
      throw new Error("Production build is missing. Run pnpm build first.");
    }
    app.use(express.static(distDirectory));
    app.use((_request, response) => {
      response.sendFile(path.join(distDirectory, "index.html"));
    });
  } else {
    viteCacheDirectory = resolveViteCacheDirectory(instanceId);
    try {
      vite = await createViteServer({
        root: repositoryRoot,
        cacheDir: viteCacheDirectory,
        server: {
          host,
          middlewareMode: true,
          hmr: { host, server },
        },
        appType: "spa",
      });
    } catch (error) {
      await rm(viteCacheDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
    app.use(vite.middlewares);
  }

  const handleSignal = (): void => {
    void closeApplication().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  server.listen(port, host, () => {
    process.stdout.write(`Shubi Shot Director ready at ${uiUrl}\n`);
  });
};
