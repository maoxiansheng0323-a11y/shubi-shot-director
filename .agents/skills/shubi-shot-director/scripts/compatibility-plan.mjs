export const PLAN_CONTRACT_VERSION = 2;

const RUNTIME_SERVICE = "shubi-shot-director";
const CAPABILITIES_CONTRACT_VERSION = 2;
const WORKSPACE_ROUTING_VERSION = 1;
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
  "blueprint.validate": policy("blueprint.validate"),
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
  "bridge.thread-workspaces",
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
  "actor.limb-presence",
  "actor.height",
  "actor.pose-joints",
  "actor.blueprint-instance-limb-overrides",
]);
const ENTITY_LOCK_MODES = Object.freeze(["none", "workflow", "user"]);
const PATCH_POLICY_FIELDS = Object.freeze(["preserveLock"]);
const LOCK_ERROR_CODES = Object.freeze([
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
]);
const ACTOR_LIMB_PART_IDS = Object.freeze([
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
const ACTOR_LIMB_PRESENCE_MODES = Object.freeze([
  "present",
  "absent",
]);
const ACTOR_LIMB_ERROR_CODES = Object.freeze([
  "LIMB_HIERARCHY_CONFLICT",
]);
const ACTOR_PUPPET = Object.freeze({
  heightLimitsM: Object.freeze({ min: 1, max: 2.4 }),
  jointIds: Object.freeze([
    "pelvis", "spine", "neck", "upper_arm_l", "forearm_l", "hand_l",
    "upper_arm_r", "forearm_r", "hand_r", "upper_leg_l", "lower_leg_l",
    "foot_l", "upper_leg_r", "lower_leg_r", "foot_r",
  ]),
  operationIds: Object.freeze([
    "actor.height.set",
    "actor.pose.joints.set",
  ]),
  errorCodes: Object.freeze([
    "ACTOR_HEIGHT_TARGET_INVALID",
    "ACTOR_HEIGHT_RANGE_INVALID",
    "ACTOR_JOINT_TARGET_INVALID",
    "ACTOR_JOINT_ID_INVALID",
  ]),
});
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
const plainOwnRecord = (value) => {
  if (!isRecord(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value
    : undefined;
};
const hasOwnDataProperty = (input, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor !== undefined && "value" in descriptor;
};
const snapshotOwnDataRecord = (input) => {
  try {
    const snapshots = new WeakMap();
    const visit = (value) => {
      if (typeof value !== "object" || value === null) {
        return value;
      }
      const existing = snapshots.get(value);
      if (existing !== undefined) {
        return existing;
      }
      const isArray = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (
        (isArray && prototype !== Array.prototype) ||
        (!isArray &&
          prototype !== Object.prototype &&
          prototype !== null)
      ) {
        throw new Error("Invalid capability snapshot.");
      }
      const descriptors = new Map();
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new Error("Invalid capability snapshot.");
        }
        descriptors.set(key, descriptor);
      }

      const snapshot = isArray
        ? []
        : Object.create(
            prototype === null ? null : Object.prototype,
          );
      snapshots.set(value, snapshot);
      for (const [key, descriptor] of descriptors) {
        if (isArray && key === "length") {
          continue;
        }
        Object.defineProperty(snapshot, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          value: visit(descriptor.value),
          writable: true,
        });
      }
      if (isArray) {
        const lengthDescriptor = descriptors.get("length");
        if (
          lengthDescriptor === undefined ||
          typeof lengthDescriptor.value !== "number"
        ) {
          throw new Error("Invalid capability snapshot.");
        }
        Object.defineProperty(snapshot, "length", {
          value: lengthDescriptor.value,
          writable: true,
        });
      }
      return snapshot;
    };

    const snapshot = visit(input);
    return plainOwnRecord(snapshot);
  } catch {
    return undefined;
  }
};
const isPositiveInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const isUniqueStringArray = (value) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;
const isNonEmptyUniqueStringArray = (value) =>
  isUniqueStringArray(value) &&
  value.length > 0 &&
  value.every((item) => item.trim().length > 0);
const stringSetsEqual = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((value) => right.includes(value));
const actorBlueprintSnapshot = (value) => {
  const record = plainOwnRecord(value);
  if (
    record === undefined ||
    Object.keys(record).length !== 5 ||
    !isPositiveInteger(record.schemaVersion) ||
    !isNonEmptyUniqueStringArray(record.mounts) ||
    !isNonEmptyUniqueStringArray(record.primitives) ||
    !isNonEmptyUniqueStringArray(record.variantDeltaFields) ||
    !isNonEmptyUniqueStringArray(record.errorCodes)
  ) {
    return undefined;
  }
  return {
    schemaVersion: record.schemaVersion,
    mounts: [...record.mounts],
    primitives: [...record.primitives],
    variantDeltaFields: [...record.variantDeltaFields],
    errorCodes: [...record.errorCodes],
  };
};
const actorBlueprintsEqual = (left, right) =>
  left?.schemaVersion === right?.schemaVersion &&
  stringSetsEqual(left?.mounts, right?.mounts) &&
  stringSetsEqual(left?.primitives, right?.primitives) &&
  stringSetsEqual(
    left?.variantDeltaFields,
    right?.variantDeltaFields,
  ) &&
  stringSetsEqual(left?.errorCodes, right?.errorCodes);
const actorPuppetSnapshot = (value) => {
  const record = plainOwnRecord(value);
  const heightLimitsM = plainOwnRecord(record?.heightLimitsM);
  if (
    record === undefined ||
    Object.keys(record).length !== 4 ||
    heightLimitsM === undefined ||
    Object.keys(heightLimitsM).length !== 2 ||
    heightLimitsM.min !== ACTOR_PUPPET.heightLimitsM.min ||
    heightLimitsM.max !== ACTOR_PUPPET.heightLimitsM.max ||
    !isNonEmptyUniqueStringArray(record.jointIds) ||
    !isNonEmptyUniqueStringArray(record.operationIds) ||
    !isNonEmptyUniqueStringArray(record.errorCodes) ||
    !stringSetsEqual(record.jointIds, ACTOR_PUPPET.jointIds) ||
    !stringSetsEqual(record.operationIds, ACTOR_PUPPET.operationIds) ||
    !stringSetsEqual(record.errorCodes, ACTOR_PUPPET.errorCodes)
  ) {
    return undefined;
  }
  return {
    heightLimitsM: { ...heightLimitsM },
    jointIds: [...record.jointIds],
    operationIds: [...record.operationIds],
    errorCodes: [...record.errorCodes],
  };
};
const actorPuppetsEqual = (left, right) =>
  left?.heightLimitsM?.min === right?.heightLimitsM?.min &&
  left?.heightLimitsM?.max === right?.heightLimitsM?.max &&
  stringSetsEqual(left?.jointIds, right?.jointIds) &&
  stringSetsEqual(left?.operationIds, right?.operationIds) &&
  stringSetsEqual(left?.errorCodes, right?.errorCodes);

const MANIFEST_ROOT_KEYS = new Set([
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
]);
const MANIFEST_REQUIRED_FIELDS = Object.freeze([
  ...MANIFEST_ROOT_KEYS,
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

const inspectCapabilitiesBoundary = (input) => {
  try {
    const record = plainOwnRecord(input);
    if (record === undefined) {
      return invalid("CAPABILITIES_INVALID");
    }
    const contractDescriptor = Object.getOwnPropertyDescriptor(
      record,
      "capabilitiesContractVersion",
    );
    const contractVersion =
      contractDescriptor !== undefined && "value" in contractDescriptor
        ? contractDescriptor.value
        : undefined;
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
      hasSensitiveConfiguration(record) ||
      includesRemovedId(record.commands, REMOVED_COMMAND_IDS) ||
      includesRemovedId(record.features, REMOVED_FEATURE_IDS)
    ) {
      return invalid("SEMANTIC_BOUNDARY_VIOLATION");
    }
    const headerFields = [
      "service",
      "bridgeProtocolVersion",
      "workspaceRoutingVersion",
      "sceneSchemaVersion",
      "patchSchemaVersion",
      "intentReportSchemaVersion",
      ...Object.keys(EXPECTED_BOUNDARY),
    ];
    if (!headerFields.every((field) => hasOwnDataProperty(record, field))) {
      return invalid("CAPABILITIES_INVALID");
    }
    if (record.service !== RUNTIME_SERVICE) {
      return invalid("BRIDGE_IDENTITY_MISMATCH");
    }
    if (
      !isPositiveInteger(record.bridgeProtocolVersion) ||
      record.workspaceRoutingVersion !== WORKSPACE_ROUTING_VERSION ||
      !isPositiveInteger(record.sceneSchemaVersion) ||
      !isPositiveInteger(record.patchSchemaVersion) ||
      !isPositiveInteger(record.intentReportSchemaVersion) ||
      Object.keys(EXPECTED_BOUNDARY).some(
        (field) => typeof record[field] !== "string",
      )
    ) {
      return invalid("CAPABILITIES_INVALID");
    }
    if (
      Object.entries(EXPECTED_BOUNDARY).some(
        ([field, expected]) => record[field] !== expected,
      )
    ) {
      return invalid("SEMANTIC_BOUNDARY_VIOLATION");
    }
    return {
      record,
      header: {
        capabilitiesContractVersion: contractVersion,
        bridgeProtocolVersion: record.bridgeProtocolVersion,
        workspaceRoutingVersion: WORKSPACE_ROUTING_VERSION,
        sceneSchemaVersion: record.sceneSchemaVersion,
        patchSchemaVersion: record.patchSchemaVersion,
        intentReportSchemaVersion: record.intentReportSchemaVersion,
      },
    };
  } catch {
    return invalid("CAPABILITIES_INVALID");
  }
};

const validateCapabilitiesSnapshot = (input) => {
  const inspected = inspectCapabilitiesBoundary(input);
  if (inspected.error !== undefined) {
    return inspected;
  }
  const record = inspected.record;
  try {
    const actorBlueprint = actorBlueprintSnapshot(
      record.actorBlueprint,
    );
    const actorPuppet = actorPuppetSnapshot(record.actorPuppet);
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
      actorPuppet === undefined ||
      actorBlueprint === undefined
    ) {
      return invalid("CAPABILITIES_INVALID");
    }
    return {
      manifest: {
        service: RUNTIME_SERVICE,
        capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
        applicationVersion: record.applicationVersion,
        bridgeProtocolVersion: record.bridgeProtocolVersion,
        workspaceRoutingVersion: WORKSPACE_ROUTING_VERSION,
        sceneSchemaVersion: record.sceneSchemaVersion,
        patchSchemaVersion: record.patchSchemaVersion,
        intentReportSchemaVersion: record.intentReportSchemaVersion,
        ...EXPECTED_BOUNDARY,
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
      },
    };
  } catch {
    return invalid("CAPABILITIES_INVALID");
  }
};

export const validateCapabilitiesManifest = (input) => {
  const snapshot = snapshotOwnDataRecord(input);
  return snapshot === undefined
    ? invalid("CAPABILITIES_INVALID")
    : validateCapabilitiesSnapshot(snapshot);
};

const compareLiveManifest = (
  offline,
  input,
  skillBridgeProtocolVersion,
  skillWorkspaceRoutingVersion,
) => {
  const inspected = inspectCapabilitiesBoundary(input);
  if (inspected.error !== undefined) {
    return inspected;
  }
  const liveHeader = inspected.header;
  if (
    liveHeader.bridgeProtocolVersion !== offline.bridgeProtocolVersion ||
    liveHeader.bridgeProtocolVersion !== skillBridgeProtocolVersion
  ) {
    return invalid("BRIDGE_PROTOCOL_UNSUPPORTED");
  }
  if (
    liveHeader.workspaceRoutingVersion !==
      offline.workspaceRoutingVersion ||
    liveHeader.workspaceRoutingVersion !== skillWorkspaceRoutingVersion
  ) {
    return invalid("CAPABILITIES_INVALID");
  }
  if (liveHeader.sceneSchemaVersion !== offline.sceneSchemaVersion) {
    return invalid("SCENE_SCHEMA_UNSUPPORTED");
  }
  if (liveHeader.patchSchemaVersion !== offline.patchSchemaVersion) {
    return invalid("PATCH_SCHEMA_UNSUPPORTED");
  }
  if (
    liveHeader.intentReportSchemaVersion !==
    offline.intentReportSchemaVersion
  ) {
    return invalid("INTENT_REPORT_SCHEMA_UNSUPPORTED");
  }
  const parsed = validateCapabilitiesSnapshot(input);
  if (parsed.error !== undefined) {
    return parsed;
  }
  const live = parsed.manifest;
  if (
    !stringSetsEqual(live.commands, offline.commands) ||
    !stringSetsEqual(live.features, offline.features) ||
    !stringSetsEqual(
      live.entityLockModes,
      offline.entityLockModes,
    ) ||
    !stringSetsEqual(
      live.patchPolicyFields,
      offline.patchPolicyFields,
    ) ||
    !stringSetsEqual(live.lockErrorCodes, offline.lockErrorCodes) ||
    !stringSetsEqual(live.actorLimbPartIds, offline.actorLimbPartIds) ||
    !stringSetsEqual(
      live.actorLimbPresenceModes,
      offline.actorLimbPresenceModes,
    ) ||
    !stringSetsEqual(live.actorLimbErrorCodes, offline.actorLimbErrorCodes) ||
    !actorPuppetsEqual(live.actorPuppet, offline.actorPuppet) ||
    !actorBlueprintsEqual(
      live.actorBlueprint,
      offline.actorBlueprint,
    )
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

const schemaBlockingError = (requestedAction, schemas) => {
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
  return null;
};
const firstSchemaCompatibilityError = (schemas) => {
  if (!schemas.scene) {
    return compatibilityError("SCENE_SCHEMA_UNSUPPORTED");
  }
  if (!schemas.patch) {
    return compatibilityError("PATCH_SCHEMA_UNSUPPORTED");
  }
  if (!schemas.intent) {
    return compatibilityError("INTENT_REPORT_SCHEMA_UNSUPPORTED");
  }
  return null;
};
const actionBlockingError = (requestedAction, schemas) =>
  schemaBlockingError(requestedAction, schemas) ??
  compatibilityError("CAPABILITY_NOT_AVAILABLE");

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
    input.skillWorkspaceRoutingVersion !==
      WORKSPACE_ROUTING_VERSION ||
    !isPositiveInteger(input.skillSceneSchemaVersion) ||
    !isPositiveInteger(input.skillPatchSchemaVersion) ||
    !isPositiveInteger(input.skillIntentReportSchemaVersion) ||
    !isNonEmptyUniqueStringArray(input.skillEntityLockModes) ||
    !isNonEmptyUniqueStringArray(input.skillPatchPolicyFields) ||
    !isNonEmptyUniqueStringArray(input.skillLockErrorCodes) ||
    !isNonEmptyUniqueStringArray(input.skillActorLimbPartIds) ||
    !isNonEmptyUniqueStringArray(input.skillActorLimbPresenceModes) ||
    !isNonEmptyUniqueStringArray(input.skillActorLimbErrorCodes) ||
    !actorPuppetsEqual(input.skillActorPuppet, ACTOR_PUPPET) ||
    !stringSetsEqual(input.skillEntityLockModes, ENTITY_LOCK_MODES) ||
    !stringSetsEqual(
      input.skillPatchPolicyFields,
      PATCH_POLICY_FIELDS,
    ) ||
    !stringSetsEqual(input.skillLockErrorCodes, LOCK_ERROR_CODES) ||
    !stringSetsEqual(input.skillActorLimbPartIds, ACTOR_LIMB_PART_IDS) ||
    !stringSetsEqual(
      input.skillActorLimbPresenceModes,
      ACTOR_LIMB_PRESENCE_MODES,
    ) ||
    !stringSetsEqual(
      input.skillActorLimbErrorCodes,
      ACTOR_LIMB_ERROR_CODES,
    )
  ) {
    return incompatiblePlan(
      requestedAction,
      compatibilityError("CAPABILITIES_INVALID"),
    );
  }

  const doctorData = snapshotOwnDataRecord(input.doctorData);
  if (doctorData === undefined) {
    return incompatiblePlan(
      requestedAction,
      compatibilityError("CAPABILITIES_INVALID"),
    );
  }
  const inspected = inspectCapabilitiesBoundary(doctorData);
  if (inspected.error !== undefined) {
    return incompatiblePlan(requestedAction, inspected.error);
  }
  if (
    inspected.header.bridgeProtocolVersion !==
    input.skillBridgeProtocolVersion
  ) {
    return incompatiblePlan(
      requestedAction,
      compatibilityError("BRIDGE_PROTOCOL_UNSUPPORTED"),
    );
  }
  if (
    inspected.header.workspaceRoutingVersion !==
    input.skillWorkspaceRoutingVersion
  ) {
    return incompatiblePlan(
      requestedAction,
      compatibilityError("CAPABILITIES_INVALID"),
    );
  }
  const schemas = schemaCompatibility(inspected.header, input);
  const firstSchemaError = firstSchemaCompatibilityError(schemas);
  const parsed = validateCapabilitiesSnapshot(doctorData);
  if (parsed.error !== undefined) {
    return incompatiblePlan(
      requestedAction,
      firstSchemaError ?? parsed.error,
    );
  }
  const manifest = parsed.manifest;
  if (
    !stringSetsEqual(
      manifest.entityLockModes,
      input.skillEntityLockModes,
    ) ||
      !stringSetsEqual(
        manifest.patchPolicyFields,
        input.skillPatchPolicyFields,
      ) ||
      !stringSetsEqual(
        manifest.lockErrorCodes,
        input.skillLockErrorCodes,
      ) ||
      !stringSetsEqual(
        manifest.actorLimbPartIds,
        input.skillActorLimbPartIds,
      ) ||
      !stringSetsEqual(
        manifest.actorLimbPresenceModes,
        input.skillActorLimbPresenceModes,
      ) ||
      !stringSetsEqual(
        manifest.actorLimbErrorCodes,
        input.skillActorLimbErrorCodes,
      ) ||
      !actorPuppetsEqual(
        manifest.actorPuppet,
        input.skillActorPuppet,
      ) ||
      !actorBlueprintsEqual(
        manifest.actorBlueprint,
        input.skillActorBlueprint,
      )
  ) {
    return incompatiblePlan(
      requestedAction,
      firstSchemaError ??
        compatibilityError("CAPABILITIES_INVALID"),
    );
  }
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
      const healthData = snapshotOwnDataRecord(input.healthData);
      if (healthData === undefined) {
        return incompatiblePlan(
          requestedAction,
          compatibilityError("CAPABILITIES_INVALID"),
        );
      }
      const compared = compareLiveManifest(
        manifest,
        healthData,
        input.skillBridgeProtocolVersion,
        input.skillWorkspaceRoutingVersion,
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
