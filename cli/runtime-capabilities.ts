import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";
import { APPLICATION_VERSION } from "./application-metadata";

export const BRIDGE_SERVICE = "shubi-shot-director" as const;
export const CAPABILITIES_CONTRACT_VERSION = 2 as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const INTENT_REPORT_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_AUTHORITY = "host" as const;
export const INPUT_CONTRACT = "structured-only" as const;
export const MODEL_INTEGRATION = "none" as const;
export const CREDENTIAL_POLICY = "forbidden" as const;
export const NETWORK_POLICY = "loopback-only" as const;

export const CLI_COMMAND_DEFINITIONS = [
  { id: "doctor", usage: "doctor" },
  { id: "ensure", usage: "ensure" },
  { id: "status", usage: "status" },
  { id: "stop", usage: "stop" },
  { id: "health", usage: "health" },
  { id: "snapshot", usage: "snapshot" },
  { id: "scene.create", usage: "scene create --file <scene.json>" },
  {
    id: "scene.submit",
    usage: "scene submit --file <scene-submission.json>",
  },
  {
    id: "scene.save",
    usage: "scene save --file <scene.json> [--force]",
  },
  { id: "scene.load", usage: "scene load --file <scene.json>" },
  { id: "patch.apply", usage: "patch apply --file <patch.json>" },
  {
    id: "patch.submit",
    usage: "patch submit --file <patch-submission.json>",
  },
  { id: "composition.inspect", usage: "composition inspect --json" },
  {
    id: "export.png",
    usage:
      "export png --file <output.png> --width <px> --height <px> [--force]",
  },
  { id: "undo", usage: "undo" },
  { id: "redo", usage: "redo" },
  { id: "open.system", usage: "open --system" },
] as const;

export const CLI_HELP_COMMANDS = CLI_COMMAND_DEFINITIONS.map(
  ({ usage }) => usage,
);

export const RUNTIME_FEATURE_IDS = [
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
] as const;

export interface RuntimeCapabilityManifest {
  service: typeof BRIDGE_SERVICE;
  capabilitiesContractVersion: number;
  applicationVersion: string;
  bridgeProtocolVersion: number;
  sceneSchemaVersion: number;
  patchSchemaVersion: number;
  intentReportSchemaVersion: number;
  semanticAuthority: typeof SEMANTIC_AUTHORITY;
  inputContract: typeof INPUT_CONTRACT;
  modelIntegration: typeof MODEL_INTEGRATION;
  credentialPolicy: typeof CREDENTIAL_POLICY;
  networkPolicy: typeof NETWORK_POLICY;
  commands: string[];
  features: string[];
}

export type RuntimeCapabilityErrorCode =
  | "CAPABILITIES_INVALID"
  | "SEMANTIC_BOUNDARY_VIOLATION";

export class RuntimeCapabilityError extends Error {
  readonly code: RuntimeCapabilityErrorCode;

  constructor(code: RuntimeCapabilityErrorCode) {
    super(
      code === "SEMANTIC_BOUNDARY_VIOLATION"
        ? "The runtime capability manifest violates the host semantic boundary."
        : "The runtime capability manifest is invalid.",
    );
    this.name = "RuntimeCapabilityError";
    this.code = code;
  }
}

const FORBIDDEN_COMMAND_IDS = new Set([
  "shot.create",
  "shot.modify",
  "profile.resolve",
]);

const FORBIDDEN_FEATURE_IDS = new Set([
  "intent.strict-report",
  "intent.allow-partial",
  "profile.external-read-only",
  "schema.scene-authoring",
  "schema.patch-authoring",
]);

const FORBIDDEN_CONFIGURATION_KEYS = new Set([
  "requiresapikey",
  "apikey",
  "token",
  "authorization",
  "secret",
  "credential",
  "credentials",
  "model",
  "provider",
  "baseurl",
  "endpoint",
  "clienttoken",
  "customsecret",
  "runtimeauth",
  "clientkey",
  "custombearer",
  "modelname",
  "providername",
  "endpointaddress",
  "modelid",
]);

const ALLOWED_BOUNDARY_CONFIGURATION_KEYS = new Set([
  "modelIntegration",
  "credentialPolicy",
]);

const CREDENTIAL_CONFIGURATION_TOKENS = new Set([
  "apikey",
  "key",
  "token",
  "secret",
  "auth",
  "authorization",
  "password",
  "bearer",
  "credential",
  "credentials",
]);

const SEMANTIC_CONFIGURATION_TOKENS = new Set([
  "model",
  "provider",
  "endpoint",
]);

const CONFIGURATION_CONTEXT_TOKENS = new Set([
  "config",
  "configuration",
  "settings",
  "options",
  "url",
  "service",
  "model",
  "provider",
  "endpoint",
]);

const COMPACT_CREDENTIAL_CONFIGURATION_PATTERNS = [
  /^[a-z0-9]*apikey[a-z0-9]*$/,
  /^[a-z0-9]*authorization[a-z0-9]*$/,
  /^[a-z0-9]*password[a-z0-9]*$/,
  /^[a-z0-9]*credentials?[a-z0-9]*$/,
  /^[a-z0-9]*baseurl[a-z0-9]*$/,
  /^[a-z0-9]*token(?:count|status|config|configuration|settings|options|value|id|header|url|endpoint|diagnostics|metadata)[a-z0-9]*$/,
  /^[a-z0-9]*(?:access|api|bearer|refresh|session|auth)token[a-z0-9]*$/,
  /^[a-z0-9]*secret(?:status|config|configuration|settings|options|value|id|header|url|endpoint|diagnostics|metadata|count)[a-z0-9]*$/,
  /^[a-z0-9]*(?:client|api|access|auth|model|provider)secret[a-z0-9]*$/,
  /^[a-z0-9]*bearer(?:token|config|configuration|settings|options|value|id|header|url|endpoint|diagnostics|metadata|status)[a-z0-9]*$/,
  /^bearer(?:count)[a-z0-9]*$/,
] as const;

const COMPACT_SEMANTIC_CONFIGURATION_PATTERN =
  /^[a-z0-9]*(?:(?:model|provider|endpoint)(?:config|configuration|settings|options|url|service|model|provider|endpoint)|(?:config|configuration|settings|options|url|service|model|provider|endpoint)(?:model|provider|endpoint))[a-z0-9]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;

const containsForbiddenId = (
  value: unknown,
  forbiddenIds: ReadonlySet<string>,
): boolean =>
  Array.isArray(value) &&
  value.some(
    (item) => typeof item === "string" && forbiddenIds.has(item),
  );

const normalizeConfigurationKey = (key: string): string =>
  key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const containsCompactSensitivePattern = (
  normalizedKey: string,
): boolean =>
  COMPACT_CREDENTIAL_CONFIGURATION_PATTERNS.some((pattern) =>
    pattern.test(normalizedKey),
  ) ||
  COMPACT_SEMANTIC_CONFIGURATION_PATTERN.test(normalizedKey);

const tokenizeConfigurationKey = (key: string): string[] =>
  key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const isForbiddenConfigurationKey = (key: string): boolean => {
  if (ALLOWED_BOUNDARY_CONFIGURATION_KEYS.has(key)) {
    return false;
  }
  const normalizedKey = normalizeConfigurationKey(key);
  if (
    FORBIDDEN_CONFIGURATION_KEYS.has(normalizedKey) ||
    containsCompactSensitivePattern(normalizedKey)
  ) {
    return true;
  }

  const tokens = tokenizeConfigurationKey(key);
  if (
    tokens.some((token) => CREDENTIAL_CONFIGURATION_TOKENS.has(token)) ||
    (tokens.includes("base") && tokens.includes("url"))
  ) {
    return true;
  }

  return tokens.some(
    (token) =>
      SEMANTIC_CONFIGURATION_TOKENS.has(token) &&
      (tokens.length === 1 ||
        tokens.some(
          (candidate) =>
            candidate !== token &&
            CONFIGURATION_CONTEXT_TOKENS.has(candidate),
        )),
  );
};

const containsForbiddenConfigurationKey = (
  input: Record<string, unknown>,
): boolean =>
  Object.keys(input).some(isForbiddenConfigurationKey);

const throwRuntimeCapabilityError = (
  code: RuntimeCapabilityErrorCode,
): never => {
  throw new RuntimeCapabilityError(code);
};

export const parseRuntimeCapabilityManifest = (
  input: unknown,
): RuntimeCapabilityManifest => {
  if (!isRecord(input)) {
    return throwRuntimeCapabilityError("CAPABILITIES_INVALID");
  }
  if (
    containsForbiddenConfigurationKey(input) ||
    containsForbiddenId(input.commands, FORBIDDEN_COMMAND_IDS) ||
    containsForbiddenId(input.features, FORBIDDEN_FEATURE_IDS)
  ) {
    return throwRuntimeCapabilityError("SEMANTIC_BOUNDARY_VIOLATION");
  }
  const semanticAuthority = input.semanticAuthority;
  const inputContract = input.inputContract;
  const modelIntegration = input.modelIntegration;
  const credentialPolicy = input.credentialPolicy;
  const networkPolicy = input.networkPolicy;
  if (
    input.service !== BRIDGE_SERVICE ||
    typeof input.capabilitiesContractVersion !== "number" ||
    !Number.isInteger(input.capabilitiesContractVersion) ||
    input.capabilitiesContractVersion < 1 ||
    typeof input.applicationVersion !== "string" ||
    input.applicationVersion.length === 0 ||
    typeof input.bridgeProtocolVersion !== "number" ||
    !Number.isInteger(input.bridgeProtocolVersion) ||
    input.bridgeProtocolVersion < 1 ||
    typeof input.sceneSchemaVersion !== "number" ||
    !Number.isInteger(input.sceneSchemaVersion) ||
    input.sceneSchemaVersion < 1 ||
    typeof input.patchSchemaVersion !== "number" ||
    !Number.isInteger(input.patchSchemaVersion) ||
    input.patchSchemaVersion < 1 ||
    typeof input.intentReportSchemaVersion !== "number" ||
    !Number.isInteger(input.intentReportSchemaVersion) ||
    input.intentReportSchemaVersion < 1 ||
    typeof semanticAuthority !== "string" ||
    typeof inputContract !== "string" ||
    typeof modelIntegration !== "string" ||
    typeof credentialPolicy !== "string" ||
    typeof networkPolicy !== "string" ||
    !isUniqueStringArray(input.commands) ||
    !isUniqueStringArray(input.features)
  ) {
    return throwRuntimeCapabilityError("CAPABILITIES_INVALID");
  }
  if (
    semanticAuthority !== SEMANTIC_AUTHORITY ||
    inputContract !== INPUT_CONTRACT ||
    modelIntegration !== MODEL_INTEGRATION ||
    credentialPolicy !== CREDENTIAL_POLICY ||
    networkPolicy !== NETWORK_POLICY
  ) {
    return throwRuntimeCapabilityError("SEMANTIC_BOUNDARY_VIOLATION");
  }
  return {
    service: BRIDGE_SERVICE,
    capabilitiesContractVersion: input.capabilitiesContractVersion,
    applicationVersion: input.applicationVersion,
    bridgeProtocolVersion: input.bridgeProtocolVersion,
    sceneSchemaVersion: input.sceneSchemaVersion,
    patchSchemaVersion: input.patchSchemaVersion,
    intentReportSchemaVersion: input.intentReportSchemaVersion,
    semanticAuthority,
    inputContract,
    modelIntegration,
    credentialPolicy,
    networkPolicy,
    commands: [...input.commands],
    features: [...input.features],
  };
};

export const getRuntimeCapabilityManifest =
  (): RuntimeCapabilityManifest => ({
    service: BRIDGE_SERVICE,
    capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
    applicationVersion: APPLICATION_VERSION,
    bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
    sceneSchemaVersion: SCENE_SCHEMA_VERSION,
    patchSchemaVersion: PATCH_SCHEMA_VERSION,
    intentReportSchemaVersion: INTENT_REPORT_SCHEMA_VERSION,
    semanticAuthority: SEMANTIC_AUTHORITY,
    inputContract: INPUT_CONTRACT,
    modelIntegration: MODEL_INTEGRATION,
    credentialPolicy: CREDENTIAL_POLICY,
    networkPolicy: NETWORK_POLICY,
    commands: CLI_COMMAND_DEFINITIONS.map(({ id }) => id),
    features: [...RUNTIME_FEATURE_IDS],
  });
