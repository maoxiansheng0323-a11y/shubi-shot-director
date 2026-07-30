#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

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
const bundledWorkspaceRoutingVersion = 1;
const bundledEntityLockModes = Object.freeze([
  "none",
  "workflow",
  "user",
]);
const bundledPatchPolicyFields = Object.freeze(["preserveLock"]);
const bundledLockErrorCodes = Object.freeze([
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
]);
const bundledActorLimbPartIds = Object.freeze([
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
]);
const bundledActorLimbPresenceModes = Object.freeze([
  "present",
  "absent",
]);
const bundledActorLimbErrorCodes = Object.freeze([
  "LIMB_HIERARCHY_CONFLICT",
]);
const bundledActorBlueprint = Object.freeze({
  schemaVersion: 1,
  mounts: Object.freeze([
    "shoulder_l", "shoulder_r", "elbow_l", "elbow_r", "wrist_l",
    "wrist_r", "hip_l", "hip_r", "knee_l", "knee_r",
  ]),
  primitives: Object.freeze(["box", "sphere", "cylinder"]),
  variantDeltaFields: Object.freeze([
    "limbPresence",
    "moduleVisibility",
  ]),
  errorCodes: Object.freeze([
    "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    "ACTOR_BLUEPRINT_FILE_INVALID",
    "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
    "ACTOR_BLUEPRINT_VARIANT_INVALID",
    "ACTOR_BLUEPRINT_HASH_MISMATCH",
    "ACTOR_BLUEPRINT_HASH_DUPLICATE",
    "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    "ACTOR_BLUEPRINT_ID_CONFLICT",
  ]),
});
const expectedIntentReportSchemaDigest =
  "be40666d595a8d675b28a0b55d039ce27eed977f46c3f64f64b37684b1e887a7";
const runtimeTimeoutMs = 30_000;
const runtimeMaxBufferBytes = 1024 * 1024;
const actorBlueprintMaxInputBytes = 1024 * 1024;
const stableActionIds = new Set([
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
let WorkspaceRoutingErrorClass;
let attachWorkspace;
let deriveThreadWorkspaceId;
let ensureWorkspaceRoute;
let isWorkspaceId;
let listWorkspaces;
let readThreadBinding;
let updateWorkspaceRoute;

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
  USER_LOCKED: "A requested scene entity is user-locked.",
  WORKFLOW_LOCKED: "A requested scene entity is workflow-locked.",
  LOCK_PRESERVATION_CONFLICT:
    "The requested change conflicts with lock preservation.",
  CONTACT_CONSTRAINT_ACTIVE:
    "An active contact constraint prevents this change.",
  LIMB_HIERARCHY_CONFLICT:
    "The requested limb presence conflicts with the actor hierarchy.",
  ACTOR_LIMB_TARGET_INVALID:
    "The requested limb target is not an editable actor.",
  ACTOR_BLUEPRINT_FILE_READ_FAILED:
    "The Actor Blueprint file could not be read.",
  ACTOR_BLUEPRINT_FILE_INVALID:
    "The Actor Blueprint document is invalid.",
  ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED:
    "The Actor Blueprint schema version is unsupported.",
  ACTOR_BLUEPRINT_VARIANT_INVALID:
    "The Actor Blueprint variant is invalid.",
  CAPABILITY_NOT_AVAILABLE:
    "The requested runtime capability is not available.",
  WORKSPACE_ID_INVALID: "The workspace ID is invalid.",
  WORKSPACE_NOT_FOUND: "The workspace was not found.",
  WORKSPACE_STATE_INVALID: "The workspace routing state is invalid.",
  WORKSPACE_LOCK_UNAVAILABLE:
    "The workspace routing lock is unavailable.",
  WORKSPACE_PORT_UNAVAILABLE:
    "No loopback port is available for the workspace.",
  WORKSPACE_THREAD_ID_UNAVAILABLE:
    "A Codex thread is required for workspace attachment.",
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
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
  "CONTACT_CONSTRAINT_ACTIVE",
  "LIMB_HIERARCHY_CONFLICT",
  "ACTOR_LIMB_TARGET_INVALID",
  "ACTOR_BLUEPRINT_FILE_READ_FAILED",
  "ACTOR_BLUEPRINT_FILE_INVALID",
  "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
  "ACTOR_BLUEPRINT_VARIANT_INVALID",
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
  const isWorkspaceRoutingError =
    WorkspaceRoutingErrorClass !== undefined &&
    error instanceof WorkspaceRoutingErrorClass;
  const safeError =
    isSkillRuntimeError ||
    isWorkspaceRoutingError ||
    error instanceof WrapperError
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
  if (command === "workspace") {
    const workspaceCommand = args[1];
    if (
      (workspaceCommand === "current" ||
        workspaceCommand === "list") &&
      args.length === 2
    ) {
      return {
        kind: "workspace",
        command: workspaceCommand,
      };
    }
    if (
      workspaceCommand === "attach" &&
      args[2] === "--id" &&
      args.length === 4
    ) {
      return {
        kind: "workspace",
        command: workspaceCommand,
        workspaceId: args[3],
      };
    }
    if (
      workspaceCommand === "attach" &&
      (args[2] !== "--id" || args[3] === undefined)
    ) {
      throw new WrapperError("CLI_ARGUMENT_REQUIRED");
    }
    throw new WrapperError("CLI_UNKNOWN_ARGUMENT");
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
  if (command === "blueprint" && args[1] === "validate") {
    if (
      args.length !== 4 ||
      args[2] !== "--file" ||
      typeof args[3] !== "string" ||
      args[3].trim().length === 0
    ) {
      throw new WrapperError("CLI_ARGUMENT_REQUIRED");
    }
    return {
      kind: "target",
      action: "blueprint.validate",
      blueprintFile: args[3],
    };
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

const readBlueprintSource = async (
  fileArgument,
  callerDirectory = process.cwd(),
) => {
  if (windowsDriveRelativePathPattern.test(fileArgument)) {
    throw new WrapperError("ACTOR_BLUEPRINT_FILE_READ_FAILED");
  }

  let handle;
  try {
    handle = await open(path.resolve(callerDirectory, fileArgument), "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > actorBlueprintMaxInputBytes) {
      throw new WrapperError("ACTOR_BLUEPRINT_FILE_READ_FAILED");
    }
    const source = await handle.readFile("utf8");
    if (Buffer.byteLength(source, "utf8") > actorBlueprintMaxInputBytes) {
      throw new WrapperError("ACTOR_BLUEPRINT_FILE_READ_FAILED");
    }
    try {
      return JSON.stringify(JSON.parse(source));
    } catch {
      throw new WrapperError("ACTOR_BLUEPRINT_FILE_INVALID");
    }
  } catch (error) {
    if (error instanceof WrapperError) {
      throw error;
    }
    throw new WrapperError("ACTOR_BLUEPRINT_FILE_READ_FAILED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
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

const isNonEmptyUniqueStringArray = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (item) => typeof item === "string" && item.trim().length > 0,
  ) &&
  new Set(value).size === value.length;
const stringSetsEqual = (left, right) =>
  isNonEmptyUniqueStringArray(left) &&
  left.length === right.length &&
  left.every((value) => right.includes(value));
const actorBlueprintEqual = (value, expected) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 5 &&
  value.schemaVersion === expected.schemaVersion &&
  stringSetsEqual(value.mounts, expected.mounts) &&
  stringSetsEqual(value.primitives, expected.primitives) &&
  stringSetsEqual(
    value.variantDeltaFields,
    expected.variantDeltaFields,
  ) &&
  stringSetsEqual(value.errorCodes, expected.errorCodes);
const cloneActorBlueprintCapability = (value) => ({
  schemaVersion: value.schemaVersion,
  mounts: [...value.mounts],
  primitives: [...value.primitives],
  variantDeltaFields: [...value.variantDeltaFields],
  errorCodes: [...value.errorCodes],
});

const readBundledContractVersions = async () => {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(skillDirectory, "runtime.json"), "utf8"),
    );
    await Promise.all([
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
      metadata?.workspaceRoutingVersion !==
        bundledWorkspaceRoutingVersion ||
      metadata?.semanticAuthority !== "host" ||
      metadata?.inputContract !== "structured-only" ||
      metadata?.modelIntegration !== "none" ||
      metadata?.credentialPolicy !== "forbidden" ||
      metadata?.networkPolicy !== "loopback-only" ||
      metadata?.sceneSchemaVersion !== 5 ||
      metadata?.patchSchemaVersion !== 5 ||
      metadata?.intentReportSchemaVersion !== 5 ||
      !stringSetsEqual(
        metadata?.entityLockModes,
        bundledEntityLockModes,
      ) ||
      !stringSetsEqual(
        metadata?.patchPolicyFields,
        bundledPatchPolicyFields,
      ) ||
      !stringSetsEqual(
        metadata?.lockErrorCodes,
        bundledLockErrorCodes,
      ) ||
      !stringSetsEqual(
        metadata?.actorLimbPartIds,
        bundledActorLimbPartIds,
      ) ||
      !stringSetsEqual(
        metadata?.actorLimbPresenceModes,
        bundledActorLimbPresenceModes,
      ) ||
      !stringSetsEqual(
        metadata?.actorLimbErrorCodes,
        bundledActorLimbErrorCodes,
      ) ||
      !actorBlueprintEqual(
        metadata?.actorBlueprint,
        bundledActorBlueprint,
      )
    ) {
      throw new Error("invalid bundled contract");
    }
    return {
      skillBridgeProtocolVersion: metadata.bridgeProtocolVersion,
      skillWorkspaceRoutingVersion:
        metadata.workspaceRoutingVersion,
      skillSceneSchemaVersion: metadata.sceneSchemaVersion,
      skillPatchSchemaVersion: metadata.patchSchemaVersion,
      skillIntentReportSchemaVersion: metadata.intentReportSchemaVersion,
      skillEntityLockModes: [...metadata.entityLockModes],
      skillPatchPolicyFields: [...metadata.patchPolicyFields],
      skillLockErrorCodes: [...metadata.lockErrorCodes],
      skillActorLimbPartIds: [...metadata.actorLimbPartIds],
      skillActorLimbPresenceModes: [...metadata.actorLimbPresenceModes],
      skillActorLimbErrorCodes: [...metadata.actorLimbErrorCodes],
      skillActorBlueprint: cloneActorBlueprintCapability(
        metadata.actorBlueprint,
      ),
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

const runtimeChildEnvironment = (
  environment = process.env,
  workspaceRoute,
) => {
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
  const routed =
    workspaceRoute === undefined
      ? {
          url: environment.SHUBI_SHOT_URL,
          port: environment.SHUBI_SHOT_PORT,
          runtimeDirectory: environment.SHUBI_SHOT_RUNTIME_DIR,
        }
      : {
          port: String(workspaceRoute.port),
          runtimeDirectory: workspaceRoute.runtimeDirectory,
        };
  setDefined(child, "SHUBI_SHOT_URL", routed.url);
  setDefined(child, "SHUBI_SHOT_PORT", routed.port);
  setDefined(
    child,
    "SHUBI_SHOT_RUNTIME_DIR",
    routed.runtimeDirectory,
  );
  return child;
};

const runRuntime = (runtime, args, workspaceRoute, stdinSource) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [runtime.entrypoint, ...args], {
        cwd: runtime.runtimeRoot,
        env: runtimeChildEnvironment(process.env, workspaceRoute),
        shell: false,
        stdio: [
          stdinSource === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ],
        windowsHide: true,
      });
    } catch {
      resolve({ unavailable: true });
      return;
    }

    if (stdinSource !== undefined) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdinSource, "utf8");
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

const invokeRuntimeJson = async (runtime, args, workspaceRoute) => {
  const result = await runRuntime(runtime, args, workspaceRoute);
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
    skillWorkspaceRoutingVersion,
    skillSceneSchemaVersion,
    skillPatchSchemaVersion,
    skillIntentReportSchemaVersion,
    skillEntityLockModes,
    skillPatchPolicyFields,
    skillLockErrorCodes,
    skillActorLimbPartIds,
    skillActorLimbPresenceModes,
    skillActorLimbErrorCodes,
    skillActorBlueprint,
  },
  workspaceRoute,
) => {
  const doctorData = requireEnvelopeData(
    await invokeRuntimeJson(runtime, ["doctor"], workspaceRoute),
  );
  const baseInput = {
    doctorData,
    requestedAction,
    skillBridgeProtocolVersion,
    skillWorkspaceRoutingVersion,
    skillSceneSchemaVersion,
    skillPatchSchemaVersion,
    skillIntentReportSchemaVersion,
    skillEntityLockModes: [...skillEntityLockModes],
    skillPatchPolicyFields: [...skillPatchPolicyFields],
    skillLockErrorCodes: [...skillLockErrorCodes],
    skillActorLimbPartIds: [...skillActorLimbPartIds],
    skillActorLimbPresenceModes: [...skillActorLimbPresenceModes],
    skillActorLimbErrorCodes: [...skillActorLimbErrorCodes],
    skillActorBlueprint: cloneActorBlueprintCapability(
      skillActorBlueprint,
    ),
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
    await invokeRuntimeJson(runtime, ["health"], workspaceRoute),
  );
  return buildCompatibilityPlan({
    ...baseInput,
    liveRequested: true,
    healthData,
  });
};

const forwardRuntime = async (
  runtime,
  args,
  workspaceRoute,
  stdinSource,
) => {
  const result = await runRuntime(
    runtime,
    args,
    workspaceRoute,
    stdinSource,
  );
  if (result.unavailable) {
    throw new WrapperError("RUNTIME_UNAVAILABLE");
  }
  const envelope = parseRuntimeEnvelope(result.stdout);

  if (runtimeSuccessContradictsProcess(envelope, result)) {
    throw new WrapperError("RUNTIME_COMMAND_FAILED");
  }
  if (!envelope.ok) {
    throw runtimeEnvelopeError(envelope);
  }
  return {
    envelope,
    exitCode: result.exitCode ?? 1,
  };
};

const workspaceRoutingRoot = (runtime) =>
  path.join(runtime.runtimeRoot, ".shubi-shot", "workspace-routing");

const legacyRuntimeDirectory = (runtime) =>
  path.join(runtime.runtimeRoot, ".shubi-shot");

const loadWorkspaceRouting = async () => {
  if (WorkspaceRoutingErrorClass !== undefined) {
    return;
  }
  const [identity, registry] = await Promise.all([
    import("./workspace-identity.mjs"),
    import("./workspace-registry.mjs"),
  ]);
  deriveThreadWorkspaceId = identity.deriveThreadWorkspaceId;
  isWorkspaceId = identity.isWorkspaceId;
  attachWorkspace = registry.attachWorkspace;
  ensureWorkspaceRoute = registry.ensureWorkspaceRoute;
  listWorkspaces = registry.listWorkspaces;
  readThreadBinding = registry.readThreadBinding;
  updateWorkspaceRoute = registry.updateWorkspaceRoute;
  WorkspaceRoutingErrorClass = registry.WorkspaceRoutingError;
};

const resolveInvocationWorkspace = async (runtime) => {
  const threadWorkspaceId = deriveThreadWorkspaceId(
    process.env.CODEX_THREAD_ID,
  );
  if (threadWorkspaceId === undefined) {
    return undefined;
  }
  const routingRoot = workspaceRoutingRoot(runtime);
  const binding = await readThreadBinding(
    routingRoot,
    threadWorkspaceId,
  );
  const route = await ensureWorkspaceRoute({
    routingRoot,
    workspaceId: binding ?? threadWorkspaceId,
    legacyRuntimeDirectory: legacyRuntimeDirectory(runtime),
  });
  return Object.freeze({
    route,
    source: binding === undefined ? "thread" : "binding",
  });
};

const workspaceSummary = (route, source) =>
  Object.freeze({
    workspaceId: route.workspaceId,
    source,
    port: route.port,
    status: route.status,
    legacy: route.legacy,
    uiUrl: `http://127.0.0.1:${route.port}`,
  });

const handleWorkspaceInvocation = async (runtime, invocation) => {
  const routingRoot = workspaceRoutingRoot(runtime);
  if (invocation.command === "list") {
    output({
      ok: true,
      data: {
        workspaces: await listWorkspaces({ routingRoot }),
      },
    });
    return;
  }

  const threadWorkspaceId = deriveThreadWorkspaceId(
    process.env.CODEX_THREAD_ID,
  );
  if (invocation.command === "attach") {
    if (threadWorkspaceId === undefined) {
      throw new WrapperError("WORKSPACE_THREAD_ID_UNAVAILABLE");
    }
    if (!isWorkspaceId(invocation.workspaceId)) {
      throw new WorkspaceRoutingErrorClass("WORKSPACE_ID_INVALID");
    }
    const workspaceId = await attachWorkspace({
      routingRoot,
      threadWorkspaceId,
      targetWorkspaceId: invocation.workspaceId,
    });
    output({
      ok: true,
      data: {
        workspaceId,
        attached: true,
      },
    });
    return;
  }

  if (threadWorkspaceId === undefined) {
    output({
      ok: true,
      data: {
        workspaceId: null,
        source: "legacy",
      },
    });
    return;
  }
  const resolved = await resolveInvocationWorkspace(runtime);
  output({
    ok: true,
    data: workspaceSummary(resolved.route, resolved.source),
  });
};

const validateStartedWorkspace = (route, data) => {
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    typeof data.uiUrl !== "string" ||
    typeof data.instanceId !== "string" ||
    !/^instance_[0-9a-f]{32}$/u.test(data.instanceId)
  ) {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
  let url;
  try {
    url = new URL(data.uiUrl);
  } catch {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== route.port ||
    url.origin !== data.uiUrl
  ) {
    throw new WrapperError("RUNTIME_RESPONSE_INVALID");
  }
  return data.instanceId;
};

const main = async () => {
  const args = process.argv.slice(2);
  rejectLegacyText(args);
  rejectForbiddenArguments(args);
  const invocation = parseInvocation(args);
  const blueprintStdinSource =
    invocation.kind === "target" &&
    invocation.action === "blueprint.validate"
      ? await readBlueprintSource(invocation.blueprintFile)
      : undefined;
  const runtimeArgs =
    blueprintStdinSource === undefined
      ? resolveFileArguments(args, invocation)
      : ["blueprint", "validate", "--stdin"];
  if (invocation.kind === "help") {
    output({
      ok: true,
      data: {
        inputContract: "structured-only",
        commands: [...stableActionIds],
        compatibilityCommand:
          "compatibility plan --action <action> [--live]",
        workspaceCommands: [
          "workspace current",
          "workspace list",
          "workspace attach --id <workspace-id>",
        ],
      },
    });
    return;
  }
  const locator = await import("./runtime-locator.mjs");
  SkillRuntimeErrorClass = locator.SkillRuntimeError;
  const runtime = await locator.resolveRuntime();
  if (invocation.kind === "workspace") {
    await loadWorkspaceRouting();
    await handleWorkspaceInvocation(runtime, invocation);
    return;
  }
  const {
    ACTION_POLICY,
    buildCompatibilityPlan,
    validateCapabilitiesManifest,
  } = await import("./compatibility-plan.mjs");
  const contractVersions = await readBundledContractVersions();
  if (
    invocation.kind !== "doctor" &&
    !(
      invocation.kind === "target" &&
      invocation.action === "blueprint.validate"
    )
  ) {
    await loadWorkspaceRouting();
  }
  const workspaceContext =
    invocation.kind === "doctor" ||
    (invocation.kind === "target" &&
      invocation.action === "blueprint.validate")
      ? undefined
      : await resolveInvocationWorkspace(runtime);
  const workspaceRoute = workspaceContext?.route;

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
    }, workspaceRoute);
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
  }, workspaceRoute);
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
  let forwarded;
  try {
    forwarded = await forwardRuntime(
      runtime,
      runtimeArgs,
      workspaceRoute,
      blueprintStdinSource,
    );
    if (
      workspaceRoute !== undefined &&
      (invocation.action === "ensure" ||
        invocation.action === "open.system")
    ) {
      const instanceId = validateStartedWorkspace(
        workspaceRoute,
        forwarded.envelope.data,
      );
      await updateWorkspaceRoute({
        routingRoot: workspaceRoutingRoot(runtime),
        workspaceId: workspaceRoute.workspaceId,
        status: "ready",
        instanceId,
      });
    } else if (
      workspaceRoute !== undefined &&
      invocation.action === "stop"
    ) {
      await updateWorkspaceRoute({
        routingRoot: workspaceRoutingRoot(runtime),
        workspaceId: workspaceRoute.workspaceId,
        status: "stopped",
      });
    }
  } catch (error) {
    if (
      workspaceRoute !== undefined &&
      (invocation.action === "ensure" ||
        invocation.action === "open.system")
    ) {
      await updateWorkspaceRoute({
        routingRoot: workspaceRoutingRoot(runtime),
        workspaceId: workspaceRoute.workspaceId,
        status: "stopped",
      }).catch(() => undefined);
    }
    throw error;
  }
  output(forwarded.envelope);
  process.exitCode = forwarded.exitCode;
};

void main().catch(outputError);
