import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";
import { INTENT_REPORT_SCHEMA_VERSION } from "../src/domain/intent-report";
import { ENTITY_LOCK_MODES } from "../src/domain/entity-lock";
import {
  ACTOR_LIMB_PART_IDS,
  ACTOR_LIMB_PRESENCE_MODES,
} from "../src/domain/actor-anatomy";
import { canonicalPuppetJointIds } from "../src/domain/actor-joints";
import {
  MAX_ACTOR_HEIGHT_M,
  MIN_ACTOR_HEIGHT_M,
} from "../src/domain/actor-stature";
import {
  ACTOR_BLUEPRINT_MOUNT_IDS,
  ACTOR_BLUEPRINT_PRIMITIVES,
  ACTOR_BLUEPRINT_SCHEMA_VERSION,
} from "../src/domain/actor-blueprint";
import { APPLICATION_VERSION } from "./application-metadata";

export { INTENT_REPORT_SCHEMA_VERSION };
export const BRIDGE_SERVICE = "shubi-shot-director" as const;
export const CAPABILITIES_CONTRACT_VERSION = 2 as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const WORKSPACE_ROUTING_VERSION = 1 as const;
export const SEMANTIC_AUTHORITY = "host" as const;
export const INPUT_CONTRACT = "structured-only" as const;
export const MODEL_INTEGRATION = "none" as const;
export const CREDENTIAL_POLICY = "forbidden" as const;
export const NETWORK_POLICY = "loopback-only" as const;
export const PATCH_POLICY_FIELDS = ["preserveLock"] as const;
export const LOCK_ERROR_CODES = [
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
] as const;
export const ACTOR_LIMB_ERROR_CODES = [
  "LIMB_HIERARCHY_CONFLICT",
] as const;
export const ACTOR_PUPPET_HEIGHT_LIMITS_M = {
  min: MIN_ACTOR_HEIGHT_M,
  max: MAX_ACTOR_HEIGHT_M,
} as const;
export const ACTOR_PUPPET_OPERATION_IDS = [
  "actor.height.set",
  "actor.pose.joints.set",
  "actor.blocking.solve",
] as const;
export const ACTOR_PUPPET_ERROR_CODES = [
  "ACTOR_HEIGHT_TARGET_INVALID",
  "ACTOR_HEIGHT_RANGE_INVALID",
  "ACTOR_JOINT_TARGET_INVALID",
  "ACTOR_JOINT_ID_INVALID",
  "STATIC_BLOCKING_ACTOR_NOT_FOUND",
  "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
  "STATIC_BLOCKING_POSE_PRESET_INVALID",
  "POSE_DIAGNOSTICS_FAILED",
] as const;
export const ACTOR_BLUEPRINT_VARIANT_DELTA_FIELDS = [
  "limbPresence",
  "moduleVisibility",
] as const;
export const ACTOR_BLUEPRINT_CAPABILITY_ERROR_CODES = [
  "ACTOR_BLUEPRINT_FILE_READ_FAILED",
  "ACTOR_BLUEPRINT_FILE_INVALID",
  "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
  "ACTOR_BLUEPRINT_VARIANT_INVALID",
  "ACTOR_BLUEPRINT_HASH_MISMATCH",
  "ACTOR_BLUEPRINT_HASH_DUPLICATE",
  "ACTOR_BLUEPRINT_REFERENCE_INVALID",
  "ACTOR_BLUEPRINT_ID_CONFLICT",
] as const;

export const CLI_COMMAND_DEFINITIONS = [
  { id: "doctor", usage: "doctor" },
  { id: "ensure", usage: "ensure" },
  { id: "status", usage: "status" },
  { id: "stop", usage: "stop" },
  { id: "health", usage: "health" },
  { id: "snapshot", usage: "snapshot" },
  {
    id: "blueprint.validate",
    usage: "blueprint validate --stdin",
  },
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
  { id: "pose.inspect", usage: "pose inspect --json" },
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
] as const;

export interface ActorPuppetCapability {
  heightLimitsM: {
    min: number;
    max: number;
  };
  jointIds: string[];
  operationIds: string[];
  errorCodes: string[];
}

export interface ActorBlueprintCapability {
  schemaVersion: number;
  mounts: string[];
  primitives: string[];
  variantDeltaFields: string[];
  errorCodes: string[];
}

export interface RuntimeCapabilityManifest {
  service: typeof BRIDGE_SERVICE;
  capabilitiesContractVersion: number;
  applicationVersion: string;
  bridgeProtocolVersion: number;
  workspaceRoutingVersion: number;
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
  entityLockModes: string[];
  patchPolicyFields: string[];
  lockErrorCodes: string[];
  actorLimbPartIds: string[];
  actorLimbPresenceModes: string[];
  actorLimbErrorCodes: string[];
  actorPuppet: ActorPuppetCapability;
  actorBlueprint: ActorBlueprintCapability;
}

export interface RuntimeCapabilityCompatibilityHeader {
  service: typeof BRIDGE_SERVICE;
  capabilitiesContractVersion: number;
  bridgeProtocolVersion: number;
  workspaceRoutingVersion: number;
  sceneSchemaVersion: number;
  patchSchemaVersion: number;
  intentReportSchemaVersion: number;
  semanticAuthority: typeof SEMANTIC_AUTHORITY;
  inputContract: typeof INPUT_CONTRACT;
  modelIntegration: typeof MODEL_INTEGRATION;
  credentialPolicy: typeof CREDENTIAL_POLICY;
  networkPolicy: typeof NETWORK_POLICY;
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

const MANIFEST_REQUIRED_FIELDS = [
  "service",
  "capabilitiesContractVersion",
  "applicationVersion",
  "bridgeProtocolVersion",
  "workspaceRoutingVersion",
  "sceneSchemaVersion",
  "patchSchemaVersion",
  "intentReportSchemaVersion",
  "semanticAuthority",
  "inputContract",
  "modelIntegration",
  "credentialPolicy",
  "networkPolicy",
  "commands",
  "features",
  "entityLockModes",
  "patchPolicyFields",
  "lockErrorCodes",
  "actorLimbPartIds",
  "actorLimbPresenceModes",
  "actorLimbErrorCodes",
  "actorPuppet",
  "actorBlueprint",
] as const;

const plainOwnRecord = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
};

const hasOwnDataProperty = (
  input: Record<string, unknown>,
  key: string,
): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor !== undefined && "value" in descriptor;
};

const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;
const isNonEmptyUniqueStringArray = (
  value: unknown,
): value is string[] =>
  isUniqueStringArray(value) &&
  value.length > 0 &&
  value.every((item) => item.trim().length > 0);

const stringSetsEqual = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value) => right.includes(value));

const parseActorBlueprintCapability = (
  value: unknown,
): ActorBlueprintCapability | null => {
  const record = plainOwnRecord(value);
  if (
    !record ||
    Object.keys(record).length !== 5 ||
    record.schemaVersion !== ACTOR_BLUEPRINT_SCHEMA_VERSION ||
    !isNonEmptyUniqueStringArray(record.mounts) ||
    !isNonEmptyUniqueStringArray(record.primitives) ||
    !isNonEmptyUniqueStringArray(record.variantDeltaFields) ||
    !isNonEmptyUniqueStringArray(record.errorCodes) ||
    !stringSetsEqual(record.mounts, ACTOR_BLUEPRINT_MOUNT_IDS) ||
    !stringSetsEqual(record.primitives, ACTOR_BLUEPRINT_PRIMITIVES) ||
    !stringSetsEqual(
      record.variantDeltaFields,
      ACTOR_BLUEPRINT_VARIANT_DELTA_FIELDS,
    ) ||
    !stringSetsEqual(
      record.errorCodes,
      ACTOR_BLUEPRINT_CAPABILITY_ERROR_CODES,
    )
  ) {
    return null;
  }
  return {
    schemaVersion: record.schemaVersion,
    mounts: [...record.mounts],
    primitives: [...record.primitives],
    variantDeltaFields: [...record.variantDeltaFields],
    errorCodes: [...record.errorCodes],
  };
};

const parseActorPuppetCapability = (
  value: unknown,
): ActorPuppetCapability | null => {
  const record = plainOwnRecord(value);
  const heightLimitsM = plainOwnRecord(record?.heightLimitsM);
  if (
    !record ||
    Object.keys(record).length !== 4 ||
    !heightLimitsM ||
    Object.keys(heightLimitsM).length !== 2 ||
    heightLimitsM.min !== ACTOR_PUPPET_HEIGHT_LIMITS_M.min ||
    heightLimitsM.max !== ACTOR_PUPPET_HEIGHT_LIMITS_M.max ||
    !isNonEmptyUniqueStringArray(record.jointIds) ||
    !isNonEmptyUniqueStringArray(record.operationIds) ||
    !isNonEmptyUniqueStringArray(record.errorCodes) ||
    !stringSetsEqual(record.jointIds, canonicalPuppetJointIds) ||
    !stringSetsEqual(record.operationIds, ACTOR_PUPPET_OPERATION_IDS) ||
    !stringSetsEqual(record.errorCodes, ACTOR_PUPPET_ERROR_CODES)
  ) {
    return null;
  }
  return {
    heightLimitsM: {
      min: ACTOR_PUPPET_HEIGHT_LIMITS_M.min,
      max: ACTOR_PUPPET_HEIGHT_LIMITS_M.max,
    },
    jointIds: [...record.jointIds],
    operationIds: [...record.operationIds],
    errorCodes: [...record.errorCodes],
  };
};

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

const sanitizeRuntimeCapabilityFailure = (error: unknown): never => {
  if (error instanceof RuntimeCapabilityError) {
    throw error;
  }
  return throwRuntimeCapabilityError("CAPABILITIES_INVALID");
};

const inspectRuntimeCapabilityCompatibilityHeader = (
  input: unknown,
): {
  header: RuntimeCapabilityCompatibilityHeader;
  record: Record<string, unknown>;
} => {
  const record = plainOwnRecord(input);
  if (record === undefined) {
    return throwRuntimeCapabilityError("CAPABILITIES_INVALID");
  }
  if (
    containsForbiddenConfigurationKey(record) ||
    containsForbiddenId(record.commands, FORBIDDEN_COMMAND_IDS) ||
    containsForbiddenId(record.features, FORBIDDEN_FEATURE_IDS)
  ) {
    return throwRuntimeCapabilityError("SEMANTIC_BOUNDARY_VIOLATION");
  }
  const headerFields = MANIFEST_REQUIRED_FIELDS.filter(
    (field) =>
      field !== "applicationVersion" &&
      field !== "commands" &&
      field !== "features" &&
      field !== "entityLockModes" &&
      field !== "patchPolicyFields" &&
      field !== "lockErrorCodes" &&
      field !== "actorLimbPartIds" &&
      field !== "actorLimbPresenceModes" &&
      field !== "actorLimbErrorCodes",
  );
  if (!headerFields.every((field) => hasOwnDataProperty(record, field))) {
    return throwRuntimeCapabilityError("CAPABILITIES_INVALID");
  }
  const semanticAuthority = record.semanticAuthority;
  const inputContract = record.inputContract;
  const modelIntegration = record.modelIntegration;
  const credentialPolicy = record.credentialPolicy;
  const networkPolicy = record.networkPolicy;
  if (
    record.service !== BRIDGE_SERVICE ||
    typeof record.capabilitiesContractVersion !== "number" ||
    !Number.isInteger(record.capabilitiesContractVersion) ||
    record.capabilitiesContractVersion < 1 ||
    typeof record.bridgeProtocolVersion !== "number" ||
    !Number.isInteger(record.bridgeProtocolVersion) ||
    record.bridgeProtocolVersion < 1 ||
    record.workspaceRoutingVersion !== WORKSPACE_ROUTING_VERSION ||
    typeof record.sceneSchemaVersion !== "number" ||
    !Number.isInteger(record.sceneSchemaVersion) ||
    record.sceneSchemaVersion < 1 ||
    typeof record.patchSchemaVersion !== "number" ||
    !Number.isInteger(record.patchSchemaVersion) ||
    record.patchSchemaVersion < 1 ||
    typeof record.intentReportSchemaVersion !== "number" ||
    !Number.isInteger(record.intentReportSchemaVersion) ||
    record.intentReportSchemaVersion < 1 ||
    typeof semanticAuthority !== "string" ||
    typeof inputContract !== "string" ||
    typeof modelIntegration !== "string" ||
    typeof credentialPolicy !== "string" ||
    typeof networkPolicy !== "string"
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
    header: {
      service: BRIDGE_SERVICE,
      capabilitiesContractVersion: record.capabilitiesContractVersion,
      bridgeProtocolVersion: record.bridgeProtocolVersion,
      workspaceRoutingVersion: WORKSPACE_ROUTING_VERSION,
      sceneSchemaVersion: record.sceneSchemaVersion,
      patchSchemaVersion: record.patchSchemaVersion,
      intentReportSchemaVersion: record.intentReportSchemaVersion,
      semanticAuthority,
      inputContract,
      modelIntegration,
      credentialPolicy,
      networkPolicy,
    },
    record,
  };
};

export const parseRuntimeCapabilityCompatibilityHeader = (
  input: unknown,
): RuntimeCapabilityCompatibilityHeader => {
  try {
    return inspectRuntimeCapabilityCompatibilityHeader(input).header;
  } catch (error) {
    return sanitizeRuntimeCapabilityFailure(error);
  }
};

export const parseRuntimeCapabilityManifest = (
  input: unknown,
): RuntimeCapabilityManifest => {
  try {
    const { header, record } =
      inspectRuntimeCapabilityCompatibilityHeader(input);
    const actorBlueprint = parseActorBlueprintCapability(
      record.actorBlueprint,
    );
    const actorPuppet = parseActorPuppetCapability(record.actorPuppet);
    if (
      !MANIFEST_REQUIRED_FIELDS.every((field) =>
        hasOwnDataProperty(record, field),
      ) ||
      typeof record.applicationVersion !== "string" ||
      record.applicationVersion.length === 0 ||
      !isUniqueStringArray(record.commands) ||
      !isUniqueStringArray(record.features) ||
      !record.features.includes("bridge.thread-workspaces") ||
      !isNonEmptyUniqueStringArray(record.entityLockModes) ||
      !isNonEmptyUniqueStringArray(record.patchPolicyFields) ||
      !isNonEmptyUniqueStringArray(record.lockErrorCodes) ||
      !isNonEmptyUniqueStringArray(record.actorLimbPartIds) ||
      !isNonEmptyUniqueStringArray(record.actorLimbPresenceModes) ||
      !isNonEmptyUniqueStringArray(record.actorLimbErrorCodes) ||
      actorPuppet === null ||
      actorBlueprint === null
    ) {
      return throwRuntimeCapabilityError("CAPABILITIES_INVALID");
    }
    return {
      ...header,
      applicationVersion: record.applicationVersion,
      commands: [...record.commands],
      features: [...record.features],
      entityLockModes: [...record.entityLockModes],
      patchPolicyFields: [...record.patchPolicyFields],
      lockErrorCodes: [...record.lockErrorCodes],
      actorLimbPartIds: [...record.actorLimbPartIds],
      actorLimbPresenceModes: [...record.actorLimbPresenceModes],
      actorLimbErrorCodes: [...record.actorLimbErrorCodes],
      actorPuppet,
      actorBlueprint,
    };
  } catch (error) {
    return sanitizeRuntimeCapabilityFailure(error);
  }
};

export const getRuntimeCapabilityManifest =
  (): RuntimeCapabilityManifest => ({
    service: BRIDGE_SERVICE,
    capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
    applicationVersion: APPLICATION_VERSION,
    bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceRoutingVersion: WORKSPACE_ROUTING_VERSION,
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
    entityLockModes: [...ENTITY_LOCK_MODES],
    patchPolicyFields: [...PATCH_POLICY_FIELDS],
    lockErrorCodes: [...LOCK_ERROR_CODES],
    actorLimbPartIds: [...ACTOR_LIMB_PART_IDS],
    actorLimbPresenceModes: [...ACTOR_LIMB_PRESENCE_MODES],
    actorLimbErrorCodes: [...ACTOR_LIMB_ERROR_CODES],
    actorPuppet: {
      heightLimitsM: {
        min: ACTOR_PUPPET_HEIGHT_LIMITS_M.min,
        max: ACTOR_PUPPET_HEIGHT_LIMITS_M.max,
      },
      jointIds: [...canonicalPuppetJointIds],
      operationIds: [...ACTOR_PUPPET_OPERATION_IDS],
      errorCodes: [...ACTOR_PUPPET_ERROR_CODES],
    },
    actorBlueprint: {
      schemaVersion: ACTOR_BLUEPRINT_SCHEMA_VERSION,
      mounts: [...ACTOR_BLUEPRINT_MOUNT_IDS],
      primitives: [...ACTOR_BLUEPRINT_PRIMITIVES],
      variantDeltaFields: [...ACTOR_BLUEPRINT_VARIANT_DELTA_FIELDS],
      errorCodes: [...ACTOR_BLUEPRINT_CAPABILITY_ERROR_CODES],
    },
  });
