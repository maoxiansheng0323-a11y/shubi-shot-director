import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSkillForwardFixtures,
  defaultForwardTiers,
  forwardCaseIds,
} from "./helpers/create-skill-forward-fixtures";
import {
  createSkillRuntimeFixture,
  deniedRuntimeEnvironmentNames,
  runSkillWrapper,
  type SkillRuntimeFixture,
  type SkillWrapperResult,
} from "./helpers/skill-runtime-fixture";
import {
  optionBoundaryCases,
  type OptionBoundaryClassification,
} from "./helpers/option-boundary-cases";

const plannerModuleUrl = pathToFileURL(
  path.resolve(
    ".agents",
    "skills",
    "shubi-shot-director",
    "scripts",
    "compatibility-plan.mjs",
  ),
).href;
const wrapperPath = path.resolve(
  ".agents",
  "skills",
  "shubi-shot-director",
  "scripts",
  "director.mjs",
);

const commandIds = [
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

const featureIds = [
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
  "actor.limb-presence",
] as const;

const entityLockModes = ["none", "workflow", "user"] as const;
const patchPolicyFields = ["preserveLock"] as const;
const lockErrorCodes = [
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
] as const;
const actorLimbPartIds = [
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
const actorLimbPresenceModes = ["present", "absent"] as const;
const actorLimbErrorCodes = ["LIMB_HIERARCHY_CONFLICT"] as const;

type SchemaVersionField =
  | "sceneSchemaVersion"
  | "patchSchemaVersion"
  | "intentReportSchemaVersion";

const SCHEMA_PRECEDENCE_CASES: ReadonlyArray<
  readonly [string, string, SchemaVersionField, string]
> = [
  [
    "scene schema",
    "scene.create",
    "sceneSchemaVersion",
    "SCENE_SCHEMA_UNSUPPORTED",
  ],
  [
    "patch schema",
    "patch.apply",
    "patchSchemaVersion",
    "PATCH_SCHEMA_UNSUPPORTED",
  ],
  [
    "intent schema",
    "scene.submit",
    "intentReportSchemaVersion",
    "INTENT_REPORT_SCHEMA_UNSUPPORTED",
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
  ["missing actor limb part ids", { actorLimbPartIds: undefined }],
  ["malformed actor limb part ids", { actorLimbPartIds: "hand_l" }],
  ["missing actor limb presence modes", { actorLimbPresenceModes: undefined }],
  ["malformed actor limb error codes", { actorLimbErrorCodes: "LIMB_HIERARCHY_CONFLICT" }],
] as const;

const SCHEMA_LOCK_PRECEDENCE_CASES: ReadonlyArray<
  readonly [
    string,
    string,
    SchemaVersionField,
    Record<string, unknown>,
    string,
  ]
> = SCHEMA_PRECEDENCE_CASES.flatMap(
  ([schemaLabel, requestedAction, schemaField, code]) =>
    LOCK_FIELD_FAILURES.map(
    ([lockLabel, lockOverride]) =>
      [
        `${schemaLabel} before ${lockLabel}`,
        requestedAction,
        schemaField,
        lockOverride,
        code,
      ] as const,
    ),
);

const v2Manifest = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  service: "shubi-shot-director",
  capabilitiesContractVersion: 2,
  applicationVersion: "1.0.0",
  bridgeProtocolVersion: 1,
  sceneSchemaVersion: 4,
  patchSchemaVersion: 4,
  intentReportSchemaVersion: 4,
  semanticAuthority: "host",
  inputContract: "structured-only",
  modelIntegration: "none",
  credentialPolicy: "forbidden",
  networkPolicy: "loopback-only",
  commands: [...commandIds],
  features: [...featureIds],
  entityLockModes: [...entityLockModes],
  patchPolicyFields: [...patchPolicyFields],
  lockErrorCodes: [...lockErrorCodes],
  actorLimbPartIds: [...actorLimbPartIds],
  actorLimbPresenceModes: [...actorLimbPresenceModes],
  actorLimbErrorCodes: [...actorLimbErrorCodes],
  ...overrides,
});

interface PlanError {
  code: string;
  message: string;
}

interface CompatibilityPlan {
  planContractVersion: number;
  mode: "compatible" | "degraded" | "incompatible";
  requestedAction: string;
  actionAllowed: boolean;
  allowedActions: string[];
  requiresBridge: boolean;
  mayStartBridge: boolean;
  liveVerified: boolean;
  diagnostics: string[];
  warnings: string[];
  blockingError: PlanError | null;
}

interface PlannerModule {
  PLAN_CONTRACT_VERSION: number;
  ACTION_POLICY: Readonly<
    Record<
      string,
      {
        command: string;
        features: readonly string[];
        schemas: readonly string[];
        requiresBridge: boolean;
        mayStartBridge: boolean;
      }
    >
  >;
  buildCompatibilityPlan: (
    input: Record<string, unknown>,
  ) => CompatibilityPlan;
  validateCapabilitiesManifest: (
    input: Record<string, unknown>,
  ) => {
    manifest?: Record<string, unknown>;
    error?: PlanError;
  };
}

interface Envelope {
  ok: boolean;
  data?: CompatibilityPlan | Record<string, unknown>;
  error?: PlanError;
}

let planner: PlannerModule;
const fixtures: SkillRuntimeFixture[] = [];
const temporaryRoots: string[] = [];

const createFixture = async (
  doctorData: Record<string, unknown>,
  options: Omit<
    Parameters<typeof createSkillRuntimeFixture>[0],
    "doctorData"
  > = {},
): Promise<SkillRuntimeFixture> => {
  const created = await createSkillRuntimeFixture({
    doctorData,
    ...options,
  });
  fixtures.push(created);
  return created;
};

const createObservedCopiedWrapper = async (): Promise<{
  observationPath: string;
  wrapperPath: string;
}> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "observed-skill-wrapper-"),
  );
  temporaryRoots.push(directory);
  const sourceSkillDirectory = path.dirname(path.dirname(wrapperPath));
  const copiedSkillDirectory = path.join(directory, "skill");
  const copiedScriptsDirectory = path.join(
    copiedSkillDirectory,
    "scripts",
  );
  const copiedGeneratedDirectory = path.join(
    copiedSkillDirectory,
    "references",
    "generated",
  );
  const copiedWrapperPath = path.join(
    copiedScriptsDirectory,
    "director.mjs",
  );
  const observationPath = path.join(directory, "locator-observation.txt");
  await Promise.all([
    mkdir(copiedScriptsDirectory, { recursive: true }),
    mkdir(copiedGeneratedDirectory, { recursive: true }),
  ]);
  await Promise.all([
    copyFile(wrapperPath, copiedWrapperPath),
    copyFile(
      path.join(sourceSkillDirectory, "scripts", "compatibility-plan.mjs"),
      path.join(copiedScriptsDirectory, "compatibility-plan.mjs"),
    ),
    copyFile(
      path.join(sourceSkillDirectory, "runtime.json"),
      path.join(copiedSkillDirectory, "runtime.json"),
    ),
    copyFile(
      path.join(
        sourceSkillDirectory,
        "references",
        "generated",
        "scene-spec.schema.json",
      ),
      path.join(copiedGeneratedDirectory, "scene-spec.schema.json"),
    ),
    copyFile(
      path.join(
        sourceSkillDirectory,
        "references",
        "generated",
        "scene-patch.schema.json",
      ),
      path.join(copiedGeneratedDirectory, "scene-patch.schema.json"),
    ),
    copyFile(
      path.join(
        sourceSkillDirectory,
        "references",
        "generated",
        "intent-report.schema.json",
      ),
      path.join(copiedGeneratedDirectory, "intent-report.schema.json"),
    ),
  ]);
  await writeFile(
    path.join(copiedScriptsDirectory, "runtime-locator.mjs"),
    `
      import { appendFileSync } from "node:fs";
      import path from "node:path";

      const observationPath = ${JSON.stringify(observationPath)};
      appendFileSync(observationPath, "locator-imported\\n", "utf8");

      export class SkillRuntimeError extends Error {
        constructor() {
          super("runtime unavailable");
          this.code = "RUNTIME_NOT_FOUND";
        }
      }

      export const resolveRuntime = async () => {
        appendFileSync(observationPath, "runtime-resolved\\n", "utf8");
        const runtimeRoot = process.env.SHUBI_SHOT_RUNTIME_ROOT;
        if (typeof runtimeRoot !== "string") {
          throw new SkillRuntimeError();
        }
        return {
          runtimeRoot: path.resolve(runtimeRoot),
          entrypoint: path.resolve(runtimeRoot, "scripts", "director.mjs"),
        };
      };
    `,
    "utf8",
  );
  return { observationPath, wrapperPath: copiedWrapperPath };
};

const buildPlan = (
  requestedAction: string,
  doctorData: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): CompatibilityPlan =>
  planner.buildCompatibilityPlan({
    requestedAction,
    doctorData,
    skillBridgeProtocolVersion: 1,
    skillSceneSchemaVersion: 4,
    skillPatchSchemaVersion: 4,
    skillIntentReportSchemaVersion: 4,
    skillEntityLockModes: [...entityLockModes],
    skillPatchPolicyFields: [...patchPolicyFields],
    skillLockErrorCodes: [...lockErrorCodes],
    skillActorLimbPartIds: [...actorLimbPartIds],
    skillActorLimbPresenceModes: [...actorLimbPresenceModes],
    skillActorLimbErrorCodes: [...actorLimbErrorCodes],
    ...overrides,
  });

const parseEnvelope = (result: SkillWrapperResult): Envelope => {
  expect(result.timedOut).toBe(false);
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe("");
  expect(result.stdout.endsWith("\n")).toBe(true);
  expect(result.stdout.trimEnd().split(/\r?\n/)).toHaveLength(1);
  return JSON.parse(result.stdout) as Envelope;
};

const expectError = (
  result: SkillWrapperResult,
  code: string,
  hiddenMarkers: string[] = [],
): Envelope => {
  expect(result.exitCode).toBe(1);
  const envelope = parseEnvelope(result);
  expect(envelope).toMatchObject({
    ok: false,
    error: { code, message: expect.any(String) },
  });
  for (const marker of hiddenMarkers) {
    expect(result.stdout).not.toContain(marker);
    expect(result.stderr).not.toContain(marker);
  }
  return envelope;
};

const readPlan = (result: SkillWrapperResult): CompatibilityPlan => {
  expect(result.exitCode).toBe(0);
  const envelope = parseEnvelope(result);
  expect(envelope.ok).toBe(true);
  return envelope.data as CompatibilityPlan;
};

beforeAll(async () => {
  planner = (await import(
    /* @vite-ignore */ plannerModuleUrl
  )) as PlannerModule;
});

afterEach(async () => {
  await Promise.all([
    ...fixtures.splice(0).map((created) => created.dispose()),
    ...temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

describe("v2 compatibility planner", () => {
  it("exports exactly the 17 structured actions and the v2 plan shape", () => {
    const plan = buildPlan("scene.submit", v2Manifest());

    expect(planner.PLAN_CONTRACT_VERSION).toBe(2);
    expect(Object.keys(planner.ACTION_POLICY)).toEqual(commandIds);
    expect(plan).toEqual({
      planContractVersion: 2,
      mode: "compatible",
      requestedAction: "scene.submit",
      actionAllowed: true,
      allowedActions: [...commandIds],
      requiresBridge: true,
      mayStartBridge: false,
      liveVerified: false,
      diagnostics: [],
      warnings: [],
      blockingError: null,
    });
    expect(Object.keys(plan)).toEqual([
      "planContractVersion",
      "mode",
      "requestedAction",
      "actionAllowed",
      "allowedActions",
      "requiresBridge",
      "mayStartBridge",
      "liveVerified",
      "diagnostics",
      "warnings",
      "blockingError",
    ]);
  });

  it.each([
    ["v1", v2Manifest({ capabilitiesContractVersion: 1 })],
    [
      "legacy",
      {
        service: "shubi-shot-director",
        applicationVersion: "0.1.0",
        bridgeProtocolVersion: 1,
      },
    ],
  ])("rejects a %s manifest without legacy help fallback", (_label, manifest) => {
    const plan = buildPlan("scene.submit", manifest);

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      liveVerified: false,
      blockingError: { code: "CAPABILITIES_CONTRACT_UNSUPPORTED" },
    });
  });

  it.each([
    ["removed command", { commands: [...commandIds, "shot.create"] }],
    [
      "removed feature",
      { features: [...featureIds, "intent.strict-report"] },
    ],
    ["requiresApiKey false", { requiresApiKey: false }],
    ["credential config", { credentialConfiguration: {} }],
    ["model config", { model: "generic-model" }],
    ["provider config", { providerOptions: {} }],
    ["endpoint config", { endpoint: "https://example.invalid" }],
  ])("rejects a v2 manifest with %s", (_label, manifestOverride) => {
    const plan = buildPlan(
      "scene.submit",
      v2Manifest(manifestOverride),
    );

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      blockingError: { code: "SEMANTIC_BOUNDARY_VIOLATION" },
    });
  });

  it.each([
    ["missing entity lock modes", { entityLockModes: undefined }],
    ["empty entity lock modes", { entityLockModes: [] }],
    [
      "duplicate entity lock modes",
      { entityLockModes: ["none", "workflow", "user", "user"] },
    ],
    ["non-string entity lock mode", { entityLockModes: ["none", 42] }],
    ["missing patch policy fields", { patchPolicyFields: undefined }],
    ["empty patch policy fields", { patchPolicyFields: [] }],
    [
      "duplicate patch policy fields",
      { patchPolicyFields: ["preserveLock", "preserveLock"] },
    ],
    ["non-string patch policy field", { patchPolicyFields: [42] }],
    ["missing lock error codes", { lockErrorCodes: undefined }],
    ["empty lock error codes", { lockErrorCodes: [] }],
    [
      "duplicate lock error codes",
      {
        lockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "LOCK_PRESERVATION_CONFLICT",
          "USER_LOCKED",
        ],
      },
    ],
    ["non-string lock error code", { lockErrorCodes: [42] }],
    ["missing actor limb part ids", { actorLimbPartIds: undefined }],
    ["empty actor limb part ids", { actorLimbPartIds: [] }],
    [
      "duplicate actor limb presence modes",
      { actorLimbPresenceModes: ["present", "absent", "present"] },
    ],
    ["non-string actor limb error code", { actorLimbErrorCodes: [42] }],
  ])("rejects a manifest with %s", (_label, manifestOverride) => {
    const plan = buildPlan(
      "scene.submit",
      v2Manifest(manifestOverride),
    );

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      blockingError: { code: "CAPABILITIES_INVALID" },
    });
  });

  it.each([
    [
      "entity lock modes",
      { skillEntityLockModes: ["none", "workflow"] },
    ],
    [
      "patch policy fields",
      { skillPatchPolicyFields: ["keepLock"] },
    ],
    [
      "lock error codes",
      {
        skillLockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "ENTITY_LOCKED",
        ],
      },
    ],
    [
      "actor limb part ids",
      {
        skillActorLimbPartIds: [
          ...actorLimbPartIds.slice(0, -1),
          "toe_r",
        ],
      },
    ],
    [
      "actor limb presence modes",
      { skillActorLimbPresenceModes: ["present"] },
    ],
    [
      "actor limb error codes",
      { skillActorLimbErrorCodes: ["UNKNOWN_LIMB_ERROR"] },
    ],
  ])("rejects %s that differ from the bundled Skill", (_label, overrides) => {
    const plan = buildPlan("scene.submit", v2Manifest(), overrides);

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      blockingError: { code: "CAPABILITIES_INVALID" },
    });
  });

  it("requires a plain or null-prototype manifest with own required fields", () => {
    const valid = v2Manifest();
    const inherited = Object.create(valid) as Record<string, unknown>;
    const nullPrototype = Object.assign(
      Object.create(null) as Record<string, unknown>,
      valid,
    );

    expect(
      buildPlan(
        "scene.submit",
        [] as unknown as Record<string, unknown>,
      ),
    ).toMatchObject({
      blockingError: { code: "CAPABILITIES_INVALID" },
    });
    expect(buildPlan("scene.submit", inherited)).toMatchObject({
      blockingError: { code: "CAPABILITIES_INVALID" },
    });
    expect(buildPlan("scene.submit", nullPrototype)).toMatchObject({
      mode: "compatible",
      actionAllowed: true,
      blockingError: null,
    });
  });

  it.each(["getter", "proxy"] as const)(
    "fails closed without leaking a throwing %s manifest",
    (kind) => {
      const marker = `PRIVATE_${kind.toUpperCase()}_MARKER`;
      const valid = v2Manifest();
      let doctorData: Record<string, unknown>;
      if (kind === "getter") {
        doctorData = { ...valid };
        Object.defineProperty(doctorData, "service", {
          enumerable: true,
          get() {
            throw new Error(marker);
          },
        });
      } else {
        doctorData = new Proxy(
          { ...valid },
          {
            getPrototypeOf() {
              throw new Error(marker);
            },
          },
        );
      }
      let caught: unknown;
      let plan: CompatibilityPlan | undefined;

      try {
        plan = buildPlan("scene.submit", doctorData);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeUndefined();
      expect(plan).toMatchObject({
        mode: "incompatible",
        actionAllowed: false,
        blockingError: { code: "CAPABILITIES_INVALID" },
      });
      expect(JSON.stringify(plan)).not.toContain(marker);
    },
  );

  it.each(["offline", "live"] as const)(
    "uses one stable snapshot of a stateful %s manifest",
    (source) => {
      const target = v2Manifest();
      let lockModeReads = 0;
      const manifest = new Proxy(target, {
        get(current, key, receiver) {
          if (key === "entityLockModes") {
            lockModeReads += 1;
            return lockModeReads === 1
              ? [...entityLockModes]
              : ["none", "workflow", "system"];
          }
          return Reflect.get(current, key, receiver);
        },
      });
      const plan =
        source === "offline"
          ? buildPlan("scene.submit", manifest)
          : buildPlan("scene.submit", v2Manifest(), {
              liveRequested: true,
              healthData: manifest,
            });

      expect(lockModeReads).toBe(0);
      expect(plan).toMatchObject({
        mode: "compatible",
        actionAllowed: true,
        liveVerified: source === "live",
        blockingError: null,
      });
    },
  );

  it("returns one stable snapshot from direct manifest validation", () => {
    const target = v2Manifest();
    let lockModeReads = 0;
    const manifest = new Proxy(target, {
      get(current, key, receiver) {
        if (key === "entityLockModes") {
          lockModeReads += 1;
          return lockModeReads === 1
            ? [...entityLockModes]
            : ["none", "workflow", "system"];
        }
        return Reflect.get(current, key, receiver);
      },
    });

    const validated =
      planner.validateCapabilitiesManifest(manifest);

    expect(lockModeReads).toBe(0);
    expect(validated.error).toBeUndefined();
    expect(validated.manifest).toMatchObject({
      entityLockModes: [...entityLockModes],
    });
  });

  it.each([
    ["offline", "BRIDGE_PROTOCOL_UNSUPPORTED", "PRIVATE_KNOWN_OFFLINE"],
    ["live", "BRIDGE_PROTOCOL_UNSUPPORTED", "PRIVATE_KNOWN_LIVE"],
    ["offline", "PRIVATE_OFFLINE_CODE", "PRIVATE_UNKNOWN_OFFLINE"],
    ["live", "PRIVATE_LIVE_CODE", "PRIVATE_UNKNOWN_LIVE"],
  ] as const)(
    "fails closed for a forged %s proxy error",
    (source, forgedCode, marker) => {
      const target = v2Manifest();
      const manifest = new Proxy(target, {
        getPrototypeOf() {
          throw { code: forgedCode, message: marker };
        },
      });
      const plan =
        source === "offline"
          ? buildPlan("scene.submit", manifest)
          : buildPlan("scene.submit", v2Manifest(), {
              liveRequested: true,
              healthData: manifest,
            });
      const serialized = JSON.stringify(plan);

      expect(plan).toMatchObject({
        mode: "incompatible",
        actionAllowed: false,
        blockingError: {
          code: "CAPABILITIES_INVALID",
          message: "The runtime capability manifest is invalid.",
        },
      });
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain("PRIVATE_");
    },
  );

  it.each([
    [
      "boundary",
      {
        semanticAuthority: "model",
        bridgeProtocolVersion: 999,
        sceneSchemaVersion: 5,
        entityLockModes: ["none", "workflow", "system"],
      },
      "SEMANTIC_BOUNDARY_VIOLATION",
    ],
    [
      "protocol before altered lock capabilities",
      {
        bridgeProtocolVersion: 999,
        sceneSchemaVersion: 5,
        entityLockModes: ["none", "workflow", "system"],
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
    ],
    [
      "protocol before missing lock capabilities",
      {
        bridgeProtocolVersion: 999,
        sceneSchemaVersion: 5,
        entityLockModes: undefined,
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
    ],
    [
      "schema before lock capabilities",
      {
        sceneSchemaVersion: 5,
        entityLockModes: ["none", "workflow", "system"],
      },
      "SCENE_SCHEMA_UNSUPPORTED",
    ],
    [
      "exact lock capabilities",
      { entityLockModes: ["none", "workflow", "system"] },
      "CAPABILITIES_INVALID",
    ],
  ] as const)(
    "uses canonical offline precedence for %s",
    (_label, override, code) => {
      const plan = buildPlan("scene.submit", v2Manifest(override));

      expect(plan.blockingError).toMatchObject({ code });
    },
  );

  it.each([
    [
      "boundary",
      {
        semanticAuthority: "model",
        bridgeProtocolVersion: 999,
        sceneSchemaVersion: 5,
        entityLockModes: ["none", "workflow", "system"],
      },
      "SEMANTIC_BOUNDARY_VIOLATION",
    ],
    [
      "protocol before altered lock capabilities",
      {
        bridgeProtocolVersion: 999,
        sceneSchemaVersion: 5,
        entityLockModes: ["none", "workflow", "system"],
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
    ],
    [
      "protocol before missing lock capabilities",
      {
        bridgeProtocolVersion: 999,
        sceneSchemaVersion: 5,
        entityLockModes: undefined,
      },
      "BRIDGE_PROTOCOL_UNSUPPORTED",
    ],
    [
      "schema before lock capabilities",
      {
        sceneSchemaVersion: 5,
        entityLockModes: ["none", "workflow", "system"],
      },
      "SCENE_SCHEMA_UNSUPPORTED",
    ],
    [
      "exact lock capabilities",
      { entityLockModes: ["none", "workflow", "system"] },
      "CAPABILITIES_INVALID",
    ],
  ] as const)(
    "uses canonical live precedence for %s",
    (_label, override, code) => {
      const plan = buildPlan("scene.submit", v2Manifest(), {
        liveRequested: true,
        healthData: v2Manifest(override),
      });

      expect(plan.blockingError).toMatchObject({ code });
    },
  );

  it.each(SCHEMA_LOCK_PRECEDENCE_CASES)(
    "uses complete offline schema precedence for %s",
    (
      _label,
      requestedAction,
      schemaField,
      lockOverride,
      code,
    ) => {
      const plan = buildPlan(
        requestedAction,
        v2Manifest({
          ...lockOverride,
          [schemaField]: 5,
        }),
      );

      expect(plan.blockingError).toMatchObject({ code });
    },
  );

  it.each(SCHEMA_PRECEDENCE_CASES)(
    "uses global offline schema precedence for %s with an unrelated action",
    (_label, _schemaAction, schemaField, code) => {
      const plan = buildPlan(
        "doctor",
        v2Manifest({
          [schemaField]: 5,
          lockErrorCodes: "malformed",
        }),
      );

      expect(plan.blockingError).toMatchObject({ code });
    },
  );

  it.each(SCHEMA_LOCK_PRECEDENCE_CASES)(
    "uses complete live schema precedence for %s",
    (
      _label,
      requestedAction,
      schemaField,
      lockOverride,
      code,
    ) => {
      const plan = buildPlan(requestedAction, v2Manifest(), {
        liveRequested: true,
        healthData: v2Manifest({
          ...lockOverride,
          [schemaField]: 5,
        }),
      });

      expect(plan.blockingError).toMatchObject({ code });
    },
  );

  it("compares reordered capability sets without mutating the manifest", () => {
    const manifest = v2Manifest({
      commands: [...commandIds].reverse(),
      features: [...featureIds].reverse(),
      entityLockModes: [...entityLockModes].reverse(),
      patchPolicyFields: [...patchPolicyFields].reverse(),
      lockErrorCodes: [...lockErrorCodes].reverse(),
      actorLimbPartIds: [...actorLimbPartIds].reverse(),
      actorLimbPresenceModes: [...actorLimbPresenceModes].reverse(),
      actorLimbErrorCodes: [...actorLimbErrorCodes],
    });
    const before = structuredClone(manifest);

    const plan = buildPlan("scene.submit", manifest);

    expect(plan).toMatchObject({
      mode: "compatible",
      actionAllowed: true,
    });
    expect(manifest).toEqual(before);
  });

  it.each([
    "clientKey",
    "clientkey",
    "CLIENTKEY",
    "CLIENT_KEY",
    "client-key",
    "runtimeAuth",
    "runtimeauth",
    "RUNTIMEAUTH",
    "RUNTIME_AUTH",
    "runtime-auth",
    "authHeader",
    "authheader",
    "AUTHHEADER",
    "AUTH_HEADER",
    "auth-header",
    "apiKey",
    "token",
    "authorization",
    "credential",
    "password",
    "bearer",
    "secret",
    "model",
    "provider",
    "baseUrl",
    "endpoint",
  ])("rejects nested sensitive configuration key %s", (key) => {
    const plan = buildPlan(
      "scene.submit",
      v2Manifest({
        diagnostics: {
          transport: [{ publicStatus: { [key]: false } }],
        },
      }),
    );

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      blockingError: { code: "SEMANTIC_BOUNDARY_VIOLATION" },
    });
  });

  it.each([
    "tokenizerVersion",
    "secretaryCount",
    "secretionStatus",
    "forbearerCount",
  ])("allows neutral nested diagnostic key %s", (key) => {
    const plan = buildPlan(
      "snapshot",
      v2Manifest({
        diagnostics: { nested: [{ [key]: "generic" }] },
      }),
    );

    expect(plan).toMatchObject({
      mode: "compatible",
      actionAllowed: true,
      blockingError: null,
    });
  });

  it.each([undefined, 0, 1.5])(
    "rejects invalid bundled bridge protocol version %s",
    (skillBridgeProtocolVersion) => {
      const plan = buildPlan("ensure", v2Manifest(), {
        skillBridgeProtocolVersion,
      });

      expect(plan).toMatchObject({
        mode: "incompatible",
        actionAllowed: false,
        allowedActions: [],
        blockingError: { code: "CAPABILITIES_INVALID" },
      });
    },
  );

  it("blocks an offline protocol that differs from the bundled Skill", () => {
    const plan = buildPlan(
      "ensure",
      v2Manifest({ bridgeProtocolVersion: 999 }),
    );

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      blockingError: { code: "BRIDGE_PROTOCOL_UNSUPPORTED" },
    });
  });

  it("blocks a live protocol that differs from the bundle and doctor", () => {
    const plan = buildPlan("scene.submit", v2Manifest(), {
      liveRequested: true,
      healthData: v2Manifest({ bridgeProtocolVersion: 999 }),
    });

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      liveVerified: false,
      blockingError: { code: "BRIDGE_PROTOCOL_UNSUPPORTED" },
    });
  });

  it("ignores future application semver for routing", () => {
    const plan = buildPlan(
      "patch.submit",
      v2Manifest({ applicationVersion: "999.123.456-next.7" }),
    );

    expect(plan).toMatchObject({
      mode: "compatible",
      actionAllowed: true,
      allowedActions: [...commandIds],
      blockingError: null,
    });
  });

  it.each([
    [
      "scene",
      { sceneSchemaVersion: 5 },
      ["scene.create", "scene.submit"],
      "SCENE_SCHEMA_UNSUPPORTED",
    ],
    [
      "patch",
      { patchSchemaVersion: 5 },
      ["patch.apply", "patch.submit"],
      "PATCH_SCHEMA_UNSUPPORTED",
    ],
    [
      "intent",
      { intentReportSchemaVersion: 5 },
      ["scene.submit", "patch.submit"],
      "INTENT_REPORT_SCHEMA_UNSUPPORTED",
    ],
  ] as const)(
    "degrades only %s-schema-dependent actions",
    (_label, manifestOverride, blockedActions, errorCode) => {
      const manifest = v2Manifest(manifestOverride);
      const unrelated = buildPlan("snapshot", manifest);

      expect(unrelated.mode).toBe("degraded");
      expect(unrelated.actionAllowed).toBe(true);
      expect(unrelated.blockingError).toBeNull();
      expect(unrelated.allowedActions).toEqual(
        commandIds.filter(
          (action) => !(blockedActions as readonly string[]).includes(action),
        ),
      );

      for (const action of blockedActions) {
        expect(buildPlan(action, manifest)).toMatchObject({
          mode: "degraded",
          actionAllowed: false,
          blockingError: { code: errorCode },
        });
      }
    },
  );

  it("degrades actions by their real command and feature requirements", () => {
    const manifest = v2Manifest({
      commands: commandIds.filter((id) => id !== "scene.save"),
      features: featureIds.filter(
        (id) => id !== "input.patch-submission.atomic",
      ),
    });
    const plan = buildPlan("snapshot", manifest);

    expect(plan.mode).toBe("degraded");
    expect(plan.allowedActions).not.toContain("scene.save");
    expect(plan.allowedActions).not.toContain("patch.submit");
    expect(plan.allowedActions).toContain("scene.submit");
    expect(plan.allowedActions).toContain("patch.apply");
    expect(plan.allowedActions).toContain("snapshot");
  });

  it("treats an offline/live boundary mismatch as incompatible", () => {
    const offline = v2Manifest();
    const plan = buildPlan("scene.submit", offline, {
      liveRequested: true,
      healthData: v2Manifest({ credentialPolicy: "optional" }),
    });

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      liveVerified: false,
      blockingError: { code: "SEMANTIC_BOUNDARY_VIOLATION" },
    });
  });

  it.each([
    ["entity lock modes", { entityLockModes: ["none", "workflow"] }],
    ["patch policy fields", { patchPolicyFields: ["keepLock"] }],
    [
      "lock error codes",
      {
        lockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "ENTITY_LOCKED",
        ],
      },
    ],
  ])("treats an offline/live %s mismatch as invalid", (_label, override) => {
    const plan = buildPlan("scene.submit", v2Manifest(), {
      liveRequested: true,
      healthData: v2Manifest(override),
    });

    expect(plan).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      allowedActions: [],
      liveVerified: false,
      blockingError: { code: "CAPABILITIES_INVALID" },
    });
  });

  it("allows a live application-version difference when boundaries match", () => {
    const plan = buildPlan("scene.submit", v2Manifest(), {
      liveRequested: true,
      healthData: v2Manifest({ applicationVersion: "999.0.0" }),
    });

    expect(plan).toMatchObject({
      mode: "compatible",
      actionAllowed: true,
      liveVerified: true,
      blockingError: null,
    });
  });
});

describe("portable v2 Skill wrapper", () => {
  it("rejects a v1 doctor response after exactly one doctor call", async () => {
    const runtime = await createFixture(
      v2Manifest({ capabilitiesContractVersion: 1 }),
    );

    const result = await runtime.run(["doctor"]);

    expectError(result, "CAPABILITIES_CONTRACT_UNSUPPORTED");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });
  });

  it("rejects a sensitive doctor diagnostic without echoing it or rereading doctor", async () => {
    const marker = "PRIVATE_DOCTOR_CLIENT_KEY_MARKER";
    const runtime = await createFixture(
      v2Manifest({
        diagnostics: {
          transport: [{ clientKey: marker }],
        },
      }),
    );

    const result = await runtime.run(["doctor"]);

    expectError(result, "SEMANTIC_BOUNDARY_VIOLATION", [marker]);
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });
  });

  it("sanitizes a valid doctor response to the manifest allowlist after one read", async () => {
    const manifest = v2Manifest({ applicationVersion: "999.0.0" });
    const runtime = await createFixture({
      ...manifest,
      diagnostics: {
        latencyMs: 7,
        transport: [{ publicStatus: "ready" }],
      },
      futurePublicField: "ignored",
    });

    const result = await runtime.run(["doctor"]);

    expect(result.exitCode).toBe(0);
    expect(parseEnvelope(result)).toEqual({ ok: true, data: manifest });
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
  });

  it.each([
    [
      "bridge protocol mismatch",
      v2Manifest({ bridgeProtocolVersion: 999 }),
      "BRIDGE_PROTOCOL_UNSUPPORTED",
      "The runtime bridge protocol is not supported.",
    ],
    [
      "missing doctor action",
      v2Manifest({
        commands: commandIds.filter((command) => command !== "doctor"),
      }),
      "CAPABILITY_NOT_AVAILABLE",
      "The requested runtime capability is not available.",
    ],
  ] as const)(
    "fails direct doctor closed for %s after one runtime read",
    async (_label, manifest, code, message) => {
      const runtime = await createFixture(manifest);

      const result = await runtime.run(["doctor"]);

      const envelope = expectError(result, code);
      expect(envelope.error).toEqual({ code, message });
      expect(await runtime.readActionIds()).toEqual(["doctor"]);
    },
  );

  it("keeps direct doctor available across schema drift and future application versions", async () => {
    const manifest = v2Manifest({
      applicationVersion: "999.123.456-next.7",
      sceneSchemaVersion: 999,
      patchSchemaVersion: 999,
      intentReportSchemaVersion: 999,
    });
    const runtime = await createFixture(manifest);

    const result = await runtime.run(["doctor"]);

    expect(result.exitCode).toBe(0);
    expect(parseEnvelope(result)).toEqual({ ok: true, data: manifest });
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
  });

  it("returns stable local help without importing the locator or invoking runtime", async () => {
    const runtime = await createFixture(v2Manifest());
    const copied = await createObservedCopiedWrapper();

    const result = await runtime.run(["help"], {
      wrapperPath: copied.wrapperPath,
    });

    expect(result.exitCode).toBe(0);
    expect(parseEnvelope(result)).toEqual({
      ok: true,
      data: {
        inputContract: "structured-only",
        commands: [...commandIds],
        compatibilityCommand:
          "compatibility plan --action <action> [--live]",
      },
    });
    expect(await runtime.readActionIds()).toEqual([]);
    await expect(
      readFile(copied.observationPath, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts the current authoritative copied IntentReport schema", async () => {
    const runtime = await createFixture(v2Manifest());
    const copied = await createObservedCopiedWrapper();

    const result = await runtime.run(
      ["scene", "submit", "--file", "scene.json"],
      { wrapperPath: copied.wrapperPath },
    );

    expect(result.exitCode).toBe(0);
    expect(parseEnvelope(result)).toMatchObject({ ok: true });
    expect(await runtime.readActionIds()).toEqual([
      "doctor",
      "health",
      "scene.submit",
    ]);
  });

  it.each([
    ["missing", "missing", []],
    [
      "invalid JSON",
      "invalid-json",
      ["PRIVATE_INTENT_SCHEMA_JSON_MARKER"],
    ],
    [
      "invalid shape with only the same-version node",
      "truncated-same-version",
      ["PRIVATE_INTENT_SCHEMA_TRUNCATED_MARKER"],
    ],
    [
      "same-version replacement",
      "replaced-same-version",
      ["PRIVATE_INTENT_SCHEMA_REPLACED_MARKER"],
    ],
    [
      "same-version tampering",
      "tampered-same-version",
      ["PRIVATE_INTENT_SCHEMA_TAMPERED_MARKER"],
    ],
    [
      "version mismatch",
      "version-mismatch",
      ["PRIVATE_INTENT_SCHEMA_VERSION_MARKER"],
    ],
  ] as const)(
    "fails closed when the copied IntentReport schema is %s",
    async (_label, mutation, hiddenMarkers) => {
      const runtime = await createFixture(v2Manifest());
      const copied = await createObservedCopiedWrapper();
      const copiedSkillDirectory = path.dirname(
        path.dirname(copied.wrapperPath),
      );
      const intentSchemaFile = path.join(
        copiedSkillDirectory,
        "references",
        "generated",
        "intent-report.schema.json",
      );

      if (mutation === "missing") {
        await rm(intentSchemaFile);
      } else if (mutation === "invalid-json") {
        await writeFile(
          intentSchemaFile,
          `{"private":"${hiddenMarkers[0]}"`,
          "utf8",
        );
      } else if (mutation === "truncated-same-version") {
        await writeFile(
          intentSchemaFile,
          `${JSON.stringify({
            properties: {
              schemaVersion: { const: 1 },
            },
            reviewMarker: hiddenMarkers[0],
          })}\n`,
          "utf8",
        );
      } else if (mutation === "replaced-same-version") {
        const replacement = JSON.parse(
          await readFile(
            path.join(
              copiedSkillDirectory,
              "references",
              "generated",
              "scene-spec.schema.json",
            ),
            "utf8",
          ),
        ) as Record<string, unknown>;
        replacement.reviewMarker = hiddenMarkers[0];
        await writeFile(
          intentSchemaFile,
          `${JSON.stringify(replacement, null, 2)}\n`,
          "utf8",
        );
      } else {
        const schema = JSON.parse(
          await readFile(intentSchemaFile, "utf8"),
        ) as Record<string, unknown> & {
          properties: { schemaVersion: { const: number } };
        };
        if (mutation === "version-mismatch") {
          schema.properties.schemaVersion.const += 1;
        }
        schema.reviewMarker = hiddenMarkers[0];
        await writeFile(
          intentSchemaFile,
          `${JSON.stringify(schema, null, 2)}\n`,
          "utf8",
        );
      }

      const result = await runtime.run(
        ["scene", "submit", "--file", "scene.json"],
        { wrapperPath: copied.wrapperPath },
      );

      expectError(result, "SKILL_SCHEMA_INVALID", [...hiddenMarkers]);
      expect(await runtime.readActionIds()).toEqual([]);
      expect(await runtime.readState()).toEqual({
        sceneId: "scene_generic_runtime",
        revision: 0,
        mutationCount: 0,
        startupCount: 0,
      });
    },
  );

  it.each(["help", "doctor"] as const)(
    "rejects trailing %s arguments before locator or runtime access",
    async (command) => {
      const runtime = await createFixture(v2Manifest());
      const copied = await createObservedCopiedWrapper();

      const result = await runtime.run([command, "--unexpected"], {
        wrapperPath: copied.wrapperPath,
      });

      expectError(result, "CLI_UNKNOWN_ARGUMENT");
      expect(await runtime.readActionIds()).toEqual([]);
      await expect(
        readFile(copied.observationPath, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each([
    [
      "help credential",
      ["help", "--clientKey", "PRIVATE_HELP_KEY_MARKER"],
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
    ],
    [
      "doctor model",
      ["doctor", "--modelConfig", "PRIVATE_DOCTOR_MODEL_MARKER"],
      "MODEL_CONFIGURATION_FORBIDDEN",
    ],
  ] as const)(
    "keeps %s preflight ahead of direct-command trailing argument validation",
    async (_label, args, code) => {
      const runtime = await createFixture(v2Manifest());

      const result = await runtime.run([...args]);

      expectError(
        result,
        code,
        args.filter((argument) => argument.includes("MARKER")),
      );
      expect(await runtime.readActionIds()).toEqual([]);
    },
  );

  it("fails closed when open.system cannot start a bridge dynamically", async () => {
    const runtime = await createFixture(
      v2Manifest({
        commands: commandIds.filter((command) => command !== "ensure"),
      }),
    );

    const result = await runtime.run(["open", "--system"]);

    expectError(result, "CAPABILITY_NOT_AVAILABLE");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });
  });

  it(
    "keeps root and portable option classifiers in parity, including -clientKey as a file value",
    async () => {
      const boundary = (await import(
        /* @vite-ignore */ pathToFileURL(
          path.resolve("scripts", "process-boundary.mjs"),
        ).href
      )) as {
        assertNoForbiddenDirectorArguments(args: readonly string[]): void;
      };
      const runtime = await createFixture(v2Manifest());
      const observed: Array<{
        id: string;
        root: OptionBoundaryClassification;
        portable: OptionBoundaryClassification;
      }> = [];
      let singleHyphenActions: string[] = [];

      for (const testCase of optionBoundaryCases) {
        let root: OptionBoundaryClassification = "allowed";
        try {
          boundary.assertNoForbiddenDirectorArguments(testCase.args);
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            typeof error.code !== "string"
          ) {
            throw error;
          }
          root = error.code as OptionBoundaryClassification;
        }

        const result = await runtime.run([...testCase.args]);
        const envelope = parseEnvelope(result);
        const portable =
          result.exitCode === 0
            ? "allowed"
            : (envelope.error?.code as OptionBoundaryClassification);
        for (const marker of testCase.hiddenMarkers) {
          expect(result.stdout).not.toContain(marker);
          expect(result.stderr).not.toContain(marker);
        }
        observed.push({ id: testCase.id, root, portable });
        if (testCase.id === "single-hyphen-client-key") {
          singleHyphenActions = await runtime.readActionIds();
        }
        await runtime.reset();
      }

      expect({ observed, singleHyphenActions }).toEqual({
        observed: optionBoundaryCases.map((testCase) => ({
          id: testCase.id,
          root: testCase.expected,
          portable: testCase.expected,
        })),
        singleHyphenActions: ["doctor", "health", "scene.submit"],
      });
    },
    60_000,
  );

  it.each([
    ["scene.submit", ["scene", "submit", "--file", "scene.json"]],
    ["patch.submit", ["patch", "submit", "--file", "patch.json"]],
  ] as const)("plans, live-verifies, and forwards %s", async (action, args) => {
    const runtime = await createFixture(v2Manifest());

    const result = await runtime.run([...args]);

    expect(result.exitCode).toBe(0);
    expect(parseEnvelope(result)).toMatchObject({ ok: true });
    expect(await runtime.readActionIds()).toEqual([
      "doctor",
      "health",
      action,
    ]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 1,
      startupCount: 0,
      revision: 1,
    });
  });

  it.each([
    ["scene.create", ["scene", "create"]],
    ["scene.submit", ["scene", "submit"]],
    ["scene.save", ["scene", "save"]],
    ["scene.load", ["scene", "load"]],
    ["patch.apply", ["patch", "apply"]],
    ["patch.submit", ["patch", "submit"]],
    [
      "export.png",
      ["export", "png", "--width", "1920", "--height", "1080"],
    ],
  ] as const)(
    "resolves the %s --file value from the wrapper caller cwd before forwarding",
    async (action, commandPrefix) => {
      const runtime = await createFixture(v2Manifest());
      const callerDirectory = await mkdtemp(
        path.join(os.tmpdir(), "skill-wrapper-caller-"),
      );
      temporaryRoots.push(callerDirectory);
      const relativeFile = path.join("relative", `${action}.json`);
      const expectedFile = path.resolve(callerDirectory, relativeFile);
      await mkdir(path.dirname(expectedFile), { recursive: true });
      const args = [...commandPrefix, "--file", relativeFile];

      const result = await runtime.run(args, { cwd: callerDirectory });

      expect(result.exitCode).toBe(0);
      expect(parseEnvelope(result)).toMatchObject({ ok: true });
      const forwarded = (await runtime.readArgumentVectors()).at(-1);
      expect(forwarded).toEqual([
        ...commandPrefix,
        "--file",
        expectedFile,
      ]);
      expect(result.stdout).not.toContain(relativeFile);
      expect(result.stdout).not.toContain(expectedFile);
      expect(result.stderr).not.toContain(relativeFile);
      expect(result.stderr).not.toContain(expectedFile);
    },
  );

  it.each([
    ["scene.submit", ["scene", "submit"]],
    [
      "export.png",
      ["export", "png", "--width", "1920", "--height", "1080"],
    ],
  ] as const)(
    "preserves a whitespace-only %s --file value for runtime validation",
    async (action, commandPrefix) => {
      const runtime = await createFixture(v2Manifest(), {
        actionErrors: {
          [action]: {
            code: "CLI_ARGUMENT_REQUIRED",
            message: "--file is required and must not be empty.",
          },
        },
      });
      const whitespaceFile = " \t ";
      const args = [...commandPrefix, "--file", whitespaceFile];

      const result = await runtime.run(args);

      expectError(result, "CLI_ARGUMENT_REQUIRED");
      expect((await runtime.readArgumentVectors()).at(-1)).toEqual(args);
    },
  );

  it.each([
    [
      "input",
      [
        "scene",
        "submit",
        "--file",
        "D:PRIVATE_DRIVE_RELATIVE_INPUT.json",
      ],
      "D:PRIVATE_DRIVE_RELATIVE_INPUT.json",
    ],
    [
      "output",
      [
        "export",
        "png",
        "--file",
        "C:PRIVATE_DRIVE_RELATIVE_OUTPUT.png",
        "--width",
        "1920",
        "--height",
        "1080",
      ],
      "C:PRIVATE_DRIVE_RELATIVE_OUTPUT.png",
    ],
    ["bare drive", ["scene", "load", "--file", "C:"], "C:"],
  ] as const)(
    "rejects a Windows drive-relative %s file before locator or runtime access",
    async (_label, args, hiddenPath) => {
      const runtime = await createFixture(v2Manifest());
      const copied = await createObservedCopiedWrapper();

      const result = await runtime.run([...args], {
        wrapperPath: copied.wrapperPath,
      });

      expectError(result, "CLI_ARGUMENT_INVALID", [hiddenPath]);
      await expect(
        readFile(copied.observationPath, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await runtime.readActionIds()).toEqual([]);
      expect(await runtime.readState()).toEqual({
        sceneId: "scene_generic_runtime",
        revision: 0,
        mutationCount: 0,
        startupCount: 0,
      });
    },
  );

  it.each([
    ["input", ["scene", "submit"], "scene.json"],
    [
      "output",
      ["export", "png", "--width", "1920", "--height", "1080"],
      "output.png",
    ],
  ] as const)(
    "keeps a native absolute %s --file value unchanged",
    async (_label, commandPrefix, fileName) => {
      const runtime = await createFixture(v2Manifest());
      const callerDirectory = await mkdtemp(
        path.join(os.tmpdir(), "skill-wrapper-absolute-"),
      );
      temporaryRoots.push(callerDirectory);
      const absoluteFile = path.join(callerDirectory, fileName);
      const args = [...commandPrefix, "--file", absoluteFile];

      const result = await runtime.run(args, { cwd: callerDirectory });

      expect(result.exitCode).toBe(0);
      expect((await runtime.readArgumentVectors()).at(-1)).toEqual(args);
    },
  );

  it("leaves --file-like argv unchanged for a synthetic non-file action", async () => {
    const runtime = await createFixture(v2Manifest());
    const args = ["status", "--file", path.join("relative", "status.json")];

    const result = await runtime.run(args);

    expect(result.exitCode).toBe(0);
    expect((await runtime.readArgumentVectors()).at(-1)).toEqual(args);
  });

  it.each([
    ["v1", v2Manifest({ capabilitiesContractVersion: 1 })],
    [
      "legacy",
      {
        service: "shubi-shot-director",
        applicationVersion: "0.1.0",
        bridgeProtocolVersion: 1,
      },
    ],
  ])("blocks %s before startup or mutation", async (_label, manifest) => {
    const runtime = await createFixture(manifest);

    const mutation = await runtime.run([
      "scene",
      "submit",
      "--file",
      "scene.json",
    ]);
    expectError(mutation, "CAPABILITIES_CONTRACT_UNSUPPORTED");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });

    await runtime.reset();
    const startup = await runtime.run(["ensure"]);
    expectError(startup, "CAPABILITIES_CONTRACT_UNSUPPORTED");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
    });
  });

  it.each([
    [
      "missing entity lock modes",
      { entityLockModes: undefined },
      ["patch", "submit", "--file", "patch.json"],
    ],
    [
      "mismatched entity lock modes",
      { entityLockModes: ["none", "workflow", "system"] },
      ["ensure"],
    ],
    [
      "missing patch policy fields",
      { patchPolicyFields: undefined },
      ["patch", "submit", "--file", "patch.json"],
    ],
    [
      "mismatched patch policy fields",
      { patchPolicyFields: ["keepLock"] },
      ["ensure"],
    ],
    [
      "missing lock error codes",
      { lockErrorCodes: undefined },
      ["patch", "submit", "--file", "patch.json"],
    ],
    [
      "mismatched lock error codes",
      {
        lockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "ENTITY_LOCKED",
        ],
      },
      ["ensure"],
    ],
  ] as const)(
    "blocks %s before startup or scene mutation",
    async (_label, manifestOverride, args) => {
      const runtime = await createFixture(v2Manifest(manifestOverride));

      const result = await runtime.run([...args]);

      expectError(result, "CAPABILITIES_INVALID");
      expect(await runtime.readActionIds()).toEqual(["doctor"]);
      expect(await runtime.readState()).toMatchObject({
        mutationCount: 0,
        startupCount: 0,
        revision: 0,
      });
    },
  );

  it("blocks a semantic-boundary violation before forwarding", async () => {
    const runtime = await createFixture(
      v2Manifest({ requiresApiKey: false }),
    );

    const result = await runtime.run([
      "patch",
      "submit",
      "--file",
      "patch.json",
    ]);

    expectError(result, "SEMANTIC_BOUNDARY_VIOLATION");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({ mutationCount: 0 });
  });

  it("blocks a nested sensitive key before startup or mutation", async () => {
    const runtime = await createFixture(
      v2Manifest({
        diagnostics: {
          transport: [{ runtime_auth: "private-value" }],
        },
      }),
    );

    const mutation = await runtime.run([
      "patch",
      "submit",
      "--file",
      "patch.json",
    ]);
    expectError(mutation, "SEMANTIC_BOUNDARY_VIOLATION", [
      "private-value",
    ]);
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });

    await runtime.reset();
    const startup = await runtime.run(["ensure"]);
    expectError(startup, "SEMANTIC_BOUNDARY_VIOLATION", [
      "private-value",
    ]);
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
    });
  });

  it("blocks protocol 999 before startup or mutation", async () => {
    const runtime = await createFixture(
      v2Manifest({ bridgeProtocolVersion: 999 }),
    );

    const mutation = await runtime.run([
      "scene",
      "submit",
      "--file",
      "scene.json",
    ]);
    expectError(mutation, "BRIDGE_PROTOCOL_UNSUPPORTED");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });

    await runtime.reset();
    const startup = await runtime.run(["ensure"]);
    expectError(startup, "BRIDGE_PROTOCOL_UNSUPPORTED");
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
    });
  });

  it("blocks a live protocol mismatch before mutation", async () => {
    const runtime = await createFixture(v2Manifest(), {
      healthData: v2Manifest({ bridgeProtocolVersion: 999 }),
    });

    const result = await runtime.run([
      "scene",
      "submit",
      "--file",
      "scene.json",
    ]);

    expectError(result, "BRIDGE_PROTOCOL_UNSUPPORTED");
    expect(await runtime.readActionIds()).toEqual(["doctor", "health"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      startupCount: 0,
      revision: 0,
    });
  });

  it("forwards an unrelated action when one schema is degraded", async () => {
    const runtime = await createFixture(
      v2Manifest({ sceneSchemaVersion: 5 }),
    );

    const result = await runtime.run(["snapshot"]);

    expect(result.exitCode).toBe(0);
    expect(await runtime.readActionIds()).toEqual([
      "doctor",
      "health",
      "snapshot",
    ]);
    expect(await runtime.readState()).toMatchObject({ mutationCount: 0 });
  });

  it("blocks an offline/live boundary mismatch before mutation", async () => {
    const runtime = await createFixture(v2Manifest(), {
      healthData: v2Manifest({ inputContract: "raw-text" }),
    });

    const result = await runtime.run([
      "scene",
      "submit",
      "--file",
      "scene.json",
    ]);

    expectError(result, "SEMANTIC_BOUNDARY_VIOLATION");
    expect(await runtime.readActionIds()).toEqual(["doctor", "health"]);
    expect(await runtime.readState()).toMatchObject({
      mutationCount: 0,
      revision: 0,
    });
  });

  it.each([
    ["legacy create", ["shot", "create", "--text", "RAW_CREATE_MARKER"]],
    ["legacy modify", ["shot", "modify", "--text", "RAW_MODIFY_MARKER"]],
    [
      "legacy profile",
      ["profile", "resolve", "--file", "RAW_PROFILE_MARKER"],
    ],
    [
      "structured action --text",
      ["scene", "submit", "--text", "RAW_SCENE_MARKER"],
    ],
    ["inline --text", ["status", "--text=RAW_INLINE_MARKER"]],
  ] as const)("rejects %s before runtime resolution", async (_label, args) => {
    const missingRuntime = path.join(
      os.tmpdir(),
      `missing-runtime-${process.pid}-${Math.random()}`,
    );
    const markers = args.filter((argument) => argument.includes("MARKER"));

    const result = await runSkillWrapper(missingRuntime, [...args]);

    expectError(result, "HOST_STRUCTURED_INPUT_REQUIRED", markers);
  });

  it.each([
    ["--api-key", "CREDENTIAL_ARGUMENT_FORBIDDEN"],
    ["--token=value", "CREDENTIAL_ARGUMENT_FORBIDDEN"],
    ["--authorization", "CREDENTIAL_ARGUMENT_FORBIDDEN"],
    ["--secret=value", "CREDENTIAL_ARGUMENT_FORBIDDEN"],
    ["--model", "MODEL_CONFIGURATION_FORBIDDEN"],
    ["--provider=value", "MODEL_CONFIGURATION_FORBIDDEN"],
    ["--base-url", "MODEL_CONFIGURATION_FORBIDDEN"],
    ["--endpoint=value", "MODEL_CONFIGURATION_FORBIDDEN"],
  ])("rejects %s before runtime resolution", async (argument, code) => {
    const missingRuntime = path.join(
      os.tmpdir(),
      `missing-runtime-${process.pid}-${Math.random()}`,
    );
    const result = await runSkillWrapper(missingRuntime, [
      "status",
      argument,
      "PRIVATE_ARGUMENT_MARKER",
    ]);

    expectError(result, code, ["PRIVATE_ARGUMENT_MARKER"]);
  });

  it.each([
    ["clientKey separated", "--clientKey", false],
    ["clientKey inline", "--clientKey", true],
    ["runtime_auth separated", "--runtime_auth", false],
    ["runtime_auth inline", "--runtime_auth", true],
    ["auth-header separated", "--auth-header", false],
    ["auth-header inline", "--auth-header", true],
  ] as const)(
    "rejects copied-wrapper credential variant %s before locator or runtime actions",
    async (label, option, inline) => {
      const runtime = await createFixture(v2Manifest());
      const copied = await createObservedCopiedWrapper();
      const marker = `PRIVATE_${label.replace(/[^a-z0-9]/gi, "_")}_MARKER`;
      const optionArguments = inline
        ? [`${option}=${marker}`]
        : [option, marker];

      const result = await runtime.run(
        [
          "scene",
          "submit",
          "--file",
          "scene.json",
          ...optionArguments,
        ],
        { wrapperPath: copied.wrapperPath },
      );

      expectError(result, "CREDENTIAL_ARGUMENT_FORBIDDEN", [marker]);
      await expect(
        readFile(copied.observationPath, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await runtime.readActionIds()).toEqual([]);
      expect(await runtime.readState()).toMatchObject({
        mutationCount: 0,
        startupCount: 0,
        revision: 0,
      });
    },
  );

  it("does not parse trailing legacy arguments before fixed rejection", async () => {
    const missingRuntime = path.join(
      os.tmpdir(),
      `missing-runtime-${process.pid}-${Math.random()}`,
    );
    const result = await runSkillWrapper(missingRuntime, [
      "shot",
      "create",
      "--api-key",
      "LEGACY_SECRET_MARKER",
    ]);

    expectError(result, "HOST_STRUCTURED_INPUT_REQUIRED", [
      "LEGACY_SECRET_MARKER",
    ]);
  });

  it.each([
    [
      "legacy text",
      ["shot", "create", "COPIED_RAW_MARKER"],
      "HOST_STRUCTURED_INPUT_REQUIRED",
    ],
    [
      "credential argument",
      ["status", "--api-key", "COPIED_KEY_MARKER"],
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
    ],
    [
      "model argument",
      ["status", "--model", "COPIED_MODEL_MARKER"],
      "MODEL_CONFIGURATION_FORBIDDEN",
    ],
  ] as const)(
    "rejects %s before loading a missing locator module",
    async (_label, args, code) => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "copied-skill-wrapper-"),
      );
      temporaryRoots.push(directory);
      const scriptsDirectory = path.join(directory, "scripts");
      const copiedWrapper = path.join(scriptsDirectory, "director.mjs");
      await mkdir(scriptsDirectory, { recursive: true });
      await copyFile(wrapperPath, copiedWrapper);

      const result = await runSkillWrapper(
        path.join(directory, "missing-runtime"),
        [...args],
        { wrapperPath: copiedWrapper },
      );

      expectError(
        result,
        code,
        args.filter((argument) => argument.includes("MARKER")),
      );
    },
  );

  it("allows parent host markers but exposes none to runtime children", async () => {
    const runtime = await createFixture(v2Manifest());
    const environment: NodeJS.ProcessEnv = {};
    for (const name of deniedRuntimeEnvironmentNames) {
      environment[name] =
        name === "NODE_OPTIONS"
          ? "--no-warnings"
          : `${name.toLowerCase()}-host-marker`;
    }

    const result = await runtime.run(["snapshot"], { environment });

    expect(result.exitCode).toBe(0);
    expect(await runtime.readActionIds()).toEqual([
      "doctor",
      "health",
      "snapshot",
    ]);
    expect(await runtime.readEnvironmentObservations()).toEqual([
      { action: "doctor", presentDeniedNames: [] },
      { action: "health", presentDeniedNames: [] },
      { action: "snapshot", presentDeniedNames: [] },
    ]);
  });

  it("builds child environments without ambient enumeration or spread", async () => {
    const source = await readFile(wrapperPath, "utf8");

    expect(source).not.toMatch(
      /Object\.(?:keys|entries|values)\s*\(\s*process\.env\s*\)/,
    );
    expect(source).not.toMatch(/\.\.\.\s*process\.env/);
    expect(source).not.toMatch(/for\s*\([^)]*\bin\s+process\.env\s*\)/);
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("AZURE_OPENAI_ENDPOINT");
    expect(source).not.toContain("HTTP_PROXY");
    expect(source).not.toContain("HTTPS_PROXY");
    expect(source).not.toContain("ALL_PROXY");
    expect(source).not.toContain("NODE_OPTIONS");
  });

  it.each([
    [
      "USER_LOCKED",
      "A requested scene entity is user-locked.",
    ],
    [
      "WORKFLOW_LOCKED",
      "A requested scene entity is workflow-locked.",
    ],
    [
      "LOCK_PRESERVATION_CONFLICT",
      "The requested change conflicts with lock preservation.",
    ],
  ] as const)("maps %s to a safe stable message", async (code, message) => {
    const marker = `PRIVATE_${code}_MARKER`;
    const runtime = await createFixture(v2Manifest(), {
      actionErrors: {
        "patch.apply": { code, message: marker },
      },
    });

    const result = await runtime.run([
      "patch",
      "apply",
      "--file",
      "patch.json",
    ]);

    const envelope = expectError(result, code, [marker]);
    expect(envelope.error).toEqual({ code, message });
    expect(await runtime.readState()).toMatchObject({ mutationCount: 0 });
  });

  it("sanitizes forwarded runtime failures", async () => {
    const marker = "PRIVATE_RUNTIME_FAILURE_MARKER";
    const runtime = await createFixture(v2Manifest(), {
      actionErrors: {
        snapshot: { code: "PRIVATE_CODE", message: marker },
      },
    });

    const result = await runtime.run(["snapshot"]);

    expectError(result, "RUNTIME_COMMAND_FAILED", [marker, "PRIVATE_CODE"]);
  });

  it("emits a deterministic v2 compatibility plan through the wrapper", async () => {
    const runtime = await createFixture(
      v2Manifest({ applicationVersion: "999.0.0" }),
    );

    const plan = readPlan(
      await runtime.run([
        "compatibility",
        "plan",
        "--action",
        "patch.submit",
      ]),
    );

    expect(plan).toMatchObject({
      planContractVersion: 2,
      mode: "compatible",
      requestedAction: "patch.submit",
      actionAllowed: true,
      allowedActions: [...commandIds],
      liveVerified: false,
      blockingError: null,
    });
    expect(await runtime.readActionIds()).toEqual(["doctor"]);
  });
});

describe("forward compatibility fixture generator", () => {
  it("creates the same v2 cases for both portable tiers", async () => {
    const root = path.join(
      os.tmpdir(),
      `skill-forward-fixtures-${process.pid}-${Math.random()}`,
    );
    temporaryRoots.push(root);
    const created = await createSkillForwardFixtures(root);

    expect(created.tiers).toEqual([...defaultForwardTiers]);
    for (const tier of created.tiers) {
      expect(Object.keys(created.cases[tier])).toEqual(forwardCaseIds);
      const fixture = JSON.parse(
        await readFile(
          path.join(
            created.cases[tier].current,
            "fixture-config.json",
          ),
          "utf8",
        ),
      ) as { doctorData: Record<string, unknown> };
      expect(fixture.doctorData).toMatchObject({
        capabilitiesContractVersion: 2,
        sceneSchemaVersion: 4,
        patchSchemaVersion: 4,
        intentReportSchemaVersion: 4,
        entityLockModes: [...entityLockModes],
        patchPolicyFields: [...patchPolicyFields],
        lockErrorCodes: [...lockErrorCodes],
        actorLimbPartIds: [...actorLimbPartIds],
        actorLimbPresenceModes: [...actorLimbPresenceModes],
        actorLimbErrorCodes: [...actorLimbErrorCodes],
      });
    }
  });
});
