import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_VERSION,
  loadApplicationVersion,
  parseApplicationVersion,
} from "../cli/application-metadata";
import * as runtimeCapabilities from "../cli/runtime-capabilities";
import {
  CAPABILITIES_CONTRACT_VERSION,
  CLI_COMMAND_DEFINITIONS,
  CLI_HELP_COMMANDS,
  RUNTIME_FEATURE_IDS,
  getRuntimeCapabilityManifest,
  parseRuntimeCapabilityManifest,
} from "../cli/runtime-capabilities";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";

const EXPECTED_COMMAND_IDS = [
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
] as const;

const EXPECTED_FEATURE_IDS = [
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
] as const;

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
  "API_KEY",
  "token",
  "authorization",
  "secret",
  "credential",
  "credentials",
  "model",
  "provider",
  "baseUrl",
  "BASE-URL",
  "endpoint",
  "END_POINT",
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

const expectCapabilityError = (
  action: () => unknown,
  code: "CAPABILITIES_INVALID" | "SEMANTIC_BOUNDARY_VIOLATION",
): void => {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({
      name: "RuntimeCapabilityError",
      code,
      message: expect.any(String),
    });
    return;
  }
  throw new Error(`Expected runtime capability error ${code}.`);
};

describe("runtime capability manifest", () => {
  it("uses package metadata and shared contract versions", async () => {
    const packageMetadata = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const manifest = getRuntimeCapabilityManifest();

    expect(APPLICATION_VERSION).toBe(packageMetadata.version);
    expect(runtimeCapabilities).toMatchObject({
      CAPABILITIES_CONTRACT_VERSION: 2,
      INTENT_REPORT_SCHEMA_VERSION: 1,
      SEMANTIC_AUTHORITY: "host",
      INPUT_CONTRACT: "structured-only",
      MODEL_INTEGRATION: "none",
      CREDENTIAL_POLICY: "forbidden",
      NETWORK_POLICY: "loopback-only",
      RuntimeCapabilityError: expect.any(Function),
    });
    expect(manifest).toMatchObject({
      service: "shubi-shot-director",
      capabilitiesContractVersion: 2,
      applicationVersion: packageMetadata.version,
      bridgeProtocolVersion: 1,
      sceneSchemaVersion: SCENE_SCHEMA_VERSION,
      patchSchemaVersion: PATCH_SCHEMA_VERSION,
      intentReportSchemaVersion: 1,
      semanticAuthority: "host",
      inputContract: "structured-only",
      modelIntegration: "none",
      credentialPolicy: "forbidden",
      networkPolicy: "loopback-only",
    });
    expect(CAPABILITIES_CONTRACT_VERSION).toBe(2);
    expect(manifest).not.toHaveProperty("requiresApiKey");
  });

  it("publishes unique stable command and feature ids", () => {
    const manifest = getRuntimeCapabilityManifest();

    expect(new Set(manifest.commands).size).toBe(manifest.commands.length);
    expect(new Set(manifest.features).size).toBe(manifest.features.length);
    expect(manifest.commands).toEqual([...EXPECTED_COMMAND_IDS]);
    expect(CLI_COMMAND_DEFINITIONS.map(({ id }) => id)).toEqual([
      ...EXPECTED_COMMAND_IDS,
    ]);
    expect(CLI_HELP_COMMANDS).toEqual(
      CLI_COMMAND_DEFINITIONS.map(({ usage }) => usage),
    );
    expect(manifest.features).toEqual([...EXPECTED_FEATURE_IDS]);
    expect(RUNTIME_FEATURE_IDS).toEqual(EXPECTED_FEATURE_IDS);
  });

  it("classifies malformed manifests as invalid", () => {
    const valid = getRuntimeCapabilityManifest();

    expectCapabilityError(
      () =>
      parseRuntimeCapabilityManifest({
        ...valid,
        commands: [...valid.commands, valid.commands[0]],
      }),
      "CAPABILITIES_INVALID",
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
    "rejects removed %s IDs as semantic boundary violations",
    (id, kind) => {
      const valid = getRuntimeCapabilityManifest();
      const override =
        kind === "command"
          ? { commands: [...valid.commands, id] }
          : { features: [...valid.features, id] };

      expectCapabilityError(
        () => parseRuntimeCapabilityManifest({ ...valid, ...override }),
        "SEMANTIC_BOUNDARY_VIOLATION",
      );
    },
  );

  it.each(FORBIDDEN_CONFIGURATION_KEYS)(
    "rejects forbidden credential or model configuration key %s",
    (key) => {
      const valid = getRuntimeCapabilityManifest();

      expectCapabilityError(
        () =>
          parseRuntimeCapabilityManifest({
            ...valid,
            [key]: false,
          }),
        "SEMANTIC_BOUNDARY_VIOLATION",
      );
    },
  );

  it.each([
    ["missing intent report schema", { intentReportSchemaVersion: undefined }],
    ["invalid intent report schema", { intentReportSchemaVersion: 0 }],
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
  ])("classifies required v2 boundary errors as invalid: %s", (_name, override) => {
    const valid = getRuntimeCapabilityManifest();

    expectCapabilityError(
      () => parseRuntimeCapabilityManifest({ ...valid, ...override }),
      "CAPABILITIES_INVALID",
    );
  });

  it.each([
    ["semantic authority", { semanticAuthority: "model" }],
    ["input contract", { inputContract: "raw-text" }],
    ["model integration", { modelIntegration: "embedded" }],
    ["credential policy", { credentialPolicy: "optional" }],
    ["network policy", { networkPolicy: "public" }],
  ])("classifies contradictory %s strings as semantic boundary violations", (_name, override) => {
    const valid = getRuntimeCapabilityManifest();

    expectCapabilityError(
      () => parseRuntimeCapabilityManifest({ ...valid, ...override }),
      "SEMANTIC_BOUNDARY_VIOLATION",
    );
  });

  it("returns independent command and feature arrays", () => {
    const first = getRuntimeCapabilityManifest();
    const second = getRuntimeCapabilityManifest();
    const parsed = parseRuntimeCapabilityManifest(first);

    expect(first.commands).not.toBe(second.commands);
    expect(first.features).not.toBe(second.features);
    expect(parsed.commands).not.toBe(first.commands);
    expect(parsed.features).not.toBe(first.features);

    first.commands.push("source-only.command");
    first.features.push("source-only.feature");
    expect(parsed.commands).toEqual([...EXPECTED_COMMAND_IDS]);
    expect(parsed.features).toEqual([...EXPECTED_FEATURE_IDS]);
    expect(second.commands).toEqual([...EXPECTED_COMMAND_IDS]);
    expect(second.features).toEqual([...EXPECTED_FEATURE_IDS]);
  });

  it("rejects non-positive and fractional manifest versions", () => {
    const valid = getRuntimeCapabilityManifest();
    const invalidVersions = [
      { capabilitiesContractVersion: 0 },
      { capabilitiesContractVersion: 1.5 },
      { bridgeProtocolVersion: 0 },
      { bridgeProtocolVersion: 1.5 },
      { sceneSchemaVersion: 0 },
      { sceneSchemaVersion: 1.5 },
      { patchSchemaVersion: 0 },
      { patchSchemaVersion: 1.5 },
      { intentReportSchemaVersion: 0 },
      { intentReportSchemaVersion: 1.5 },
    ];

    for (const override of invalidVersions) {
      expectCapabilityError(
        () => parseRuntimeCapabilityManifest({ ...valid, ...override }),
        "CAPABILITIES_INVALID",
      );
    }
  });

  it("accepts and omits additive diagnostic fields", () => {
    const valid = getRuntimeCapabilityManifest();
    const parsed = parseRuntimeCapabilityManifest({
      ...valid,
      diagnostics: { build: "generic" },
      modelDiagnostics: "none-loaded",
      providerStatus: "not-configured",
      endpointLatencyMs: 0,
      monkeyConfig: "generic",
      buildMetadata: { revision: "generic" },
    });

    expect(parsed).toEqual(valid);
    expect(parsed).not.toHaveProperty("diagnostics");
    expect(parsed).not.toHaveProperty("modelDiagnostics");
  });

  it.each(ALLOWED_COMPACT_DIAGNOSTIC_KEYS)(
    "accepts neutral compact diagnostic key %s",
    (key) => {
      const valid = getRuntimeCapabilityManifest();
      const parsed = parseRuntimeCapabilityManifest({
        ...valid,
        [key]: "generic",
      });

      expect(parsed).toEqual(valid);
      expect(parsed).not.toHaveProperty(key);
    },
  );

  it("accepts SemVer prerelease and build metadata", () => {
    expect(parseApplicationVersion({ version: "1.2.3-beta.1" })).toBe(
      "1.2.3-beta.1",
    );
    expect(
      parseApplicationVersion({ version: "1.2.3-beta.1+build.20260724" }),
    ).toBe("1.2.3-beta.1+build.20260724");
  });

  it("rejects invalid SemVer application versions", () => {
    for (const version of [
      "",
      "01.2.3",
      "1.2.3-.",
      "1.2.3-a..b",
      "1.2.3-01",
    ]) {
      expect(() => parseApplicationVersion({ version })).toThrowError(
        "Application package metadata is invalid.",
      );
    }
  });

  it("sanitizes package metadata read failures", () => {
    const marker = "PRIVATE_PATH_MARKER";
    let error: unknown;
    try {
      loadApplicationVersion(() => {
        throw new Error(marker);
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Application package metadata is invalid.",
    );
    expect(String(error)).not.toContain(marker);
  });

  it("sanitizes malformed package metadata JSON", () => {
    const marker = "PRIVATE_JSON_MARKER";
    let error: unknown;
    try {
      loadApplicationVersion(() => `${marker}{`);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Application package metadata is invalid.",
    );
    expect(String(error)).not.toContain(marker);
  });
});
