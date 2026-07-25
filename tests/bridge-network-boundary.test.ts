import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BridgeError,
  requestBridge,
  resolveBridgeConfiguration,
} from "../cli/bridge";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorCli = path.join(repositoryRoot, "cli", "director.ts");
const tsxCliPath = path.join(
  repositoryRoot,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const servers: Server[] = [];
const temporaryDirectories: string[] = [];

const DIRECTOR_OWNED_ENVIRONMENT = [
  "SHUBI_SHOT_API_KEY",
  "SHUBI_SHOT_TOKEN",
  "SHUBI_SHOT_AUTHORIZATION",
  "SHUBI_SHOT_SECRET",
  "SHUBI_SHOT_MODEL",
  "SHUBI_SHOT_PROVIDER",
  "SHUBI_SHOT_BASE_URL",
  "SHUBI_SHOT_ENDPOINT",
] as const;

interface CliResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface RunningCli {
  child: ChildProcess;
  completion: Promise<CliResult>;
}

const listenOnLoopback = async (server: Server): Promise<number> => {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
};

const closeServer = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const getUnusedLoopbackPort = async (): Promise<number> => {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
  await closeServer(server);
  return port;
};

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shubi-shot-network-boundary-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const probeCanonicalBridge = async (
  port: number,
): Promise<Record<string, unknown> | null> => {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/health`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(250),
      },
    );
    const body = (await response.json()) as unknown;
    if (
      !response.ok ||
      typeof body !== "object" ||
      body === null ||
      !("ok" in body) ||
      body.ok !== true ||
      !("data" in body) ||
      typeof body.data !== "object" ||
      body.data === null
    ) {
      return null;
    }
    return body.data as Record<string, unknown>;
  } catch {
    return null;
  }
};

const stopCanonicalBridge = async (
  port: number,
  health: Record<string, unknown>,
): Promise<void> => {
  if (typeof health.instanceId !== "string") {
    return;
  }
  await fetch(`http://127.0.0.1:${port}/api/v1/shutdown`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-Shubi-Shot-Instance": health.instanceId,
    },
    body: "{}",
    signal: AbortSignal.timeout(1_000),
  }).catch(() => undefined);
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if ((await probeCanonicalBridge(port)) === null) {
      return;
    }
    await delay(50);
  }
};

const launchEnsure = (
  bridgeUrl: string,
  runtimeDirectory: string,
): RunningCli => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of DIRECTOR_OWNED_ENVIRONMENT) {
    delete environment[name];
  }
  delete environment.SHUBI_SHOT_PORT;
  environment.SHUBI_SHOT_URL = bridgeUrl;
  environment.SHUBI_SHOT_RUNTIME_DIR = runtimeDirectory;

  const child = spawn(
    process.execPath,
    [tsxCliPath, directorCli, "ensure"],
    {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<CliResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
  return { child, completion };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("bridge network boundary", () => {
  it.each([
    ["default redirect behavior", undefined],
    ["caller-requested redirect follow", { redirect: "follow" as const }],
  ])("blocks redirect escape with %s", async (_label, options) => {
    let targetHits = 0;
    const targetServer = createServer((_request, response) => {
      targetHits += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, data: { escaped: true } }));
    });
    const targetPort = await listenOnLoopback(targetServer);

    const redirectServer = createServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader(
        "Location",
        `http://127.0.0.1:${targetPort}/escaped`,
      );
      response.end();
    });
    const redirectPort = await listenOnLoopback(redirectServer);
    const configuration = resolveBridgeConfiguration({
      SHUBI_SHOT_URL: `http://127.0.0.1:${redirectPort}`,
    });

    await expect(
      requestBridge(configuration, "/api/v1/redirect", options),
    ).rejects.toBeInstanceOf(BridgeError);
    expect(targetHits).toBe(0);
  });

  it("refuses to autostart a missing bridge on a non-canonical loopback host", async () => {
    const port = await getUnusedLoopbackPort();
    const runtimeDirectory = await createTemporaryDirectory();
    const running = launchEnsure(
      `http://127.0.0.2:${port}`,
      runtimeDirectory,
    );
    let completed: CliResult | undefined;
    void running.completion.then((result) => {
      completed = result;
    });
    let canonicalHealth: Record<string, unknown> | null = null;

    try {
      const deadline = Date.now() + 12_000;
      while (completed === undefined && Date.now() < deadline) {
        canonicalHealth = await probeCanonicalBridge(port);
        if (canonicalHealth !== null) {
          break;
        }
        await delay(50);
      }

      expect(canonicalHealth).toBeNull();
      expect(completed).toMatchObject({
        exitCode: 1,
        signal: null,
        stderr: "",
      });
      expect(JSON.parse(completed?.stdout.trim() ?? "")).toEqual({
        ok: false,
        error: {
          code: "BRIDGE_AUTOSTART_HOST_UNSUPPORTED",
          message:
            "Automatic bridge startup requires the canonical 127.0.0.1 host.",
        },
      });
      await delay(200);
      expect(await probeCanonicalBridge(port)).toBeNull();
    } finally {
      const health = canonicalHealth ?? (await probeCanonicalBridge(port));
      if (health !== null) {
        await stopCanonicalBridge(port, health);
      }
      if (running.child.exitCode === null) {
        running.child.kill();
      }
      await Promise.race([running.completion, delay(2_000)]);
    }
  }, 20_000);
});
