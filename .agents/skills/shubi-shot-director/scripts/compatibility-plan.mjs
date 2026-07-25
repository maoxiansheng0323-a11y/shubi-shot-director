export const PLAN_CONTRACT_VERSION = 2;

const RUNTIME_SERVICE = "shubi-shot-director";
const CAPABILITIES_CONTRACT_VERSION = 2;
const EXPECTED_BOUNDARY = Object.freeze({
  semanticAuthority: "host",
  inputContract: "structured-only",
  modelIntegration: "none",
  credentialPolicy: "forbidden",
  networkPolicy: "loopback-only",
});

const policy = (
  command,
  {
    features = [],
    schemas = [],
    requiresBridge = false,
    mayStartBridge = false,
  } = {},
) =>
  Object.freeze({
    command,
    features: Object.freeze([...features]),
    schemas: Object.freeze([...schemas]),
    requiresBridge,
    mayStartBridge,
  });

export const ACTION_POLICY = Object.freeze({
  doctor: policy("doctor"),
  ensure: policy("ensure", { mayStartBridge: true }),
  status: policy("status"),
  stop: policy("stop", { features: ["bridge.safe-shutdown"] }),
  health: policy("health", { requiresBridge: true }),
  snapshot: policy("snapshot", { requiresBridge: true }),
  "scene.create": policy("scene.create", {
    schemas: ["scene"],
    requiresBridge: true,
  }),
  "scene.submit": policy("scene.submit", {
    features: [
      "input.intent-report.validate",
      "input.scene-submission.atomic",
    ],
    schemas: ["scene", "intent"],
    requiresBridge: true,
  }),
  "scene.save": policy("scene.save", {
    features: ["scene.files"],
    requiresBridge: true,
  }),
  "scene.load": policy("scene.load", {
    features: ["scene.files"],
    requiresBridge: true,
  }),
  "patch.apply": policy("patch.apply", {
    schemas: ["patch"],
    requiresBridge: true,
  }),
  "patch.submit": policy("patch.submit", {
    features: [
      "input.intent-report.validate",
      "input.patch-submission.atomic",
    ],
    schemas: ["patch", "intent"],
    requiresBridge: true,
  }),
  "composition.inspect": policy("composition.inspect", {
    features: ["composition.segmented-report"],
    requiresBridge: true,
  }),
  "export.png": policy("export.png", {
    features: ["export.software-png"],
    requiresBridge: true,
  }),
  undo: policy("undo", { requiresBridge: true }),
  redo: policy("redo", { requiresBridge: true }),
  "open.system": policy("open.system", {
    requiresBridge: true,
    mayStartBridge: true,
  }),
});

const ACTION_IDS = Object.freeze(Object.keys(ACTION_POLICY));
const REQUIRED_FEATURE_IDS = Object.freeze([
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
]);
const REMOVED_COMMAND_IDS = new Set([
  "shot.create",
  "shot.modify",
  "profile.resolve",
]);
const REMOVED_FEATURE_IDS = new Set([
  "intent.strict-report",
  "intent.allow-partial",
  "profile.external-read-only",
  "schema.scene-authoring",
  "schema.patch-authoring",
]);

const ERROR_MESSAGES = Object.freeze({
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
  CAPABILITY_NOT_AVAILABLE:
    "The requested runtime capability is not available.",
});

const compatibilityError = (code) => ({
  code,
  message: ERROR_MESSAGES[code],
});

const invalid = (code) => ({ error: compatibilityError(code) });
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isPositiveInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const isUniqueStringArray = (value) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;
const stringSetsEqual = (left, right) =>
  left.length === right.length &&
  left.every((value) => right.includes(value));

const MANIFEST_ROOT_KEYS = new Set([
  "service",
  "capabilitiesContractVersion",
  "applicationVersion",
  "bridgeProtocolVersion",
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
]);
const FORBIDDEN_COMPACT_KEYS = new Set([
  "requiresapikey",
  "apikey",
  "token",
  "authorization",
  "credential",
  "credentials",
  "password",
  "bearer",
  "secret",
  "baseurl",
  "model",
  "provider",
  "endpoint",
  "clientkey",
  "runtimeauth",
  "authheader",
]);
const CREDENTIAL_KEY_TOKENS = new Set([
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
const SEMANTIC_KEY_TOKENS = new Set([
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
  "name",
  "id",
  "address",
  "integration",
  "model",
  "provider",
  "endpoint",
]);
const COMPACT_CREDENTIAL_PATTERNS = [
  /^[a-z0-9]*(?:api|client)key[a-z0-9]*$/,
  /^[a-z0-9]*(?:runtimeauth|authheader)[a-z0-9]*$/,
  /^[a-z0-9]*authorization[a-z0-9]*$/,
  /^[a-z0-9]*password[a-z0-9]*$/,
  /^[a-z0-9]*credentials?[a-z0-9]*$/,
  /^[a-z0-9]*baseurl[a-z0-9]*$/,
  /^[a-z0-9]*token(?:count|status|config|configuration|settings|options|value|id|header|url|endpoint|diagnostics|metadata)[a-z0-9]*$/,
  /^[a-z0-9]*(?:access|api|bearer|client|refresh|session|auth|runtime)token[a-z0-9]*$/,
  /^[a-z0-9]*secret(?:status|config|configuration|settings|options|value|id|header|url|endpoint|diagnostics|metadata|count)[a-z0-9]*$/,
  /^[a-z0-9]*(?:client|api|access|auth|model|provider|runtime|custom)secret[a-z0-9]*$/,
  /^[a-z0-9]*bearer(?:token|config|configuration|settings|options|value|id|header|url|endpoint|diagnostics|metadata|status)[a-z0-9]*$/,
  /^bearercount[a-z0-9]*$/,
];
const COMPACT_SEMANTIC_PATTERN =
  /^[a-z0-9]*(?:(?:model|provider|endpoint)(?:config|configuration|settings|options|url|service|name|id|address|integration|model|provider|endpoint)|(?:config|configuration|settings|options|url|service|name|id|address|integration|model|provider|endpoint)(?:model|provider|endpoint))[a-z0-9]*$/;

const normalizeConfigurationKey = (key) =>
  key.replace(/[^a-z0-9]/gi, "").toLowerCase();
const tokenizeConfigurationKey = (key) =>
  key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const isSensitiveConfigurationKey = (key) => {
  const normalized = normalizeConfigurationKey(key);
  if (
    FORBIDDEN_COMPACT_KEYS.has(normalized) ||
    COMPACT_CREDENTIAL_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    ) ||
    COMPACT_SEMANTIC_PATTERN.test(normalized)
  ) {
    return true;
  }

  const tokens = tokenizeConfigurationKey(key);
  if (
    tokens.some((token) => CREDENTIAL_KEY_TOKENS.has(token)) ||
    (tokens.includes("base") && tokens.includes("url"))
  ) {
    return true;
  }

  return tokens.some(
    (token) =>
      SEMANTIC_KEY_TOKENS.has(token) &&
      (tokens.length === 1 ||
        tokens.some(
          (candidate) =>
            candidate !== token &&
            CONFIGURATION_CONTEXT_TOKENS.has(candidate),
        )),
  );
};

const hasSensitiveConfiguration = (input) => {
  const visited = new Set();
  const visit = (value, root = false) => {
    if (
      typeof value !== "object" ||
      value === null ||
      visited.has(value)
    ) {
      return false;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      return value.some((item) => visit(item));
    }

    return Object.entries(value).some(
      ([key, child]) =>
        ((!root || !MANIFEST_ROOT_KEYS.has(key)) &&
          isSensitiveConfigurationKey(key)) ||
        visit(child),
    );
  };
  return visit(input, true);
};
const includesRemovedId = (values, removedIds) =>
  Array.isArray(values) && values.some((value) => removedIds.has(value));

export const validateCapabilitiesManifest = (input) => {
  if (!isRecord(input)) {
    return invalid("CAPABILITIES_INVALID");
  }

  const contractVersion = input.capabilitiesContractVersion;
  if (contractVersion === undefined || contractVersion === 1) {
    return invalid("CAPABILITIES_CONTRACT_UNSUPPORTED");
  }
  if (!isPositiveInteger(contractVersion)) {
    return invalid("CAPABILITIES_INVALID");
  }
  if (contractVersion !== CAPABILITIES_CONTRACT_VERSION) {
    return invalid("CAPABILITIES_CONTRACT_UNSUPPORTED");
  }
  if (
    hasSensitiveConfiguration(input) ||
    includesRemovedId(input.commands, REMOVED_COMMAND_IDS) ||
    includesRemovedId(input.features, REMOVED_FEATURE_IDS)
  ) {
    return invalid("SEMANTIC_BOUNDARY_VIOLATION");
  }
  if (input.service !== RUNTIME_SERVICE) {
    return invalid("BRIDGE_IDENTITY_MISMATCH");
  }
  if (
    typeof input.applicationVersion !== "string" ||
    input.applicationVersion.length === 0 ||
    !isPositiveInteger(input.bridgeProtocolVersion) ||
    !isPositiveInteger(input.sceneSchemaVersion) ||
    !isPositiveInteger(input.patchSchemaVersion) ||
    !isPositiveInteger(input.intentReportSchemaVersion) ||
    !isUniqueStringArray(input.commands) ||
    !isUniqueStringArray(input.features) ||
    Object.keys(EXPECTED_BOUNDARY).some(
      (field) => typeof input[field] !== "string",
    )
  ) {
    return invalid("CAPABILITIES_INVALID");
  }
  if (
    Object.entries(EXPECTED_BOUNDARY).some(
      ([field, expected]) => input[field] !== expected,
    )
  ) {
    return invalid("SEMANTIC_BOUNDARY_VIOLATION");
  }

  return {
    manifest: {
      service: RUNTIME_SERVICE,
      capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
      applicationVersion: input.applicationVersion,
      bridgeProtocolVersion: input.bridgeProtocolVersion,
      sceneSchemaVersion: input.sceneSchemaVersion,
      patchSchemaVersion: input.patchSchemaVersion,
      intentReportSchemaVersion: input.intentReportSchemaVersion,
      ...EXPECTED_BOUNDARY,
      commands: [...input.commands],
      features: [...input.features],
    },
  };
};

const compareLiveManifest = (
  offline,
  input,
  skillBridgeProtocolVersion,
) => {
  const parsed = validateCapabilitiesManifest(input);
  if (parsed.error !== undefined) {
    return parsed;
  }
  const live = parsed.manifest;
  if (
    live.bridgeProtocolVersion !== offline.bridgeProtocolVersion ||
    live.bridgeProtocolVersion !== skillBridgeProtocolVersion
  ) {
    return invalid("BRIDGE_PROTOCOL_UNSUPPORTED");
  }
  if (live.sceneSchemaVersion !== offline.sceneSchemaVersion) {
    return invalid("SCENE_SCHEMA_UNSUPPORTED");
  }
  if (live.patchSchemaVersion !== offline.patchSchemaVersion) {
    return invalid("PATCH_SCHEMA_UNSUPPORTED");
  }
  if (
    live.intentReportSchemaVersion !== offline.intentReportSchemaVersion
  ) {
    return invalid("INTENT_REPORT_SCHEMA_UNSUPPORTED");
  }
  if (
    !stringSetsEqual(live.commands, offline.commands) ||
    !stringSetsEqual(live.features, offline.features)
  ) {
    return invalid("CAPABILITIES_INVALID");
  }
  return { manifest: live };
};

const schemaCompatibility = (
  manifest,
  {
    skillSceneSchemaVersion,
    skillPatchSchemaVersion,
    skillIntentReportSchemaVersion,
  },
) => ({
  scene: manifest.sceneSchemaVersion === skillSceneSchemaVersion,
  patch: manifest.patchSchemaVersion === skillPatchSchemaVersion,
  intent:
    manifest.intentReportSchemaVersion ===
    skillIntentReportSchemaVersion,
});

const actionIsAvailable = (actionId, manifest, schemas) => {
  const action = ACTION_POLICY[actionId];
  return (
    manifest.commands.includes(action.command) &&
    action.features.every((feature) =>
      manifest.features.includes(feature),
    ) &&
    action.schemas.every((schema) => schemas[schema])
  );
};

const diagnosticsFor = (manifest, schemas) => {
  const diagnostics = [];
  for (const actionId of ACTION_IDS) {
    const command = ACTION_POLICY[actionId].command;
    if (!manifest.commands.includes(command)) {
      diagnostics.push(`COMMAND_UNAVAILABLE:${command}`);
    }
  }
  for (const feature of REQUIRED_FEATURE_IDS) {
    if (!manifest.features.includes(feature)) {
      diagnostics.push(`FEATURE_UNAVAILABLE:${feature}`);
    }
  }
  if (!schemas.scene) {
    diagnostics.push("SCENE_SCHEMA_UNSUPPORTED");
  }
  if (!schemas.patch) {
    diagnostics.push("PATCH_SCHEMA_UNSUPPORTED");
  }
  if (!schemas.intent) {
    diagnostics.push("INTENT_REPORT_SCHEMA_UNSUPPORTED");
  }
  return diagnostics;
};

const actionBlockingError = (requestedAction, schemas) => {
  const action = ACTION_POLICY[requestedAction];
  if (action.schemas.includes("scene") && !schemas.scene) {
    return compatibilityError("SCENE_SCHEMA_UNSUPPORTED");
  }
  if (action.schemas.includes("patch") && !schemas.patch) {
    return compatibilityError("PATCH_SCHEMA_UNSUPPORTED");
  }
  if (action.schemas.includes("intent") && !schemas.intent) {
    return compatibilityError("INTENT_REPORT_SCHEMA_UNSUPPORTED");
  }
  return compatibilityError("CAPABILITY_NOT_AVAILABLE");
};

const incompatiblePlan = (requestedAction, error) => ({
  planContractVersion: PLAN_CONTRACT_VERSION,
  mode: "incompatible",
  requestedAction,
  actionAllowed: false,
  allowedActions: [],
  requiresBridge: ACTION_POLICY[requestedAction].requiresBridge,
  mayStartBridge: false,
  liveVerified: false,
  diagnostics: [error.code],
  warnings: [],
  blockingError: { ...error },
});

const mayStartBridge = (requestedAction, actionAllowed, allowedActions) =>
  actionAllowed &&
  ACTION_POLICY[requestedAction].mayStartBridge &&
  (requestedAction === "ensure" || allowedActions.includes("ensure"));

export const buildCompatibilityPlan = (input) => {
  if (
    !isRecord(input) ||
    !Object.hasOwn(ACTION_POLICY, input.requestedAction)
  ) {
    throw new Error("Unknown compatibility action.");
  }
  const requestedAction = input.requestedAction;
  if (
    !isPositiveInteger(input.skillBridgeProtocolVersion) ||
    !isPositiveInteger(input.skillSceneSchemaVersion) ||
    !isPositiveInteger(input.skillPatchSchemaVersion) ||
    !isPositiveInteger(input.skillIntentReportSchemaVersion)
  ) {
    return incompatiblePlan(
      requestedAction,
      compatibilityError("CAPABILITIES_INVALID"),
    );
  }

  const parsed = validateCapabilitiesManifest(input.doctorData);
  if (parsed.error !== undefined) {
    return incompatiblePlan(requestedAction, parsed.error);
  }
  const manifest = parsed.manifest;
  if (
    manifest.bridgeProtocolVersion !== input.skillBridgeProtocolVersion
  ) {
    return incompatiblePlan(
      requestedAction,
      compatibilityError("BRIDGE_PROTOCOL_UNSUPPORTED"),
    );
  }
  const schemas = schemaCompatibility(manifest, input);
  const allowedActions = ACTION_IDS.filter((actionId) =>
    actionIsAvailable(actionId, manifest, schemas),
  );
  const diagnostics = diagnosticsFor(manifest, schemas);
  let liveVerified = false;
  let liveAvailable = true;

  if (input.liveRequested === true) {
    if (input.healthData === undefined) {
      liveAvailable = false;
      diagnostics.push("LIVE_CAPABILITIES_UNVERIFIED");
    } else {
      const compared = compareLiveManifest(
        manifest,
        input.healthData,
        input.skillBridgeProtocolVersion,
      );
      if (compared.error !== undefined) {
        return incompatiblePlan(requestedAction, compared.error);
      }
      liveVerified = true;
    }
  }

  const actionAvailable = allowedActions.includes(requestedAction);
  const actionAllowed = actionAvailable && liveAvailable;
  const mode =
    allowedActions.length === ACTION_IDS.length && liveAvailable
      ? "compatible"
      : "degraded";

  return {
    planContractVersion: PLAN_CONTRACT_VERSION,
    mode,
    requestedAction,
    actionAllowed,
    allowedActions,
    requiresBridge: ACTION_POLICY[requestedAction].requiresBridge,
    mayStartBridge: mayStartBridge(
      requestedAction,
      actionAllowed,
      allowedActions,
    ),
    liveVerified,
    diagnostics,
    warnings: [],
    blockingError: actionAllowed
      ? null
      : actionBlockingError(requestedAction, schemas),
  };
};
