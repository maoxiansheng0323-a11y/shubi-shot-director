import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { createApiApp } from "../server/api";
import { SceneSession } from "../server/scene-session";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  createPatchSubmission,
  createSceneSubmission,
  createStructuredScene,
} from "./helpers/structured-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const tsxCliPath = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const asyncListenerProcess = fileURLToPath(
  new URL("./helpers/async-scene-listener-process.ts", import.meta.url),
);

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

const postJson = async (
  port: number,
  pathname: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const createTestServer = async (session: SceneSession) => {
  const app = createApiApp(session, {
    uiUrl: "http://127.0.0.1:5173",
    instanceId: "instance_0123456789abcdef0123456789abcdef",
    requestShutdown: () => undefined,
  });
  const server = createServer(app);
  const port = await listenOnLoopback(server);
  return { server, port };
};

describe("GET /api/v1/health", () => {
  it("publishes the runtime manifest without changing scene history", async () => {
    const initial = createDefaultScene();
    const session = new SceneSession(initial);
    const first = session.applyPatch({
      schemaVersion: 1,
      patchId: "patch_health_history_first",
      sceneId: initial.sceneId,
      baseRevision: initial.revision,
      source: "manual",
      operations: [
        {
          op: "scene.title.set",
          value: "First health history title",
        },
      ],
    });
    session.applyPatch({
      schemaVersion: 1,
      patchId: "patch_health_history_second",
      sceneId: initial.sceneId,
      baseRevision: first.revision,
      source: "manual",
      operations: [
        {
          op: "scene.title.set",
          value: "Second health history title",
        },
      ],
    });
    session.undo();

    const beforeSnapshot = session.snapshot();
    const beforeHistory = session.historyStatus();
    expect(beforeHistory).toEqual({ canUndo: true, canRedo: true });

    const uiUrl = "http://127.0.0.1:5173";
    const instanceId = "instance_0123456789abcdef0123456789abcdef";
    const app = createApiApp(session, {
      uiUrl,
      instanceId,
      requestShutdown: () => undefined,
    });
    const server = createServer(app);
    const port = await listenOnLoopback(server);
    let body: unknown;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/health`,
      );
      expect(response.status).toBe(200);
      body = await response.json();
    } finally {
      await closeServer(server);
    }

    const manifest = getRuntimeCapabilityManifest();
    expect(body).toEqual({
      ok: true,
      data: {
        ...manifest,
        status: "ready",
        sceneId: beforeSnapshot.sceneId,
        revision: beforeSnapshot.revision,
        uiUrl,
        instanceId,
      },
    });
    expect(session.snapshot()).toEqual(beforeSnapshot);
    expect(session.historyStatus()).toEqual(beforeHistory);

    expect(session.undo()).toMatchObject({
      title: initial.title,
      revision: beforeSnapshot.revision + 1,
    });
    expect(session.redo()).toMatchObject({
      title: first.title,
      revision: beforeSnapshot.revision + 2,
    });
  });
});

describe("structured submission API", () => {
  it("accepts a scene submission once with an ephemeral summary", async () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const listener = vi.fn();
    session.subscribe(listener);
    const submission = createSceneSubmission();
    submission.scene = {
      ...submission.scene,
      sceneId: "scene_api_submitted",
      title: "API submitted generic scene",
    };
    submission.intentReport.warnings = [
      {
        code: "APPROXIMATE_PLACEMENT",
        targetIds: ["marker_private_api_target"],
      },
    ];
    const { server, port } = await createTestServer(session);
    try {
      const result = await postJson(
        port,
        "/api/v1/submissions/scene",
        submission,
      );

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            scene: expect.objectContaining({
              sceneId: "scene_api_submitted",
              revision: initial.revision + 1,
              title: "API submitted generic scene",
            }),
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
        },
      });
      expect(JSON.stringify(result.body)).not.toContain(
        "marker_private_api_target",
      );
      expect(JSON.stringify(result.body)).not.toContain("intentReport");
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

  it("accepts a compound patch as one revision and one undo step", async () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const listener = vi.fn();
    session.subscribe(listener);
    const submission = createPatchSubmission(initial);
    const { server, port } = await createTestServer(session);
    try {
      const result = await postJson(
        port,
        "/api/v1/submissions/patch",
        submission,
      );

      expect(result).toMatchObject({
        status: 200,
        body: {
          ok: true,
          data: {
            scene: {
              sceneId: initial.sceneId,
              revision: initial.revision + 1,
              title: "Revised generic shot",
            },
            history: { canUndo: true, canRedo: false },
            intentSummary: { operation: "modify" },
          },
        },
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(session.undo()).toMatchObject({
        sceneId: initial.sceneId,
        revision: initial.revision + 2,
        title: initial.title,
        output: initial.output,
      });
    } finally {
      await closeServer(server);
    }
  });

  it("acknowledges a structured submission when an earlier change listener throws", async () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const marker = "marker_private_change_listener_failure";
    session.subscribe(() => {
      throw new Error(marker);
    });
    const laterListener = vi.fn();
    session.subscribe(laterListener);
    const submission = createPatchSubmission(initial);
    const { server, port } = await createTestServer(session);
    try {
      const result = await postJson(
        port,
        "/api/v1/submissions/patch",
        submission,
      );

      expect(result).toMatchObject({
        status: 200,
        body: {
          ok: true,
          data: {
            scene: {
              sceneId: initial.sceneId,
              revision: initial.revision + 1,
              title: "Revised generic shot",
            },
            history: { canUndo: true, canRedo: false },
            intentSummary: { operation: "modify" },
          },
        },
      });
      expect(JSON.stringify(result.body)).not.toContain(marker);
      expect(session.snapshot()).toMatchObject({
        sceneId: initial.sceneId,
        revision: initial.revision + 1,
        title: "Revised generic shot",
      });
      expect(session.historyStatus()).toEqual({
        canUndo: true,
        canRedo: false,
      });
      expect(laterListener).toHaveBeenCalledTimes(1);
      expect(laterListener).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "patch",
          scene: expect.objectContaining({
            sceneId: initial.sceneId,
            revision: initial.revision + 1,
          }),
        }),
      );
    } finally {
      await closeServer(server);
    }
  });

  it("isolates async change listener rejection in a real API process", () => {
    const marker = "async_private_listener";
    const result = spawnSync(
      process.execPath,
      ["--unhandled-rejections=strict", tsxCliPath, asyncListenerProcess],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        shell: false,
        timeout: 20_000,
        windowsHide: true,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).not.toContain(marker);
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({
      status: 200,
      body: {
        ok: true,
        data: {
          scene: {
            sceneId: "scene_starter",
            revision: 1,
            title: "Revised generic shot",
          },
          history: { canUndo: true, canRedo: false },
          intentSummary: { operation: "modify" },
        },
      },
      scene: {
        sceneId: "scene_starter",
        revision: 1,
        title: "Revised generic shot",
      },
      history: { canUndo: true, canRedo: false },
      laterListenerCount: 1,
    });
  });

  it.each([
    [
      "invalid report",
      "/api/v1/submissions/scene",
      () => ({
        ...createSceneSubmission(),
        intentReport: {
          ...createSceneSubmission().intentReport,
          rawPrompt: "marker_private_report",
        },
      }),
      400,
      "INTENT_REPORT_INVALID",
      "Intent report is invalid.",
    ],
    [
      "invalid evidence",
      "/api/v1/submissions/scene",
      () => {
        const submission = createSceneSubmission();
        submission.intentReport.recognizedConstraints[0]?.evidence.push({
          type: "entity-property",
          entityId: "camera_shot_1",
          path: "marker_private_path",
        } as never);
        return submission;
      },
      400,
      "INTENT_REPORT_INVALID",
      "Intent report is invalid.",
    ],
    [
      "invalid scene payload",
      "/api/v1/submissions/scene",
      () => ({
        ...createSceneSubmission(),
        scene: { ...createStructuredScene(), title: "" },
      }),
      400,
      "SCHEMA_VALIDATION_FAILED",
      "Scene data failed schema validation.",
    ],
    [
      "unknown scene submission key",
      "/api/v1/submissions/scene",
      () => ({
        ...createSceneSubmission(),
        marker_private_top_level: true,
      }),
      400,
      "SCHEMA_VALIDATION_FAILED",
      "Scene data failed schema validation.",
    ],
    [
      "unknown nested scene key",
      "/api/v1/submissions/scene",
      () => {
        const submission = createSceneSubmission();
        return {
          ...submission,
          scene: {
            ...submission.scene,
            entities: submission.scene.entities.map((entity, index) =>
              index === 0
                ? { ...entity, marker_private_nested: true }
                : entity,
            ),
          },
        };
      },
      400,
      "SCHEMA_VALIDATION_FAILED",
      "Scene data failed schema validation.",
    ],
    [
      "missing entity reference",
      "/api/v1/submissions/scene",
      () => {
        const submission = createSceneSubmission();
        return {
          ...submission,
          scene: {
            ...submission.scene,
            entities: submission.scene.entities.map((entity) =>
              entity.id === "actor_generic_1"
                ? {
                    ...entity,
                    parentId: "marker_private_missing_entity",
                  }
                : entity,
            ),
          },
        };
      },
      400,
      "SCHEMA_VALIDATION_FAILED",
      "Scene data failed schema validation.",
    ],
    [
      "invalid patch payload",
      "/api/v1/submissions/patch",
      () => {
        const submission = createPatchSubmission();
        return {
          ...submission,
          patch: { ...submission.patch, baseRevision: -1 },
        };
      },
      400,
      "SCHEMA_VALIDATION_FAILED",
      "Scene data failed schema validation.",
    ],
    [
      "unknown nested patch key",
      "/api/v1/submissions/patch",
      () => {
        const submission = createPatchSubmission();
        return {
          ...submission,
          patch: {
            ...submission.patch,
            operations: submission.patch.operations.map(
              (operation, index) =>
                index === 0
                  ? { ...operation, marker_private_patch: true }
                  : operation,
            ),
          },
        };
      },
      400,
      "SCHEMA_VALIDATION_FAILED",
      "Scene data failed schema validation.",
    ],
    [
      "missing patch entity",
      "/api/v1/submissions/patch",
      () => {
        const submission = createPatchSubmission();
        return {
          ...submission,
          patch: {
            ...submission.patch,
            operations: [
              {
                op: "entity.transform.translate" as const,
                entityId: "marker_private_missing_patch_entity",
                deltaM: [0.25, 0, 0] as [number, number, number],
                referenceSpace: "world" as const,
              },
              submission.patch.operations[1],
            ],
          },
        };
      },
      400,
      "ENTITY_NOT_FOUND",
      "A requested scene entity was not found.",
    ],
    [
      "locked contact entity",
      "/api/v1/submissions/scene",
      () => {
        const submission = createSceneSubmission();
        const marker = "marker_private_locked_contact_actor";
        return {
          ...submission,
          scene: {
            ...submission.scene,
            entities: submission.scene.entities.map((entity) =>
              entity.id === "actor_generic_1"
                ? {
                    ...entity,
                    id: marker,
                    lockMode: "workflow" as const,
                    transform: {
                      ...entity.transform,
                      positionM: [0, 2, 0] as [number, number, number],
                    },
                  }
                : entity,
            ),
            constraints: submission.scene.constraints.map((constraint) =>
              constraint.type === "ground-contact" &&
              constraint.entityId === "actor_generic_1"
                ? { ...constraint, entityId: marker }
                : constraint,
            ),
          },
        };
      },
      400,
      "WORKFLOW_LOCKED",
      "A requested scene entity is workflow locked.",
    ],
    [
      "user-locked patch entity",
      "/api/v1/patches",
      () => ({
        schemaVersion: 3,
        patchId: "patch_api_user_lock",
        sceneId: "scene_starter",
        baseRevision: 0,
        source: "natural-language",
        preserveLock: false,
        operations: [
          {
            op: "entity.flags.set",
            entityId: "actor_generic_1",
            lockMode: "user",
          },
          {
            op: "entity.transform.translate",
            entityId: "actor_generic_1",
            deltaM: [0.25, 0, 0],
            referenceSpace: "world",
          },
        ],
      }),
      400,
      "USER_LOCKED",
      "A requested scene entity is user protected.",
    ],
    [
      "lock preservation conflict",
      "/api/v1/patches",
      () => ({
        schemaVersion: 3,
        patchId: "patch_api_preservation_conflict",
        sceneId: "scene_starter",
        baseRevision: 0,
        source: "natural-language",
        preserveLock: true,
        operations: [
          {
            op: "entity.flags.set",
            entityId: "actor_generic_1",
            lockMode: "workflow",
          },
        ],
      }),
      400,
      "LOCK_PRESERVATION_CONFLICT",
      "The requested Patch would change preserved lock state.",
    ],
    [
      "stale patch",
      "/api/v1/submissions/patch",
      () => {
        const submission = createPatchSubmission();
        return {
          ...submission,
          patch: { ...submission.patch, baseRevision: 1 },
        };
      },
      409,
      "STALE_REVISION",
      "The scene revision is stale.",
    ],
  ] as const)(
    "rejects %s with a stable error and zero mutation",
    async (_name, pathname, createBody, status, code, message) => {
      const initial = createStructuredScene();
      const session = new SceneSession(initial);
      const listener = vi.fn();
      session.subscribe(listener);
      const { server, port } = await createTestServer(session);
      try {
        const result = await postJson(port, pathname, createBody());

        expect(result).toEqual({
          status,
          body: {
            ok: false,
            error: { code, message },
          },
        });
        expect(JSON.stringify(result.body)).not.toContain("marker_private");
        expect(session.snapshot()).toEqual(initial);
        expect(session.historyStatus()).toEqual({
          canUndo: false,
          canRedo: false,
        });
        expect(listener).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    },
  );
});
