import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { createBrowserChildEnvironment } from "../scripts/process-boundary.mjs";
import { analyzeComposition } from "../src/domain/composition-safety";
import { scenePatchSchema } from "../src/domain/scene-patch";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  intentSummarySchema,
  patchSubmissionSchema,
  sceneSubmissionSchema,
  type PatchSubmission,
  type SceneSubmission,
} from "../src/domain/scene-submission";
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SERVICE,
  BridgeError,
  bridgeConfigurationIsLoopback,
  ensureBridge,
  probeBridgeHealth,
  requestPreviewPng,
  requestBridge,
  requireBridgeHealth,
  resolveBridgeConfiguration,
  stopBridge,
  type JsonEnvelope,
} from "./bridge";
import {
  assertNoArguments,
  CliCommandError,
  parseCompositionInspectOptions,
  parseExportCommandOptions,
  parseFileCommandOptions,
  readBoundedJsonFile,
  writeFileAtomically,
} from "./command-io";
import {
  CLI_HELP_COMMANDS,
  getRuntimeCapabilityManifest,
} from "./runtime-capabilities";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tsxCliPath = path.join(
  repositoryRoot,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

interface CliErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

const output = (value: JsonEnvelope | CliErrorEnvelope): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const readSceneFromEnvelope = (envelope: JsonEnvelope): SceneSpec => {
  const data = envelope.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("scene" in data)
  ) {
    throw new BridgeError(
      "BRIDGE_RESPONSE_INVALID",
      "The local bridge returned an invalid scene response.",
    );
  }
  const result = sceneSpecSchema.safeParse(data.scene);
  if (!result.success) {
    throw new BridgeError(
      "BRIDGE_RESPONSE_INVALID",
      "The local bridge returned an invalid scene response.",
    );
  }
  return result.data;
};

const readValidatedSceneFile = async (
  filePath: string,
): Promise<SceneSpec> => {
  const result = sceneSpecSchema.safeParse(
    await readBoundedJsonFile(filePath),
  );
  if (!result.success) {
    throw new CliCommandError(
      "SCENE_FILE_INVALID",
      "The supplied file is not a valid SceneSpec.",
    );
  }
  return result.data;
};

const readValidatedPatchFile = async (filePath: string) => {
  const result = scenePatchSchema.safeParse(
    await readBoundedJsonFile(filePath),
  );
  if (!result.success) {
    throw new CliCommandError(
      "PATCH_FILE_INVALID",
      "The supplied file is not a valid ScenePatch.",
    );
  }
  return result.data;
};

const readValidatedSceneSubmissionFile = async (
  filePath: string,
): Promise<SceneSubmission> => {
  const result = sceneSubmissionSchema.safeParse(
    await readBoundedJsonFile(filePath),
  );
  if (!result.success) {
    throw new CliCommandError(
      "SCENE_SUBMISSION_FILE_INVALID",
      "The supplied file is not a valid scene submission.",
    );
  }
  return result.data;
};

const readValidatedPatchSubmissionFile = async (
  filePath: string,
): Promise<PatchSubmission> => {
  const result = patchSubmissionSchema.safeParse(
    await readBoundedJsonFile(filePath),
  );
  if (!result.success) {
    throw new CliCommandError(
      "PATCH_SUBMISSION_FILE_INVALID",
      "The supplied file is not a valid patch submission.",
    );
  }
  return result.data;
};

const historyStatusSchema = z
  .object({
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  })
  .strict();

const submissionResponseSchema = z
  .object({
    scene: sceneSpecSchema,
    history: historyStatusSchema,
    intentSummary: intentSummarySchema,
  })
  .strict();

const readSubmissionResponse = (envelope: JsonEnvelope) => {
  const result = submissionResponseSchema.safeParse(envelope.data);
  if (!result.success) {
    throw new BridgeError(
      "BRIDGE_RESPONSE_INVALID",
      "The local bridge returned an invalid submission response.",
    );
  }
  return result.data;
};

const openSystemBrowser = (url: string): void => {
  const command =
    process.platform === "win32"
      ? { executable: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { executable: "open", args: [url] }
        : { executable: "xdg-open", args: [url] };
  const child = spawn(command.executable, command.args, {
    detached: true,
    env: createBrowserChildEnvironment(process.env),
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
};

const nodeVersionSupported = (): boolean => {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((part) => Number(part));
  return major > 22 || (major === 22 && minor >= 12);
};

const sceneMutationSummary = (
  action: "create" | "load",
  scene: SceneSpec,
) => ({
  action,
  sceneId: scene.sceneId,
  revision: scene.revision,
  entityCount: scene.entities.length,
  constraintCount: scene.constraints.length,
});

const runDirectorCommand = async (
  args: readonly string[],
): Promise<void> => {
  const command = args[0] ?? "help";

  if (command === "help") {
    assertNoArguments(args.slice(1));
    output({
      ok: true,
      data: {
        commands: CLI_HELP_COMMANDS,
      },
    });
    return;
  }

  if (command === "doctor") {
    assertNoArguments(args.slice(1));
    output({
      ok: true,
      data: {
        ...getRuntimeCapabilityManifest(),
        nodeVersion: process.versions.node,
        nodeSupported: nodeVersionSupported(),
        bridgeConfiguration:
          bridgeConfigurationIsLoopback() ? "loopback" : "invalid",
      },
    });
    return;
  }

  const configuration = resolveBridgeConfiguration();

  if (command === "ensure") {
    assertNoArguments(args.slice(1));
    const result = await ensureBridge(configuration, {
      repositoryRoot,
      tsxCliPath,
    });
    output({
      ok: true,
      data: {
        ...result.health,
        started: result.started,
      },
    });
    return;
  }

  if (command === "status") {
    assertNoArguments(args.slice(1));
    const health = await probeBridgeHealth(configuration);
    output({
      ok: true,
      data:
        health === null
          ? {
              service: BRIDGE_SERVICE,
              status: "stopped",
              protocolVersion: BRIDGE_PROTOCOL_VERSION,
              uiUrl: configuration.baseUrl.origin,
            }
          : {
              ...health,
              status: "running",
            },
    });
    return;
  }

  if (command === "stop") {
    assertNoArguments(args.slice(1));
    const result = await stopBridge(configuration);
    output({
      ok: true,
      data: {
        service: BRIDGE_SERVICE,
        status: "stopped",
        stopped: result.stopped,
      },
    });
    return;
  }

  if (command === "health") {
    assertNoArguments(args.slice(1));
    output({
      ok: true,
      data: await requireBridgeHealth(configuration),
    });
    return;
  }

  if (command === "snapshot") {
    assertNoArguments(args.slice(1));
    await requireBridgeHealth(configuration);
    output(await requestBridge(configuration, "/api/v1/scene"));
    return;
  }

  if (
    command === "scene" &&
    (args[1] === "create" || args[1] === "load")
  ) {
    const action = args[1];
    const options = parseFileCommandOptions(args.slice(2));
    const scene = await readValidatedSceneFile(options.file);
    await requireBridgeHealth(configuration);
    const response = await requestBridge(
      configuration,
      "/api/v1/scene",
      {
        method: "PUT",
        body: JSON.stringify(scene),
      },
    );
    const accepted = readSceneFromEnvelope(response);
    output({
      ok: true,
      data: sceneMutationSummary(action, accepted),
    });
    return;
  }

  if (command === "scene" && args[1] === "save") {
    const options = parseFileCommandOptions(args.slice(2), {
      allowForce: true,
    });
    await requireBridgeHealth(configuration);
    const response = await requestBridge(
      configuration,
      "/api/v1/scene",
    );
    const scene = readSceneFromEnvelope(response);
    const serialized = `${JSON.stringify(scene, null, 2)}\n`;
    const written = await writeFileAtomically(
      options.file,
      serialized,
      {
        overwrite: options.force,
        existsCode: "SCENE_FILE_EXISTS",
        writeFailedCode: "SCENE_FILE_WRITE_FAILED",
      },
    );
    output({
      ok: true,
      data: {
        sceneId: scene.sceneId,
        revision: scene.revision,
        bytes: written.bytes,
        overwritten: written.overwritten,
      },
    });
    return;
  }

  if (command === "scene" && args[1] === "submit") {
    const options = parseFileCommandOptions(args.slice(2));
    const submission = await readValidatedSceneSubmissionFile(options.file);
    await requireBridgeHealth(configuration);
    const response = await requestBridge(
      configuration,
      "/api/v1/submissions/scene",
      {
        method: "POST",
        body: JSON.stringify(submission),
      },
    );
    const accepted = readSubmissionResponse(response);
    output({
      ok: true,
      data: {
        action: "submit",
        kind: "scene",
        sceneId: accepted.scene.sceneId,
        revision: accepted.scene.revision,
        history: accepted.history,
        intentSummary: accepted.intentSummary,
      },
    });
    return;
  }

  if (command === "patch" && args[1] === "apply") {
    const options = parseFileCommandOptions(args.slice(2));
    const patch = await readValidatedPatchFile(options.file);
    await requireBridgeHealth(configuration);
    output(
      await requestBridge(configuration, "/api/v1/patches", {
        method: "POST",
        body: JSON.stringify(patch),
      }),
    );
    return;
  }

  if (command === "patch" && args[1] === "submit") {
    const options = parseFileCommandOptions(args.slice(2));
    const submission = await readValidatedPatchSubmissionFile(options.file);
    await requireBridgeHealth(configuration);
    const response = await requestBridge(
      configuration,
      "/api/v1/submissions/patch",
      {
        method: "POST",
        body: JSON.stringify(submission),
      },
    );
    const accepted = readSubmissionResponse(response);
    output({
      ok: true,
      data: {
        action: "submit",
        kind: "patch",
        sceneId: accepted.scene.sceneId,
        revision: accepted.scene.revision,
        operationCount: submission.patch.operations.length,
        history: accepted.history,
        intentSummary: accepted.intentSummary,
      },
    });
    return;
  }

  if (
    command === "composition" &&
    args[1] === "inspect"
  ) {
    parseCompositionInspectOptions(args.slice(2));
    await requireBridgeHealth(configuration);
    const snapshot = await requestBridge(
      configuration,
      "/api/v1/scene",
    );
    const scene = readSceneFromEnvelope(snapshot);
    const checkedConstraintCount = scene.constraints.filter(
      (constraint) =>
        constraint.type === "keep-visible" &&
        constraint.enabled,
    ).length;
    output({
      ok: true,
      data: {
        sceneId: scene.sceneId,
        revision: scene.revision,
        checkedConstraintCount,
        report: analyzeComposition(scene),
      },
    });
    return;
  }

  if (command === "export" && args[1] === "png") {
    const options = parseExportCommandOptions(args.slice(2));
    await requireBridgeHealth(configuration);
    const snapshot = await requestBridge(
      configuration,
      "/api/v1/scene",
    );
    const scene = readSceneFromEnvelope(snapshot);
    const rendered = await requestPreviewPng(
      configuration,
      options.width,
      options.height,
    );
    if (
      rendered.sceneId !== scene.sceneId ||
      rendered.revision !== scene.revision
    ) {
      throw new BridgeError(
        "EXPORT_PREVIEW_REVISION_MISMATCH",
        "The scene revision changed during PNG export.",
      );
    }
    await writeFileAtomically(options.file, rendered.png, {
      overwrite: options.force,
      existsCode: "EXPORT_FILE_EXISTS",
      writeFailedCode: "EXPORT_FILE_WRITE_FAILED",
    });
    const activeCamera = scene.entities.find(
      (entity) =>
        entity.kind === "camera" &&
        entity.id === scene.activeCameraId,
    );
    const warnings: string[] = [];
    if (activeCamera?.locked !== true) {
      warnings.push("ACTIVE_CAMERA_UNLOCKED");
    }
    if (
      Math.abs(
        options.width / options.height -
          scene.output.aspect.width / scene.output.aspect.height,
      ) > 0.001
    ) {
      warnings.push("OUTPUT_ASPECT_OVERRIDE");
    }
    output({
      ok: true,
      data: {
        sceneId: scene.sceneId,
        revision: scene.revision,
        width: options.width,
        height: options.height,
        sha256: createHash("sha256")
          .update(rendered.png)
          .digest("hex"),
        warnings,
      },
    });
    return;
  }

  if (command === "undo" || command === "redo") {
    assertNoArguments(args.slice(1));
    await requireBridgeHealth(configuration);
    output(
      await requestBridge(
        configuration,
        `/api/v1/${command}`,
        {
          method: "POST",
          body: "{}",
        },
      ),
    );
    return;
  }

  if (command === "open") {
    if (args.length !== 2 || args[1] !== "--system") {
      throw new CliCommandError(
        "CLI_ARGUMENT_REQUIRED",
        "open requires --system.",
      );
    }
    const ensured = await ensureBridge(configuration, {
      repositoryRoot,
      tsxCliPath,
    });
    openSystemBrowser(ensured.health.uiUrl);
    output({
      ok: true,
      data: {
        ...ensured.health,
        opened: true,
      },
    });
    return;
  }

  throw new CliCommandError(
    "CLI_UNKNOWN_COMMAND",
    "Unknown command.",
  );
};

export const runDirector = async (
  args: readonly string[],
): Promise<void> => {
  try {
    await runDirectorCommand(args);
  } catch (error: unknown) {
    let code = "CLI_ERROR";
    let message = "The command could not be completed safely.";

    if (
      error instanceof CliCommandError ||
      error instanceof BridgeError
    ) {
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      code = "SCHEMA_VALIDATION_FAILED";
      message = "Generated scene data failed schema validation.";
    }

    output({
      ok: false,
      error: {
        code,
        message,
      },
    });
    process.exitCode = 1;
  }
};
