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
  ACTOR_LIMB_ERROR_CODES,
  CLI_COMMAND_DEFINITIONS,
  CLI_HELP_COMMANDS,
  LOCK_ERROR_CODES,
  PATCH_POLICY_FIELDS,
  RUNTIME_FEATURE_IDS,
  getRuntimeCapabilityManifest,
  parseRuntimeCapabilityManifest,
} from "../cli/runtime-capabilities";
import { ENTITY_LOCK_MODES } from "../src/domain/entity-lock";
import {
  ACTOR_LIMB_PART_IDS,
  ACTOR_LIMB_PRESENCE_MODES,
} from "../src/domain/actor-anatomy";
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
  "blueprint.validate",
  "scene.create",
  "scene.submit",
  "scene.save",
  "scene.load",
  "patch.apply",
  "patch.submit",
  "composition.inspect",
  "pose.inspect",
  "export.png",
  "undo",
  "redo",
  "open.system",
] as const;

const EXPECTED_FEATURE_IDS = [
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
const EXPECTED_ACTOR_PUPPET_CAPABILITY = {
  heightLimitsM: { min: 1, max: 2.4 },
  jointIds: [
    "pelvis",
    "spine",
    "neck",
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
  operationIds: [
    "actor.height.set",
    "actor.pose.joints.set",
    "actor.blocking.solve",
  ],
  errorCodes: [
    "ACTOR_HEIGHT_TARGET_INVALID",
    "ACTOR_HEIGHT_RANGE_INVALID",
    "ACTOR_JOINT_TARGET_INVALID",
    "ACTOR_JOINT_ID_INVALID",
    "STATIC_BLOCKING_ACTOR_NOT_FOUND",
    "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
    "STATIC_BLOCKING_POSE_PRESET_INVALID",
    "POSE_DIAGNOSTICS_FAILED",
  ],
} as const;
const EXPECTED_ACTOR_BLUEPRINT_CAPABILITY = {
  schemaVersion: 1,
  mounts: [
    "shoulder_l",
    "shoulder_r",
    "elbow_l",
    "elbow_r",
    "wrist_l",
    "wrist_r",
    "hip_l",
    "hip_r",
    "knee_l",
    "knee_r",
  ],
  primitives: ["box", "sphere", "cylinder"],
  variantDeltaFields: ["limbPresence", "moduleVisibility"],
  errorCodes: [
    "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    "ACTOR_BLUEPRINT_FILE_INVALID",
    "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
    "ACTOR_BLUEPRINT_VARIANT_INVALID",
    "ACTOR_BLUEPRINT_HASH_MISMATCH",
    "ACTOR_BLUEPRINT_HASH_DUPLICATE",
    "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    "ACTOR_BLUEPRINT_ID_CONFLICT",
  ],
} as const;

const EXPECTED_ENTITY_LOCK_MODES = ["none", "workflow", "user"] as const;
const EXPECTED_PATCH_POLICY_FIELDS = ["preserveLock"] as const;
const EXPECTED_LOCK_ERROR_CODES = [
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
] as const;
const EXPECTED_ACTOR_LIMB_PART_IDS = [
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
] as const;
const EXPECTED_ACTOR_LIMB_PRESENCE_MODES = ["present", "absent"] as const;
const EXPECTED_ACTOR_LIMB_ERROR_CODES = ["LIMB_HIERARCHY_CONFLICT"] as const;

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

    expect(packageMetadata.version).toBe("0.10.0");
    expect(APPLICATION_VERSION).toBe(packageMetadata.version);
    expect(runtimeCapabilities).toMatchObject({
      CAPABILITIES_CONTRACT_VERSION: 2,
      WORKSPACE_ROUTING_VERSION: 1,
      INTENT_REPORT_SCHEMA_VERSION: 6,
      ACTOR_PUPPET_HEIGHT_LIMITS_M:
        EXPECTED_ACTOR_PUPPET_CAPABILITY.heightLimitsM,
      ACTOR_PUPPET_OPERATION_IDS:
        EXPECTED_ACTOR_PUPPET_CAPABILITY.operationIds,
      ACTOR_PUPPET_ERROR_CODES:
        EXPECTED_ACTOR_PUPPET_CAPABILITY.errorCodes,
      PATCH_POLICY_FIELDS: EXPECTED_PATCH_POLICY_FIELDS,
      LOCK_ERROR_CODES: EXPECTED_LOCK_ERROR_CODES,
      ACTOR_LIMB_ERROR_CODES: EXPECTED_ACTOR_LIMB_ERROR_CODES,
      SEMANTIC_AUTHORITY: "host",
      INPUT_CONTRACT: "structured-only",
      MODEL_INTEGRATION: "none",
      CREDENTIAL_POLICY: "forbidden",
      NETWORK_POLICY: "loopback-only",
      RuntimeCapabilityError: expect.any(Function),
    });
    expect(manifest).toEqual({
      service: "shubi-shot-director",
      capabilitiesContractVersion: 2,
      applicationVersion: packageMetadata.version,
      bridgeProtocolVersion: 1,
      workspaceRoutingVersion: 1,
      sceneSchemaVersion: SCENE_SCHEMA_VERSION,
      patchSchemaVersion: PATCH_SCHEMA_VERSION,
      intentReportSchemaVersion: 6,
      semanticAuthority: "host",
      inputContract: "structured-only",
      modelIntegration: "none",
      credentialPolicy: "forbidden",
      networkPolicy: "loopback-only",
      commands: [...EXPECTED_COMMAND_IDS],
      features: [...EXPECTED_FEATURE_IDS],
      entityLockModes: [...EXPECTED_ENTITY_LOCK_MODES],
      patchPolicyFields: [...EXPECTED_PATCH_POLICY_FIELDS],
      lockErrorCodes: [...EXPECTED_LOCK_ERROR_CODES],
      actorLimbPartIds: [...EXPECTED_ACTOR_LIMB_PART_IDS],
      actorLimbPresenceModes: [...EXPECTED_ACTOR_LIMB_PRESENCE_MODES],
      actorLimbErrorCodes: [...EXPECTED_ACTOR_LIMB_ERROR_CODES],
      actorPuppet: {
        heightLimitsM: {
          ...EXPECTED_ACTOR_PUPPET_CAPABILITY.heightLimitsM,
        },
        jointIds: [...EXPECTED_ACTOR_PUPPET_CAPABILITY.jointIds],
        operationIds: [...EXPECTED_ACTOR_PUPPET_CAPABILITY.operationIds],
        errorCodes: [...EXPECTED_ACTOR_PUPPET_CAPABILITY.errorCodes],
      },
      actorBlueprint: {
        schemaVersion: 1,
        mounts: [...EXPECTED_ACTOR_BLUEPRINT_CAPABILITY.mounts],
        primitives: [...EXPECTED_ACTOR_BLUEPRINT_CAPABILITY.primitives],
        variantDeltaFields: [
          ...EXPECTED_ACTOR_BLUEPRINT_CAPABILITY.variantDeltaFields,
        ],
        errorCodes: [...EXPECTED_ACTOR_BLUEPRINT_CAPABILITY.errorCodes],
      },
    });
    expect(CAPABILITIES_CONTRACT_VERSION).toBe(2);
    expect(ENTITY_LOCK_MODES).toEqual(EXPECTED_ENTITY_LOCK_MODES);
    expect(ACTOR_LIMB_PART_IDS).toEqual(EXPECTED_ACTOR_LIMB_PART_IDS);
    expect(ACTOR_LIMB_PRESENCE_MODES).toEqual(
      EXPECTED_ACTOR_LIMB_PRESENCE_MODES,
    );
    expect(runtimeCapabilities.ACTOR_PUPPET_HEIGHT_LIMITS_M).toEqual(
      EXPECTED_ACTOR_PUPPET_CAPABILITY.heightLimitsM,
    );
    expect(runtimeCapabilities.ACTOR_PUPPET_OPERATION_IDS).toEqual(
      EXPECTED_ACTOR_PUPPET_CAPABILITY.operationIds,
    );
    expect(runtimeCapabilities.ACTOR_PUPPET_ERROR_CODES).toEqual(
      EXPECTED_ACTOR_PUPPET_CAPABILITY.errorCodes,
    );
    expect(manifest).not.toHaveProperty("requiresApiKey");
    expect(manifest.actorBlueprint).toMatchObject({
      schemaVersion: 1,
      primitives: ["box", "sphere", "cylinder"],
    });
  });

  it("publishes unique stable command, feature, lock, and anatomy capability ids", () => {
    const manifest = getRuntimeCapabilityManifest();

    expect(new Set(manifest.commands).size).toBe(manifest.commands.length);
    expect(new Set(manifest.features).size).toBe(manifest.features.length);
    expect(new Set(manifest.entityLockModes).size).toBe(
      manifest.entityLockModes.length,
    );
    expect(new Set(manifest.patchPolicyFields).size).toBe(
      manifest.patchPolicyFields.length,
    );
    expect(new Set(manifest.lockErrorCodes).size).toBe(
      manifest.lockErrorCodes.length,
    );
    expect(new Set(manifest.actorLimbPartIds).size).toBe(
      manifest.actorLimbPartIds.length,
    );
    expect(new Set(manifest.actorLimbPresenceModes).size).toBe(
      manifest.actorLimbPresenceModes.length,
    );
    expect(new Set(manifest.actorLimbErrorCodes).size).toBe(
      manifest.actorLimbErrorCodes.length,
    );
    expect(new Set(manifest.actorPuppet.jointIds).size).toBe(
      manifest.actorPuppet.jointIds.length,
    );
    expect(new Set(manifest.actorPuppet.operationIds).size).toBe(
      manifest.actorPuppet.operationIds.length,
    );
    expect(new Set(manifest.actorPuppet.errorCodes).size).toBe(
      manifest.actorPuppet.errorCodes.length,
    );
    expect(manifest.commands).toEqual([...EXPECTED_COMMAND_IDS]);
    expect(CLI_COMMAND_DEFINITIONS.map(({ id }) => id)).toEqual([
      ...EXPECTED_COMMAND_IDS,
    ]);
    expect(CLI_HELP_COMMANDS).toEqual(
      CLI_COMMAND_DEFINITIONS.map(({ usage }) => usage),
    );
    expect(manifest.features).toEqual([...EXPECTED_FEATURE_IDS]);
    expect(RUNTIME_FEATURE_IDS).toEqual(EXPECTED_FEATURE_IDS);
    expect(manifest.entityLockModes).toEqual([
      ...EXPECTED_ENTITY_LOCK_MODES,
    ]);
    expect(manifest.patchPolicyFields).toEqual([
      ...EXPECTED_PATCH_POLICY_FIELDS,
    ]);
    expect(PATCH_POLICY_FIELDS).toEqual(EXPECTED_PATCH_POLICY_FIELDS);
    expect(manifest.lockErrorCodes).toEqual([
      ...EXPECTED_LOCK_ERROR_CODES,
    ]);
    expect(LOCK_ERROR_CODES).toEqual(EXPECTED_LOCK_ERROR_CODES);
    expect(manifest.actorLimbPartIds).toEqual([
      ...EXPECTED_ACTOR_LIMB_PART_IDS,
    ]);
    expect(manifest.actorLimbPresenceModes).toEqual([
      ...EXPECTED_ACTOR_LIMB_PRESENCE_MODES,
    ]);
    expect(manifest.actorLimbErrorCodes).toEqual([
      ...EXPECTED_ACTOR_LIMB_ERROR_CODES,
    ]);
    expect(ACTOR_LIMB_ERROR_CODES).toEqual(EXPECTED_ACTOR_LIMB_ERROR_CODES);
    expect(manifest.actorPuppet).toEqual({
      heightLimitsM: {
        ...EXPECTED_ACTOR_PUPPET_CAPABILITY.heightLimitsM,
      },
      jointIds: [...EXPECTED_ACTOR_PUPPET_CAPABILITY.jointIds],
      operationIds: [...EXPECTED_ACTOR_PUPPET_CAPABILITY.operationIds],
      errorCodes: [...EXPECTED_ACTOR_PUPPET_CAPABILITY.errorCodes],
    });
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
    ["entity lock modes", "entityLockModes", EXPECTED_ENTITY_LOCK_MODES],
    ["patch policy fields", "patchPolicyFields", EXPECTED_PATCH_POLICY_FIELDS],
    ["lock error codes", "lockErrorCodes", EXPECTED_LOCK_ERROR_CODES],
    ["actor limb part ids", "actorLimbPartIds", EXPECTED_ACTOR_LIMB_PART_IDS],
    [
      "actor limb presence modes",
      "actorLimbPresenceModes",
      EXPECTED_ACTOR_LIMB_PRESENCE_MODES,
    ],
    [
      "actor limb error codes",
      "actorLimbErrorCodes",
      EXPECTED_ACTOR_LIMB_ERROR_CODES,
    ],
  ] as const)(
    "requires %s to be a non-empty unique string array",
    (_label, field, expected) => {
      const valid = getRuntimeCapabilityManifest();
      const malformedValues: unknown[] = [
        undefined,
        [],
        [...expected, expected[0]],
        [...expected.slice(0, -1), 42],
        "",
        null,
        {},
      ];

      for (const value of malformedValues) {
        expectCapabilityError(
          () =>
            parseRuntimeCapabilityManifest({
              ...valid,
              [field]: value,
            }),
          "CAPABILITIES_INVALID",
        );
      }
    },
  );

  it("requires a plain or null-prototype manifest with own required fields", () => {
    const valid = getRuntimeCapabilityManifest();

    expectCapabilityError(
      () => parseRuntimeCapabilityManifest([]),
      "CAPABILITIES_INVALID",
    );
    expectCapabilityError(
      () =>
        parseRuntimeCapabilityManifest(
          Object.create(valid) as Record<string, unknown>,
        ),
      "CAPABILITIES_INVALID",
    );

    const nullPrototypeManifest = Object.assign(
      Object.create(null) as Record<string, unknown>,
      valid,
    );
    expect(parseRuntimeCapabilityManifest(nullPrototypeManifest)).toEqual(
      valid,
    );
  });

  it.each(["getter", "proxy"] as const)(
    "fails closed without leaking a throwing %s manifest",
    (kind) => {
      const marker = `PRIVATE_${kind.toUpperCase()}_MARKER`;
      const valid = getRuntimeCapabilityManifest();
      let input: unknown;
      if (kind === "getter") {
        const getterManifest = { ...valid };
        Object.defineProperty(getterManifest, "service", {
          enumerable: true,
          get() {
            throw new Error(marker);
          },
        });
        input = getterManifest;
      } else {
        input = new Proxy(
          { ...valid },
          {
            getPrototypeOf() {
              throw new Error(marker);
            },
          },
        );
      }

      let caught: unknown;
      try {
        parseRuntimeCapabilityManifest(input);
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        name: "RuntimeCapabilityError",
        code: "CAPABILITIES_INVALID",
        message: "The runtime capability manifest is invalid.",
      });
      expect(String(caught)).not.toContain(marker);
    },
  );

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

  it("returns independent manifest arrays", () => {
    const first = getRuntimeCapabilityManifest();
    const second = getRuntimeCapabilityManifest();
    const parsed = parseRuntimeCapabilityManifest(first);

    expect(first.commands).not.toBe(second.commands);
    expect(first.features).not.toBe(second.features);
    expect(first.entityLockModes).not.toBe(second.entityLockModes);
    expect(first.patchPolicyFields).not.toBe(second.patchPolicyFields);
    expect(first.lockErrorCodes).not.toBe(second.lockErrorCodes);
    expect(first.actorLimbPartIds).not.toBe(second.actorLimbPartIds);
    expect(first.actorLimbPresenceModes).not.toBe(second.actorLimbPresenceModes);
    expect(first.actorLimbErrorCodes).not.toBe(second.actorLimbErrorCodes);
    expect(parsed.commands).not.toBe(first.commands);
    expect(parsed.features).not.toBe(first.features);
    expect(parsed.entityLockModes).not.toBe(first.entityLockModes);
    expect(parsed.patchPolicyFields).not.toBe(first.patchPolicyFields);
    expect(parsed.lockErrorCodes).not.toBe(first.lockErrorCodes);
    expect(parsed.actorLimbPartIds).not.toBe(first.actorLimbPartIds);
    expect(parsed.actorLimbPresenceModes).not.toBe(first.actorLimbPresenceModes);
    expect(parsed.actorLimbErrorCodes).not.toBe(first.actorLimbErrorCodes);

    first.commands.push("source-only.command");
    first.features.push("source-only.feature");
    first.entityLockModes.push("source-only-lock");
    first.patchPolicyFields.push("sourceOnlyPolicy");
    first.lockErrorCodes.push("SOURCE_ONLY_ERROR");
    first.actorLimbPartIds.push("source_only_part");
    first.actorLimbPresenceModes.push("source-only-mode");
    first.actorLimbErrorCodes.push("SOURCE_ONLY_LIMB_ERROR");
    expect(parsed.commands).toEqual([...EXPECTED_COMMAND_IDS]);
    expect(parsed.features).toEqual([...EXPECTED_FEATURE_IDS]);
    expect(parsed.entityLockModes).toEqual([
      ...EXPECTED_ENTITY_LOCK_MODES,
    ]);
    expect(parsed.patchPolicyFields).toEqual([
      ...EXPECTED_PATCH_POLICY_FIELDS,
    ]);
    expect(parsed.lockErrorCodes).toEqual([
      ...EXPECTED_LOCK_ERROR_CODES,
    ]);
    expect(second.commands).toEqual([...EXPECTED_COMMAND_IDS]);
    expect(second.features).toEqual([...EXPECTED_FEATURE_IDS]);
    expect(second.entityLockModes).toEqual([
      ...EXPECTED_ENTITY_LOCK_MODES,
    ]);
    expect(second.patchPolicyFields).toEqual([
      ...EXPECTED_PATCH_POLICY_FIELDS,
    ]);
    expect(second.lockErrorCodes).toEqual([
      ...EXPECTED_LOCK_ERROR_CODES,
    ]);
    expect(parsed.actorLimbPartIds).toEqual([...EXPECTED_ACTOR_LIMB_PART_IDS]);
    expect(parsed.actorLimbPresenceModes).toEqual([
      ...EXPECTED_ACTOR_LIMB_PRESENCE_MODES,
    ]);
    expect(parsed.actorLimbErrorCodes).toEqual([
      ...EXPECTED_ACTOR_LIMB_ERROR_CODES,
    ]);
    expect(second.actorLimbPartIds).toEqual([...EXPECTED_ACTOR_LIMB_PART_IDS]);
    expect(second.actorLimbPresenceModes).toEqual([
      ...EXPECTED_ACTOR_LIMB_PRESENCE_MODES,
    ]);
    expect(second.actorLimbErrorCodes).toEqual([
      ...EXPECTED_ACTOR_LIMB_ERROR_CODES,
    ]);
  });

  it("does not reorder caller arrays while parsing", () => {
    const valid = getRuntimeCapabilityManifest();
    const source = {
      ...valid,
      commands: [...valid.commands].reverse(),
      features: [...valid.features].reverse(),
      entityLockModes: [...valid.entityLockModes].reverse(),
      patchPolicyFields: [...valid.patchPolicyFields].reverse(),
      lockErrorCodes: [...valid.lockErrorCodes].reverse(),
      actorLimbPartIds: [...valid.actorLimbPartIds].reverse(),
      actorLimbPresenceModes: [...valid.actorLimbPresenceModes].reverse(),
      actorLimbErrorCodes: [...valid.actorLimbErrorCodes].reverse(),
    };
    const before = {
      commands: [...source.commands],
      features: [...source.features],
      entityLockModes: [...source.entityLockModes],
      patchPolicyFields: [...source.patchPolicyFields],
      lockErrorCodes: [...source.lockErrorCodes],
      actorLimbPartIds: [...source.actorLimbPartIds],
      actorLimbPresenceModes: [...source.actorLimbPresenceModes],
      actorLimbErrorCodes: [...source.actorLimbErrorCodes],
    };

    parseRuntimeCapabilityManifest(source);

    expect(source).toMatchObject(before);
  });

  it("rejects non-positive and fractional manifest versions", () => {
    const valid = getRuntimeCapabilityManifest();
    const invalidVersions = [
      { capabilitiesContractVersion: 0 },
      { capabilitiesContractVersion: 1.5 },
      { bridgeProtocolVersion: 0 },
      { bridgeProtocolVersion: 1.5 },
      { workspaceRoutingVersion: 0 },
      { workspaceRoutingVersion: 1.5 },
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

  it("requires the canonical workspace routing version", () => {
    const valid = {
      ...getRuntimeCapabilityManifest(),
      workspaceRoutingVersion: 1,
    };

    for (const workspaceRoutingVersion of [undefined, 0, 1.5, 2]) {
      expectCapabilityError(
        () =>
          parseRuntimeCapabilityManifest({
            ...valid,
            workspaceRoutingVersion,
          }),
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
