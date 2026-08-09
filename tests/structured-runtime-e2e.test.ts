import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { renderSceneToPng } from "../server/software-png";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import {
  createExplicitPuppetActionPose,
  createPatchSubmission,
  createSceneSubmission,
} from "./helpers/structured-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const socketGuardPath = fileURLToPath(
  new URL("./helpers/socket-guard.mjs", import.meta.url),
);
const socketGuardUrl = pathToFileURL(socketGuardPath).href;
const directorCliPath = path.join(
  repositoryRoot,
  "cli",
  "director.ts",
);
const directorLauncherPath = path.join(
  repositoryRoot,
  "scripts",
  "director.mjs",
);
const serverPath = path.join(repositoryRoot, "server", "index.ts");
const tsxLoaderPath = path.join(
  repositoryRoot,
  "node_modules",
  "tsx",
  "dist",
  "loader.mjs",
);
const tsxLoaderUrl = pathToFileURL(tsxLoaderPath).href;
const guardLogName = "socket-guard.jsonl";
const expectedCommandIds = [
  "doctor",
  "ensure",
  "status",
  "stop",
  "health",
  "snapshot",
  "blueprint.validate",
  "scene.create",
  "scene.submit",
  "scene.save",
  "scene.load",
  "patch.apply",
  "patch.submit",
  "shot.solve",
  "shot.revise",
  "shot.candidates",
  "shot.accept",
  "composition.inspect",
  "pose.inspect",
  "export.png",
  "undo",
  "redo",
  "open.system",
] as const;
const expectedFeatureIds = [
  "bridge.thread-workspaces",
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
  "actor.limb-presence",
  "actor.blueprint-snapshots",
  "actor.modular-primitives",
  "actor.variants",
  "actor.resolved-projection",
  "actor.height",
  "actor.pose-joints",
  "actor.static-blocking",
  "actor.body-contact-sites",
  "actor.pose-diagnostics",
  "actor.blueprint-instance-limb-overrides",
  "shot.semantic-intent-plan",
  "shot.hard-soft-constraints",
  "shot.relationship-solver",
  "shot.camera-candidate-solver",
  "shot.render-space-verification",
  "shot.semantic-revision",
] as const;
const temporaryDirectories: string[] = [];

const osEnvironmentKeys = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
] as const;

const forbiddenRuntimeEnvironmentKeys = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NODE_OPTIONS",
  "CODEX_THREAD_ID",
  "SHUBI_SHOT_RUNTIME_ROOT",
  "SHUBI_SHOT_WORKSPACE_ID",
  "SHUBI_SHOT_WORKSPACE_REGISTRY",
  "SHUBI_SHOT_WORKSPACE_BINDING",
  "SHUBI_SHOT_API_KEY",
  "SHUBI_SHOT_TOKEN",
  "SHUBI_SHOT_AUTHORIZATION",
  "SHUBI_SHOT_SECRET",
  "SHUBI_SHOT_MODEL",
  "SHUBI_SHOT_PROVIDER",
  "SHUBI_SHOT_BASE_URL",
  "SHUBI_SHOT_ENDPOINT",
] as const;

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface CapturedProcess {
  child: ChildProcess;
  completion: Promise<ProcessResult>;
  output: () => { stdout: string; stderr: string };
}

const runningProcesses: CapturedProcess[] = [];

interface JsonEnvelope<T = Record<string, unknown>> {
  ok: true;
  data: T;
}

interface SnapshotData {
  scene: SceneSpec;
  history: {
    canUndo: boolean;
    canRedo: boolean;
  };
}

const createTemporaryDirectory = async (
  prefix: string,
): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const createMinimalEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of osEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return {
    ...environment,
    ...overrides,
  };
};

const startCapturedProcess = (
  executable: string,
  args: string[],
  options: SpawnOptions,
  timeoutMs = 30_000,
): CapturedProcess => {
  const child = spawn(executable, args, {
    ...options,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<ProcessResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("A real Director process timed out."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
  const captured = {
    child,
    completion,
    output: () => ({ stdout, stderr }),
  };
  runningProcesses.push(captured);
  return captured;
};

const waitForChildExit = async (
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> => {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      resolve(exited);
    };
    const onClose = (): void => finish(true);
    const onError = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
    child.once("error", onError);
  });
};

const terminateCapturedProcess = async (
  captured: CapturedProcess,
): Promise<void> => {
  const { child } = captured;
  if (child.exitCode !== null || child.signalCode !== null) {
    await captured.completion.catch(() => undefined);
    return;
  }
  child.kill();
  if (await waitForChildExit(child, 2_000)) {
    return;
  }
  child.kill("SIGKILL");
  if (!(await waitForChildExit(child, 2_000))) {
    throw new Error("A real Director process did not terminate.");
  }
};

const runNode = async (
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs = 30_000,
): Promise<ProcessResult> =>
  startCapturedProcess(
    process.execPath,
    args,
    {
      cwd: repositoryRoot,
      env: environment,
    },
    timeoutMs,
  ).completion;

const parseSuccessfulJsonLine = <T>(
  result: ProcessResult,
): JsonEnvelope<T> => {
  expect(result).toMatchObject({
    exitCode: 0,
    signal: null,
    stderr: "",
  });
  const lines = result.stdout.split(/\r?\n/u);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  const parsed = JSON.parse(lines[0] ?? "") as JsonEnvelope<T>;
  expect(parsed.ok).toBe(true);
  return parsed;
};

const runDirectCli = async <T>(
  args: string[],
  environment: NodeJS.ProcessEnv,
  observedStreams: string[],
): Promise<JsonEnvelope<T>> => {
  const result = await runNode(
    [
      "--import",
      socketGuardUrl,
      "--import",
      tsxLoaderUrl,
      directorCliPath,
      ...args,
    ],
    environment,
  );
  observedStreams.push(result.stdout, result.stderr);
  return parseSuccessfulJsonLine<T>(result);
};

const runRootLauncher = async <T>(
  args: string[],
  environment: NodeJS.ProcessEnv,
  observedStreams: string[],
): Promise<JsonEnvelope<T>> => {
  const result = await runNode(
    [
      "--import",
      socketGuardUrl,
      directorLauncherPath,
      ...args,
    ],
    environment,
  );
  observedStreams.push(result.stdout, result.stderr);
  return parseSuccessfulJsonLine<T>(result);
};

const connectTestPreviewRenderer = async (
  bridgeUrl: string,
  scene: SceneSpec,
): Promise<{ completion: Promise<void>; close: () => void }> => {
  const controller = new AbortController();
  const response = await fetch(
    `${bridgeUrl}/api/v1/preview-exports/events`,
    { signal: controller.signal },
  );
  if (!response.ok || !response.body) {
    throw new Error("The test Shot Preview stream did not connect.");
  }
  const responseBody = response.body;
  const completion = (async (): Promise<void> => {
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("The test Shot Preview stream closed early.");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine) {
          const request = JSON.parse(dataLine.slice(6)) as {
            requestId: string;
            sceneId: string;
            revision: number;
            width: number;
            height: number;
          };
          expect(request).toMatchObject({
            sceneId: scene.sceneId,
            revision: scene.revision,
          });
          const png = renderSceneToPng(
            scene,
            request.width,
            request.height,
          ).png;
          const upload = await fetch(
            `${bridgeUrl}/api/v1/preview-exports/${request.requestId}/result`,
            {
              method: "POST",
              headers: {
                "Content-Type": "image/png",
                "X-Shubi-Shot-Scene-Id": request.sceneId,
                "X-Shubi-Shot-Revision": String(request.revision),
              },
              body: Uint8Array.from(png),
            },
          );
          expect(upload.status).toBe(200);
          return;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  })();
  return {
    completion,
    close: () => controller.abort(),
  };
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

const listenOnLoopback = async (server: Server): Promise<number> => {
  return listenOnHost(server, "127.0.0.1");
};

const listenOnHost = async (
  server: Server,
  host: "127.0.0.1" | "::1",
): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
};

const getUnusedLoopbackPort = async (): Promise<number> => {
  for (;;) {
    const server = createServer();
    const port = await listenOnLoopback(server);
    await closeServer(server);
    if (port !== 4317) {
      return port;
    }
  }
};

const fileExists = async (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false,
  );

const readRequestJson = async (
  request: IncomingMessage,
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
};

interface ControlledSaveBridge {
  server: Server;
  bridgeUrl: string;
  observations: {
    patch: unknown | null;
    fileExistedBeforePatchResponse: boolean | null;
    currentScene: () => SceneSpec;
  };
}

const startControlledSaveBridge = async (
  initialScene: SceneSpec,
  savePath: string,
  responseMode: "accepted" | "invalid" | "mismatched",
  onPatchApplied?: (scene: SceneSpec) => Promise<void>,
): Promise<ControlledSaveBridge> => {
  let scene = structuredClone(initialScene);
  let bridgeUrl = "";
  const observations: ControlledSaveBridge["observations"] = {
    patch: null,
    fileExistedBeforePatchResponse: null,
    currentScene: () => structuredClone(scene),
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/api/v1/health") {
        sendJson(response, 200, {
          ok: true,
          data: {
            ...getRuntimeCapabilityManifest(),
            status: "ready",
            sceneId: scene.sceneId,
            revision: scene.revision,
            uiUrl: bridgeUrl,
            instanceId: "instance_00000000000000000000000000000000",
          },
        });
        return;
      }
      if (request.method === "GET" && request.url === "/api/v1/scene") {
        sendJson(response, 200, {
          ok: true,
          data: {
            scene,
            history: { canUndo: false, canRedo: false },
          },
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/v1/patches") {
        observations.patch = await readRequestJson(request);
        scene = applyScenePatch(scene, observations.patch).next;
        observations.fileExistedBeforePatchResponse =
          await fileExists(savePath);
        await onPatchApplied?.(structuredClone(scene));
        const responseScene =
          responseMode === "mismatched"
            ? {
                ...structuredClone(scene),
                title: "Mismatched checkpoint response",
              }
            : scene;
        sendJson(
          response,
          200,
          responseMode !== "invalid"
            ? {
                ok: true,
                data: {
                  scene: responseScene,
                  history: { canUndo: true, canRedo: false },
                },
              }
            : {
                ok: true,
                data: {
                  scene: { invalid: true },
                },
              },
        );
        return;
      }
      sendJson(response, 404, {
        ok: false,
        error: { code: "NOT_FOUND", message: "Not found." },
      });
    } catch {
      sendJson(response, 500, {
        ok: false,
        error: {
          code: "CONTROLLED_BRIDGE_FAILED",
          message: "Controlled bridge failed.",
        },
      });
    }
  });
  const port = await listenOnLoopback(server);
  bridgeUrl = `http://127.0.0.1:${port}`;
  return { server, bridgeUrl, observations };
};

const startGuardedBridge = async (
  port: number,
  runtimeDirectory: string,
): Promise<CapturedProcess> => {
  const environment = createMinimalEnvironment({
    SHUBI_SHOT_PORT: String(port),
    SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
  });
  for (const key of forbiddenRuntimeEnvironmentKeys) {
    expect(environment).not.toHaveProperty(key);
  }
  const running = startCapturedProcess(
    process.execPath,
    [
      "--import",
      socketGuardUrl,
      "--import",
      tsxLoaderUrl,
      serverPath,
    ],
    {
      cwd: repositoryRoot,
      env: environment,
    },
    120_000,
  );
  const readyText =
    "Shubi Shot Director ready at http://127.0.0.1:" + port;
  await Promise.race([
    new Promise<void>((resolve) => {
      const inspect = (): void => {
        if (running.output().stdout.includes(readyText)) {
          resolve();
        }
      };
      running.child.stdout?.on("data", inspect);
      inspect();
    }),
    running.completion.then((result) => {
      throw new Error(
        "The guarded bridge exited before becoming ready: " +
          result.exitCode,
      );
    }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        async () => {
          const output = running.output();
          const guardLog = await readFile(
            path.join(runtimeDirectory, guardLogName),
            "utf8",
          ).catch(() => "");
          reject(
            new Error(
              "The guarded bridge did not become ready. stdout=" +
                JSON.stringify(output.stdout) +
                " stderr=" +
                JSON.stringify(output.stderr) +
                " guard=" +
                JSON.stringify(guardLog),
            ),
          );
        },
        30_000,
      );
    }),
  ]);
  return running;
};

const expectV2Boundary = (data: Record<string, unknown>): void => {
  expect(data).toEqual(expect.objectContaining({
    service: "shubi-shot-director",
    capabilitiesContractVersion: 2,
    applicationVersion: "1.0.0",
    bridgeProtocolVersion: 1,
    workspaceRoutingVersion: 1,
    sceneSchemaVersion: 6,
    patchSchemaVersion: 6,
    intentReportSchemaVersion: 6,
    semanticAuthority: "host",
    inputContract: "structured-only",
    modelIntegration: "none",
    credentialPolicy: "forbidden",
    networkPolicy: "loopback-only",
    commands: expectedCommandIds,
    features: expectedFeatureIds,
    entityLockModes: ["none", "workflow", "user"],
    patchPolicyFields: ["preserveLock"],
    lockErrorCodes: [
      "USER_LOCKED",
      "WORKFLOW_LOCKED",
      "LOCK_PRESERVATION_CONFLICT",
    ],
    actorLimbPartIds: [
      "upper_arm_l",
      "forearm_l",
      "hand_l",
      "upper_arm_r",
      "forearm_r",
      "hand_r",
      "upper_leg_l",
      "lower_leg_l",
      "foot_l",
      "upper_leg_r",
      "lower_leg_r",
      "foot_r",
    ],
    actorLimbPresenceModes: ["present", "absent"],
    actorLimbErrorCodes: ["LIMB_HIERARCHY_CONFLICT"],
    actorPuppet: {
      heightLimitsM: { min: 1, max: 2.4 },
      jointIds: [
        "pelvis",
        "spine",
        "neck",
        "upper_arm_l",
        "forearm_l",
        "hand_l",
        "upper_arm_r",
        "forearm_r",
        "hand_r",
        "upper_leg_l",
        "lower_leg_l",
        "foot_l",
        "upper_leg_r",
        "lower_leg_r",
        "foot_r",
      ],
      operationIds: [
        "actor.height.set",
        "actor.pose.joints.set",
        "actor.blocking.solve",
      ],
      errorCodes: [
        "ACTOR_HEIGHT_TARGET_INVALID",
        "ACTOR_HEIGHT_RANGE_INVALID",
        "ACTOR_JOINT_TARGET_INVALID",
        "ACTOR_JOINT_ID_INVALID",
        "STATIC_BLOCKING_ACTOR_NOT_FOUND",
        "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
        "STATIC_BLOCKING_POSE_PRESET_INVALID",
        "POSE_DIAGNOSTICS_FAILED",
      ],
    },
    actorBlueprint: {
      schemaVersion: 1,
      mounts: [
        "shoulder_l",
        "shoulder_r",
        "elbow_l",
        "elbow_r",
        "wrist_l",
        "wrist_r",
        "hip_l",
        "hip_r",
        "knee_l",
        "knee_r",
      ],
      primitives: ["box", "sphere", "cylinder"],
      variantDeltaFields: ["limbPresence", "moduleVisibility"],
      errorCodes: [
        "ACTOR_BLUEPRINT_FILE_READ_FAILED",
        "ACTOR_BLUEPRINT_FILE_INVALID",
        "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
        "ACTOR_BLUEPRINT_VARIANT_INVALID",
        "ACTOR_BLUEPRINT_HASH_MISMATCH",
        "ACTOR_BLUEPRINT_HASH_DUPLICATE",
        "ACTOR_BLUEPRINT_REFERENCE_INVALID",
        "ACTOR_BLUEPRINT_ID_CONFLICT",
      ],
    },
  }));
  expect(data).not.toHaveProperty("requiresApiKey");
};

const readGuardRecords = async (
  runtimeDirectory: string,
): Promise<Array<Record<string, unknown>>> => {
  const source = await readFile(
    path.join(runtimeDirectory, guardLogName),
    "utf8",
  );
  return source
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const collectFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(target)));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files;
};

const auditNoMarkerLeak = async (
  directory: string,
  streams: string[],
  markers: string[],
): Promise<void> => {
  const files = await collectFiles(directory);
  const buffers = await Promise.all(files.map((file) => readFile(file)));
  const repositoryMarkers = [
    repositoryRoot,
    repositoryRoot.replaceAll("\\", "/"),
  ];
  const textSources = [
    ...streams,
    ...buffers.map((buffer) => buffer.toString("utf8")),
  ];
  for (const marker of [...markers, ...repositoryMarkers]) {
    const normalizedMarker = marker.toLowerCase();
    for (const source of textSources) {
      expect(source.toLowerCase()).not.toContain(normalizedMarker);
    }
    const markerBuffer = Buffer.from(marker, "utf8");
    for (const buffer of buffers) {
      expect(buffer.includes(markerBuffer)).toBe(false);
    }
  }
};

afterEach(async () => {
  for (const captured of runningProcesses.splice(0)) {
    await terminateCapturedProcess(captured);
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe.sequential("offline structured Director real-process workflow", () => {
  it("fails closed for DNS, TLS, HTTPS, and non-loopback sockets", async () => {
    const runtimeDirectory = await createTemporaryDirectory(
      "shubi-shot-socket-guard-",
    );
    const server = createServer((_request, response) => {
      response.end("loopback-ipv4-ok");
    });
    const port = await listenOnLoopback(server);
    const ipv6Server = createServer((_request, response) => {
      response.end("loopback-ipv6-ok");
    });
    const ipv6Port = await listenOnHost(ipv6Server, "::1");
    const environment = createMinimalEnvironment({
      SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
    });
    const probeSource = [
      "import dns from \"node:dns\";",
      "import childProcess from \"node:child_process\";",
      "import dgram from \"node:dgram\";",
      "import https from \"node:https\";",
      "import net from \"node:net\";",
      "import tls from \"node:tls\";",
      "process.noDeprecation = true;",
      "const results = {};",
      "const check = (name, operation) => {",
      "  try {",
      "    const value = operation();",
      "    value?.on?.(\"error\", () => undefined);",
      "    results[name] = \"MISSED\";",
      "  } catch (error) {",
      "    results[name] = error?.code;",
      "  }",
      "};",
      "check(\"dns\", () => dns.lookup(\"example.invalid\", () => undefined));",
      "check(\"dnsPromisesResolver\", () => { const pending = new dns.promises.Resolver().resolve4(\"example.invalid\"); pending.catch(() => undefined); return pending; });",
      "check(\"dgram\", () => { const socket = dgram.createSocket(\"udp4\"); socket.close(); return socket; });",
      "check(\"dgramConstructor\", () => { const socket = new dgram.Socket(\"udp4\"); socket.close(); return socket; });",
      "check(\"dgramHandle\", () => { const handle = dgram._createSocketHandle(undefined, undefined, \"udp4\"); handle.close(); return handle; });",
      "check(\"tls\", () => tls.connect({ host: \"127.0.0.1\", port: 9 }));",
      "check(\"https\", () => https.get(\"https://127.0.0.1:9\"));",
      "check(\"credentialed\", () => fetch(\"http://user:pass@127.0.0.1:" + port + "\"));",
      "check(\"hostname\", () => net.connect({ host: \"localhost\", port: 9 }));",
      "check(\"outbound\", () => net.connect({ host: \"198.51.100.1\", port: 9 }));",
      "check(\"exec\", () => childProcess.exec(\"\"));",
      "check(\"execFile\", () => childProcess.execFile(process.execPath, [\"--version\"]));",
      "check(\"fork\", () => childProcess.fork(" + JSON.stringify(socketGuardPath) + ", [], { silent: true }));",
      "check(\"spawnSync\", () => childProcess.spawnSync(process.execPath, [\"--version\"]));",
      "check(\"execSync\", () => childProcess.execSync(\"\"));",
      "check(\"execFileSync\", () => childProcess.execFileSync(process.execPath, [\"--version\"]));",
      "check(\"spawnShell\", () => childProcess.spawn(process.execPath, { shell: true, stdio: \"ignore\" }));",
      "check(\"childProcessPrototypeSpawn\", () => { const child = new childProcess.ChildProcess(); child.on(\"error\", () => undefined); child.spawn({ file: process.execPath, args: [process.execPath, \"--version\"], stdio: [\"ignore\", \"ignore\", \"ignore\"] }); return child; });",
      "const guardedChildSource = \"import dgram from \\\"node:dgram\\\"; try { const socket = dgram.createSocket(\\\"udp4\\\"); socket.close(); process.stdout.write(\\\"MISSED\\\"); } catch (error) { process.stdout.write(error?.code ?? \\\"UNKNOWN\\\"); }\";",
      "const guardedChild = childProcess.spawn(process.execPath, [\"--input-type=module\", \"--eval\", guardedChildSource], { env: process.env, stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
      "let guardedChildStdout = \"\";",
      "guardedChild.stdout.setEncoding(\"utf8\");",
      "guardedChild.stdout.on(\"data\", (chunk) => { guardedChildStdout += chunk; });",
      "const guardedChildExit = await new Promise((resolve, reject) => { guardedChild.once(\"error\", reject); guardedChild.once(\"close\", resolve); });",
      "results.spawnChildExit = guardedChildExit;",
      "results.spawnChildGuard = guardedChildStdout;",
      "const ipv4Response = await fetch(\"http://127.0.0.1:" + port + "\");",
      "results.loopbackIpv4 = await ipv4Response.text();",
      "const ipv6Response = await fetch(\"http://[::1]:" + ipv6Port + "\");",
      "results.loopbackIpv6 = await ipv6Response.text();",
      "process.stdout.write(JSON.stringify({ ok: true, data: results }) + String.fromCharCode(10));",
    ].join("\n");
    const probePath = path.join(runtimeDirectory, "guard-probe.mjs");
    await writeFile(probePath, probeSource, "utf8");
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          probePath,
        ],
        environment,
      );
      const parsed = parseSuccessfulJsonLine<Record<string, string>>(result);
      expect(parsed.data).toEqual({
        dns: "SOCKET_GUARD_BLOCKED",
        dnsPromisesResolver: "SOCKET_GUARD_BLOCKED",
        dgram: "SOCKET_GUARD_BLOCKED",
        dgramConstructor: "SOCKET_GUARD_BLOCKED",
        dgramHandle: "SOCKET_GUARD_BLOCKED",
        tls: "SOCKET_GUARD_BLOCKED",
        https: "SOCKET_GUARD_BLOCKED",
        credentialed: "SOCKET_GUARD_BLOCKED",
        hostname: "SOCKET_GUARD_BLOCKED",
        outbound: "SOCKET_GUARD_BLOCKED",
        exec: "SOCKET_GUARD_BLOCKED",
        execFile: "SOCKET_GUARD_BLOCKED",
        fork: "SOCKET_GUARD_BLOCKED",
        spawnSync: "SOCKET_GUARD_BLOCKED",
        execSync: "SOCKET_GUARD_BLOCKED",
        execFileSync: "SOCKET_GUARD_BLOCKED",
        spawnShell: "SOCKET_GUARD_BLOCKED",
        childProcessPrototypeSpawn: "SOCKET_GUARD_BLOCKED",
        spawnChildExit: 0,
        spawnChildGuard: "SOCKET_GUARD_BLOCKED",
        loopbackIpv4: "loopback-ipv4-ok",
        loopbackIpv6: "loopback-ipv6-ok",
      });
      const records = await readGuardRecords(runtimeDirectory);
      const blockedApis = records
        .filter((record) => record.type === "network-blocked")
        .map((record) => record.api);
      expect(blockedApis).toEqual(
        expect.arrayContaining([
          "dns.lookup",
          "dns.promises.Resolver.resolve4",
          "dgram.createSocket",
          "dgram.Socket",
          "dgram._createSocketHandle",
          "tls.connect",
          "https.get",
          "fetch",
          "net.connect",
        ]),
      );
      const blockedProcessApis = records
        .filter((record) => record.type === "process-blocked")
        .map((record) => record.api);
      expect(blockedProcessApis).toEqual(
        expect.arrayContaining([
          "child_process.spawn.shell",
          "child_process.ChildProcess.spawn",
        ]),
      );
      expect(
        records.some(
          (record) =>
            record.type === "network-allowed" &&
            record.family === "ipv4-loopback",
        ),
      ).toBe(true);
      expect(
        records.some(
          (record) =>
            record.type === "network-allowed" &&
            record.family === "ipv6-loopback",
        ),
      ).toBe(true);
      const serializedRecords = JSON.stringify(records);
      expect(serializedRecords).not.toContain("example.invalid");
      expect(serializedRecords).not.toContain("198.51.100.1");
    } finally {
      await closeServer(server);
      await closeServer(ipv6Server);
    }
  }, 20_000);

  it("receives an accepted save checkpoint before writing the scene file", async () => {
    const directory = await createTemporaryDirectory(
      "shubi-shot-controlled-save-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    await mkdir(runtimeDirectory);
    const savedScenePath = path.join(directory, "saved-scene.json");
    const scene = createDefaultScene();
    scene.revision = 9;
    scene.entities[1]!.lockMode = "workflow";
    scene.entities[2]!.lockMode = "user";
    const controlled = await startControlledSaveBridge(
      scene,
      savedScenePath,
      "accepted",
    );
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          "--import",
          tsxLoaderUrl,
          directorCliPath,
          "scene",
          "save",
          "--file",
          savedScenePath,
        ],
        createMinimalEnvironment({
          SHUBI_SHOT_URL: controlled.bridgeUrl,
          SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
        }),
      );
      expect(result.exitCode, result.stdout).toBe(0);
      const saved = parseSuccessfulJsonLine<{
        sceneId: string;
        revision: number;
      }>(result);

      expect(controlled.observations.fileExistedBeforePatchResponse).toBe(
        false,
      );
      expect(controlled.observations.patch).toMatchObject({
        patchId: "system_save_9",
        sceneId: scene.sceneId,
        baseRevision: 9,
        source: "system",
        preserveLock: false,
        operations: [
          {
            op: "entity.flags.set",
            entityId: scene.entities[0]!.id,
            lockMode: "workflow",
          },
          {
            op: "entity.flags.set",
            entityId: scene.entities[3]!.id,
            lockMode: "workflow",
          },
        ],
      });
      const written = sceneSpecSchema.parse(
        JSON.parse(await readFile(savedScenePath, "utf8")) as unknown,
      );
      expect(written.revision).toBe(10);
      expect(saved.data.revision).toBe(10);
      expect(
        written.entities.every((entity) => entity.lockMode !== "none"),
      ).toBe(true);
    } finally {
      await closeServer(controlled.server);
    }
  });

  it("does not create a scene file when the save checkpoint response is invalid", async () => {
    const directory = await createTemporaryDirectory(
      "shubi-shot-invalid-save-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    await mkdir(runtimeDirectory);
    const savedScenePath = path.join(directory, "must-not-exist.json");
    const controlled = await startControlledSaveBridge(
      createDefaultScene(),
      savedScenePath,
      "invalid",
    );
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          "--import",
          tsxLoaderUrl,
          directorCliPath,
          "scene",
          "save",
          "--file",
          savedScenePath,
        ],
        createMinimalEnvironment({
          SHUBI_SHOT_URL: controlled.bridgeUrl,
          SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(controlled.observations.patch).not.toBeNull();
      expect(await fileExists(savedScenePath)).toBe(false);
    } finally {
      await closeServer(controlled.server);
    }
  });

  it("preflights an existing target before submitting any checkpoint", async () => {
    const directory = await createTemporaryDirectory(
      "shubi-shot-save-preflight-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    await mkdir(runtimeDirectory);
    const savedScenePath = path.join(directory, "existing-scene.json");
    const sentinel = "existing scene must remain unchanged";
    await writeFile(savedScenePath, sentinel, "utf8");
    const initial = createDefaultScene();
    const controlled = await startControlledSaveBridge(
      initial,
      savedScenePath,
      "accepted",
    );
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          "--import",
          tsxLoaderUrl,
          directorCliPath,
          "scene",
          "save",
          "--file",
          savedScenePath,
        ],
        createMinimalEnvironment({
          SHUBI_SHOT_URL: controlled.bridgeUrl,
          SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(controlled.observations.patch).toBeNull();
      expect(controlled.observations.currentScene()).toEqual(initial);
      expect(await readFile(savedScenePath, "utf8")).toBe(sentinel);
    } finally {
      await closeServer(controlled.server);
    }
  });

  it("does not overwrite a scene file when the save checkpoint response is invalid", async () => {
    const directory = await createTemporaryDirectory(
      "shubi-shot-invalid-save-overwrite-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    await mkdir(runtimeDirectory);
    const savedScenePath = path.join(directory, "existing-scene.json");
    const sentinel = "existing scene must remain unchanged";
    await writeFile(savedScenePath, sentinel, "utf8");
    const controlled = await startControlledSaveBridge(
      createDefaultScene(),
      savedScenePath,
      "invalid",
    );
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          "--import",
          tsxLoaderUrl,
          directorCliPath,
          "scene",
          "save",
          "--file",
          savedScenePath,
          "--force",
        ],
        createMinimalEnvironment({
          SHUBI_SHOT_URL: controlled.bridgeUrl,
          SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(controlled.observations.patch).not.toBeNull();
      expect(await readFile(savedScenePath, "utf8")).toBe(sentinel);
    } finally {
      await closeServer(controlled.server);
    }
  });

  it("does not overwrite a scene file for a schema-valid but uncorrelated checkpoint response", async () => {
    const directory = await createTemporaryDirectory(
      "shubi-shot-mismatched-save-overwrite-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    await mkdir(runtimeDirectory);
    const savedScenePath = path.join(directory, "existing-scene.json");
    const sentinel = "existing scene must remain unchanged";
    await writeFile(savedScenePath, sentinel, "utf8");
    const controlled = await startControlledSaveBridge(
      createDefaultScene(),
      savedScenePath,
      "mismatched",
    );
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          "--import",
          tsxLoaderUrl,
          directorCliPath,
          "scene",
          "save",
          "--file",
          savedScenePath,
          "--force",
        ],
        createMinimalEnvironment({
          SHUBI_SHOT_URL: controlled.bridgeUrl,
          SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(
        JSON.parse(result.stdout.trim()) as unknown,
      ).toMatchObject({
        ok: false,
        error: {
          code: "WORKFLOW_LOCK_CHECKPOINT_INVALID",
        },
      });
      expect(await readFile(savedScenePath, "utf8")).toBe(sentinel);
    } finally {
      await closeServer(controlled.server);
    }
  });

  it("reports a late write failure while retaining the accepted remote checkpoint", async () => {
    const directory = await createTemporaryDirectory(
      "shubi-shot-late-save-write-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    await mkdir(runtimeDirectory);
    const outputDirectory = path.join(directory, "output");
    await mkdir(outputDirectory);
    const savedScenePath = path.join(outputDirectory, "scene.json");
    const controlled = await startControlledSaveBridge(
      createDefaultScene(),
      savedScenePath,
      "accepted",
      async () => {
        await rm(outputDirectory, { recursive: true, force: true });
      },
    );
    try {
      const result = await runNode(
        [
          "--import",
          socketGuardUrl,
          "--import",
          tsxLoaderUrl,
          directorCliPath,
          "scene",
          "save",
          "--file",
          savedScenePath,
        ],
        createMinimalEnvironment({
          SHUBI_SHOT_URL: controlled.bridgeUrl,
          SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(
        JSON.parse(result.stdout.trim()) as unknown,
      ).toMatchObject({
        ok: false,
        error: { code: "SCENE_FILE_WRITE_FAILED" },
      });
      const remote = controlled.observations.currentScene();
      expect(remote.revision).toBe(1);
      expect(
        remote.entities.every(
          (entity) => entity.lockMode !== "none",
        ),
      ).toBe(true);
      expect(await fileExists(savedScenePath)).toBe(false);
    } finally {
      await closeServer(controlled.server);
    }
  });

  it("completes a credential-free structured workflow with no outbound access", async () => {
    expect(path.isAbsolute(process.execPath)).toBe(true);
    expect(path.isAbsolute(tsxLoaderPath)).toBe(true);
    expect(path.isAbsolute(directorCliPath)).toBe(true);
    expect(path.isAbsolute(serverPath)).toBe(true);
    expect(path.isAbsolute(directorLauncherPath)).toBe(true);

    const directory = await createTemporaryDirectory(
      "shubi-shot-structured-e2e-",
    );
    const runtimeDirectory = path.join(directory, "runtime");
    const port = await getUnusedLoopbackPort();
    expect(port).not.toBe(4317);
    const bridgeUrl = "http://127.0.0.1:" + port;
    const bridge = await startGuardedBridge(port, runtimeDirectory);
    const observedStreams: string[] = [];
    const commandEnvironment = createMinimalEnvironment({
      SHUBI_SHOT_URL: bridgeUrl,
      SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
    });
    for (const key of forbiddenRuntimeEnvironmentKeys) {
      expect(commandEnvironment).not.toHaveProperty(key);
    }

    const markerValues = {
      rawPrompt: "host_raw_prompt_marker_61f4",
      profilePath:
        "host_profile_path_marker_7741/project-profile.json",
      alias: "host_alias_marker_9c32",
      credential: "credential_marker_0e87",
      endpoint: "https://model-endpoint-marker.invalid/v1",
      httpProxy: "http://http-proxy-marker.invalid:8080",
      httpsProxy: "http://https-proxy-marker.invalid:8443",
      allProxy: "socks5://all-proxy-marker.invalid:1080",
      nodeCondition: "ambient_node_options_marker",
    };
    const ambientLauncherEnvironment = {
      ...commandEnvironment,
      OPENAI_API_KEY: markerValues.credential,
      AZURE_OPENAI_ENDPOINT: markerValues.endpoint,
      HTTP_PROXY: markerValues.httpProxy,
      HTTPS_PROXY: markerValues.httpsProxy,
      ALL_PROXY: markerValues.allProxy,
      NODE_OPTIONS: "--conditions=" + markerValues.nodeCondition,
      HOST_RAW_PROMPT_MARKER: markerValues.rawPrompt,
      HOST_PROFILE_PATH_MARKER: markerValues.profilePath,
      HOST_ALIAS_MARKER: markerValues.alias,
    };

    const sceneSubmission = createSceneSubmission();
    sceneSubmission.scene = {
      ...sceneSubmission.scene,
      sceneId: "scene_offline_structured_e2e",
      title: "Offline structured generic shot",
    };
    const sceneSubmissionPath = path.join(
      directory,
      "scene-submission.json",
    );
    const patchSubmissionPath = path.join(
      directory,
      "patch-submission.json",
    );
    const savedScenePath = path.join(directory, "saved-scene.json");
    const exportPath = path.join(directory, "reference.png");
    await writeFile(
      sceneSubmissionPath,
      JSON.stringify(sceneSubmission),
      "utf8",
    );

    const doctor = await runDirectCli<Record<string, unknown>>(
      ["doctor"],
      commandEnvironment,
      observedStreams,
    );
    expectV2Boundary(doctor.data);

    const ensure = await runDirectCli<Record<string, unknown>>(
      ["ensure"],
      commandEnvironment,
      observedStreams,
    );
    expectV2Boundary(ensure.data);
    expect(ensure.data.started).toBe(false);

    const health = await runDirectCli<Record<string, unknown>>(
      ["health"],
      commandEnvironment,
      observedStreams,
    );
    expectV2Boundary(health.data);
    expect(health.data).toMatchObject({
      sceneId: "scene_starter",
      revision: 0,
      uiUrl: bridgeUrl,
    });

    const submittedScene = await runDirectCli<{
      sceneId: string;
      revision: number;
    }>(
      ["scene", "submit", "--file", sceneSubmissionPath],
      commandEnvironment,
      observedStreams,
    );
    expect(submittedScene.data).toMatchObject({
      sceneId: sceneSubmission.scene.sceneId,
      revision: 1,
    });

    const sceneSnapshot = await runDirectCli<SnapshotData>(
      ["snapshot"],
      commandEnvironment,
      observedStreams,
    );
    const acceptedScene = sceneSpecSchema.parse(
      sceneSnapshot.data.scene,
    );
    expect(acceptedScene.sceneId).toBe(sceneSubmission.scene.sceneId);
    expect(acceptedScene.revision).toBe(submittedScene.data.revision);

    const patchSubmission = createPatchSubmission(acceptedScene);
    patchSubmission.patch.operations.push(
      {
        op: "actor.height.set",
        actorId: "actor_generic_1",
        heightM: 1.84,
      },
      {
        op: "actor.limb-presence.set",
        actorId: "actor_generic_1",
        updates: { hand_l: "absent" },
      },
      {
        op: "actor.pose.set",
        entityId: "actor_generic_1",
        value: createExplicitPuppetActionPose(),
      },
      {
        op: "actor.pose.joints.set",
        actorId: "actor_generic_1",
        updates: { neck: [0, 0, 0, 1] },
      },
    );
    patchSubmission.intentReport.recognizedConstraints.push(
      {
        id: "intent_actor_height_e2e_1",
        kind: "actor-height",
        required: true,
        targets: ["actor_generic_1"],
        evidence: [{ type: "patch-operation", operationIndex: 2 }],
      },
      {
        id: "intent_actor_limb_e2e_1",
        kind: "actor-limb-presence",
        required: true,
        targets: ["actor_generic_1"],
        evidence: [{ type: "patch-operation", operationIndex: 3 }],
      },
      {
        id: "intent_actor_action_e2e_1",
        kind: "pose",
        required: true,
        targets: ["actor_generic_1"],
        evidence: [{ type: "patch-operation", operationIndex: 4 }],
      },
      {
        id: "intent_actor_joint_e2e_1",
        kind: "pose",
        required: true,
        targets: ["actor_generic_1"],
        evidence: [{ type: "patch-operation", operationIndex: 5 }],
      },
    );
    await writeFile(
      patchSubmissionPath,
      JSON.stringify(patchSubmission),
      "utf8",
    );
    const submittedPatch = await runDirectCli<{
      sceneId: string;
      revision: number;
      operationCount: number;
    }>(
      ["patch", "submit", "--file", patchSubmissionPath],
      commandEnvironment,
      observedStreams,
    );
    expect(submittedPatch.data).toMatchObject({
      sceneId: acceptedScene.sceneId,
      revision: acceptedScene.revision + 1,
      operationCount: 6,
    });

    const patchedSnapshot = await runDirectCli<SnapshotData>(
      ["snapshot"],
      commandEnvironment,
      observedStreams,
    );
    expect(patchedSnapshot.data.scene).toMatchObject({
      sceneId: acceptedScene.sceneId,
      revision: acceptedScene.revision + 1,
      title: "Revised generic shot",
      output: {
        aspect: { width: 16, height: 9 },
        resolutionPx: { width: 1280, height: 720 },
      },
    });
    const patchedActor = sceneSpecSchema
      .parse(patchedSnapshot.data.scene)
      .entities.find(({ id }) => id === "actor_generic_1");
    expect(patchedActor).toMatchObject({
      kind: "actor",
      body: {
        heightM: 1.84,
        limbPresence: { hand_l: "absent" },
      },
      pose: { preset: { id: "pose.custom-v1" } },
    });

    const undo = await runDirectCli<SnapshotData>(
      ["undo"],
      commandEnvironment,
      observedStreams,
    );
    expect(undo.data.scene).toMatchObject({
      sceneId: acceptedScene.sceneId,
      revision: acceptedScene.revision + 2,
      title: acceptedScene.title,
      output: acceptedScene.output,
    });
    expect(undo.data.history).toEqual({
      canUndo: true,
      canRedo: true,
    });
    const undoSnapshot = await runDirectCli<SnapshotData>(
      ["snapshot"],
      commandEnvironment,
      observedStreams,
    );
    expect(undoSnapshot.data.scene).toEqual(undo.data.scene);
    expect(
      sceneSpecSchema
        .parse(undoSnapshot.data.scene)
        .entities.find(({ id }) => id === "actor_generic_1"),
    ).toEqual(
      acceptedScene.entities.find(({ id }) => id === "actor_generic_1"),
    );

    const redo = await runDirectCli<SnapshotData>(
      ["redo"],
      commandEnvironment,
      observedStreams,
    );
    expect(redo.data.scene).toMatchObject({
      sceneId: acceptedScene.sceneId,
      revision: acceptedScene.revision + 3,
      title: "Revised generic shot",
      output: {
        aspect: { width: 16, height: 9 },
        resolutionPx: { width: 1280, height: 720 },
      },
    });
    expect(redo.data.history).toEqual({
      canUndo: true,
      canRedo: false,
    });
    const redoSnapshot = await runDirectCli<SnapshotData>(
      ["snapshot"],
      commandEnvironment,
      observedStreams,
    );
    expect(redoSnapshot.data.scene).toEqual(redo.data.scene);
    expect(
      sceneSpecSchema
        .parse(redoSnapshot.data.scene)
        .entities.find(({ id }) => id === "actor_generic_1"),
    ).toEqual(patchedActor);

    const saved = await runDirectCli<{
      sceneId: string;
      revision: number;
      bytes: number;
    }>(
      ["scene", "save", "--file", savedScenePath],
      commandEnvironment,
      observedStreams,
    );
    const savedScene = sceneSpecSchema.parse(
      JSON.parse(await readFile(savedScenePath, "utf8")) as unknown,
    );
    expect(saved.data).toMatchObject({
      sceneId: savedScene.sceneId,
      revision: savedScene.revision,
    });
    expect(savedScene.revision).toBe(
      redoSnapshot.data.scene.revision + 1,
    );
    expect(
      savedScene.entities.every(
        (entity) => entity.lockMode !== "none",
      ),
    ).toBe(true);
    const loaded = await runDirectCli<{
      sceneId: string;
      revision: number;
    }>(
      ["scene", "load", "--file", savedScenePath],
      commandEnvironment,
      observedStreams,
    );
    expect(loaded.data).toMatchObject({
      sceneId: savedScene.sceneId,
      revision: savedScene.revision + 1,
    });
    const loadedSnapshot = await runDirectCli<SnapshotData>(
      ["snapshot"],
      commandEnvironment,
      observedStreams,
    );
    const loadedScene = sceneSpecSchema.parse(
      loadedSnapshot.data.scene,
    );
    expect(loadedScene).toMatchObject({
      sceneId: savedScene.sceneId,
      revision: savedScene.revision + 1,
      title: savedScene.title,
      output: savedScene.output,
    });

    const composition = await runDirectCli<{
      sceneId: string;
      revision: number;
      report: Record<string, unknown>;
    }>(
      ["composition", "inspect", "--json"],
      commandEnvironment,
      observedStreams,
    );
    expect(composition.data).toMatchObject({
      sceneId: loadedScene.sceneId,
      revision: loadedScene.revision,
      report: {
        overallStatus: expect.stringMatching(
          /^(safe|check|fail|unchecked)$/u,
        ),
        anchorSafe: expect.any(Object),
        framingSafe: expect.any(Object),
        captionSafe: expect.any(Object),
        occlusionSafe: expect.any(Object),
        topologySafe: expect.any(Object),
        cameraCollisionSafe: expect.any(Object),
        issues: expect.any(Array),
      },
    });

    const previewRenderer = await connectTestPreviewRenderer(
      bridgeUrl,
      loadedScene,
    );
    let exported: JsonEnvelope<{
      sceneId: string;
      revision: number;
      width: number;
      height: number;
      sha256: string;
    }>;
    try {
      exported = await runDirectCli<{
        sceneId: string;
        revision: number;
        width: number;
        height: number;
        sha256: string;
      }>(
        [
          "export",
          "png",
          "--file",
          exportPath,
          "--width",
          "1920",
          "--height",
          "1080",
        ],
        commandEnvironment,
        observedStreams,
      );
      await previewRenderer.completion;
    } finally {
      previewRenderer.close();
    }
    const png = await readFile(exportPath);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(1920);
    expect(png.readUInt32BE(20)).toBe(1080);
    expect(exported.data).toMatchObject({
      sceneId: loadedScene.sceneId,
      revision: loadedScene.revision,
      width: 1920,
      height: 1080,
      sha256: createHash("sha256").update(png).digest("hex"),
    });

    const launcherDoctor = await runRootLauncher<
      Record<string, unknown>
    >(
      ["doctor"],
      ambientLauncherEnvironment,
      observedStreams,
    );
    expectV2Boundary(launcherDoctor.data);
    const launcherSnapshot = await runRootLauncher<SnapshotData>(
      ["snapshot"],
      ambientLauncherEnvironment,
      observedStreams,
    );
    expect(launcherSnapshot.data.scene).toEqual(loadedScene);

    const stopped = await runDirectCli<{
      service: string;
      status: string;
      stopped: boolean;
    }>(
      ["stop"],
      commandEnvironment,
      observedStreams,
    );
    expect(stopped.data).toEqual({
      service: "shubi-shot-director",
      status: "stopped",
      stopped: true,
    });
    const bridgeResult = await bridge.completion;
    observedStreams.push(
      bridgeResult.stdout,
      bridgeResult.stderr,
      JSON.stringify(composition),
      JSON.stringify(exported),
      await readFile(savedScenePath, "utf8"),
    );
    expect(bridgeResult).toMatchObject({
      exitCode: 0,
      signal: null,
      stderr: "",
    });

    const guardRecords = await readGuardRecords(runtimeDirectory);
    expect(
      guardRecords.filter(
        (record) => record.type === "network-blocked",
      ),
    ).toEqual([]);
    expect(
      guardRecords.some(
        (record) =>
          record.type === "network-allowed" &&
          record.api === "fetch" &&
          record.family === "ipv4-loopback",
      ),
    ).toBe(true);
    const launcherSpawnRecords = guardRecords.filter(
      (record) =>
        record.type === "spawn-observation" &&
        record.processRole === "director.mjs",
    );
    expect(launcherSpawnRecords).toHaveLength(2);
    const allSpawnRecords = guardRecords.filter(
      (record) => record.type === "spawn-observation",
    );
    expect(allSpawnRecords).toHaveLength(4);
    expect(
      allSpawnRecords
        .map((record) => record.processRole)
        .sort(),
    ).toEqual([
      "cli.mjs",
      "cli.mjs",
      "director.mjs",
      "director.mjs",
    ]);
    for (const record of allSpawnRecords) {
      expect(record).toMatchObject({
        explicitEnvironment: true,
        guardInjected: true,
        sensitiveEnvironmentKeyCount: 0,
        observerEnvironmentKeyCount: 0,
      });
    }
    const blockedProcessRecords = guardRecords.filter(
      (record) => record.type === "process-blocked",
    );
    expect(blockedProcessRecords.length).toBeGreaterThan(0);
    for (const record of blockedProcessRecords) {
      expect(record).toMatchObject({
        processRole: "index.ts",
        api: "child_process.exec",
        targetClass: "unguarded-child-process",
      });
    }

    await auditNoMarkerLeak(
      directory,
      observedStreams,
      Object.values(markerValues),
    );
  }, 120_000);
});
