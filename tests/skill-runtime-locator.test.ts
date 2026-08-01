import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

const EXPECTED_RUNTIME_NAME = "shubi-shot-director";
const V2_RUNTIME_METADATA = {
  capabilitiesContractVersion: 2,
  bridgeProtocolVersion: 1,
  workspaceRoutingVersion: 1,
  sceneSchemaVersion: 6,
  patchSchemaVersion: 6,
  intentReportSchemaVersion: 6,
  semanticAuthority: "host",
  inputContract: "structured-only",
  modelIntegration: "none",
  credentialPolicy: "forbidden",
  networkPolicy: "loopback-only",
  entityLockModes: ["none", "workflow", "user"],
  patchPolicyFields: ["preserveLock"],
  lockErrorCodes: [
    "USER_LOCKED",
    "WORKFLOW_LOCKED",
    "LOCK_PRESERVATION_CONFLICT",
  ],
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
  actorPuppet: {
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
    operationIds: ["actor.height.set", "actor.pose.joints.set"],
    errorCodes: [
      "ACTOR_HEIGHT_TARGET_INVALID",
      "ACTOR_HEIGHT_RANGE_INVALID",
      "ACTOR_JOINT_TARGET_INVALID",
      "ACTOR_JOINT_ID_INVALID",
    ],
  },
  actorBlueprint: {
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
  },
} as const;
const RUNTIME_NOT_FOUND_MESSAGE =
  "A compatible Shubi Shot Director runtime was not found.";
const skillScriptsDirectory = path.resolve(
  ".agents",
  "skills",
  "shubi-shot-director",
  "scripts",
);
const locatorModuleUrl = pathToFileURL(
  path.join(skillScriptsDirectory, "runtime-locator.mjs"),
).href;
const execFileAsync = promisify(execFile);

interface LocatorOptions {
  environment?: Record<string, string | undefined>;
  skillDirectory?: string;
}

interface LocatorModule {
  SkillRuntimeError: new () => Error & { code: string };
  resolveRuntimeEntrypoint: (
    options?: LocatorOptions,
  ) => Promise<string>;
}

let locator: LocatorModule;
const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "skill-runtime-locator-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const createRuntime = async (
  root: string,
  options: {
    entrypoint?: string;
    entrypointKind?: "directory" | "file" | "missing";
    packageName?: string;
  } = {},
): Promise<string> => {
  const entrypoint = options.entrypoint ?? path.join("scripts", "director.mjs");
  const entrypointPath = path.join(root, entrypoint);
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({
      name: options.packageName ?? EXPECTED_RUNTIME_NAME,
    })}\n`,
  );

  if (options.entrypointKind === "directory") {
    await mkdir(entrypointPath, { recursive: true });
  } else if (options.entrypointKind !== "missing") {
    await mkdir(path.dirname(entrypointPath), { recursive: true });
    await writeFile(entrypointPath, "export {};\n");
  }

  return entrypointPath;
};

const writeRuntimeMetadata = async (
  skillDirectory: string,
  metadata: unknown,
): Promise<void> => {
  await mkdir(skillDirectory, { recursive: true });
  const value =
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
      ? { ...V2_RUNTIME_METADATA, ...metadata }
      : metadata;
  await writeFile(
    path.join(skillDirectory, "runtime.json"),
    `${JSON.stringify(value)}\n`,
  );
};

const expectRuntimeNotFound = async (
  operation: Promise<unknown>,
  hiddenMarkers: string[] = [],
): Promise<void> => {
  try {
    await operation;
    throw new Error("Expected runtime discovery to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(locator.SkillRuntimeError);
    expect(error).toMatchObject({
      code: "RUNTIME_NOT_FOUND",
      message: RUNTIME_NOT_FOUND_MESSAGE,
    });
    expect(String(error)).toBe(
      `SkillRuntimeError: ${RUNTIME_NOT_FOUND_MESSAGE}`,
    );
    for (const marker of hiddenMarkers) {
      expect((error as Error).message).not.toContain(marker);
      expect(String(error)).not.toContain(marker);
    }
  }
};

beforeAll(async () => {
  locator = (await import(/* @vite-ignore */ locatorModuleUrl)) as LocatorModule;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

afterAll(() => {
  locator = undefined as unknown as LocatorModule;
});

describe("skill runtime locator", () => {
  it("declares canonical workspace routing metadata", async () => {
    const metadata = JSON.parse(
      await readFile(
        path.resolve(
          ".agents",
          "skills",
          "shubi-shot-director",
          "runtime.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(metadata.workspaceRoutingVersion).toBe(1);
  });

  it("publishes fail-closed v2 boundary and schema metadata", async () => {
    const metadata = JSON.parse(
      await readFile(
        path.resolve(
          ".agents",
          "skills",
          "shubi-shot-director",
          "runtime.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(metadata).toEqual({
      locatorContractVersion: 1,
      relativeRoot: "../../..",
      entrypoint: "scripts/director.mjs",
      ...V2_RUNTIME_METADATA,
    });
  });

  it("prefers an explicit compatible runtime root regardless of skill depth", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const runtimeRoot = path.join(temporaryDirectory, "explicit-runtime");
    const entrypoint = await createRuntime(runtimeRoot);
    const unrelatedSkillDirectory = path.join(
      temporaryDirectory,
      "unrelated",
      "deeply",
      "nested",
      "skill",
    );
    await mkdir(unrelatedSkillDirectory, { recursive: true });

    const resolved = await locator.resolveRuntimeEntrypoint({
      environment: {
        SHUBI_SHOT_RUNTIME_ROOT: runtimeRoot,
      },
      skillDirectory: unrelatedSkillDirectory,
    });

    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(await realpath(entrypoint));
  });

  it.each([
    {
      label: "package name does not match",
      options: { packageName: "generic-director-package" },
    },
    {
      label: "entrypoint is missing",
      options: { entrypointKind: "missing" as const },
    },
    {
      label: "entrypoint is not a regular file",
      options: { entrypointKind: "directory" as const },
    },
  ])("rejects an explicit root when $label", async ({ options }) => {
    const temporaryDirectory = await createTemporaryDirectory();
    const marker = "configured-runtime-marker";
    const configuredRoot = path.join(temporaryDirectory, marker);
    await createRuntime(configuredRoot, options);

    const fallbackRoot = path.join(temporaryDirectory, "fallback-runtime");
    await createRuntime(fallbackRoot);
    const skillDirectory = path.join(fallbackRoot, "nested", "skill");
    await mkdir(skillDirectory, { recursive: true });

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {
          SHUBI_SHOT_RUNTIME_ROOT: configuredRoot,
        },
        skillDirectory,
      }),
      [configuredRoot, marker],
    );
  });

  it("uses release metadata at arbitrary skill nesting depth", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const runtimeRoot = path.join(temporaryDirectory, "runtime");
    const entrypoint = await createRuntime(runtimeRoot);
    const skillDirectory = path.join(
      temporaryDirectory,
      "release",
      "version",
      "nested",
      "skills",
      "director",
    );
    await writeRuntimeMetadata(skillDirectory, {
      locatorContractVersion: 1,
      relativeRoot: path.relative(skillDirectory, runtimeRoot),
      entrypoint: path.join("scripts", "director.mjs"),
    });

    const resolved = await locator.resolveRuntimeEntrypoint({
      environment: {},
      skillDirectory,
    });

    expect(resolved).toBe(await realpath(entrypoint));
  });

  it("starts a root-level release entrypoint from its validated runtime root", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const runtimeRoot = path.join(temporaryDirectory, "runtime");
    const entrypoint = await createRuntime(runtimeRoot, {
      entrypoint: "director.mjs",
    });
    const observationPath = path.join(
      temporaryDirectory,
      "runtime-cwd.txt",
    );
    const doctorData = {
      service: EXPECTED_RUNTIME_NAME,
      ...V2_RUNTIME_METADATA,
      applicationVersion: "1.0.0",
      commands: ["doctor"],
      features: ["bridge.thread-workspaces"],
    };
    await writeFile(
      entrypoint,
      `
        import { writeFileSync } from "node:fs";
        writeFileSync(
          ${JSON.stringify(observationPath)},
          process.cwd(),
          "utf8",
        );
        process.stdout.write(
          ${JSON.stringify(`${JSON.stringify({ ok: true, data: doctorData })}\n`)},
        );
      `,
    );

    const skillDirectory = path.join(
      temporaryDirectory,
      "release",
      "nested",
      "skill",
    );
    const bundledScriptsDirectory = path.join(skillDirectory, "scripts");
    const bundledGeneratedDirectory = path.join(
      skillDirectory,
      "references",
      "generated",
    );
    await Promise.all([
      mkdir(bundledScriptsDirectory, { recursive: true }),
      mkdir(bundledGeneratedDirectory, { recursive: true }),
    ]);
    await Promise.all([
      copyFile(
        path.join(skillScriptsDirectory, "director.mjs"),
        path.join(bundledScriptsDirectory, "director.mjs"),
      ),
      copyFile(
        path.join(skillScriptsDirectory, "runtime-locator.mjs"),
        path.join(bundledScriptsDirectory, "runtime-locator.mjs"),
      ),
      copyFile(
        path.join(skillScriptsDirectory, "compatibility-plan.mjs"),
        path.join(bundledScriptsDirectory, "compatibility-plan.mjs"),
      ),
      copyFile(
        path.join(
          path.dirname(skillScriptsDirectory),
          "references",
          "generated",
          "scene-spec.schema.json",
        ),
        path.join(bundledGeneratedDirectory, "scene-spec.schema.json"),
      ),
      copyFile(
        path.join(
          path.dirname(skillScriptsDirectory),
          "references",
          "generated",
          "scene-patch.schema.json",
        ),
        path.join(bundledGeneratedDirectory, "scene-patch.schema.json"),
      ),
      copyFile(
        path.join(
          path.dirname(skillScriptsDirectory),
          "references",
          "generated",
          "intent-report.schema.json",
        ),
        path.join(
          bundledGeneratedDirectory,
          "intent-report.schema.json",
        ),
      ),
    ]);
    await writeRuntimeMetadata(skillDirectory, {
      locatorContractVersion: 1,
      relativeRoot: path.relative(skillDirectory, runtimeRoot),
      entrypoint: "director.mjs",
    });

    const environment = { ...process.env };
    delete environment.SHUBI_SHOT_RUNTIME_ROOT;
    const result = await execFileAsync(
      process.execPath,
      [path.join(bundledScriptsDirectory, "director.mjs"), "doctor"],
      {
        encoding: "utf8",
        env: environment,
      },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    const observation = await readFile(observationPath, "utf8");

    expect(await realpath(observation)).toBe(await realpath(runtimeRoot));
  });

  it("selects the nearest compatible ancestor when release metadata is absent", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    await createRuntime(temporaryDirectory);
    const nearestRuntime = path.join(temporaryDirectory, "packages", "director");
    const nearestEntrypoint = await createRuntime(nearestRuntime);
    const skillDirectory = path.join(
      nearestRuntime,
      "installed",
      "nested",
      "skill",
    );
    await mkdir(skillDirectory, { recursive: true });

    const resolved = await locator.resolveRuntimeEntrypoint({
      environment: {},
      skillDirectory,
    });

    expect(resolved).toBe(await realpath(nearestEntrypoint));
  });

  it.each([
    {
      label: "invalid JSON",
      content: "{not-json",
    },
    {
      label: "unsupported contract version",
      content: JSON.stringify({
        locatorContractVersion: 2,
        relativeRoot: ".",
        entrypoint: path.join("scripts", "director.mjs"),
      }),
    },
    {
      label: "non-string relative root",
      content: JSON.stringify({
        locatorContractVersion: 1,
        relativeRoot: 1,
        entrypoint: path.join("scripts", "director.mjs"),
      }),
    },
    {
      label: "non-string entrypoint",
      content: JSON.stringify({
        locatorContractVersion: 1,
        relativeRoot: ".",
        entrypoint: null,
      }),
    },
  ])("fails closed for $label release metadata", async ({ content }) => {
    const temporaryDirectory = await createTemporaryDirectory();
    await createRuntime(temporaryDirectory);
    const skillDirectory = path.join(temporaryDirectory, "nested", "skill");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "runtime.json"), content);

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {},
        skillDirectory,
      }),
    );
  });

  it.each([
    ["missing capability contract", { capabilitiesContractVersion: undefined }],
    ["v1 capability contract", { capabilitiesContractVersion: 1 }],
    ["missing bridge protocol", { bridgeProtocolVersion: undefined }],
    ["unsupported bridge protocol", { bridgeProtocolVersion: 999 }],
    ["fractional bridge protocol", { bridgeProtocolVersion: 1.5 }],
    ["missing workspace routing", { workspaceRoutingVersion: undefined }],
    ["unsupported workspace routing", { workspaceRoutingVersion: 999 }],
    ["fractional workspace routing", { workspaceRoutingVersion: 1.5 }],
    ["invalid scene schema", { sceneSchemaVersion: 0 }],
    ["invalid patch schema", { patchSchemaVersion: 1.5 }],
    ["missing intent schema", { intentReportSchemaVersion: undefined }],
    ["missing actor limb part ids", { actorLimbPartIds: undefined }],
    ["empty actor limb part ids", { actorLimbPartIds: [] }],
    [
      "duplicate actor limb presence modes",
      { actorLimbPresenceModes: ["present", "absent", "present"] },
    ],
    ["non-string actor limb error code", { actorLimbErrorCodes: [42] }],
    [
      "mismatched actor limb part ids",
      {
        actorLimbPartIds: [
          ...V2_RUNTIME_METADATA.actorLimbPartIds.slice(0, -1),
          "toe_r",
        ],
      },
    ],
    ["missing entity lock modes", { entityLockModes: undefined }],
    ["empty entity lock modes", { entityLockModes: [] }],
    [
      "duplicate entity lock modes",
      { entityLockModes: ["none", "workflow", "user", "user"] },
    ],
    [
      "mismatched entity lock modes",
      { entityLockModes: ["none", "workflow", "system"] },
    ],
    ["missing patch policy fields", { patchPolicyFields: undefined }],
    ["empty patch policy fields", { patchPolicyFields: [] }],
    [
      "duplicate patch policy fields",
      { patchPolicyFields: ["preserveLock", "preserveLock"] },
    ],
    [
      "mismatched patch policy fields",
      { patchPolicyFields: ["keepLock"] },
    ],
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
    [
      "mismatched lock error codes",
      {
        lockErrorCodes: [
          "USER_LOCKED",
          "WORKFLOW_LOCKED",
          "ENTITY_LOCKED",
        ],
      },
    ],
    ["runtime semantic authority", { semanticAuthority: "runtime" }],
    ["raw-text input contract", { inputContract: "raw-text" }],
    ["model integration", { modelIntegration: "local" }],
    ["credential policy", { credentialPolicy: "optional" }],
    ["network policy", { networkPolicy: "public" }],
    ["removed API-key field", { requiresApiKey: false }],
  ])("fails closed for v2 metadata with %s", async (_label, overrides) => {
    const temporaryDirectory = await createTemporaryDirectory();
    const runtimeRoot = path.join(temporaryDirectory, "runtime");
    await createRuntime(runtimeRoot);
    const skillDirectory = path.join(
      temporaryDirectory,
      "release",
      "nested",
      "skill",
    );
    await writeRuntimeMetadata(skillDirectory, {
      locatorContractVersion: 1,
      relativeRoot: path.relative(skillDirectory, runtimeRoot),
      entrypoint: path.join("scripts", "director.mjs"),
      ...overrides,
    });

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {},
        skillDirectory,
      }),
    );
  });

  it("rejects a release entrypoint that escapes its runtime root", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const runtimeRoot = path.join(temporaryDirectory, "runtime");
    await createRuntime(runtimeRoot, { entrypointKind: "missing" });
    const outsideEntrypoint = path.join(
      temporaryDirectory,
      "outside",
      "director.mjs",
    );
    await mkdir(path.dirname(outsideEntrypoint), { recursive: true });
    await writeFile(outsideEntrypoint, "export {};\n");
    const skillDirectory = path.join(
      temporaryDirectory,
      "release",
      "nested",
      "skill",
    );
    await writeRuntimeMetadata(skillDirectory, {
      locatorContractVersion: 1,
      relativeRoot: path.relative(skillDirectory, runtimeRoot),
      entrypoint: path.join("..", "outside", "director.mjs"),
    });

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {},
        skillDirectory,
      }),
      [outsideEntrypoint],
    );
  });

  it("rejects an entrypoint through a directory link that escapes its runtime root", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const runtimeRoot = path.join(temporaryDirectory, "runtime");
    const entrypoint = await createRuntime(runtimeRoot, {
      entrypointKind: "missing",
    });
    const outsideDirectory = path.join(temporaryDirectory, "outside");
    const outsideEntrypoint = path.join(outsideDirectory, "director.mjs");
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(outsideEntrypoint, "export {};\n");
    await symlink(outsideDirectory, path.dirname(entrypoint), "junction");
    const skillDirectory = path.join(
      temporaryDirectory,
      "release",
      "nested",
      "skill",
    );
    await writeRuntimeMetadata(skillDirectory, {
      locatorContractVersion: 1,
      relativeRoot: path.relative(skillDirectory, runtimeRoot),
      entrypoint: path.join("scripts", "director.mjs"),
    });

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {},
        skillDirectory,
      }),
      [outsideEntrypoint],
    );
  });

  it("does not scan sibling directories for a runtime", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const skillDirectory = path.join(
      temporaryDirectory,
      "installed-skill",
      "nested",
    );
    await mkdir(skillDirectory, { recursive: true });
    await createRuntime(path.join(temporaryDirectory, "sibling-runtime"));

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {},
        skillDirectory,
      }),
    );
  });

  it("ignores unknown environment variables during ancestor discovery", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const entrypoint = await createRuntime(temporaryDirectory);
    const skillDirectory = path.join(temporaryDirectory, "nested", "skill");
    await mkdir(skillDirectory, { recursive: true });

    const resolved = await locator.resolveRuntimeEntrypoint({
      environment: {
        GENERIC_RUNTIME_ROOT: path.join(
          temporaryDirectory,
          "unrelated-runtime",
        ),
      },
      skillDirectory,
    });

    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(await realpath(entrypoint));
  });

  it("fails when ancestor package names never match", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    await createRuntime(temporaryDirectory, {
      packageName: "generic-director-package",
    });
    const skillDirectory = path.join(temporaryDirectory, "nested", "skill");
    await mkdir(skillDirectory, { recursive: true });

    await expectRuntimeNotFound(
      locator.resolveRuntimeEntrypoint({
        environment: {},
        skillDirectory,
      }),
    );
  });
});
