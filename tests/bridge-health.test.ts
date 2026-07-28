import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BridgeError,
  requestBridge,
  resolveBridgeConfiguration,
  stopBridge,
  type BridgeConfiguration,
  validateBridgeHealth,
} from "../cli/bridge";
import {
  getRuntimeCapabilityManifest,
  type RuntimeCapabilityManifest,
} from "../cli/runtime-capabilities";

const COMPACT_CONFIGURATION_KEYS = [
  "modelconfig",
  "modelconfiguration",
  "providerconfig",
  "serviceendpoint",
  "endpointurl",
  "credentialdiagnostics",
  "tokencount",
  "secretstatus",
  "baseurldiagnostics",
  "apikeyid",
  "authorizationheader",
  "passwordstatus",
  "bearertoken",
  "runtimemodelconfig",
  "customproviderconfig",
  "bridgeendpointurl",
  "runtimebaseurl",
  "clientapikey",
  "clienttoken",
  "customsecret",
  "runtimeauth",
  "clientkey",
  "custombearer",
  "modelName",
  "providerName",
  "endpointAddress",
  "modelId",
] as const;

const ALLOWED_COMPACT_DIAGNOSTIC_KEYS = [
  "tokenizerVersion",
  "TOKENIZERVERSION",
  "secretaryCount",
  "SECRETARYCOUNT",
  "secretionStatus",
  "SECRETIONSTATUS",
  "forbearerCount",
  "FORBEARERCOUNT",
] as const;

const FORBIDDEN_CONFIGURATION_KEYS = [
  "requiresApiKey",
  "apiKey",
  "token",
  "authorization",
  "secret",
  "credential",
  "credentials",
  "model",
  "provider",
  "baseUrl",
  "endpoint",
  "modelConfig",
  "model-config",
  "model_config",
  "providerConfig",
  "apiToken",
  "authorizationHeader",
  "credentialConfig",
  "modelProvider",
  "serviceEndpoint",
  "endpointUrl",
  "apiKeyId",
  "secretValue",
  "authHeader",
  "password",
  "bearer",
  ...COMPACT_CONFIGURATION_KEYS,
  ...COMPACT_CONFIGURATION_KEYS.map((key) => key.toUpperCase()),
] as const;

const LOCK_CAPABILITIES = {
  entityLockModes: ["none", "workflow", "user"],
  patchPolicyFields: ["preserveLock"],
  lockErrorCodes: [
    "USER_LOCKED",
    "WORKFLOW_LOCKED",
    "LOCK_PRESERVATION_CONFLICT",
  ],
} as const;
const ANATOMY_CAPABILITIES = {
  actorLimbPartIds: [
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
  ],
  actorLimbPresenceModes: ["present", "absent"],
  actorLimbErrorCodes: ["LIMB_HIERARCHY_CONFLICT"],
} as const;

type SchemaVersionField =
  | "sceneSchemaVersion"
  | "patchSchemaVersion"
  | "intentReportSchemaVersion";

const SCHEMA_PRECEDENCE_CASES: ReadonlyArray<
  readonly [string, SchemaVersionField, string, string]
> = [
  [
    "scene schema",
    "sceneSchemaVersion",
    "SCENE_SCHEMA_UNSUPPORTED",
    "The local bridge SceneSpec schema is unsupported.",
  ],
  [
    "patch schema",
    "patchSchemaVersion",
    "PATCH_SCHEMA_UNSUPPORTED",
    "The local bridge ScenePatch schema is unsupported.",
  ],
  [
    "intent schema",
    "intentReportSchemaVersion",
    "INTENT_REPORT_SCHEMA_UNSUPPORTED",
    "The local bridge IntentReport schema is unsupported.",
  ],
] as const;

const LOCK_FIELD_FAILURES: ReadonlyArray<
  readonly [string, Record<string, unknown>]
> = [
  ["missing entity lock modes", { entityLockModes: undefined }],
  ["malformed entity lock modes", { entityLockModes: "none" }],
  ["missing patch policy fields", { patchPolicyFields: undefined }],
  ["malformed patch policy fields", { patchPolicyFields: "preserveLock" }],
  ["missing lock error codes", { lockErrorCodes: undefined }],
  ["malformed lock error codes", { lockErrorCodes: "USER_LOCKED" }],
] as const;

const SCHEMA_LOCK_PRECEDENCE_CASES: ReadonlyArray<
  readonly [
    string,
    SchemaVersionField,
    Record<string, unknown>,
    string,
    string,
  ]
> = SCHEMA_PRECEDENCE_CASES.flatMap(
  ([schemaLabel, schemaField, code, message]) =>
    LOCK_FIELD_FAILURES.map(
    ([lockLabel, lockOverride]) =>
      [
        `${schemaLabel} before ${lockLabel}`,
        schemaField,
        lockOverride,
        code,
        message,
      ] as const,
    ),
);

const liveHealth = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...getRuntimeCapabilityManifest(),
  entityLockModes: [...LOCK_CAPABILITIES.entityLockModes],
  patchPolicyFields: [...LOCK_CAPABILITIES.patchPolicyFields],
  lockErrorCodes: [...LOCK_CAPABILITIES.lockErrorCodes],
  actorLimbPartIds: [...ANATOMY_CAPABILITIES.actorLimbPartIds],
  actorLimbPresenceModes: [...ANATOMY_CAPABILITIES.actorLimbPresenceModes],
  actorLimbErrorCodes: [...ANATOMY_CAPABILITIES.actorLimbErrorCodes],
  status: "ready",
  sceneId: "scene_generic_health",
  revision: 7,
  uiUrl: "http://127.0.0.1:4317",
  instanceId: "instance_0123456789abcdef0123456789abcdef",
  ...overrides,
});

const expectBridgeError = (
  action: () => unknown,
  code: string,
  message: string,
): void => {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code, message });
    return;
  }
  throw new Error(`Expected bridge error ${code}.`);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateBridgeHealth", () => {
  it("accepts additive fields and different application versions while returning the full parsed health", () => {
    const expected = {
      ...getRuntimeCapabilityManifest(),
      applicationVersion: "offline-diagnostic-version",
      bridgeProtocolVersion: 9,
      commands: [...getRuntimeCapabilityManifest().commands].reverse(),
      features: [...getRuntimeCapabilityManifest().features].reverse(),
      entityLockModes: [...LOCK_CAPABILITIES.entityLockModes].reverse(),
      patchPolicyFields: [...LOCK_CAPABILITIES.patchPolicyFields].reverse(),
      lockErrorCodes: [...LOCK_CAPABILITIES.lockErrorCodes].reverse(),
      actorLimbPartIds: [...ANATOMY_CAPABILITIES.actorLimbPartIds].reverse(),
      actorLimbPresenceModes: [
        ...ANATOMY_CAPABILITIES.actorLimbPresenceModes,
      ].reverse(),
      actorLimbErrorCodes: [...ANATOMY_CAPABILITIES.actorLimbErrorCodes],
    };
    const input = liveHealth({
      applicationVersion: "live-diagnostic-version",
      bridgeProtocolVersion: 9,
      unknownCapability: { additive: true },
      unknownLiveState: "ignored",
      diagnostics: { build: "generic" },
      modelDiagnostics: "none-loaded",
      providerStatus: "not-configured",
      endpointLatencyMs: 0,
      monkeyConfig: "generic",
      buildMetadata: { revision: "generic" },
    });

    expect(validateBridgeHealth(input, expected)).toEqual({
      service: expected.service,
      capabilitiesContractVersion:
        expected.capabilitiesContractVersion,
      applicationVersion: "live-diagnostic-version",
      bridgeProtocolVersion: 9,
      sceneSchemaVersion: expected.sceneSchemaVersion,
      patchSchemaVersion: expected.patchSchemaVersion,
      intentReportSchemaVersion: expected.intentReportSchemaVersion,
      semanticAuthority: "host",
      inputContract: "structured-only",
      modelIntegration: "none",
      credentialPolicy: "forbidden",
      networkPolicy: "loopback-only",
      commands: getRuntimeCapabilityManifest().commands,
      features: getRuntimeCapabilityManifest().features,
      entityLockModes: [...LOCK_CAPABILITIES.entityLockModes],
      patchPolicyFields: [...LOCK_CAPABILITIES.patchPolicyFields],
      lockErrorCodes: [...LOCK_CAPABILITIES.lockErrorCodes],
      actorLimbPartIds: [...ANATOMY_CAPABILITIES.actorLimbPartIds],
      actorLimbPresenceModes: [...ANATOMY_CAPABILITIES.actorLimbPresenceModes],
      actorLimbErrorCodes: [...ANATOMY_CAPABILITIES.actorLimbErrorCodes],
      status: "ready",
      sceneId: "scene_generic_health",
      revision: 7,
      uiUrl: "http://127.0.0.1:4317",
      instanceId: "instance_0123456789abcdef0123456789abcdef",
    });
  });

  it("compares the live protocol with the supplied offline manifest instead of an absolute protocol value", () => {
    const expected = {
      ...getRuntimeCapabilityManifest(),
      bridgeProtocolVersion: 14,
    };

    expect(
      validateBridgeHealth(
        liveHealth({ bridgeProtocolVersion: 14 }),
        expected,
      ).bridgeProtocolVersion,
    ).toBe(14);
  });

  it.each(ALLOWED_COMPACT_DIAGNOSTIC_KEYS)(
    "accepts neutral compact diagnostic key %s",
    (key) => {
      expect(
        validateBridgeHealth(liveHealth({ [key]: "generic" })),
      ).toMatchObject({
        status: "ready",
        sceneId: "scene_generic_health",
        revision: 7,
      });
    },
  );

  it.each([
    [null],
    [{ service: "generic-unrelated-service" }],
  ])("rejects a non-Director service identity", (input) => {
    expectBridgeError(
      () => validateBridgeHealth(input),
      "BRIDGE_IDENTITY_MISMATCH",
      "The loopback service did not identify itself as Shubi Shot Director.",
    );
  });

  it.each([
    [
      "missing contract",
      { capabilitiesContractVersion: undefined },
    ],
    [
      "different contract",
      {
        capabilitiesContractVersion:
          getRuntimeCapabilityManifest().capabilitiesContractVersion + 1,
      },
    ],
  ])("classifies an unsupported capabilities contract: %s", (_name, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      "CAPABILITIES_CONTRACT_UNSUPPORTED",
      "The local bridge capability contract is unsupported.",
    );
  });

  it.each([
    [
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "The local bridge protocol is unsupported.",
      {
        bridgeProtocolVersion:
          getRuntimeCapabilityManifest().bridgeProtocolVersion + 1,
      },
    ],
    [
      "SCENE_SCHEMA_UNSUPPORTED",
      "The local bridge SceneSpec schema is unsupported.",
      {
        sceneSchemaVersion:
          getRuntimeCapabilityManifest().sceneSchemaVersion + 1,
      },
    ],
    [
      "PATCH_SCHEMA_UNSUPPORTED",
      "The local bridge ScenePatch schema is unsupported.",
      {
        patchSchemaVersion:
          getRuntimeCapabilityManifest().patchSchemaVersion + 1,
      },
    ],
    [
      "INTENT_REPORT_SCHEMA_UNSUPPORTED",
      "The local bridge IntentReport schema is unsupported.",
      {
        intentReportSchemaVersion:
          getRuntimeCapabilityManifest().intentReportSchemaVersion + 1,
      },
    ],
  ])("returns the fixed compatibility code %s", (code, message, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      code,
      message,
    );
  });

  it.each([
    ["shot.create", "command"],
    ["shot.modify", "command"],
    ["profile.resolve", "command"],
    ["intent.strict-report", "feature"],
    ["intent.allow-partial", "feature"],
    ["profile.external-read-only", "feature"],
    ["schema.scene-authoring", "feature"],
    ["schema.patch-authoring", "feature"],
  ] as const)(
    "rejects removed %s IDs with the semantic boundary code",
    (id, kind) => {
      const manifest = getRuntimeCapabilityManifest();
      const override =
        kind === "command"
          ? { commands: [...manifest.commands, id] }
          : { features: [...manifest.features, id] };

      expectBridgeError(
        () => validateBridgeHealth(liveHealth(override)),
        "SEMANTIC_BOUNDARY_VIOLATION",
        "The local bridge violates the host semantic boundary.",
      );
    },
  );

  it.each(FORBIDDEN_CONFIGURATION_KEYS)(
    "rejects forbidden credential or model configuration key %s",
    (key) => {
      expectBridgeError(
        () => validateBridgeHealth(liveHealth({ [key]: false })),
        "SEMANTIC_BOUNDARY_VIOLATION",
        "The local bridge violates the host semantic boundary.",
      );
    },
  );

  it.each([
    ["semantic authority", { semanticAuthority: "model" }],
    ["input contract", { inputContract: "raw-text" }],
    ["model integration", { modelIntegration: "embedded" }],
    ["credential policy", { credentialPolicy: "optional" }],
    ["network policy", { networkPolicy: "public" }],
  ])("rejects an offline/live %s mismatch before mutation", (_name, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      "SEMANTIC_BOUNDARY_VIOLATION",
      "The local bridge violates the host semantic boundary.",
    );
  });

  it.each([
    ["missing semantic authority", { semanticAuthority: undefined }],
    ["non-string semantic authority", { semanticAuthority: 42 }],
    ["missing input contract", { inputContract: undefined }],
    ["non-string input contract", { inputContract: 42 }],
    ["missing model integration", { modelIntegration: undefined }],
    ["non-string model integration", { modelIntegration: 42 }],
    ["missing credential policy", { credentialPolicy: undefined }],
    ["non-string credential policy", { credentialPolicy: 42 }],
    ["missing network policy", { networkPolicy: undefined }],
    ["non-string network policy", { networkPolicy: 42 }],
  ])("classifies malformed required boundary fields as invalid: %s", (_name, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
  });

  it.each([
    ["missing entity lock modes", { entityLockModes: undefined }],
    ["missing patch policy fields", { patchPolicyFields: undefined }],
    ["missing lock error codes", { lockErrorCodes: undefined }],
    ["empty entity lock modes", { entityLockModes: [] }],
    ["duplicate patch policy fields", {
      patchPolicyFields: ["preserveLock", "preserveLock"],
    }],
    ["non-string lock error code", {
      lockErrorCodes: ["USER_LOCKED", 42],
    }],
    ["missing actor limb part ids", { actorLimbPartIds: undefined }],
    ["empty actor limb part ids", { actorLimbPartIds: [] }],
    ["duplicate actor limb presence modes", {
      actorLimbPresenceModes: ["present", "absent", "present"],
    }],
    ["non-string actor limb error code", {
      actorLimbErrorCodes: [42],
    }],
  ])("classifies malformed lock capability fields as invalid: %s", (_name, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
  });

  it.each(SCHEMA_LOCK_PRECEDENCE_CASES)(
    "uses schema precedence for %s",
    (_label, schemaField, lockOverride, code, message) => {
      const expected = getRuntimeCapabilityManifest();
      expectBridgeError(
        () =>
          validateBridgeHealth(
            liveHealth({
              ...lockOverride,
              [schemaField]:
                (expected[schemaField] as number) + 1,
            }),
          ),
        code,
        message,
      );
    },
  );

  it.each([
    [
      "boundary",
      {
        semanticAuthority: "model",
        bridgeProtocolVersion:
          getRuntimeCapabilityManifest().bridgeProtocolVersion + 1,
        sceneSchemaVersion:
          getRuntimeCapabilityManifest().sceneSchemaVersion + 1,
        entityLockModes: ["none", "workflow", "system"],
      },
      "SEMANTIC_BOUNDARY_VIOLATION",
      "The local bridge violates the host semantic boundary.",
    ],
    [
      "protocol before altered lock capabilities",
      {
        bridgeProtocolVersion:
          getRuntimeCapabilityManifest().bridgeProtocolVersion + 1,
        sceneSchemaVersion:
          getRuntimeCapabilityManifest().sceneSchemaVersion + 1,
        entityLockModes: ["none", "workflow", "system"],
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "The local bridge protocol is unsupported.",
    ],
    [
      "protocol before missing lock capabilities",
      {
        bridgeProtocolVersion:
          getRuntimeCapabilityManifest().bridgeProtocolVersion + 1,
        sceneSchemaVersion:
          getRuntimeCapabilityManifest().sceneSchemaVersion + 1,
        entityLockModes: undefined,
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "The local bridge protocol is unsupported.",
    ],
    [
      "schema before lock capabilities",
      {
        sceneSchemaVersion:
          getRuntimeCapabilityManifest().sceneSchemaVersion + 1,
        entityLockModes: ["none", "workflow", "system"],
      },
      "SCENE_SCHEMA_UNSUPPORTED",
      "The local bridge SceneSpec schema is unsupported.",
    ],
    [
      "exact lock capabilities",
      { entityLockModes: ["none", "workflow", "system"] },
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    ],
  ])(
    "uses canonical compatibility precedence for %s",
    (_name, override, code, message) => {
      expectBridgeError(
        () => validateBridgeHealth(liveHealth(override)),
        code,
        message,
      );
    },
  );

  it.each([
    [
      "removed entity lock mode",
      { entityLockModes: ["none", "workflow"] },
    ],
    [
      "altered entity lock mode",
      { entityLockModes: ["none", "workflow", "system"] },
    ],
    [
      "added entity lock mode",
      {
        entityLockModes: [
          ...LOCK_CAPABILITIES.entityLockModes,
          "temporary",
        ],
      },
    ],
    ["removed patch policy field", { patchPolicyFields: [] }],
    ["altered patch policy field", { patchPolicyFields: ["keepLock"] }],
    [
      "added patch policy field",
      {
        patchPolicyFields: [
          ...LOCK_CAPABILITIES.patchPolicyFields,
          "allowLockChange",
        ],
      },
    ],
    [
      "removed lock error code",
      {
        lockErrorCodes: LOCK_CAPABILITIES.lockErrorCodes.slice(0, -1),
      },
    ],
    [
      "altered lock error code",
      {
        lockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "ENTITY_LOCKED",
        ],
      },
    ],
    [
      "added lock error code",
      {
        lockErrorCodes: [
          ...LOCK_CAPABILITIES.lockErrorCodes,
          "UNKNOWN_LOCK",
        ],
      },
    ],
    [
      "altered actor limb part id",
      {
        actorLimbPartIds: [
          ...ANATOMY_CAPABILITIES.actorLimbPartIds.slice(0, -1),
          "toe_r",
        ],
      },
    ],
    [
      "removed actor limb presence mode",
      { actorLimbPresenceModes: ["present"] },
    ],
    [
      "altered actor limb error code",
      { actorLimbErrorCodes: ["UNKNOWN_LIMB_ERROR"] },
    ],
  ])("rejects a lock or anatomy capability set with an %s", (_name, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
  });

  it.each([
    ["malformed manifest", { applicationVersion: "" }],
    [
      "duplicate command IDs",
      {
        commands: [
          ...getRuntimeCapabilityManifest().commands,
          getRuntimeCapabilityManifest().commands[0],
        ],
      },
    ],
    [
      "different commands",
      { commands: ["doctor", "generic.unknown"] },
    ],
    [
      "different features",
      { features: ["input.intent-report.validate"] },
    ],
    ["status", { status: "starting" }],
    ["scene ID", { sceneId: 42 }],
    ["empty scene ID", { sceneId: "" }],
    ["revision", { revision: -1 }],
    ["instance ID", { instanceId: "instance_invalid" }],
    ["editor URL", { uiUrl: "http://192.0.2.1:4317" }],
  ])("classifies invalid capabilities or live state: %s", (_name, override) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth(override)),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
  });

  it("rejects a malformed expected manifest", () => {
    const malformedExpected = {
      ...getRuntimeCapabilityManifest(),
      features: ["duplicate", "duplicate"],
    } as RuntimeCapabilityManifest;

    expectBridgeError(
      () => validateBridgeHealth(liveHealth(), malformedExpected),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
  });

  it.each(["status", "sceneId", "revision", "instanceId", "uiUrl"])(
    "rejects a throwing live health %s accessor without invoking or leaking it",
    (field) => {
      const marker = `PRIVATE_LIVE_${field.toUpperCase()}_GETTER`;
      const input = liveHealth();
      let reads = 0;
      Object.defineProperty(input, field, {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error(marker);
        },
      });
      let caught: unknown;

      try {
        validateBridgeHealth(input);
      } catch (error) {
        caught = error;
      }

      expect(reads).toBe(0);
      expect(caught).toBeInstanceOf(BridgeError);
      expect(caught).toMatchObject({
        code: "CAPABILITIES_INVALID",
        message: "The local bridge capabilities are invalid.",
      });
      expect(String(caught)).not.toContain(marker);
    },
  );

  it.each(["status", "sceneId", "revision", "instanceId", "uiUrl"])(
    "redacts a throwing live health %s proxy",
    (field) => {
      const marker = `PRIVATE_LIVE_${field.toUpperCase()}_PROXY`;
      const target = liveHealth();
      const input = new Proxy(target, {
        get(current, key, receiver) {
          if (key === field) {
            throw new Error(marker);
          }
          return Reflect.get(current, key, receiver);
        },
        getOwnPropertyDescriptor(current, key) {
          if (key === field) {
            throw new Error(marker);
          }
          return Reflect.getOwnPropertyDescriptor(current, key);
        },
      });
      let caught: unknown;

      try {
        validateBridgeHealth(input);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BridgeError);
      expect(caught).toMatchObject({
        code: "CAPABILITIES_INVALID",
        message: "The local bridge capabilities are invalid.",
      });
      expect(String(caught)).not.toContain(marker);
    },
  );

  it("rejects a malformed expected contract accessor without invoking it", () => {
    const expected = {
      ...getRuntimeCapabilityManifest(),
    } as RuntimeCapabilityManifest;
    let reads = 0;
    Object.defineProperty(expected, "capabilitiesContractVersion", {
      enumerable: true,
      get() {
        reads += 1;
        return "invalid";
      },
    });

    expectBridgeError(
      () => validateBridgeHealth(liveHealth(), expected),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
    expect(reads).toBe(0);
  });

  it("rejects a malformed expected capability-list accessor without invoking it", () => {
    const expected = {
      ...getRuntimeCapabilityManifest(),
    } as RuntimeCapabilityManifest;
    let reads = 0;
    Object.defineProperty(expected, "commands", {
      enumerable: true,
      get() {
        reads += 1;
        return ["doctor"];
      },
    });

    expectBridgeError(
      () => validateBridgeHealth(liveHealth(), expected),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
    expect(reads).toBe(0);
  });

  it("redacts a throwing expected contract accessor", () => {
    const marker = "PRIVATE_EXPECTED_CONTRACT_GETTER";
    const expected = {
      ...getRuntimeCapabilityManifest(),
    } as RuntimeCapabilityManifest;
    Object.defineProperty(expected, "capabilitiesContractVersion", {
      enumerable: true,
      get() {
        throw new Error(marker);
      },
    });
    let caught: unknown;

    try {
      validateBridgeHealth(liveHealth(), expected);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BridgeError);
    expect(caught).toMatchObject({
      code: "CAPABILITIES_INVALID",
      message: "The local bridge capabilities are invalid.",
    });
    expect(String(caught)).not.toContain(marker);
  });

  it("redacts a throwing expected manifest proxy", () => {
    const marker = "PRIVATE_EXPECTED_CONTRACT_PROXY";
    const target = {
      ...getRuntimeCapabilityManifest(),
    };
    delete (
      target as Partial<RuntimeCapabilityManifest>
    ).capabilitiesContractVersion;
    const expected = new Proxy(target, {
      get(_current, key) {
        if (key === "capabilitiesContractVersion") {
          throw new Error(marker);
        }
        return Reflect.get(_current, key);
      },
      getOwnPropertyDescriptor(current, key) {
        if (key === "capabilitiesContractVersion") {
          throw new Error(marker);
        }
        return Reflect.getOwnPropertyDescriptor(current, key);
      },
    }) as RuntimeCapabilityManifest;
    let caught: unknown;

    try {
      validateBridgeHealth(liveHealth(), expected);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BridgeError);
    expect(caught).toMatchObject({
      code: "CAPABILITIES_INVALID",
      message: "The local bridge capabilities are invalid.",
    });
    expect(String(caught)).not.toContain(marker);
  });

  it("validates and returns one stable snapshot of a stateful live proxy", () => {
    const target = liveHealth();
    let validationPhase = 0;
    let sceneDescriptorReads = 0;
    const input = new Proxy(target, {
      getPrototypeOf(current) {
        validationPhase += 1;
        return Reflect.getPrototypeOf(current);
      },
      get(current, key, receiver) {
        if (key === "bridgeProtocolVersion") {
          return validationPhase <= 1 ? 1 : 999;
        }
        return Reflect.get(current, key, receiver);
      },
      getOwnPropertyDescriptor(current, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(
          current,
          key,
        );
        if (
          key !== "sceneId" ||
          descriptor === undefined ||
          !("value" in descriptor)
        ) {
          return descriptor;
        }
        sceneDescriptorReads += 1;
        return {
          ...descriptor,
          value:
            sceneDescriptorReads === 1
              ? "scene_snapshot"
              : "scene_late_read",
        };
      },
    });

    expect(validateBridgeHealth(input)).toMatchObject({
      bridgeProtocolVersion: 1,
      sceneId: "scene_snapshot",
    });
  });

  it("snapshots a nested stateful capability array before validation", () => {
    const canonicalModes = [...LOCK_CAPABILITIES.entityLockModes];
    const alteredModes = ["none", "workflow", "system"];
    let iterations = 0;
    const statefulModes = new Proxy(canonicalModes, {
      get(current, key, receiver) {
        if (key === Symbol.iterator) {
          iterations += 1;
          const values =
            iterations === 1 ? canonicalModes : alteredModes;
          return values[Symbol.iterator].bind(values);
        }
        return Reflect.get(current, key, receiver);
      },
    });

    expect(
      validateBridgeHealth(
        liveHealth({ entityLockModes: statefulModes }),
      ).entityLockModes,
    ).toEqual(canonicalModes);
  });

  it.each([
    [
      "input",
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "PRIVATE_KNOWN_INPUT_MESSAGE",
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "The local bridge protocol is unsupported.",
    ],
    [
      "expected",
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "PRIVATE_KNOWN_EXPECTED_MESSAGE",
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "The local bridge protocol is unsupported.",
    ],
    [
      "input",
      "PRIVATE_INPUT_CODE",
      "PRIVATE_UNKNOWN_INPUT_MESSAGE",
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    ],
    [
      "expected",
      "PRIVATE_EXPECTED_CODE",
      "PRIVATE_UNKNOWN_EXPECTED_MESSAGE",
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    ],
  ] as const)(
    "canonicalizes a forged BridgeError from the %s path",
    (source, forgedCode, marker, code, message) => {
      const forged = new BridgeError(forgedCode, marker);
      const target =
        source === "input"
          ? liveHealth()
          : { ...getRuntimeCapabilityManifest() };
      const trappedField =
        source === "input"
          ? "service"
          : "capabilitiesContractVersion";
      const proxy = new Proxy(target, {
        getOwnPropertyDescriptor(current, key) {
          if (key === trappedField) {
            throw forged;
          }
          return Reflect.getOwnPropertyDescriptor(current, key);
        },
      });
      let caught: unknown;

      try {
        if (source === "input") {
          validateBridgeHealth(proxy);
        } else {
          validateBridgeHealth(
            liveHealth(),
            proxy as unknown as RuntimeCapabilityManifest,
          );
        }
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BridgeError);
      expect(caught).toMatchObject({ code, message });
      expect(String(caught)).not.toContain(marker);
      expect((caught as BridgeError).code).not.toContain("PRIVATE");
    },
  );

  it("compares reordered capability sets without mutating callers", () => {
    const expected = {
      ...getRuntimeCapabilityManifest(),
      commands: [...getRuntimeCapabilityManifest().commands].reverse(),
      features: [...getRuntimeCapabilityManifest().features].reverse(),
      entityLockModes: [...LOCK_CAPABILITIES.entityLockModes].reverse(),
      patchPolicyFields: [...LOCK_CAPABILITIES.patchPolicyFields],
      lockErrorCodes: [...LOCK_CAPABILITIES.lockErrorCodes].reverse(),
    };
    const input = liveHealth({
      commands: [...getRuntimeCapabilityManifest().commands].reverse(),
      features: [...getRuntimeCapabilityManifest().features].reverse(),
      entityLockModes: [...LOCK_CAPABILITIES.entityLockModes].reverse(),
      patchPolicyFields: [...LOCK_CAPABILITIES.patchPolicyFields],
      lockErrorCodes: [...LOCK_CAPABILITIES.lockErrorCodes].reverse(),
    });
    const inputArrays = {
      commands: [...(input.commands as string[])],
      features: [...(input.features as string[])],
      entityLockModes: [...(input.entityLockModes as string[])],
      patchPolicyFields: [...(input.patchPolicyFields as string[])],
      lockErrorCodes: [...(input.lockErrorCodes as string[])],
    };
    const expectedArrays = {
      commands: [...expected.commands],
      features: [...expected.features],
      entityLockModes: [...expected.entityLockModes],
      patchPolicyFields: [...expected.patchPolicyFields],
      lockErrorCodes: [...expected.lockErrorCodes],
    };

    validateBridgeHealth(input, expected);

    expect(input).toMatchObject(inputArrays);
    expect(expected).toMatchObject(expectedArrays);
  });

  it.each([
    "http://127.0.0.0:4317",
    "http://127.0.0.1:4317",
    "http://127.1.2.3:4317",
    "http://127.255.255.255:65535",
    "http://[::1]:4317",
  ])("accepts numeric loopback health origin %s", (uiUrl) => {
    expect(validateBridgeHealth(liveHealth({ uiUrl })).uiUrl).toBe(uiUrl);
  });

  it.each([
    ["http://127.0.0.1:4317/", "http://127.0.0.1:4317"],
    ["http://[::1]:4317/", "http://[::1]:4317"],
  ] as const)("accepts exact root health origin %s", (uiUrl, expected) => {
    expect(validateBridgeHealth(liveHealth({ uiUrl })).uiUrl).toBe(expected);
  });

  it.each([
    "http://126.255.255.255:4317",
    "http://128.0.0.1:4317",
    "http://localhost:4317",
    "http://director.example.test:4317",
    "https://127.0.0.1:4317",
    "http://user@127.0.0.1:4317",
    "http://127.0.0.1:4317/editor",
    "http://127.0.0.1:4317/?view=editor",
    "http://127.0.0.1:4317/#editor",
    "http://127.1:4317",
    "http://127.0.0.1",
    "http://[::1]",
    "http://127.0.0.1:4317/.",
    "http://127.0.0.1:4317/..",
    "http://127.0.0.1:4317/%2e",
    "http://127.0.0.1:4317/%2e%2e",
    "http://127.0.0.1:4317/%2E%2E/",
    "http://127.0.0.1:4317/%2F",
    "http://127.0.0.1:4317//",
    "http://127.0.0.1:0",
    "http://127.0.0.1:04317",
  ])("rejects non-origin or non-numeric-loopback health URL %s", (uiUrl) => {
    expectBridgeError(
      () => validateBridgeHealth(liveHealth({ uiUrl })),
      "CAPABILITIES_INVALID",
      "The local bridge capabilities are invalid.",
    );
  });
});

describe("requestBridge", () => {
  it.each([
    ["USER_LOCKED", "A requested scene entity is user-locked."],
    [
      "WORKFLOW_LOCKED",
      "A requested scene entity is workflow-locked.",
    ],
    [
      "LOCK_PRESERVATION_CONFLICT",
      "The requested change conflicts with lock preservation.",
    ],
  ] as const)(
    "redacts an upstream %s message",
    async (code, message) => {
      const marker = `PRIVATE_${code}_UPSTREAM_MARKER`;
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code, message: marker },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const configuration = resolveBridgeConfiguration({
        SHUBI_SHOT_URL: "http://127.0.0.1:4317",
      });
      let caught: unknown;

      try {
        await requestBridge(configuration, "/api/v1/patch", {
          method: "POST",
          body: "{}",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        name: "BridgeError",
        code,
        message,
      });
      expect(String(caught)).not.toContain(marker);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
});

describe("stopBridge", () => {
  it("safely stops an owned bridge whose scene schemas are older", async () => {
    const manifest = getRuntimeCapabilityManifest();
    const instanceId = "instance_0123456789abcdef0123456789abcdef";
    const oldHealth = liveHealth({
      sceneSchemaVersion: manifest.sceneSchemaVersion - 1,
      patchSchemaVersion: manifest.patchSchemaVersion - 1,
      intentReportSchemaVersion: manifest.intentReportSchemaVersion - 1,
      instanceId,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: oldHealth }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: { service: manifest.service, status: "stopping", instanceId },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockRejectedValueOnce(new TypeError("Bridge stopped."));
    vi.stubGlobal("fetch", fetchMock);
    const configuration = resolveBridgeConfiguration({
      SHUBI_SHOT_URL: "http://127.0.0.1:4317",
    });

    await expect(stopBridge(configuration)).resolves.toEqual({
      stopped: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "http://127.0.0.1:4317/api/v1/shutdown",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "X-Shubi-Shot-Instance": instanceId,
      }),
    });
  });
});

describe("resolveBridgeConfiguration", () => {
  it.each([
    ["http://127.0.0.0:4317", "http://127.0.0.0:4317", 4317],
    ["http://127.0.0.1:4317", "http://127.0.0.1:4317", 4317],
    ["http://127.1.2.3:4318", "http://127.1.2.3:4318", 4318],
    [
      "http://127.255.255.255:65535",
      "http://127.255.255.255:65535",
      65535,
    ],
    ["http://[::1]:4319", "http://[::1]:4319", 4319],
  ] as const)(
    "accepts numeric loopback origin %s",
    (configuredUrl, expectedOrigin, expectedPort) => {
      const configuration = resolveBridgeConfiguration({
        SHUBI_SHOT_URL: configuredUrl,
      });

      expect(configuration.baseUrl.origin).toBe(expectedOrigin);
      expect(configuration.port).toBe(expectedPort);
    },
  );

  it.each([
    "http://127.0.0.1:4317",
    "http://127.0.0.1:4317/",
    "http://[::1]:4317",
    "http://[::1]:4317/",
  ])("retains the exact validated origin source %s", (configuredUrl) => {
    const configuration = resolveBridgeConfiguration({
      SHUBI_SHOT_URL: configuredUrl,
    });

    expect(configuration.originSource).toBe(configuredUrl);
  });

  it.each([
    ["http://127.0.0.1:4317/", "http://127.0.0.1:4317"],
    ["http://[::1]:4317/", "http://[::1]:4317"],
  ] as const)(
    "accepts exact root bridge origin %s",
    (configuredUrl, expectedOrigin) => {
      expect(
        resolveBridgeConfiguration({ SHUBI_SHOT_URL: configuredUrl })
          .baseUrl.origin,
      ).toBe(expectedOrigin);
    },
  );

  it.each([
    "http://126.255.255.255:4317",
    "http://128.0.0.1:4317",
    "http://localhost:4317",
    "http://director.example.test:4317",
    "https://127.0.0.1:4317",
    "http://user:pass@127.0.0.1:4317",
    "http://127.0.0.1:4317/editor",
    "http://127.0.0.1:4317/?view=editor",
    "http://127.0.0.1:4317/#editor",
    "http://127.1:4317",
    "http://0177.0.0.1:4317",
    "http://127.0.0.1",
    "http://[::1]",
    "http://127.0.0.1:4317/.",
    "http://127.0.0.1:4317/..",
    "http://127.0.0.1:4317/%2e",
    "http://127.0.0.1:4317/%2e%2e",
    "http://127.0.0.1:4317/%2E%2E/",
    "http://127.0.0.1:4317/%2F",
    "http://127.0.0.1:4317//",
    "http://127.0.0.1:0",
    "http://127.0.0.1:04317",
  ])("rejects bridge escape URL %s before use", (configuredUrl) => {
    expectBridgeError(
      () =>
        resolveBridgeConfiguration({
          SHUBI_SHOT_URL: configuredUrl,
        }),
      "BRIDGE_URL_NOT_LOOPBACK",
      "The bridge URL must be an uncredentialed loopback HTTP origin.",
    );
  });

  it.each([
    [
      "remote configuration",
      {
        baseUrl: new URL("http://192.0.2.1:4317"),
        port: 4317,
      },
      "/api/v1/health",
    ],
    [
      "absolute remote pathname",
      {
        baseUrl: new URL("http://127.0.0.1:4317"),
        port: 4317,
      },
      "http://192.0.2.1:4317/api/v1/health",
    ],
    [
      "protocol-relative remote pathname",
      {
        baseUrl: new URL("http://127.0.0.1:4317"),
        port: 4317,
      },
      "//192.0.2.1:4317/api/v1/health",
    ],
    [
      "configuration without origin provenance",
      {
        baseUrl: new URL("http://127.0.0.1"),
        port: 80,
      },
      "/api/v1/health",
    ],
    [
      "normalized encoded-path configuration without provenance",
      {
        baseUrl: new URL("http://127.0.0.1:4317/%2e"),
        port: 4317,
      },
      "/api/v1/health",
    ],
    [
      "mismatched origin provenance",
      {
        baseUrl: new URL("http://127.0.0.1:4317"),
        port: 4317,
        originSource: "http://127.0.0.2:4317",
      },
      "/api/v1/health",
    ],
    [
      "mismatched port provenance",
      {
        baseUrl: new URL("http://127.0.0.1:4317"),
        port: 4317,
        originSource: "http://127.0.0.1:4318",
      },
      "/api/v1/health",
    ],
    [
      "encoded-path origin provenance",
      {
        baseUrl: new URL("http://127.0.0.1:4317/%2e"),
        port: 4317,
        originSource: "http://127.0.0.1:4317/%2e",
      },
      "/api/v1/health",
    ],
  ] as const)(
    "rejects %s before fetch",
    async (_label, configuration, pathname) => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        requestBridge(
          configuration as unknown as BridgeConfiguration,
          pathname,
        ),
      ).rejects.toMatchObject({
        code: "BRIDGE_URL_NOT_LOOPBACK",
        message:
          "The bridge URL must be an uncredentialed loopback HTTP origin.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
