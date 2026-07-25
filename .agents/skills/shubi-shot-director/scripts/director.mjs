#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const skillDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const generatedSchemaDirectory = path.join(
  skillDirectory,
  "references",
  "generated",
);
const bundledBridgeProtocolVersion = 1;
const expectedIntentReportSchemaDigest =
  "c343c18d11c3e3690a810654f3536e27c3ca0c6568a5ff5438605e6264098708";
const runtimeTimeoutMs = 30_000;
const runtimeMaxBufferBytes = 1024 * 1024;
const stableActionIds = new Set([
  "doctor",
  "ensure",
  "status",
  "stop",
  "health",
  "snapshot",
  "scene.create",
  "scene.submit",
  "scene.save",
  "scene.load",
  "patch.apply",
  "patch.submit",
  "composition.inspect",
  "export.png",
  "undo",
  "redo",
  "open.system",
]);
const fileActionIds = new Set([
  "scene.create",
  "scene.submit",
  "scene.save",
  "scene.load",
  "patch.apply",
  "patch.submit",
  "export.png",
]);
const windowsDriveRelativePathPattern = /^[A-Za-z]:(?![\\/])/;
const credentialOptionTokens = new Set([
  "apikey",
  "key",
  "token",
  "auth",
  "authorization",
  "credential",
  "credentials",
  "password",
  "bearer",
  "secret",
]);
const compactCredentialOptionNames = new Set([
  "requiresapikey",
  "apikey",
  "clientkey",
  "runtimeauth",
  "authheader",
  "clienttoken",
  "apitoken",
  "accesstoken",
  "bearertoken",
  "refreshtoken",
  "sessiontoken",
  "authtoken",
  "runtimetoken",
  "clientsecret",
  "apisecret",
  "accesssecret",
  "authsecret",
  "modelsecret",
  "providersecret",
  "runtimesecret",
  "customsecret",
  "custombearer",
  "token",
  "authorization",
  "credential",
  "credentials",
  "password",
  "bearer",
  "secret",
]);
const modelConfigurationOptionTokens = new Set([
  "model",
  "provider",
  "endpoint",
]);
const modelConfigurationContextTokens = new Set([
  "config",
  "configuration",
  "settings",
  "options",
  "url",
  "service",
  "name",
  "id",
  "address",
  "integration",
  "model",
  "provider",
  "endpoint",
]);
const compactModelConfigurationOptionNames = new Set(["baseurl"]);
for (const token of modelConfigurationOptionTokens) {
  compactModelConfigurationOptionNames.add(token);
  for (const context of modelConfigurationContextTokens) {
    compactModelConfigurationOptionNames.add(`${token}${context}`);
    compactModelConfigurationOptionNames.add(`${context}${token}`);
  }
}
let SkillRuntimeErrorClass;

const WRAPPER_ERROR_MESSAGES = Object.freeze({
  CLI_UNKNOWN_COMMAND: "Unknown command.",
  CLI_UNKNOWN_ARGUMENT: "Unknown compatibility option.",
  CLI_ARGUMENT_REQUIRED: "A required compatibility option is missing.",
  CLI_ARGUMENT_DUPLICATE:
    "A compatibility option may only be supplied once.",
  CLI_ARGUMENT_INVALID: "A command argument is invalid.",
  HOST_STRUCTURED_INPUT_REQUIRED:
    "Natural-language requests must be authored by the host as structured submissions.",
  CREDENTIAL_ARGUMENT_FORBIDDEN: "Credential arguments are forbidden.",
  MODEL_CONFIGURATION_FORBIDDEN:
    "Model configuration arguments are forbidden.",
  SKILL_SCHEMA_INVALID: "The bundled Skill schema is invalid.",
  RUNTIME_RESPONSE_INVALID: "The runtime returned an invalid response.",
  RUNTIME_UNAVAILABLE: "The Director runtime is unavailable.",
  RUNTIME_COMMAND_FAILED:
    "The runtime command could not be completed safely.",
  CAPABILITIES_INVALID: "The runtime capability manifest is invalid.",
  CAPABILITIES_CONTRACT_UNSUPPORTED:
    "The runtime capability contract is not supported.",
  SEMANTIC_BOUNDARY_VIOLATION:
    "The runtime capability manifest violates the host semantic boundary.",
  BRIDGE_IDENTITY_MISMATCH:
    "The runtime service identity does not match.",
  BRIDGE_PROTOCOL_UNSUPPORTED:
    "The runtime bridge protocol is not supported.",
  SCENE_SCHEMA_UNSUPPORTED:
    "The runtime SceneSpec schema is not supported by this Skill.",
  PATCH_SCHEMA_UNSUPPORTED:
    "The runtime ScenePatch schema is not supported by this Skill.",
  INTENT_REPORT_SCHEMA_UNSUPPORTED:
    "The runtime IntentReport schema is not supported by this Skill.",
  BRIDGE_UNAVAILABLE:
    "The local Shubi Shot Director bridge is not running.",
  STALE_REVISION: "The scene revision is stale.",
  SCHEMA_VALIDATION_FAILED: "Scene data failed schema validation.",
  SCENE_SUBMISSION_FILE_INVALID:
    "The supplied file is not a valid scene submission.",
  PATCH_SUBMISSION_FILE_INVALID:
    "The supplied file is not a valid patch submission.",
  INTENT_REPORT_INVALID: "Intent report is invalid.",
  UNSUPPORTED_DESCRIPTION:
    "The structured description cannot be applied safely.",
  INTENT_COVERAGE_INCOMPLETE: "Intent coverage is incomplete.",
  ENTITY_NOT_FOUND: "A requested scene entity was not found.",
  ENTITY_LOCKED: "A requested scene entity is locked.",
  CONTACT_CONSTRAINT_ACTIVE:
    "An active contact constraint prevents this change.",
  CAPABILITY_NOT_AVAILABLE:
    "The requested runtime capability is not available.",
});

const stableRuntimeErrorCodes = new Set([
  "CLI_ARGUMENT_REQUIRED",
  "CAPABILITIES_INVALID",
  "CAPABILITIES_CONTRACT_UNSUPPORTED",
  "SEMANTIC_BOUNDARY_VIOLATION",
  "BRIDGE_IDENTITY_MISMATCH",
  "BRIDGE_PROTOCOL_UNSUPPORTED",
  "SCENE_SCHEMA_UNSUPPORTED",
  "PATCH_SCHEMA_UNSUPPORTED",
  "INTENT_REPORT_SCHEMA_UNSUPPORTED",
  "BRIDGE_UNAVAILABLE",
  "STALE_REVISION",
  "SCHEMA_VALIDATION_FAILED",
  "SCENE_SUBMISSION_FILE_INVALID",
  "PATCH_SUBMISSION_FILE_INVALID",
  "INTENT_REPORT_INVALID",
  "UNSUPPORTED_DESCRIPTION",
  "INTENT_COVERAGE_INCOMPLETE",
  "ENTITY_NOT_FOUND",
  "ENTITY_LOCKED",
  "CONTACT_CONSTRAINT_ACTIVE",
  "CAPABILITY_NOT_AVAILABLE",
]);

class WrapperError extends Error {
  constructor(code) {
    super(WRAPPER_ERROR_MESSAGES[code]);
    this.name = "WrapperError";
    this.code = code;
  }
}

const output = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const outputError = (error) => {
  const isSkillRuntimeError =
    SkillRuntimeErrorClass !== undefined &&
    error instanceof SkillRuntimeErrorClass;
  const safeError =
    isSkillRuntimeError || error instanceof WrapperError
      ? error
      : new WrapperError("RUNTIME_UNAVAILABLE");
  output({
    ok: false,
    error: {
      code: safeError.code,
      message: safeError.message,
    },
  });
  process.exitCode = 1;
};

const unknownCommand = () => {
  throw new WrapperError("CLI_UNKNOWN_COMMAND");
};

const argumentOption = (argument) => {
  const inlineValueIndex = argument.indexOf("=");
  return inlineValueIndex === -1
    ? argument
    : argument.slice(0, inlineValueIndex);
};

const optionNameFromArgument = (argument) => {
  if (!argument.startsWith("--")) {
    return undefined;
  }
  return argumentOption(argument).replace(/^-+/, "");
};

const normalizeOptionName = (optionName) =>
  optionName.replace(/[^a-z0-9]/gi, "").toLowerCase();

const tokenizeOptionName = (optionName) =>
  optionName
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const isCredentialOptionName = (optionName, tokens) => {
  const normalized = normalizeOptionName(optionName);
  return (
    compactCredentialOptionNames.has(normalized) ||
    tokens.some((token) => credentialOptionTokens.has(token))
  );
};

const isModelConfigurationOptionName = (optionName, tokens) => {
  const normalized = normalizeOptionName(optionName);
  if (
    compactModelConfigurationOptionNames.has(normalized) ||
    (tokens.includes("base") && tokens.includes("url"))
  ) {
    return true;
  }
  return tokens.some(
    (token) =>
      modelConfigurationOptionTokens.has(token) &&
      (tokens.length === 1 ||
        tokens.some(
          (candidate) =>
            candidate !== token &&
            modelConfigurationContextTokens.has(candidate),
        )),
  );
};

const rejectLegacyText = (args) => {
  const legacyCommand =
    (args[0] === "shot" &&
      (args[1] === "create" || args[1] === "modify")) ||
    (args[0] === "profile" && args[1] === "resolve");
  if (
    legacyCommand ||
    args.some((argument) => argumentOption(argument) === "--text")
  ) {
    throw new WrapperError("HOST_STRUCTURED_INPUT_REQUIRED");
  }
};

const rejectForbiddenArguments = (args) => {
  for (const argument of args) {
    const optionName = optionNameFromArgument(argument);
    if (optionName === undefined) {
      continue;
    }
    const tokens = tokenizeOptionName(optionName);
    if (isCredentialOptionName(optionName, tokens)) {
      throw new WrapperError("CREDENTIAL_ARGUMENT_FORBIDDEN");
    }
    if (isModelConfigurationOptionName(optionName, tokens)) {
      throw new WrapperError("MODEL_CONFIGURATION_FORBIDDEN");
    }
  }
};

const actionFromArgs = (args) => {
  const command = args[0] ?? "help";
  if (command === "help") {
    if (args.length > 1) {
      throw new WrapperError("CLI_UNKNOWN_ARGUMENT");
    }
    return { kind: "help" };
  }
  if (command === "doctor") {
    if (args.length > 1) {
      throw new WrapperError("CLI_UNKNOWN_ARGUMENT");
    }
    return { kind: "doctor" };
  }
  if (
    [
      "ensure",
      "status",
      "stop",
      "health",
      "snapshot",
      "undo",
      "redo",
    ].includes(command)
  ) {
    return { kind: "target", action: command };
  }
  if (
    command === "scene" &&
    ["create", "submit", "save", "load"].includes(args[1])
  ) {
    return { kind: "target", action: `scene.${args[1]}` };
  }
  if (
    command === "patch" &&
    ["apply", "submit"].includes(args[1])
  ) {
    return { kind: "target", action: `patch.${args[1]}` };
  }
  if (command === "composition" && args[1] === "inspect") {
    return { kind: "target", action: "composition.inspect" };
  }
  if (command === "export" && args[1] === "png") {
    return { kind: "target", action: "export.png" };
  }
  if (command === "open" && args[1] === "--system") {
    return { kind: "target", action: "open.system" };
  }
  return unknownCommand();
};

const parseCompatibilityPlan = (args) => {
  if (args[0] !== "compatibility" || args[1] !== "plan") {
    return undefined;
  }
  let requestedAction;
  let live = false;
  for (let index = 2; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--live") {
      if (live) {
        throw new WrapperError("CLI_ARGUMENT_DUPLICATE");
      }
      live = true;
      continue;
    }
    if (option === "--action") {
      if (requestedAction !== undefined) {
        throw new WrapperError("CLI_ARGUMENT_DUPLICATE");
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new WrapperError("CLI_ARGUMENT_REQUIRED");
      }
      if (!stableActionIds.has(value)) {
        return unknownCommand();
      }
      requestedAction = value;
      index += 1;
      continue;
    }
    throw new WrapperError("CLI_UNKNOWN_ARGUMENT");
  }
  if (requestedAction === undefined) {
    throw new WrapperError("CLI_ARGUMENT_REQUIRED");
  }
  return { kind: "plan", requestedAction, live };
};

const parseInvocation = (args) => {
  if (args[0] === "compatibility") {
    return parseCompatibilityPlan(args) ?? unknownCommand();
  }
  return actionFromArgs(args);
};

const resolveFileArguments = (
  args,
  invocation,
  callerDirectory = process.cwd(),
) => {
  if (
    invocation.kind !== "target" ||
    !fileActionIds.has(invocation.action)
  ) {
    return args;
  }
  const resolved = [...args];
  for (let index = 0; index < resolved.length; index += 1) {
    if (resolved[index] !== "--file") {
      continue;
    }
    const value = resolved[index + 1];
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.startsWith("--")
    ) {
      continue;
    }
    if (windowsDriveRelativePathPattern.test(value)) {
      throw new WrapperError("CLI_ARGUMENT_INVALID");
    }
    resolved[index + 1] = path.resolve(callerDirectory, value);
    index += 1;
  }
  return resolved;
};

const readBundledSchemaVersion = async (fileName, expectedDigest) => {
  try {
    const schema = JSON.parse(
      await readFile(
        path.join(generatedSchemaDirectory, fileName),
        "utf8",
      ),
    );
    const version = schema?.properties?.schemaVersion?.const;
    if (
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("invalid schema version");
    }
    if (
      expectedDigest !== undefined &&
      createHash("sha256")
        .update(JSON.stringify(schema), "utf8")
        .digest("hex") !== expectedDigest
    ) {
      throw new Error("invalid schema digest");
    }
    return version;
  } catch {
    throw new WrapperError("SKILL_SCHEMA_INVALID");
  }
};

const readBundledContractVersions = async () => {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(skillDirectory, "runtime.json"), "utf8"),
    );
    const [
      sceneSchemaFileVersion,
      patchSchemaFileVersion,
      intentReportSchemaFileVersion,
    ] = await Promise.all([
      readBundledSchemaVersion("scene-spec.schema.json"),
      readBundledSchemaVersion("scene-patch.schema.json"),
      readBundledSchemaVersion(
        "intent-report.schema.json",
        expectedIntentReportSchemaDigest,
      ),
    ]);
    if (
      metadata?.capabilitiesContractVersion !== 2 ||
      metadata?.bridgeProtocolVersion !==
        bundledBridgeProtocolVersion ||
      metadata?.semanticAuthority !== "host" ||
      metadata?.inputContract !== "structured-only" ||
      metadata?.modelIntegration !== "none" ||
      metadata?.credentialPolicy !== "forbidden" ||
      metadata?.networkPolicy !== "loopback-only" ||
      metadata?.sceneSchemaVersion !== sceneSchemaFileVersion ||
      metadata?.patchSchemaVersion !== patchSchemaFileVersion ||
      metadata?.intentReportSchemaVersion !==
        intentReportSchemaFileVersion
    ) {
      throw new Error("invalid bundled contract");
    }
    return {
      skillBridgeProtocolVersion: metadata.bridgeProtocolVersion,
      skillSceneSchemaVersion: metadata.sceneSchemaVersion,
      skillPatchSchemaVersion: metadata.patchSchemaVersion,
      skillIntentReportSchemaVersion: metadata.intentReportSchemaVersion,
    };
  } catch (error) {
    if (error instanceof WrapperError) {
      throw error;
    }
    throw new WrapperError("SKILL_SCHEMA_INVALID");
  }
};

const setDefined = (target, name, value) => {
  if (value !== undefined) {
    target[name] = value;
  }
};

const runtimeChildEnvironment = (environment = process.env) => {
  const child = {};
  setDefined(child, "PATH", environment.PATH ?? environment.Path);
  setDefined(
    child,
    "SystemRoot",
    environment.SystemRoot ?? environment.SYSTEMROOT,
  );
  setDefined(child, "windir", environment.windir ?? environment.WINDIR);
  setDefined(child, "ComSpec", environment.ComSpec ?? environment.COMSPEC);
  setDefined(child, "PATHEXT", environment.PATHEXT);
  setDefined(child, "SYSTEMDRIVE", environment.SYSTEMDRIVE);
  setDefined(child, "TEMP", environment.TEMP);
  setDefined(child, "TMP", environment.TMP);
  setDefined(child, "TMPDIR", environment.TMPDIR);
  setDefined(child, "HOME", environment.HOME);
  setDefined(child, "USERPROFILE", environment.USERPROFILE);
  setDefined(child, "HOMEDRIVE", environment.HOMEDRIVE);
  setDefined(child, "HOMEPATH", environment.HOMEPATH);
  setDefined(child, "LANG", environment.LANG);
  setDefined(child, "LANGUAGE", environment.LANGUAGE);
  setDefined(child, "LC_ALL", environment.LC_ALL);
  setDefined(child, "LC_CTYPE", environment.LC_CTYPE);
  setDefined(child, "LC_MESSAGES", environment.LC_MESSAGES);
  setDefined(child, "TZ", environment.TZ);
  setDefined(child, "DISPLAY", environment.DISPLAY);
  setDefined(child, "WAYLAND_DISPLAY", environment.WAYLAND_DISPLAY);
  setDefined(child, "XAUTHORITY", environment.XAUTHORITY);
  setDefined(
    child,
    "DBUS_SESSION_BUS_ADDRESS",
    environment.DBUS_SESSION_BUS_ADDRESS,
  );
  setDefined(child, "XDG_RUNTIME_DIR", environment.XDG_RUNTIME_DIR);
  setDefined(child, "DESKTOP_SESSION", environment.DESKTOP_SESSION);
  setDefined(
    child,
    "XDG_CURRENT_DESKTOP",
    environment.XDG_CURRENT_DESKTOP,
  );
  setDefined(
    child,
    "__CF_USER_TEXT_ENCODING",
    environment.__CF_USER_TEXT_ENCODING,
  );
  setDefined(child, "SHUBI_SHOT_URL", environment.SHUBI_SHOT_URL);
  setDefined(child, "SHUBI_SHOT_PORT", environment.SHUBI_SHOT_PORT);
  setDefined(
    child,
    "SHUBI_SHOT_RUNTIME_DIR",
    environment.SHUBI_SHOT_RUNTIME_DIR,
  );
  return child;
};

const runRuntime = (runtime, args) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [runtime.entrypoint, ...args], {
        cwd: runtime.runtimeRoot,
        env: runtimeChildEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolve({ unavailable: true });
      return;
    }

    let stdout = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const stopForOverflow = () => {
      if (!overflow) {
        overflow = true;
        child.kill("SIGKILL");
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, runtimeTimeoutMs);
    timeout.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > runtimeMaxBufferBytes) {
        stopForOverflow();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk, "utf8");
      if (stderrBytes > runtimeMaxBufferBytes) {
        stopForOverflow();
      }
    });
    child.once("error", () => {
      finish({ unavailable: true });
    });
    child.once("close", (exitCode, signal) => {
      finish({
        unavailable: timedOut || overflow,
        stdout,
        exitCode,
        signal,
      });
    });
  });

const parseSingleRuntimeJson = (stdout) => {
  if (typeof stdout !== "string") {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
  const match = /^([^\r\n]+)(?:\r?\n)?$/.exec(stdout);
  if (match === null) {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
};

const parseRuntimeEnvelope = (stdout) => {
  const envelope = parseSingleRuntimeJson(stdout);
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope) ||
    typeof envelope.ok !== "boolean"
  ) {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
  return envelope;
};

const runtimeSuccessContradictsProcess = (envelope, result) =>
  envelope.ok &&
  (result.exitCode !== 0 ||
    (result.signal !== null && result.signal !== undefined));

const runtimeEnvelopeError = (envelope) => {
  const code = envelope?.error?.code;
  return new WrapperError(
    typeof code === "string" && stableRuntimeErrorCodes.has(code)
      ? code
      : "RUNTIME_COMMAND_FAILED",
  );
};

const invokeRuntimeJson = async (runtime, args) => {
  const result = await runRuntime(runtime, args);
  if (result.unavailable) {
    throw new WrapperError("RUNTIME_UNAVAILABLE");
  }
  const envelope = parseRuntimeEnvelope(result.stdout);
  if (runtimeSuccessContradictsProcess(envelope, result)) {
    throw new WrapperError("RUNTIME_COMMAND_FAILED");
  }
  return { envelope, exitCode: result.exitCode, signal: result.signal };
};

const requireEnvelopeData = (invocation) => {
  if (!invocation.envelope.ok) {
    throw runtimeEnvelopeError(invocation.envelope);
  }
  return invocation.envelope.data;
};

const createPlan = async (
  runtime,
  buildCompatibilityPlan,
  {
    requestedAction,
    live = false,
    skillBridgeProtocolVersion,
    skillSceneSchemaVersion,
    skillPatchSchemaVersion,
    skillIntentReportSchemaVersion,
  },
) => {
  const doctorData = requireEnvelopeData(
    await invokeRuntimeJson(runtime, ["doctor"]),
  );
  const baseInput = {
    doctorData,
    requestedAction,
    skillBridgeProtocolVersion,
    skillSceneSchemaVersion,
    skillPatchSchemaVersion,
    skillIntentReportSchemaVersion,
  };
  const offlinePlan = buildCompatibilityPlan(baseInput);
  if (!live || offlinePlan.mode === "incompatible") {
    return offlinePlan;
  }
  if (!offlinePlan.allowedActions.includes("health")) {
    return buildCompatibilityPlan({
      ...baseInput,
      liveRequested: true,
    });
  }
  const healthData = requireEnvelopeData(
    await invokeRuntimeJson(runtime, ["health"]),
  );
  return buildCompatibilityPlan({
    ...baseInput,
    liveRequested: true,
    healthData,
  });
};

const forwardRuntime = async (runtime, args) => {
  const result = await runRuntime(runtime, args);
  if (result.unavailable) {
    outputError(new WrapperError("RUNTIME_UNAVAILABLE"));
    return;
  }
  let envelope;
  try {
    envelope = parseRuntimeEnvelope(result.stdout);
  } catch (error) {
    outputError(error);
    return;
  }

  if (runtimeSuccessContradictsProcess(envelope, result)) {
    outputError(new WrapperError("RUNTIME_COMMAND_FAILED"));
    return;
  }
  if (!envelope.ok) {
    outputError(runtimeEnvelopeError(envelope));
    return;
  }
  output(envelope);
  process.exitCode = result.exitCode ?? 1;
};

const main = async () => {
  const args = process.argv.slice(2);
  rejectLegacyText(args);
  rejectForbiddenArguments(args);
  const invocation = parseInvocation(args);
  const runtimeArgs = resolveFileArguments(args, invocation);
  if (invocation.kind === "help") {
    output({
      ok: true,
      data: {
        inputContract: "structured-only",
        commands: [...stableActionIds],
        compatibilityCommand:
          "compatibility plan --action <action> [--live]",
      },
    });
    return;
  }
  const locator = await import("./runtime-locator.mjs");
  SkillRuntimeErrorClass = locator.SkillRuntimeError;
  const runtime = await locator.resolveRuntime();
  const {
    ACTION_POLICY,
    buildCompatibilityPlan,
    validateCapabilitiesManifest,
  } = await import("./compatibility-plan.mjs");
  const contractVersions = await readBundledContractVersions();

  if (invocation.kind === "doctor") {
    const doctorData = requireEnvelopeData(
      await invokeRuntimeJson(runtime, ["doctor"]),
    );
    const plan = buildCompatibilityPlan({
      doctorData,
      requestedAction: "doctor",
      ...contractVersions,
    });
    if (!plan.actionAllowed) {
      output({
        ok: false,
        error:
          plan.blockingError ?? {
            code: "CAPABILITY_NOT_AVAILABLE",
            message: WRAPPER_ERROR_MESSAGES.CAPABILITY_NOT_AVAILABLE,
          },
      });
      process.exitCode = 1;
      return;
    }
    const validated = validateCapabilitiesManifest(doctorData);
    if (validated.error !== undefined) {
      throw new WrapperError(validated.error.code);
    }
    output({ ok: true, data: validated.manifest });
    return;
  }

  if (invocation.kind === "plan") {
    const plan = await createPlan(runtime, buildCompatibilityPlan, {
      requestedAction: invocation.requestedAction,
      live: invocation.live,
      ...contractVersions,
    });
    output({ ok: true, data: plan });
    return;
  }

  const actionPolicy = ACTION_POLICY[invocation.action];
  const needsLiveProof =
    actionPolicy.requiresBridge && !actionPolicy.mayStartBridge;
  const plan = await createPlan(runtime, buildCompatibilityPlan, {
    requestedAction: invocation.action,
    live: needsLiveProof,
    ...contractVersions,
  });
  const startupCapabilityUnavailable =
    plan.actionAllowed &&
    actionPolicy.mayStartBridge &&
    !plan.mayStartBridge;
  if (
    !plan.actionAllowed ||
    (needsLiveProof && !plan.liveVerified) ||
    startupCapabilityUnavailable
  ) {
    output({
      ok: false,
      error:
        (startupCapabilityUnavailable ? null : plan.blockingError) ?? {
          code: "CAPABILITY_NOT_AVAILABLE",
          message: WRAPPER_ERROR_MESSAGES.CAPABILITY_NOT_AVAILABLE,
        },
    });
    process.exitCode = 1;
    return;
  }
  await forwardRuntime(runtime, runtimeArgs);
};

void main().catch(outputError);
