import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { createBrowserChildEnvironment } from "../scripts/process-boundary.mjs";
import {
  ACTOR_BLUEPRINT_ERROR_CODES,
  ACTOR_BLUEPRINT_MAX_INPUT_BYTES,
  ACTOR_BLUEPRINT_SCHEMA_VERSION,
  actorBlueprintDocumentSchema,
  createActorBlueprintSnapshot,
} from "../src/domain/actor-blueprint";
import { analyzeComposition } from "../src/domain/composition-safety";
import {
  actorPuppetInputErrorCode,
} from "../src/domain/scene-patch";
import {
  createScenePatchCompatibilityPayload,
  parseScenePatchInputWithProvenance,
  parseSceneSpecInput,
} from "../src/domain/scene-migrations";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createWorkflowLockCheckpointPatch,
  validateWorkflowLockCheckpointAcceptance,
  WorkflowLockCheckpointError,
} from "../src/domain/workflow-lock-patch";
import {
  intentSummarySchema,
  normalizePatchSubmissionInput,
  normalizeSceneSubmissionInput,
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
  preflightOutputFile,
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

const actorPuppetErrorMessage = (code: string): string | undefined => {
  switch (code) {
    case "ACTOR_HEIGHT_TARGET_INVALID":
      return "The requested actor height target is invalid.";
    case "ACTOR_HEIGHT_RANGE_INVALID":
      return "Actor stature must be between 1.0 and 2.4 meters.";
    case "ACTOR_JOINT_TARGET_INVALID":
      return "The requested actor joint target is invalid.";
    case "ACTOR_JOINT_ID_INVALID":
      return "The requested actor joint ID is unsupported.";
    default:
      return undefined;
  }
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
  try {
    return parseSceneSpecInput(await readBoundedJsonFile(filePath));
  } catch {
    throw new CliCommandError(
      "SCENE_FILE_INVALID",
      "The supplied file is not a valid SceneSpec.",
    );
  }
};

const readValidatedPatchFile = async (filePath: string) => {
  const input = await readBoundedJsonFile(filePath);
  try {
    const parsed = parseScenePatchInputWithProvenance(input);
    return createScenePatchCompatibilityPayload(
      parsed.patch,
      parsed.sourceSchemaVersion,
    );
  } catch (error) {
    const actorPuppetCode = actorPuppetInputErrorCode(error, input);
    if (actorPuppetCode !== undefined) {
      throw new CliCommandError(
        actorPuppetCode,
        actorPuppetErrorMessage(actorPuppetCode) ?? "The actor request is invalid.",
      );
    }
    throw new CliCommandError(
      "PATCH_FILE_INVALID",
      "The supplied file is not a valid ScenePatch.",
    );
  }
};

const readValidatedSceneSubmissionFile = async (
  filePath: string,
): Promise<SceneSubmission> => {
  const input = await readBoundedJsonFile(filePath);
  try {
    return normalizeSceneSubmissionInput(input);
  } catch {
    throw new CliCommandError(
      "SCENE_SUBMISSION_FILE_INVALID",
      "The supplied file is not a valid scene submission.",
    );
  }
};

const readValidatedPatchSubmissionFile = async (
  filePath: string,
): Promise<{ payload: unknown; normalized: PatchSubmission }> => {
  const input = await readBoundedJsonFile(filePath);
  try {
    const parsed = normalizePatchSubmissionInput(input);
    return {
      payload: {
        intentReport: parsed.submission.intentReport,
        patch: createScenePatchCompatibilityPayload(
          parsed.submission.patch,
          parsed.patchSourceSchemaVersion,
        ),
      },
      normalized: parsed.submission,
    };
  } catch (error) {
    const actorPuppetCode = actorPuppetInputErrorCode(error, input);
    if (actorPuppetCode !== undefined) {
      throw new CliCommandError(
        actorPuppetCode,
        actorPuppetErrorMessage(actorPuppetCode) ?? "The actor request is invalid.",
      );
    }
    throw new CliCommandError(
      "PATCH_SUBMISSION_FILE_INVALID",
      "The supplied file is not a valid patch submission.",
    );
  }
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

const readBoundedStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  let byteCount = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), "utf8");
    byteCount += buffer.length;
    if (byteCount > ACTOR_BLUEPRINT_MAX_INPUT_BYTES) {
      throw new CliCommandError(
        "ACTOR_BLUEPRINT_FILE_INVALID",
        "The Actor Blueprint document is invalid.",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const readValidatedBlueprintFromStdin = async () => {
  let input: unknown;
  try {
    input = JSON.parse(await readBoundedStdin()) as unknown;
  } catch (error) {
    if (error instanceof CliCommandError) {
      throw error;
    }
    throw new CliCommandError(
      "ACTOR_BLUEPRINT_FILE_INVALID",
      "The Actor Blueprint document is invalid.",
    );
  }

  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new CliCommandError(
      "ACTOR_BLUEPRINT_FILE_INVALID",
      "The Actor Blueprint document is invalid.",
    );
  }
  const schemaVersion = (input as Record<string, unknown>).schemaVersion;
  if (
    typeof schemaVersion === "number" &&
    Number.isInteger(schemaVersion) &&
    schemaVersion !== ACTOR_BLUEPRINT_SCHEMA_VERSION
  ) {
    throw new CliCommandError(
      "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
      "The Actor Blueprint schema version is unsupported.",
    );
  }

  const parsed = actorBlueprintDocumentSchema.safeParse(input);
  if (!parsed.success) {
    const variantInvalid = parsed.error.issues.some(
      ({ message }) =>
        message === ACTOR_BLUEPRINT_ERROR_CODES.variantInvalid,
    );
    throw new CliCommandError(
      variantInvalid
        ? "ACTOR_BLUEPRINT_VARIANT_INVALID"
        : "ACTOR_BLUEPRINT_FILE_INVALID",
      variantInvalid
        ? "The Actor Blueprint variant is invalid."
        : "The Actor Blueprint document is invalid.",
    );
  }
  return parsed.data;
};

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

  if (command === "blueprint" && args[1] === "validate") {
    if (args.length !== 3 || args[2] !== "--stdin") {
      throw new CliCommandError(
        "CLI_ARGUMENT_REQUIRED",
        "blueprint validate requires --stdin.",
      );
    }
    const document = await readValidatedBlueprintFromStdin();
    const snapshot = createActorBlueprintSnapshot(document);
    output({
      ok: true,
      data: {
        blueprintId: snapshot.blueprintId,
        blueprintVersion: snapshot.blueprintVersion,
        contentSha256: snapshot.contentSha256,
        moduleCount: snapshot.modules.length,
        variantCount: snapshot.variants.length,
        valid: true,
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
    await preflightOutputFile(options.file, {
      overwrite: options.force,
      existsCode: "SCENE_FILE_EXISTS",
      writeFailedCode: "SCENE_FILE_WRITE_FAILED",
    });
    await requireBridgeHealth(configuration);
    const response = await requestBridge(
      configuration,
      "/api/v1/scene",
    );
    const scene = readSceneFromEnvelope(response);
    const checkpoint = createWorkflowLockCheckpointPatch(
      scene,
      `system_save_${scene.revision}`,
      "system",
    );
    const savedScene = checkpoint === null
      ? scene
      : validateWorkflowLockCheckpointAcceptance(
          scene,
          checkpoint,
          readSceneFromEnvelope(
            await requestBridge(
              configuration,
              "/api/v1/patches",
              {
                method: "POST",
                body: JSON.stringify(checkpoint),
              },
            ),
          ),
        );
    const serialized = `${JSON.stringify(savedScene, null, 2)}\n`;
    // The accepted checkpoint is authoritative remote state. A later local
    // filesystem failure is reported, but cannot transactionally undo it.
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
        sceneId: savedScene.sceneId,
        revision: savedScene.revision,
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
    const { payload, normalized } =
      await readValidatedPatchSubmissionFile(options.file);
    await requireBridgeHealth(configuration);
    const response = await requestBridge(
      configuration,
      "/api/v1/submissions/patch",
      {
        method: "POST",
        body: JSON.stringify(payload),
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
        operationCount: normalized.patch.operations.length,
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
    if (activeCamera?.lockMode === "none") {
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
      message = actorPuppetErrorMessage(error.code) ?? error.message;
    } else if (error instanceof ZodError) {
      code = "SCHEMA_VALIDATION_FAILED";
      message = "Generated scene data failed schema validation.";
    } else if (error instanceof WorkflowLockCheckpointError) {
      code = error.code;
      message = error.message;
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
