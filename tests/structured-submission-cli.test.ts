import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { createApiApp } from "../server/api";
import { SceneSession } from "../server/scene-session";
import {
  createPatchIntentReport,
  createPatchSubmission,
  createSceneSubmission,
  createStructuredPatch,
  createStructuredScene,
} from "./helpers/structured-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);
const legacyQuickstartSubmission = fileURLToPath(
  new URL("../examples/quickstart.scene-submission.json", import.meta.url),
);
const temporaryDirectories: string[] = [];

interface CliResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shot-structured-submission-"),
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

const startApi = async (session: SceneSession) => {
  const requests: Array<{ method: string; pathname: string }> = [];
  const app = createApiApp(session, {
    uiUrl: "http://127.0.0.1:5173",
    instanceId: "instance_0123456789abcdef0123456789abcdef",
    requestShutdown: () => undefined,
  });
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      pathname: request.url ?? "",
    });
    app(request, response);
  });
  const port = await listenOnLoopback(server);
  const bridgeUrl = `http://127.0.0.1:${port}`;
  return { server, bridgeUrl, requests };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Director CLI structured submissions", () => {
  it("keeps direct scene create and patch apply behavior unchanged", async () => {
    const directory = await temporaryDirectory();
    const initial = createStructuredScene();
    const sceneFile = path.join(directory, "scene.json");
    const patchFile = path.join(directory, "patch.json");
    await writeFile(sceneFile, JSON.stringify(initial), "utf8");
    await writeFile(
      patchFile,
      JSON.stringify({
        ...createStructuredPatch(initial),
        baseRevision: initial.revision + 1,
      }),
      "utf8",
    );

    const session = new SceneSession(initial);
    const { server, bridgeUrl } = await startApi(session);
    try {
      const created = await runDirector(
        ["scene", "create", "--file", sceneFile],
        bridgeUrl,
      );
      expect(parseSingleJsonLine(created.stdout)).toMatchObject({
        ok: true,
        data: {
          action: "create",
          sceneId: initial.sceneId,
          revision: initial.revision + 1,
        },
      });

      const patched = await runDirector(
        ["patch", "apply", "--file", patchFile],
        bridgeUrl,
      );
      expect(parseSingleJsonLine(patched.stdout)).toMatchObject({
        ok: true,
        data: {
          scene: {
            sceneId: initial.sceneId,
            revision: initial.revision + 2,
            title: "Revised generic shot",
          },
          history: { canUndo: true, canRedo: false },
        },
      });
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it("submits a scene once and emits only the privacy-safe summary", async () => {
    const directory = await temporaryDirectory();
    const submission = createSceneSubmission();
    submission.scene = {
      ...submission.scene,
      sceneId: "scene_cli_submitted",
      title: "Submitted generic scene",
    };
    const marker = "marker_private_target";
    submission.intentReport.warnings = [
      { code: "APPROXIMATE_PLACEMENT", targetIds: [marker] },
    ];
    const file = path.join(directory, "marker-private-source.json");
    await writeFile(file, JSON.stringify(submission), "utf8");

    const session = new SceneSession(createStructuredScene());
    const listener = vi.fn();
    session.subscribe(listener);
    const { server, bridgeUrl } = await startApi(session);
    try {
      const result = await runDirector(
        ["scene", "submit", "--file", file],
        bridgeUrl,
      );

      expect(result).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: true,
        data: {
          action: "submit",
          kind: "scene",
          sceneId: "scene_cli_submitted",
          revision: 1,
          history: { canUndo: true, canRedo: false },
          intentSummary: {
            operation: "create",
            allowPartial: false,
            recognizedConstraintCount: 1,
            unsupportedConstraintCount: 0,
            unresolvedRelationCount: 0,
            warningCount: 1,
            unsupportedConstraintCodes: [],
            unresolvedRelationCodes: [],
            warningCodes: ["APPROXIMATE_PLACEMENT"],
          },
        },
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(session.snapshot()).toMatchObject({
        sceneId: "scene_cli_submitted",
        revision: 1,
      });
      expect(result.stdout).not.toContain(marker);
      expect(result.stdout).not.toContain(directory);
      expect(result.stdout).not.toContain("intentReport");
      expect(result.stdout).not.toContain("evidence");
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it("migrates a v1 single-room scene submission through the public CLI", async () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const { server, bridgeUrl } = await startApi(session);
    try {
      const result = await runDirector(
        [
          "scene",
          "submit",
          "--file",
          legacyQuickstartSubmission,
        ],
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
          action: "submit",
          kind: "scene",
          sceneId: "scene_quickstart_1",
          revision: initial.revision + 1,
        },
      });
      expect(session.snapshot()).toMatchObject({
        schemaVersion: 4,
        sceneId: "scene_quickstart_1",
        spatialLayout: null,
      });
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it("submits a compound patch as one undoable transaction", async () => {
    const directory = await temporaryDirectory();
    const initial = createStructuredScene();
    const submission = createPatchSubmission(initial);
    submission.intentReport = createPatchIntentReport({
      allowPartial: true,
      unsupportedConstraints: [
        { code: "UNSUPPORTED_CONSTRAINT" },
        { code: "UNAPPLIED_CONSTRAINT" },
        { code: "UNSUPPORTED_CONSTRAINT" },
      ],
      unresolvedRelations: [
        { code: "UNRESOLVED_RELATION" },
        { code: "UNRESOLVED_RELATION" },
      ],
      warnings: [
        { code: "PARTIAL_APPLICATION" },
        { code: "APPROXIMATE_PLACEMENT" },
        { code: "PARTIAL_APPLICATION" },
      ],
    });
    const file = path.join(directory, "patch-submission.json");
    await writeFile(file, JSON.stringify(submission), "utf8");

    const session = new SceneSession(initial);
    const { server, bridgeUrl } = await startApi(session);
    try {
      const result = await runDirector(
        ["patch", "submit", "--file", file],
        bridgeUrl,
      );

      expect(result).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: true,
        data: {
          action: "submit",
          kind: "patch",
          sceneId: initial.sceneId,
          revision: initial.revision + 1,
          operationCount: 2,
          history: { canUndo: true, canRedo: false },
          intentSummary: {
            operation: "modify",
            allowPartial: true,
            recognizedConstraintCount: 1,
            unsupportedConstraintCount: 3,
            unresolvedRelationCount: 2,
            warningCount: 3,
            unsupportedConstraintCodes: [
              "UNSUPPORTED_CONSTRAINT",
              "UNAPPLIED_CONSTRAINT",
            ],
            unresolvedRelationCodes: ["UNRESOLVED_RELATION"],
            warningCodes: [
              "PARTIAL_APPLICATION",
              "APPROXIMATE_PLACEMENT",
            ],
          },
        },
      });
      expect(session.snapshot()).toMatchObject({
        sceneId: initial.sceneId,
        revision: initial.revision + 1,
        title: "Revised generic shot",
      });
      expect(session.undo()).toMatchObject({
        sceneId: initial.sceneId,
        revision: initial.revision + 2,
        title: initial.title,
        output: initial.output,
      });
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it.each([1, 2] as const)(
    "migrates a v%s patch submission without shifting evidence indices",
    async (schemaVersion) => {
      const directory = await temporaryDirectory();
      const initial = createStructuredScene();
      const legacySubmission = structuredClone(
        createPatchSubmission(initial),
      ) as {
        intentReport: {
          schemaVersion: number;
          recognizedConstraints: unknown[];
        };
        patch: {
          schemaVersion: number;
          preserveLock?: boolean;
          operations: unknown[];
        };
      };
      legacySubmission.intentReport.schemaVersion = schemaVersion;
      legacySubmission.intentReport.recognizedConstraints = [
        {
          id: "intent_legacy_visibility_1",
          kind: "visibility",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
        {
          id: "intent_legacy_output_1",
          kind: "output",
          required: true,
          targets: [],
          evidence: [{ type: "patch-operation", operationIndex: 1 }],
        },
      ];
      legacySubmission.patch.schemaVersion = schemaVersion;
      delete legacySubmission.patch.preserveLock;
      legacySubmission.patch.operations = [
        {
          op: "entity.flags.set",
          entityId: "actor_generic_1",
          visible: false,
          locked: true,
        },
        createStructuredPatch(initial).operations[1],
      ];
      const file = path.join(
        directory,
        `legacy-v${schemaVersion}-patch-submission.json`,
      );
      await writeFile(file, JSON.stringify(legacySubmission), "utf8");

      const session = new SceneSession(initial);
      const { server, bridgeUrl } = await startApi(session);
      try {
        const result = await runDirector(
          ["patch", "submit", "--file", file],
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
            action: "submit",
            kind: "patch",
            sceneId: initial.sceneId,
            revision: initial.revision + 1,
          },
        });
        expect(session.snapshot()).toMatchObject({
          schemaVersion: 4,
          entities: expect.arrayContaining([
            expect.objectContaining({
              id: "actor_generic_1",
              visible: false,
            }),
          ]),
        });
      } finally {
        await closeServer(server);
      }
    },
    20_000,
  );

  it("keeps malformed files and strict option errors local", async () => {
    const directory = await temporaryDirectory();
    const file = path.join(directory, "invalid.json");
    await writeFile(file, "{not-json", "utf8");
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const { server, bridgeUrl } = await startApi(session);
    try {
      const malformed = await runDirector(
        ["scene", "submit", "--file", file],
        bridgeUrl,
      );
      expect(parseSingleJsonLine(malformed.stdout)).toEqual({
        ok: false,
        error: {
          code: "CLI_INPUT_FILE_INVALID_JSON",
          message: "The supplied input file is not valid JSON.",
        },
      });

      const unknown = await runDirector(
        ["patch", "submit", "--file", file, "--extra", "value"],
        bridgeUrl,
      );
      expect(parseSingleJsonLine(unknown.stdout)).toEqual({
        ok: false,
        error: {
          code: "CLI_UNKNOWN_ARGUMENT",
          message: "Unknown command option.",
        },
      });
      expect(session.snapshot()).toEqual(initial);
      expect(session.historyStatus()).toEqual({
        canUndo: false,
        canRedo: false,
      });
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it.each([
    {
      kind: "scene",
      pathname: "/api/v1/submissions/scene",
      operation: "create",
      marker: "marker_private_invalid_scene_envelope",
      code: "SCENE_SUBMISSION_FILE_INVALID",
      message: "The supplied file is not a valid scene submission.",
    },
    {
      kind: "patch",
      pathname: "/api/v1/submissions/patch",
      operation: "modify",
      marker: "marker_private_invalid_patch_envelope",
      code: "PATCH_SUBMISSION_FILE_INVALID",
      message: "The supplied file is not a valid patch submission.",
    },
  ] as const)(
    "rejects invalid $kind envelope before bridge health or mutation",
    async ({ kind, pathname, operation, marker, code, message }) => {
      const directory = await temporaryDirectory();
      const file = path.join(directory, `invalid-${kind}-submission.json`);
      await writeFile(file, JSON.stringify({ [marker]: true }), "utf8");

      const scene = createStructuredScene();
      const requests: Array<{ method: string; pathname: string }> = [];
      let mutationCount = 0;
      let bridgeUrl = "";
      const server = createServer((request, response) => {
        const requestPathname = request.url ?? "";
        requests.push({
          method: request.method ?? "",
          pathname: requestPathname,
        });
        response.setHeader("Content-Type", "application/json");
        if (
          request.method === "GET" &&
          requestPathname === "/api/v1/health"
        ) {
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
          requestPathname === pathname
        ) {
          mutationCount += 1;
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                scene: { ...scene, revision: scene.revision + mutationCount },
                history: { canUndo: true, canRedo: false },
                intentSummary: {
                  operation,
                  allowPartial: false,
                  recognizedConstraintCount: 0,
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
          [kind, "submit", "--file", file],
          bridgeUrl,
        );

        expect(parseSingleJsonLine(result.stdout)).toEqual({
          ok: false,
          error: { code, message },
        });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).not.toContain(marker);
        expect(result.stdout).not.toContain(directory);
        expect(result.stdout).not.toContain("issues");
        expect(requests).toEqual([]);
        expect(mutationCount).toBe(0);
      } finally {
        await closeServer(server);
      }
    },
    20_000,
  );

  it("forwards stable bridge error codes without echoing private markers", async () => {
    const directory = await temporaryDirectory();
    const initial = createStructuredScene();
    const submission = createPatchSubmission(initial);
    const marker = "marker_private_policy_warning";
    submission.intentReport = {
      ...submission.intentReport,
      canApplySafely: false,
      warnings: [
        { code: "APPROXIMATE_PLACEMENT", targetIds: [marker] },
      ],
    };
    const file = path.join(directory, "marker-private-error.json");
    await writeFile(file, JSON.stringify(submission), "utf8");

    const session = new SceneSession(initial);
    const { server, bridgeUrl, requests } = await startApi(session);
    try {
      const result = await runDirector(
        ["patch", "submit", "--file", file],
        bridgeUrl,
      );

      expect(result.exitCode).toBe(1);
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: {
          code: "UNSUPPORTED_DESCRIPTION",
          message: "The local bridge rejected the request.",
        },
      });
      expect(result.stdout).not.toContain(marker);
      expect(result.stdout).not.toContain(directory);
      expect(requests).toEqual([
        { method: "GET", pathname: "/api/v1/health" },
        {
          method: "POST",
          pathname: "/api/v1/submissions/patch",
        },
      ]);
      expect(session.snapshot()).toEqual(initial);
      expect(session.historyStatus()).toEqual({
        canUndo: false,
        canRedo: false,
      });
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it("rejects invalid scene payloads locally without bridge requests", async () => {
    const directory = await temporaryDirectory();
    const initial = createStructuredScene();
    const submission = createSceneSubmission();
    const marker = "marker_private_cli_payload";
    const file = path.join(directory, "marker-private-payload.json");
    await writeFile(
      file,
      JSON.stringify({
        ...submission,
        scene: {
          ...submission.scene,
          entities: submission.scene.entities.map((entity, index) =>
            index === 0 ? { ...entity, [marker]: true } : entity,
          ),
        },
      }),
      "utf8",
    );

    const session = new SceneSession(initial);
    const listener = vi.fn();
    session.subscribe(listener);
    const { server, bridgeUrl, requests } = await startApi(session);
    try {
      const result = await runDirector(
        ["scene", "submit", "--file", file],
        bridgeUrl,
      );

      expect(result.exitCode).toBe(1);
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: {
          code: "SCENE_SUBMISSION_FILE_INVALID",
          message: "The supplied file is not a valid scene submission.",
        },
      });
      expect(result.stdout).not.toContain(marker);
      expect(result.stdout).not.toContain(directory);
      expect(result.stdout).not.toContain("issues");
      expect(result.stdout).not.toContain("entities");
      expect(requests).toEqual([]);
      expect(session.snapshot()).toEqual(initial);
      expect(session.historyStatus()).toEqual({
        canUndo: false,
        canRedo: false,
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  }, 20_000);

  it("sanitizes missing patch entity errors without echoing the entity or file path", async () => {
    const directory = await temporaryDirectory();
    const initial = createStructuredScene();
    const submission = createPatchSubmission(initial);
    const marker = "marker_private_missing_patch_entity";
    submission.patch = {
      ...submission.patch,
      operations: [
        {
          op: "entity.transform.translate",
          entityId: marker,
          deltaM: [0.25, 0, 0],
          referenceSpace: "world",
        },
        submission.patch.operations[1],
      ],
    };
    const file = path.join(directory, "marker-private-patch.json");
    await writeFile(file, JSON.stringify(submission), "utf8");

    const session = new SceneSession(initial);
    const listener = vi.fn();
    session.subscribe(listener);
    const { server, bridgeUrl, requests } = await startApi(session);
    try {
      const result = await runDirector(
        ["patch", "submit", "--file", file],
        bridgeUrl,
      );

      expect(result.exitCode).toBe(1);
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: {
          code: "ENTITY_NOT_FOUND",
          message: "A requested scene entity was not found.",
        },
      });
      expect(result.stdout).not.toContain(marker);
      expect(result.stdout).not.toContain(directory);
      expect(result.stdout).not.toContain("entityId");
      expect(requests).toEqual([
        { method: "GET", pathname: "/api/v1/health" },
        {
          method: "POST",
          pathname: "/api/v1/submissions/patch",
        },
      ]);
      expect(session.snapshot()).toEqual(initial);
      expect(session.historyStatus()).toEqual({
        canUndo: false,
        canRedo: false,
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  }, 20_000);
});
