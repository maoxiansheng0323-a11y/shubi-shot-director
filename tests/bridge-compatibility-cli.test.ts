import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  createPatchSubmission,
  createSceneSubmission,
} from "./helpers/structured-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

const COMPACT_CONFIGURATION_KEYS = [
  "modelconfig",
  "modelconfiguration",
  "providerconfig",
  "serviceendpoint",
  "endpointurl",
  "credentialdiagnostics",
  "tokencount",
  "secretstatus",
  "baseurldiagnostics",
  "apikeyid",
  "authorizationheader",
  "passwordstatus",
  "bearertoken",
  "runtimemodelconfig",
  "customproviderconfig",
  "bridgeendpointurl",
  "runtimebaseurl",
  "clientapikey",
  "clienttoken",
  "customsecret",
  "runtimeauth",
  "clientkey",
  "custombearer",
  "modelName",
  "providerName",
  "endpointAddress",
  "modelId",
] as const;

const ALLOWED_COMPACT_DIAGNOSTIC_KEYS = [
  "tokenizerVersion",
  "TOKENIZERVERSION",
  "secretaryCount",
  "SECRETARYCOUNT",
  "secretionStatus",
  "SECRETIONSTATUS",
  "forbearerCount",
  "FORBEARERCOUNT",
] as const;

const FORBIDDEN_CONFIGURATION_KEYS = [
  "requiresApiKey",
  "apiKey",
  "token",
  "authorization",
  "secret",
  "credential",
  "credentials",
  "model",
  "provider",
  "baseUrl",
  "endpoint",
  "modelConfig",
  "model-config",
  "model_config",
  "providerConfig",
  "apiToken",
  "authorizationHeader",
  "credentialConfig",
  "modelProvider",
  "serviceEndpoint",
  "endpointUrl",
  "apiKeyId",
  "secretValue",
  "authHeader",
  "password",
  "bearer",
  ...COMPACT_CONFIGURATION_KEYS,
  ...COMPACT_CONFIGURATION_KEYS.map((key) => key.toUpperCase()),
] as const;

const LOCK_CAPABILITIES = {
  entityLockModes: ["none", "workflow", "user"],
  patchPolicyFields: ["preserveLock"],
  lockErrorCodes: [
    "USER_LOCKED",
    "WORKFLOW_LOCKED",
    "LOCK_PRESERVATION_CONFLICT",
  ],
} as const;
const ANATOMY_CAPABILITIES = {
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
} as const;

interface CliResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

type CompatibilityCase = readonly [
  name: string,
  manifestOverride: Record<string, unknown>,
  errorCode: string,
  commandKind: "scene" | "patch",
];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shot-bridge-compatibility-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

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

const runDirector = (
  args: string[],
  bridgeUrl: string,
): Promise<CliResult> => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SHUBI_SHOT_URL: bridgeUrl,
  };
  delete environment.SHUBI_SHOT_PORT;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [directorScript, ...args],
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
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
};

const parseSingleJsonLine = (stdout: string): unknown => {
  const lines = stdout.split(/\r?\n/);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  return JSON.parse(lines[0] ?? "") as unknown;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Director CLI bridge compatibility gate", () => {
  it("stops a structured submission after an incompatible v2 health response", async () => {
    const directory = await temporaryDirectory();
    const submissionFile = path.join(directory, "scene-submission.json");
    await writeFile(
      submissionFile,
      JSON.stringify(createSceneSubmission()),
      "utf8",
    );
    const scene = createDefaultScene();
    const requests: Array<{ method: string; pathname: string }> = [];
    let bridgeUrl = "";
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "",
        pathname: request.url ?? "",
      });
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ok: true,
          data: {
            ...getRuntimeCapabilityManifest(),
            inputContract: "raw-text",
            status: "ready",
            sceneId: scene.sceneId,
            revision: scene.revision,
            uiUrl: bridgeUrl,
            instanceId: "instance_0123456789abcdef0123456789abcdef",
          },
        }),
      );
    });
    const port = await listenOnLoopback(server);
    bridgeUrl = `http://127.0.0.1:${port}`;

    try {
      const result = await runDirector(
        ["scene", "submit", "--file", submissionFile],
        bridgeUrl,
      );

      expect(result.exitCode).toBe(1);
      expect(parseSingleJsonLine(result.stdout)).toMatchObject({
        ok: false,
        error: { code: "SEMANTIC_BOUNDARY_VIOLATION" },
      });
      expect(requests).toEqual([
        { method: "GET", pathname: "/api/v1/health" },
      ]);
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it("posts a compatible v2 patch submission exactly once", async () => {
    const directory = await temporaryDirectory();
    const scene = createDefaultScene();
    const submission = createPatchSubmission(scene);
    const submissionFile = path.join(directory, "patch-submission.json");
    await writeFile(submissionFile, JSON.stringify(submission), "utf8");
    const requests: Array<{ method: string; pathname: string }> = [];
    let mutationCount = 0;
    let bridgeUrl = "";
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "",
        pathname: request.url ?? "",
      });
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET" && request.url === "/api/v1/health") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              ...getRuntimeCapabilityManifest(),
              status: "ready",
              sceneId: scene.sceneId,
              revision: scene.revision,
              uiUrl: bridgeUrl,
              instanceId: "instance_0123456789abcdef0123456789abcdef",
            },
          }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/api/v1/submissions/patch"
      ) {
        mutationCount += 1;
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              scene: { ...scene, revision: scene.revision + 1 },
              history: { canUndo: true, canRedo: false },
              intentSummary: {
                operation: "modify",
                allowPartial: false,
                recognizedConstraintCount: 1,
                unsupportedConstraintCount: 0,
                unresolvedRelationCount: 0,
                warningCount: 0,
                unsupportedConstraintCodes: [],
                unresolvedRelationCodes: [],
                warningCodes: [],
              },
            },
          }),
        );
        return;
      }
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          ok: false,
          error: { code: "UNEXPECTED_REQUEST", message: "Rejected." },
        }),
      );
    });
    const port = await listenOnLoopback(server);
    bridgeUrl = `http://127.0.0.1:${port}`;

    try {
      const result = await runDirector(
        ["patch", "submit", "--file", submissionFile],
        bridgeUrl,
      );

      expect(result.exitCode).toBe(0);
      expect(parseSingleJsonLine(result.stdout)).toMatchObject({
        ok: true,
        data: {
          action: "submit",
          kind: "patch",
          sceneId: scene.sceneId,
          revision: scene.revision + 1,
          operationCount: 2,
        },
      });
      expect(mutationCount).toBe(1);
      expect(requests).toEqual([
        { method: "GET", pathname: "/api/v1/health" },
        { method: "POST", pathname: "/api/v1/submissions/patch" },
      ]);
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it.each<CompatibilityCase>([
    [
      "protocol",
      {
        bridgeProtocolVersion:
          getRuntimeCapabilityManifest().bridgeProtocolVersion + 1,
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "scene",
    ],
    [
      "SceneSpec schema",
      {
        sceneSchemaVersion:
          getRuntimeCapabilityManifest().sceneSchemaVersion + 1,
      },
      "SCENE_SCHEMA_UNSUPPORTED",
      "patch",
    ],
    [
      "ScenePatch schema",
      {
        patchSchemaVersion:
          getRuntimeCapabilityManifest().patchSchemaVersion + 1,
      },
      "PATCH_SCHEMA_UNSUPPORTED",
      "scene",
    ],
    [
      "IntentReport schema",
      {
        intentReportSchemaVersion:
          getRuntimeCapabilityManifest().intentReportSchemaVersion + 1,
      },
      "INTENT_REPORT_SCHEMA_UNSUPPORTED",
      "patch",
    ],
    [
      "semantic authority",
      { semanticAuthority: "model" },
      "SEMANTIC_BOUNDARY_VIOLATION",
      "scene",
    ],
    [
      "input contract",
      { inputContract: "raw-text" },
      "SEMANTIC_BOUNDARY_VIOLATION",
      "patch",
    ],
    [
      "model integration",
      { modelIntegration: "embedded" },
      "SEMANTIC_BOUNDARY_VIOLATION",
      "scene",
    ],
    [
      "credential policy",
      { credentialPolicy: "optional" },
      "SEMANTIC_BOUNDARY_VIOLATION",
      "patch",
    ],
    [
      "network policy",
      { networkPolicy: "public" },
      "SEMANTIC_BOUNDARY_VIOLATION",
      "scene",
    ],
    [
      "removed entity lock mode",
      { entityLockModes: ["none", "workflow"] },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "altered entity lock mode",
      { entityLockModes: ["none", "workflow", "system"] },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "added entity lock mode",
      {
        entityLockModes: [
          ...LOCK_CAPABILITIES.entityLockModes,
          "temporary",
        ],
      },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "removed patch policy field",
      { patchPolicyFields: [] },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "altered patch policy field",
      { patchPolicyFields: ["keepLock"] },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "added patch policy field",
      {
        patchPolicyFields: [
          ...LOCK_CAPABILITIES.patchPolicyFields,
          "allowLockChange",
        ],
      },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "removed lock error code",
      {
        lockErrorCodes: LOCK_CAPABILITIES.lockErrorCodes.slice(0, -1),
      },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "altered lock error code",
      {
        lockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "ENTITY_LOCKED",
        ],
      },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "added lock error code",
      {
        lockErrorCodes: [
          ...LOCK_CAPABILITIES.lockErrorCodes,
          "UNKNOWN_LOCK",
        ],
      },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "missing actor limb part ids",
      { actorLimbPartIds: undefined },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "empty actor limb presence modes",
      { actorLimbPresenceModes: [] },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "duplicate actor limb error codes",
      {
        actorLimbErrorCodes: [
          ...ANATOMY_CAPABILITIES.actorLimbErrorCodes,
          ...ANATOMY_CAPABILITIES.actorLimbErrorCodes,
        ],
      },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "non-string actor limb part id",
      {
        actorLimbPartIds: [
          ...ANATOMY_CAPABILITIES.actorLimbPartIds.slice(0, -1),
          42,
        ],
      },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "altered actor limb part id",
      {
        actorLimbPartIds: [
          ...ANATOMY_CAPABILITIES.actorLimbPartIds.slice(0, -1),
          "toe_r",
        ],
      },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    [
      "altered actor limb presence mode",
      { actorLimbPresenceModes: ["present", "missing"] },
      "CAPABILITIES_INVALID",
      "patch",
    ],
    [
      "altered actor limb error code",
      { actorLimbErrorCodes: ["UNKNOWN_LIMB_ERROR"] },
      "CAPABILITIES_INVALID",
      "scene",
    ],
    ...FORBIDDEN_CONFIGURATION_KEYS.map((key, index) => [
      `forbidden ${key} field`,
      { [key]: false },
      "SEMANTIC_BOUNDARY_VIOLATION",
      index % 2 === 0 ? "scene" : "patch",
    ] as const),
  ])(
    "blocks %s mismatches before any scene mutation",
    async (_name, manifestOverride, errorCode, commandKind) => {
      const directory = await temporaryDirectory();
      const fixtureDirectory = path.join(directory, "fixtures");
      await mkdir(fixtureDirectory);
      const scene = createDefaultScene();
      const sceneFile = path.join(fixtureDirectory, "scene.json");
      const patchFile = path.join(fixtureDirectory, "patch.json");
      await Promise.all([
        writeFile(sceneFile, JSON.stringify(scene), "utf8"),
        writeFile(
          patchFile,
          JSON.stringify({
            schemaVersion: 1,
            patchId: "patch_generic_compatibility",
            sceneId: scene.sceneId,
            baseRevision: scene.revision,
            source: "manual",
            operations: [
              {
                op: "scene.title.set",
                value: "Generic compatibility fixture",
              },
            ],
          }),
          "utf8",
        ),
      ]);

      const requests: Array<{ method: string; pathname: string }> = [];
      let bridgeUrl = "";
      const server = createServer((request, response) => {
        requests.push({
          method: request.method ?? "",
          pathname: request.url ?? "",
        });
        response.setHeader("Content-Type", "application/json");
        if (request.method === "GET" && request.url === "/api/v1/health") {
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                ...getRuntimeCapabilityManifest(),
                ...manifestOverride,
                status: "ready",
                sceneId: scene.sceneId,
                revision: scene.revision,
                uiUrl: bridgeUrl,
                instanceId:
                  "instance_0123456789abcdef0123456789abcdef",
              },
            }),
          );
          return;
        }
        response.statusCode = 500;
        response.end(
          JSON.stringify({
            ok: false,
            error: { code: "UNEXPECTED_REQUEST", message: "Rejected." },
          }),
        );
      });
      const port = await listenOnLoopback(server);
      bridgeUrl = `http://127.0.0.1:${port}`;

      try {
        const args =
          commandKind === "scene"
            ? ["scene", "create", "--file", sceneFile]
            : ["patch", "apply", "--file", patchFile];
        const result = await runDirector(args, bridgeUrl);

        expect(result).toMatchObject({
          exitCode: 1,
          signal: null,
          stderr: "",
        });
        expect(parseSingleJsonLine(result.stdout)).toEqual({
          ok: false,
          error: {
            code: errorCode,
            message: expect.any(String),
          },
        });
        expect(result.stdout).not.toContain(directory);
        expect(requests).toEqual([
          { method: "GET", pathname: "/api/v1/health" },
        ]);
      } finally {
        await closeServer(server);
      }
    },
    20_000,
  );

  it.each(ALLOWED_COMPACT_DIAGNOSTIC_KEYS)(
    "allows neutral compact diagnostic key %s before scene mutation",
    async (key) => {
      const directory = await temporaryDirectory();
      const scene = createDefaultScene();
      const sceneFile = path.join(directory, "scene.json");
      await writeFile(sceneFile, JSON.stringify(scene), "utf8");

      const requests: Array<{ method: string; pathname: string }> = [];
      let bridgeUrl = "";
      const server = createServer((request, response) => {
        requests.push({
          method: request.method ?? "",
          pathname: request.url ?? "",
        });
        response.setHeader("Content-Type", "application/json");
        if (request.method === "GET" && request.url === "/api/v1/health") {
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                ...getRuntimeCapabilityManifest(),
                [key]: "generic",
                status: "ready",
                sceneId: scene.sceneId,
                revision: scene.revision,
                uiUrl: bridgeUrl,
                instanceId:
                  "instance_0123456789abcdef0123456789abcdef",
              },
            }),
          );
          return;
        }
        if (request.method === "PUT" && request.url === "/api/v1/scene") {
          response.end(
            JSON.stringify({
              ok: true,
              data: { scene },
            }),
          );
          return;
        }
        response.statusCode = 500;
        response.end(
          JSON.stringify({
            ok: false,
            error: { code: "UNEXPECTED_REQUEST", message: "Rejected." },
          }),
        );
      });
      const port = await listenOnLoopback(server);
      bridgeUrl = `http://127.0.0.1:${port}`;

      try {
        const result = await runDirector(
          ["scene", "create", "--file", sceneFile],
          bridgeUrl,
        );

        expect(result).toMatchObject({
          exitCode: 0,
          signal: null,
          stderr: "",
        });
        expect(parseSingleJsonLine(result.stdout)).toMatchObject({
          ok: true,
          data: {
            action: "create",
            sceneId: scene.sceneId,
            revision: scene.revision,
          },
        });
        expect(requests).toEqual([
          { method: "GET", pathname: "/api/v1/health" },
          { method: "PUT", pathname: "/api/v1/scene" },
        ]);
      } finally {
        await closeServer(server);
      }
    },
    20_000,
  );
});
