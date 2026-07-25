import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { ZodError } from "zod";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { SceneDomainError } from "../src/domain/apply-scene-patch";
import { ContactConstraintError } from "../src/domain/contact-constraints";
import {
  IntentSubmissionError,
  parsePatchSubmission,
  parseSceneSubmission,
  summarizeIntentReport,
} from "../src/domain/scene-submission";
import {
  PreviewExportBroker,
  PreviewExportError,
} from "./preview-export-broker";
import type { SceneChangeEvent } from "./scene-session";
import { SceneSession } from "./scene-session";

const sendOk = (response: Response, data: unknown): void => {
  response.json({
    ok: true,
    data,
  });
};

const safeSceneDomainMessage = (code: string): string => {
  switch (code) {
    case "STALE_REVISION":
      return "The scene revision is stale.";
    case "ENTITY_NOT_FOUND":
      return "A requested scene entity was not found.";
    case "ENTITY_LOCKED":
      return "A requested scene entity is locked.";
    default:
      return "The scene request was rejected.";
  }
};

const safeContactConstraintMessage = (
  code: ContactConstraintError["code"],
): string => {
  switch (code) {
    case "ENTITY_NOT_FOUND":
    case "SURFACE_NOT_FOUND":
      return "A requested scene entity was not found.";
    case "LOCKED_ENTITY_CONFLICT":
      return "A requested scene entity is locked.";
    default:
      return "The scene request violates a contact constraint.";
  }
};

export const createApiApp = (
  session: SceneSession,
  options: {
    uiUrl: string;
    instanceId: string;
    requestShutdown: () => void;
    previewExports?: PreviewExportBroker;
  },
): Express => {
  const app = express();
  const previewExports =
    options.previewExports ?? new PreviewExportBroker();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/api/v1/health", (_request, response) => {
    const scene = session.snapshot();
    const manifest = getRuntimeCapabilityManifest();
    sendOk(response, {
      ...manifest,
      status: "ready",
      sceneId: scene.sceneId,
      revision: scene.revision,
      uiUrl: options.uiUrl,
      instanceId: options.instanceId,
    });
  });

  app.post("/api/v1/shutdown", (request, response) => {
    const remoteAddress = request.socket.remoteAddress ?? "";
    const isLoopback =
      remoteAddress === "::1" ||
      remoteAddress.startsWith("127.") ||
      remoteAddress.startsWith("::ffff:127.");
    if (!isLoopback) {
      response.status(403).json({
        ok: false,
        error: {
          code: "BRIDGE_SHUTDOWN_FORBIDDEN",
          message: "Bridge shutdown is only available from loopback.",
        },
      });
      return;
    }
    if (
      request.get("X-Shubi-Shot-Instance") !== options.instanceId
    ) {
      response.status(409).json({
        ok: false,
        error: {
          code: "BRIDGE_INSTANCE_MISMATCH",
          message: "The bridge instance changed before shutdown.",
        },
      });
      return;
    }
    sendOk(response, {
      service: "shubi-shot-director",
      status: "stopping",
      instanceId: options.instanceId,
    });
    setTimeout(options.requestShutdown, 10);
  });

  app.get("/api/v1/scene", (_request, response) => {
    sendOk(response, {
      scene: session.snapshot(),
      history: session.historyStatus(),
    });
  });

  app.get("/api/v1/preview-exports/events", (request, response) => {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write("retry: 1000\n\n");

    const unsubscribe = previewExports.subscribe((exportRequest) => {
      response.write("event: png\n");
      response.write(`data: ${JSON.stringify(exportRequest)}\n\n`);
    });
    const keepAlive = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, 15_000);

    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post("/api/v1/preview-exports/png", async (request, response) => {
    const width = request.body?.width;
    const height = request.body?.height;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 16 ||
      height < 16 ||
      width > 7680 ||
      height > 7680 ||
      width * height > 7680 * 4320
    ) {
      throw new PreviewExportError(
        "EXPORT_RESOLUTION_INVALID",
        "The requested export resolution is unsupported.",
      );
    }
    const scene = session.snapshot();
    const result = await previewExports.request({
      sceneId: scene.sceneId,
      revision: scene.revision,
      width,
      height,
    });
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", result.png.byteLength);
    response.setHeader("X-Shubi-Shot-Scene-Id", result.sceneId);
    response.setHeader(
      "X-Shubi-Shot-Revision",
      String(result.revision),
    );
    response.send(result.png);
  });

  app.post(
    "/api/v1/preview-exports/:requestId/result",
    express.raw({ type: "image/png", limit: "40mb" }),
    (request, response) => {
      const sceneId = request.get("X-Shubi-Shot-Scene-Id") ?? "";
      const revisionSource =
        request.get("X-Shubi-Shot-Revision") ?? "";
      if (!/^(0|[1-9][0-9]*)$/u.test(revisionSource)) {
        throw new PreviewExportError(
          "EXPORT_PREVIEW_INVALID",
          "The browser Shot Preview returned invalid export metadata.",
        );
      }
      if (!Buffer.isBuffer(request.body)) {
        throw new PreviewExportError(
          "EXPORT_PREVIEW_INVALID",
          "The browser Shot Preview returned an invalid PNG.",
        );
      }
      previewExports.complete({
        requestId: request.params.requestId,
        sceneId,
        revision: Number(revisionSource),
        png: request.body,
      });
      sendOk(response, { accepted: true });
    },
  );

  app.post(
    "/api/v1/preview-exports/:requestId/error",
    (request, response) => {
      previewExports.fail(request.params.requestId);
      sendOk(response, { accepted: true });
    },
  );

  app.put("/api/v1/scene", (request, response) => {
    const scene = session.replaceScene(request.body);
    sendOk(response, {
      scene,
      history: session.historyStatus(),
    });
  });

  app.post("/api/v1/patches", (request, response) => {
    const scene = session.applyPatch(request.body);
    sendOk(response, {
      scene,
      history: session.historyStatus(),
    });
  });

  app.post("/api/v1/submissions/scene", (request, response) => {
    const parsed = parseSceneSubmission(request.body);
    const intentSummary = summarizeIntentReport(parsed.intentReport);
    const scene = session.submitScene(request.body);
    sendOk(response, {
      scene,
      history: session.historyStatus(),
      intentSummary,
    });
  });

  app.post("/api/v1/submissions/patch", (request, response) => {
    const parsed = parsePatchSubmission(request.body);
    const intentSummary = summarizeIntentReport(parsed.intentReport);
    const scene = session.submitPatch(request.body);
    sendOk(response, {
      scene,
      history: session.historyStatus(),
      intentSummary,
    });
  });

  app.post("/api/v1/undo", (_request, response) => {
    const scene = session.undo();
    sendOk(response, {
      scene,
      history: session.historyStatus(),
    });
  });

  app.post("/api/v1/redo", (_request, response) => {
    const scene = session.redo();
    sendOk(response, {
      scene,
      history: session.historyStatus(),
    });
  });

  app.get("/api/v1/events", (request, response) => {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const sendEvent = (event: SceneChangeEvent): void => {
      response.write(`id: ${event.eventId}\n`);
      response.write(`event: scene\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent({
      eventId: "event_initial",
      reason: "replace",
      scene: session.snapshot(),
    });

    const unsubscribe = session.subscribe(sendEvent);
    const keepAlive = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, 15_000);

    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (error instanceof ZodError) {
        response.status(400).json({
          ok: false,
          error: {
            code: "SCHEMA_VALIDATION_FAILED",
            message: "Scene data failed schema validation.",
          },
        });
        return;
      }
      if (error instanceof IntentSubmissionError) {
        response.status(400).json({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      if (error instanceof SceneDomainError) {
        response.status(error.code === "STALE_REVISION" ? 409 : 400).json({
          ok: false,
          error: {
            code: error.code,
            message: safeSceneDomainMessage(error.code),
          },
        });
        return;
      }
      if (error instanceof ContactConstraintError) {
        response.status(400).json({
          ok: false,
          error: {
            code: error.code,
            message: safeContactConstraintMessage(error.code),
          },
        });
        return;
      }
      if (error instanceof PreviewExportError) {
        const status =
          error.code === "EXPORT_REQUEST_NOT_FOUND"
            ? 404
            : error.code === "EXPORT_PREVIEW_TIMEOUT"
              ? 504
              : error.code === "EXPORT_PREVIEW_UNAVAILABLE" ||
                  error.code === "EXPORT_PREVIEW_REVISION_MISMATCH"
                ? 409
                : 400;
        response.status(status).json({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      response.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "The local scene bridge encountered an unexpected error.",
        },
      });
    },
  );

  return app;
};
