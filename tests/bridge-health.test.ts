import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BridgeError,
  requestBridge,
  resolveBridgeConfiguration,
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

const liveHealth = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...getRuntimeCapabilityManifest(),
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
