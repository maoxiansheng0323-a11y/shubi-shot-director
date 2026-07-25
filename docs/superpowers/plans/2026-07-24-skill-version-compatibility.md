# Skill and Runtime Compatibility Implementation Plan

> [!WARNING]
> **Superseded on 2026-07-25.** Use
> [`2026-07-25-host-semantic-authority-v2.md`](2026-07-25-host-semantic-authority-v2.md)
> as the current implementation plan. The historical body below is preserved
> for checkpoint and migration context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one Shubi Shot Director Skill route safely across compatible Codex models and local runtime versions through a deterministic capability contract, without application-version branching or API-key handling.

**Architecture:** The local runtime publishes one shared manifest through offline `doctor` and live bridge health. The Skill launcher locates the runtime without a fixed repository depth, builds a deterministic compatibility plan from stable command and feature IDs, and blocks undeclared operations before forwarding them. Runtime schema changes restrict only Skill-authored JSON; high-level commands remain available when advertised.

**Tech Stack:** TypeScript 6, Node.js 22, Vitest, Express, ESM JavaScript Skill scripts, Zod schemas, pnpm.

---

## File map

- Create `src/domain/schema-versions.ts`: shared SceneSpec and ScenePatch schema constants.
- Create `cli/application-metadata.ts`: safe application-version loading from package metadata.
- Create `cli/runtime-capabilities.ts`: stable command/feature IDs, manifest types, parsing, and help generation.
- Modify `src/domain/scene-schema.ts` and `src/domain/scene-patch.ts`: consume shared schema constants.
- Modify `cli/director.ts`: publish the manifest from `doctor` and consume generated help.
- Modify `server/api.ts`: publish the same manifest through live health.
- Modify `cli/bridge.ts`: validate service identity and runtime compatibility with specific errors.
- Create `tests/runtime-capabilities.test.ts`, `tests/cli-doctor.test.ts`, `tests/server-api-health.test.ts`, `tests/bridge-health.test.ts`, and `tests/bridge-compatibility-cli.test.ts`.
- Create `.agents/skills/shubi-shot-director/runtime.json`: release-relative runtime entrypoint metadata.
- Create `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`: bounded runtime lookup.
- Create `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`: deterministic full/restricted/legacy/incompatible planning.
- Modify `.agents/skills/shubi-shot-director/scripts/director.mjs`: compatibility-plan command and pre-forward gating.
- Create `tests/helpers/skill-runtime-fixture.ts`, `tests/helpers/create-skill-forward-fixtures.ts`, `tests/skill-runtime-locator.test.ts`, `tests/skill-compatibility.test.ts`, and `tests/skill-docs.test.ts`.
- Rewrite the main Skill and affected references so routing follows the compatibility plan and `IntentReport.canApplySafely`.

### Task 1: Centralize runtime versions and capabilities

**Files:**

- Create: `src/domain/schema-versions.ts`
- Create: `cli/application-metadata.ts`
- Create: `cli/runtime-capabilities.ts`
- Modify: `cli/bridge.ts`
- Modify: `src/domain/scene-schema.ts`
- Modify: `src/domain/scene-patch.ts`
- Test: `tests/runtime-capabilities.test.ts`

- [ ] **Step 1: Write the failing manifest tests**

Create `tests/runtime-capabilities.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_VERSION,
  parseApplicationVersion,
} from "../cli/application-metadata";
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

describe("runtime capability manifest", () => {
  it("uses package metadata and shared contract versions", async () => {
    const packageMetadata = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const manifest = getRuntimeCapabilityManifest();

    expect(APPLICATION_VERSION).toBe(packageMetadata.version);
    expect(manifest).toMatchObject({
      service: "shubi-shot-director",
      capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
      applicationVersion: packageMetadata.version,
      requiresApiKey: false,
      bridgeProtocolVersion: 1,
      sceneSchemaVersion: SCENE_SCHEMA_VERSION,
      patchSchemaVersion: PATCH_SCHEMA_VERSION,
    });
  });

  it("publishes unique stable command and feature ids", () => {
    const manifest = getRuntimeCapabilityManifest();

    expect(new Set(manifest.commands).size).toBe(manifest.commands.length);
    expect(new Set(manifest.features).size).toBe(manifest.features.length);
    expect(manifest.commands).toEqual(
      CLI_COMMAND_DEFINITIONS.map(({ id }) => id),
    );
    expect(CLI_HELP_COMMANDS).toEqual(
      CLI_COMMAND_DEFINITIONS.map(({ usage }) => usage),
    );
    expect(manifest.features).toEqual([...RUNTIME_FEATURE_IDS]);
  });

  it("rejects malformed or contradictory manifests", () => {
    const valid = getRuntimeCapabilityManifest();

    expect(() =>
      parseRuntimeCapabilityManifest({
        ...valid,
        commands: [...valid.commands, valid.commands[0]],
      }),
    ).toThrowError("The runtime capability manifest is invalid.");
    expect(() =>
      parseRuntimeCapabilityManifest({ ...valid, requiresApiKey: "false" }),
    ).toThrowError("The runtime capability manifest is invalid.");
  });

  it("validates package versions without exposing file paths", () => {
    expect(parseApplicationVersion({ version: "1.2.3-beta.1" })).toBe(
      "1.2.3-beta.1",
    );
    expect(() => parseApplicationVersion({ version: "" })).toThrowError(
      "Application package metadata is invalid.",
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/runtime-capabilities.test.ts
```

Expected: FAIL because the three imported modules do not exist.

- [ ] **Step 3: Add shared schema and package-version sources**

Create `src/domain/schema-versions.ts`:

```ts
export const SCENE_SCHEMA_VERSION = 1 as const;
export const PATCH_SCHEMA_VERSION = 1 as const;
```

Create `cli/application-metadata.ts`:

```ts
import { readFileSync } from "node:fs";

const semverPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const parseApplicationVersion = (input: unknown): string => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("version" in input) ||
    typeof input.version !== "string" ||
    !semverPattern.test(input.version)
  ) {
    throw new Error("Application package metadata is invalid.");
  }
  return input.version;
};

const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as unknown;

export const APPLICATION_VERSION =
  parseApplicationVersion(packageMetadata);
```

Replace the schema literals in `src/domain/scene-schema.ts` and `src/domain/scene-patch.ts`:

```ts
import { SCENE_SCHEMA_VERSION } from "./schema-versions";

schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
```

```ts
import { PATCH_SCHEMA_VERSION } from "./schema-versions";

schemaVersion: z.literal(PATCH_SCHEMA_VERSION),
```

- [ ] **Step 4: Add the stable manifest module**

Create `cli/runtime-capabilities.ts`:

```ts
import { APPLICATION_VERSION } from "./application-metadata";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";

export const BRIDGE_SERVICE = "shubi-shot-director" as const;
export const CAPABILITIES_CONTRACT_VERSION = 1 as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export const CLI_COMMAND_DEFINITIONS = [
  { id: "doctor", usage: "doctor" },
  { id: "ensure", usage: "ensure" },
  { id: "status", usage: "status" },
  { id: "stop", usage: "stop" },
  { id: "health", usage: "health" },
  { id: "snapshot", usage: "snapshot" },
  { id: "scene.create", usage: "scene create --file <scene.json>" },
  {
    id: "scene.save",
    usage: "scene save --file <scene.json> [--force]",
  },
  { id: "scene.load", usage: "scene load --file <scene.json>" },
  { id: "patch.apply", usage: "patch apply --file <patch.json>" },
  {
    id: "shot.create",
    usage:
      "shot create --text <description> [--profile <external-project-profile.json>] [--open]",
  },
  {
    id: "shot.modify",
    usage:
      "shot modify --text <description> [--profile <external-project-profile.json>] [--allow-partial] [--open]",
  },
  { id: "composition.inspect", usage: "composition inspect --json" },
  {
    id: "export.png",
    usage:
      "export png --file <output.png> --width <px> --height <px> [--force]",
  },
  {
    id: "profile.resolve",
    usage:
      "profile resolve --file <external-project-profile.json> --text <description>",
  },
  { id: "undo", usage: "undo" },
  { id: "redo", usage: "redo" },
  { id: "open.system", usage: "open --system" },
] as const;

export const CLI_HELP_COMMANDS = CLI_COMMAND_DEFINITIONS.map(
  ({ usage }) => usage,
);

export const RUNTIME_FEATURE_IDS = [
  "intent.strict-report",
  "intent.allow-partial",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
  "profile.external-read-only",
  "schema.scene-authoring",
  "schema.patch-authoring",
] as const;

export interface RuntimeCapabilityManifest {
  service: typeof BRIDGE_SERVICE;
  capabilitiesContractVersion: number;
  applicationVersion: string;
  requiresApiKey: boolean;
  bridgeProtocolVersion: number;
  sceneSchemaVersion: number;
  patchSchemaVersion: number;
  commands: string[];
  features: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;

export const parseRuntimeCapabilityManifest = (
  input: unknown,
): RuntimeCapabilityManifest => {
  if (
    !isRecord(input) ||
    input.service !== BRIDGE_SERVICE ||
    typeof input.capabilitiesContractVersion !== "number" ||
    !Number.isInteger(input.capabilitiesContractVersion) ||
    input.capabilitiesContractVersion < 1 ||
    typeof input.applicationVersion !== "string" ||
    input.applicationVersion.length === 0 ||
    typeof input.requiresApiKey !== "boolean" ||
    typeof input.bridgeProtocolVersion !== "number" ||
    !Number.isInteger(input.bridgeProtocolVersion) ||
    input.bridgeProtocolVersion < 1 ||
    typeof input.sceneSchemaVersion !== "number" ||
    !Number.isInteger(input.sceneSchemaVersion) ||
    input.sceneSchemaVersion < 1 ||
    typeof input.patchSchemaVersion !== "number" ||
    !Number.isInteger(input.patchSchemaVersion) ||
    input.patchSchemaVersion < 1 ||
    !isUniqueStringArray(input.commands) ||
    !isUniqueStringArray(input.features)
  ) {
    throw new Error("The runtime capability manifest is invalid.");
  }
  return {
    service: BRIDGE_SERVICE,
    capabilitiesContractVersion: input.capabilitiesContractVersion,
    applicationVersion: input.applicationVersion,
    requiresApiKey: input.requiresApiKey,
    bridgeProtocolVersion: input.bridgeProtocolVersion,
    sceneSchemaVersion: input.sceneSchemaVersion,
    patchSchemaVersion: input.patchSchemaVersion,
    commands: [...input.commands],
    features: [...input.features],
  };
};

export const getRuntimeCapabilityManifest =
  (): RuntimeCapabilityManifest => ({
    service: BRIDGE_SERVICE,
    capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
    applicationVersion: APPLICATION_VERSION,
    requiresApiKey: false,
    bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
    sceneSchemaVersion: SCENE_SCHEMA_VERSION,
    patchSchemaVersion: PATCH_SCHEMA_VERSION,
    commands: CLI_COMMAND_DEFINITIONS.map(({ id }) => id),
    features: [...RUNTIME_FEATURE_IDS],
  });
```

In `cli/bridge.ts`, remove the local service and protocol declarations and import/re-export the shared constants so existing imports remain compatible:

```ts
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SERVICE,
} from "./runtime-capabilities";

export { BRIDGE_PROTOCOL_VERSION, BRIDGE_SERVICE };
```

- [ ] **Step 5: Run focused and schema regression tests**

Run:

```powershell
pnpm exec vitest run tests/runtime-capabilities.test.ts tests/scene-domain.test.ts tests/atomic-patch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the stable unit**

```powershell
git add src/domain/schema-versions.ts src/domain/scene-schema.ts src/domain/scene-patch.ts cli/application-metadata.ts cli/runtime-capabilities.ts cli/bridge.ts tests/runtime-capabilities.test.ts
git commit -m "feat: centralize runtime capability versions"
```

### Task 2: Publish one manifest through `doctor` and health

**Files:**

- Modify: `cli/director.ts`
- Modify: `server/api.ts`
- Test: `tests/cli-doctor.test.ts`
- Test: `tests/server-api-health.test.ts`

- [ ] **Step 1: Write failing process and API tests**

Create `tests/cli-doctor.test.ts` with a process helper that consumes the single JSON line:

```ts
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";

const execFileAsync = promisify(execFile);
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);

const unusedLoopbackPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not expose a loopback port.");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
};

const runCli = async (port: number, ...args: string[]) =>
  execFileAsync(process.execPath, [directorScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, SHUBI_SHOT_PORT: String(port) },
  });

describe("Director doctor", () => {
  it("returns the shared manifest as one read-only JSON envelope", async () => {
    const port = await unusedLoopbackPort();
    const result = await runCli(port, "doctor");
    const lines = result.stdout.trim().split(/\r?\n/);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      ok: true,
      data: getRuntimeCapabilityManifest(),
    });
    expect(result.stderr).toBe("");
    const status = JSON.parse((await runCli(port, "status")).stdout);
    expect(status).toMatchObject({
      ok: true,
      data: { status: "stopped" },
    });
  });

  it("rejects unexpected arguments without starting a bridge", async () => {
    const port = await unusedLoopbackPort();
    await expect(
      runCli(port, "doctor", "--unexpected"),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("CLI_UNKNOWN_ARGUMENT"),
    });
  });
});
```

Create `tests/server-api-health.test.ts`; use an ephemeral Node server rather than adding `supertest`:

```ts
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { createApiApp } from "../server/api";
import { SceneSession } from "../server/scene-session";
import { createDefaultScene } from "../src/domain/default-scene";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("bridge health API", () => {
  it("publishes the shared manifest without changing the scene", async () => {
    const session = new SceneSession(createDefaultScene());
    const before = session.snapshot();
    const server = createServer(
      createApiApp(session, {
        uiUrl: "http://127.0.0.1:4317",
        instanceId: "instance_00000000000000000000000000000000",
        requestShutdown: () => undefined,
      }),
    );
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not expose a loopback port.");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/health`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: Record<string, unknown>;
    };

    expect(body).toMatchObject({
      ok: true,
      data: getRuntimeCapabilityManifest(),
    });
    expect(session.snapshot()).toEqual(before);
    expect(session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm exec vitest run tests/cli-doctor.test.ts tests/server-api-health.test.ts
```

Expected: FAIL because `doctor` and health still publish separate legacy fields.

- [ ] **Step 3: Generate CLI help and `doctor` from the manifest**

In `cli/director.ts`, import:

```ts
import {
  CLI_HELP_COMMANDS,
  getRuntimeCapabilityManifest,
} from "./runtime-capabilities";
```

Delete the local `helpCommands` array, return `CLI_HELP_COMMANDS` from `help`, and replace the `doctor` data with:

```ts
data: {
  ...getRuntimeCapabilityManifest(),
  nodeVersion: process.versions.node,
  nodeSupported: nodeVersionSupported(),
  bridgeConfiguration:
    bridgeConfigurationIsLoopback() ? "loopback" : "invalid",
},
```

Do not retain `productVersion` or the three coarse boolean capabilities.

- [ ] **Step 4: Publish the same manifest through health**

In `server/api.ts`, import `getRuntimeCapabilityManifest` and build health from it:

```ts
const manifest = getRuntimeCapabilityManifest();
sendOk(response, {
  ...manifest,
  status: "ready",
  sceneId: scene.sceneId,
  revision: scene.revision,
  uiUrl: options.uiUrl,
  instanceId: options.instanceId,
  // Temporary aliases keep the current CLI usable until Task 3 updates it.
  protocolVersion: manifest.bridgeProtocolVersion,
  schemaVersion: manifest.sceneSchemaVersion,
});
```

- [ ] **Step 5: Run focused tests and the current CLI smoke path**

Run:

```powershell
pnpm exec vitest run tests/cli-doctor.test.ts tests/server-api-health.test.ts
node scripts/director.mjs doctor
```

Expected: both tests PASS; `doctor` emits one JSON envelope with `requiresApiKey: false` and stable command/feature IDs.

- [ ] **Step 6: Commit**

```powershell
git add cli/director.ts server/api.ts tests/cli-doctor.test.ts tests/server-api-health.test.ts
git commit -m "feat: publish runtime capability manifest"
```

### Task 3: Fail closed on a mismatched live bridge

**Files:**

- Modify: `cli/bridge.ts`
- Modify: `server/api.ts`
- Test: `tests/bridge-health.test.ts`
- Test: `tests/bridge-compatibility-cli.test.ts`

- [ ] **Step 1: Write failing health-classification tests**

Create `tests/bridge-health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BridgeError,
  validateBridgeHealth,
} from "../cli/bridge";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";

const validHealth = () => ({
  ...getRuntimeCapabilityManifest(),
  status: "ready",
  sceneId: "scene_generic_test",
  revision: 0,
  uiUrl: "http://127.0.0.1:4317",
  instanceId: "instance_00000000000000000000000000000000",
});

const expectCode = (input: unknown, code: string) => {
  try {
    validateBridgeHealth(input);
    throw new Error("Expected validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).code).toBe(code);
  }
};

describe("bridge health compatibility", () => {
  it("accepts a different application version and unknown fields", () => {
    expect(
      validateBridgeHealth({
        ...validHealth(),
        applicationVersion: "9.0.0",
        futureField: true,
      }),
    ).toMatchObject({ applicationVersion: "9.0.0" });
  });

  it("accepts a new protocol when the local CLI expects the same protocol", () => {
    const expected = {
      ...getRuntimeCapabilityManifest(),
      bridgeProtocolVersion: 2,
    };
    expect(
      validateBridgeHealth(
        { ...validHealth(), bridgeProtocolVersion: 2 },
        expected,
      ),
    ).toMatchObject({ bridgeProtocolVersion: 2 });
  });

  it("separates identity, contract, protocol, schema, and key errors", () => {
    expectCode({ ...validHealth(), service: "other-service" },
      "BRIDGE_IDENTITY_MISMATCH");
    const { capabilitiesContractVersion: _removed, ...legacy } = validHealth();
    expectCode(legacy, "CAPABILITIES_CONTRACT_UNSUPPORTED");
    expectCode({ ...validHealth(), bridgeProtocolVersion: 2 },
      "BRIDGE_PROTOCOL_UNSUPPORTED");
    expectCode({ ...validHealth(), sceneSchemaVersion: 2 },
      "SCENE_SCHEMA_UNSUPPORTED");
    expectCode({ ...validHealth(), patchSchemaVersion: 2 },
      "PATCH_SCHEMA_UNSUPPORTED");
    expectCode({ ...validHealth(), requiresApiKey: true },
      "RUNTIME_REQUIRES_API_KEY");
  });

  it("rejects malformed fields as capabilities errors", () => {
    expectCode({ ...validHealth(), commands: ["doctor", "doctor"] },
      "CAPABILITIES_INVALID");
    expectCode({
      ...validHealth(),
      features: validHealth().features.filter(
        (id) => id !== "scene.files",
      ),
    }, "CAPABILITIES_INVALID");
  });
});
```

- [ ] **Step 2: Write a failing zero-mutation CLI test**

Create `tests/bridge-compatibility-cli.test.ts` with a synthetic loopback service. The critical assertion is that a mismatch receives only `GET /api/v1/health` and never a scene write:

```ts
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { createDefaultScene } from "../src/domain/default-scene";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CLI bridge compatibility gate", () => {
  const cases = [
    {
      name: "live protocol differs",
      override: { bridgeProtocolVersion: 2 },
      code: "BRIDGE_PROTOCOL_UNSUPPORTED",
      action: "scene" as const,
    },
    {
      name: "live SceneSpec schema differs",
      override: { sceneSchemaVersion: 2 },
      code: "SCENE_SCHEMA_UNSUPPORTED",
      action: "scene" as const,
    },
    {
      name: "live ScenePatch schema differs",
      override: { patchSchemaVersion: 2 },
      code: "PATCH_SCHEMA_UNSUPPORTED",
      action: "patch" as const,
    },
    {
      name: "runtime requires an API key",
      override: { requiresApiKey: true },
      code: "RUNTIME_REQUIRES_API_KEY",
      action: "scene" as const,
    },
  ];

  it.each(cases)("does not mutate when $name", async (testCase) => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        ok: true,
        data: {
          ...getRuntimeCapabilityManifest(),
          ...testCase.override,
          status: "ready",
          sceneId: "scene_generic_test",
          revision: 0,
          uiUrl: "http://127.0.0.1:4317",
        },
      }));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not expose a loopback port.");
    }
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "shot-bridge-test-"),
    );
    temporaryDirectories.push(directory);
    const sceneFile = path.join(directory, "scene.json");
    const patchFile = path.join(directory, "patch.json");
    const scene = createDefaultScene();
    await writeFile(sceneFile, JSON.stringify(scene));
    await writeFile(
      patchFile,
      JSON.stringify({
        schemaVersion: 1,
        patchId: "patch_bridge_gate_test",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "system",
        operations: [
          { op: "scene.title.set", value: "Generic test scene" },
        ],
      }),
    );
    const actionArgs =
      testCase.action === "scene"
        ? ["scene", "create", "--file", sceneFile]
        : ["patch", "apply", "--file", patchFile];

    await expect(
      execFileAsync(
        process.execPath,
        [directorScript, ...actionArgs],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            SHUBI_SHOT_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(testCase.code),
    });

    expect(requests).toEqual(["GET /api/v1/health"]);
  });
});
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
pnpm exec vitest run tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts
```

Expected: FAIL because the current parser still expects `protocolVersion` and reports broad identity errors.

- [ ] **Step 4: Implement explicit live compatibility validation**

In `cli/bridge.ts`:

```ts
import {
  BRIDGE_SERVICE,
  getRuntimeCapabilityManifest,
  parseRuntimeCapabilityManifest,
  type RuntimeCapabilityManifest,
} from "./runtime-capabilities";

export interface BridgeHealth extends RuntimeCapabilityManifest {
  status: "ready";
  sceneId: string;
  revision: number;
  uiUrl: string;
  instanceId?: string;
}
```

Change the signature so tests and future runtimes compare against their own local manifest, then implement this validation order:

```ts
export const validateBridgeHealth = (
  input: unknown,
  expected = getRuntimeCapabilityManifest(),
): BridgeHealth => {

if (!isObject(input) || input.service !== BRIDGE_SERVICE) {
  throw new BridgeError(
    "BRIDGE_IDENTITY_MISMATCH",
    "The loopback service did not identify itself as Shubi Shot Director.",
  );
}

let manifest: RuntimeCapabilityManifest;
try {
  manifest = parseRuntimeCapabilityManifest(input);
} catch {
  if (!("capabilitiesContractVersion" in input)) {
    throw new BridgeError(
      "CAPABILITIES_CONTRACT_UNSUPPORTED",
      "The running bridge does not provide a supported capability contract.",
    );
  }
  throw new BridgeError(
    "CAPABILITIES_INVALID",
    "The running bridge returned an invalid capability manifest.",
  );
}

if (
  manifest.capabilitiesContractVersion !==
  expected.capabilitiesContractVersion
) {
  throw new BridgeError(
    "CAPABILITIES_CONTRACT_UNSUPPORTED",
    "The running bridge uses an unsupported capability contract.",
  );
}
if (manifest.requiresApiKey) {
  throw new BridgeError(
    "RUNTIME_REQUIRES_API_KEY",
    "The running bridge is outside the local no-key product contract.",
  );
}
if (manifest.bridgeProtocolVersion !== expected.bridgeProtocolVersion) {
  throw new BridgeError(
    "BRIDGE_PROTOCOL_UNSUPPORTED",
    "The running bridge protocol does not match the local CLI.",
  );
}
if (manifest.sceneSchemaVersion !== expected.sceneSchemaVersion) {
  throw new BridgeError(
    "SCENE_SCHEMA_UNSUPPORTED",
    "The running bridge SceneSpec schema does not match the local CLI.",
  );
}
if (manifest.patchSchemaVersion !== expected.patchSchemaVersion) {
  throw new BridgeError(
    "PATCH_SCHEMA_UNSUPPORTED",
    "The running bridge ScenePatch schema does not match the local CLI.",
  );
}

const sameIds = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((id) => right.includes(id));

if (
  !sameIds(manifest.commands, expected.commands) ||
  !sameIds(manifest.features, expected.features)
) {
  throw new BridgeError(
    "CAPABILITIES_INVALID",
    "The running bridge capabilities do not match the local CLI.",
  );
}

if (
  input.status !== "ready" ||
  typeof input.sceneId !== "string" ||
  input.sceneId.length === 0 ||
  typeof input.revision !== "number" ||
  !Number.isInteger(input.revision) ||
  input.revision < 0 ||
  (input.instanceId !== undefined &&
    (typeof input.instanceId !== "string" ||
      !/^instance_[a-f0-9]{32}$/.test(input.instanceId)))
) {
  throw new BridgeError(
    "CAPABILITIES_INVALID",
    "The running bridge returned invalid live state.",
  );
}

return {
  ...manifest,
  status: "ready",
  sceneId: input.sceneId,
  revision: input.revision,
  uiUrl: validateLoopbackUiUrl(input.uiUrl),
  ...(typeof input.instanceId === "string"
    ? { instanceId: input.instanceId }
    : {}),
};
};
```

Then validate status, scene ID, revision, instance ID, and the loopback UI URL as before. Return the parsed manifest fields plus live state. Add fixed safe messages for the new errors in `safeBridgeMessage`.

Remove the temporary `protocolVersion` and `schemaVersion` aliases from `server/api.ts` after the new parser passes.

- [ ] **Step 5: Run focused and full runtime checks**

```powershell
pnpm exec vitest run tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/server-api-health.test.ts
pnpm typecheck
pnpm test
```

Expected: PASS; no mismatch test sends a mutating request.

- [ ] **Step 6: Commit**

```powershell
git add cli/bridge.ts server/api.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/server-api-health.test.ts
git commit -m "feat: fail closed on mismatched live bridges"
```

### Task 4: Discover the runtime without a fixed repository depth

**Files:**

- Create: `.agents/skills/shubi-shot-director/runtime.json`
- Create: `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Test: `tests/skill-runtime-locator.test.ts`

- [ ] **Step 1: Write failing locator tests**

Create `tests/skill-runtime-locator.test.ts` using temporary generic packages. Import the ESM locator through a dynamic URL so TypeScript does not require a declaration file:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const locatorUrl = pathToFileURL(
  path.resolve(
    ".agents/skills/shubi-shot-director/scripts/runtime-locator.mjs",
  ),
).href;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const createRuntime = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shot-runtime-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "scripts"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "shubi-shot-director", version: "1.0.0" }),
  );
  await writeFile(path.join(root, "scripts", "director.mjs"), "");
  return root;
};

describe("Skill runtime locator", () => {
  it("prefers an explicitly configured runtime root", async () => {
    const root = await createRuntime();
    const { resolveRuntimeEntrypoint } = await import(locatorUrl);

    await expect(
      resolveRuntimeEntrypoint({
        environment: { SHUBI_SHOT_RUNTIME_ROOT: root },
        skillDirectory: path.join(root, "unrelated-skill"),
      }),
    ).resolves.toBe(path.join(root, "scripts", "director.mjs"));
  });

  it("fails without exposing a configured path", async () => {
    const marker = "sensitive-runtime-marker";
    const { resolveRuntimeEntrypoint } = await import(locatorUrl);

    await expect(
      resolveRuntimeEntrypoint({
        environment: { SHUBI_SHOT_RUNTIME_ROOT: marker },
        skillDirectory: process.cwd(),
      }),
    ).rejects.not.toThrow(marker);
  });

  it("uses release-relative metadata without assuming directory depth", async () => {
    const root = await createRuntime();
    const skillDirectory = path.join(root, "nested", "skill");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      path.join(skillDirectory, "runtime.json"),
      JSON.stringify({
        locatorContractVersion: 1,
        relativeRoot: "../..",
        entrypoint: "scripts/director.mjs",
      }),
    );
    const { resolveRuntimeEntrypoint } = await import(locatorUrl);

    await expect(
      resolveRuntimeEntrypoint({ environment: {}, skillDirectory }),
    ).resolves.toBe(path.join(root, "scripts", "director.mjs"));
  });

  it("finds only the nearest matching ancestor package", async () => {
    const root = await createRuntime();
    const skillDirectory = path.join(root, "a", "b", "skill");
    await mkdir(skillDirectory, { recursive: true });
    const { resolveRuntimeEntrypoint } = await import(locatorUrl);

    await expect(
      resolveRuntimeEntrypoint({ environment: {}, skillDirectory }),
    ).resolves.toBe(path.join(root, "scripts", "director.mjs"));
  });

  it("rejects an invalid package or missing entrypoint", async () => {
    const root = await createRuntime();
    const { resolveRuntimeEntrypoint } = await import(locatorUrl);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "other-package", version: "1.0.0" }),
    );

    await expect(
      resolveRuntimeEntrypoint({
        environment: { SHUBI_SHOT_RUNTIME_ROOT: root },
        skillDirectory: process.cwd(),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_NOT_FOUND" });

    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "shubi-shot-director", version: "1.0.0" }),
    );
    await rm(path.join(root, "scripts", "director.mjs"));
    await expect(
      resolveRuntimeEntrypoint({
        environment: { SHUBI_SHOT_RUNTIME_ROOT: root },
        skillDirectory: process.cwd(),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_NOT_FOUND" });
  });

  it("does not scan a sibling runtime", async () => {
    const container = await mkdtemp(
      path.join(os.tmpdir(), "shot-runtime-container-"),
    );
    temporaryDirectories.push(container);
    const skillDirectory = path.join(container, "skill");
    const sibling = path.join(container, "runtime");
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(path.join(sibling, "scripts"), { recursive: true });
    await writeFile(
      path.join(sibling, "package.json"),
      JSON.stringify({ name: "shubi-shot-director", version: "1.0.0" }),
    );
    await writeFile(path.join(sibling, "scripts", "director.mjs"), "");
    const { resolveRuntimeEntrypoint } = await import(locatorUrl);

    await expect(
      resolveRuntimeEntrypoint({ environment: {}, skillDirectory }),
    ).rejects.toMatchObject({ code: "RUNTIME_NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm exec vitest run tests/skill-runtime-locator.test.ts
```

Expected: FAIL because the locator does not exist.

- [ ] **Step 3: Add release metadata and bounded lookup**

Create `.agents/skills/shubi-shot-director/runtime.json`:

```json
{
  "locatorContractVersion": 1,
  "relativeRoot": "../../..",
  "entrypoint": "scripts/director.mjs"
}
```

Create `runtime-locator.mjs`:

```js
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultSkillDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class SkillRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SkillRuntimeError";
    this.code = code;
  }
}

const notFound = () =>
  new SkillRuntimeError(
    "RUNTIME_NOT_FOUND",
    "A compatible Shubi Shot Director runtime was not found.",
  );

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw notFound();
  }
};

const isRegularFile = async (file) => {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
};

const validateRuntimeRoot = async (
  rootSource,
  entrypointSource = "scripts/director.mjs",
) => {
  const root = path.resolve(rootSource);
  const metadata = await readJson(path.join(root, "package.json"));
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    metadata.name !== "shubi-shot-director" ||
    typeof entrypointSource !== "string" ||
    entrypointSource.length === 0
  ) {
    throw notFound();
  }
  const entrypoint = path.resolve(root, entrypointSource);
  const relative = path.relative(root, entrypoint);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !(await isRegularFile(entrypoint))
  ) {
    throw notFound();
  }
  return entrypoint;
};

const readOptionalRuntimeMetadata = async (skillDirectory) => {
  const file = path.join(skillDirectory, "runtime.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw notFound();
  }
};

export async function resolveRuntimeEntrypoint({
  environment = process.env,
  skillDirectory = defaultSkillDirectory,
} = {}) {
  if (environment.SHUBI_SHOT_RUNTIME_ROOT !== undefined) {
    return validateRuntimeRoot(environment.SHUBI_SHOT_RUNTIME_ROOT);
  }

  const metadata = await readOptionalRuntimeMetadata(skillDirectory);
  if (metadata !== null) {
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      metadata.locatorContractVersion !== 1 ||
      typeof metadata.relativeRoot !== "string" ||
      typeof metadata.entrypoint !== "string"
    ) {
      throw notFound();
    }
    return validateRuntimeRoot(
      path.resolve(skillDirectory, metadata.relativeRoot),
      metadata.entrypoint,
    );
  }

  let current = path.resolve(skillDirectory);
  while (true) {
    try {
      const packageMetadata = JSON.parse(
        await readFile(path.join(current, "package.json"), "utf8"),
      );
      if (packageMetadata?.name === "shubi-shot-director") {
        return validateRuntimeRoot(current);
      }
    } catch {
      // A non-runtime ancestor may have no package metadata.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw notFound();
}
```

- [ ] **Step 4: Make the Skill launcher use the locator**

Replace the fixed four-level calculation in `.agents/skills/shubi-shot-director/scripts/director.mjs` with:

```js
import {
  SkillRuntimeError,
  resolveRuntimeEntrypoint,
} from "./runtime-locator.mjs";

const main = async () => {
  const runtimeEntrypoint = await resolveRuntimeEntrypoint();
  const child = spawn(
    process.execPath,
    [runtimeEntrypoint, ...process.argv.slice(2)],
    {
      cwd: path.dirname(path.dirname(runtimeEntrypoint)),
      env: process.env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
  child.on("error", () => {
    process.stderr.write("The Director CLI could not be started.\n");
    process.exitCode = 1;
  });
};

void main().catch((error) => {
  const known = error instanceof SkillRuntimeError;
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: {
      code: known ? error.code : "RUNTIME_NOT_FOUND",
      message: known
        ? error.message
        : "A compatible Shubi Shot Director runtime was not found.",
    },
  })}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run tests and the real wrapper doctor**

```powershell
pnpm exec vitest run tests/skill-runtime-locator.test.ts
node .agents/skills/shubi-shot-director/scripts/director.mjs doctor
```

Expected: PASS; wrapper `doctor` reaches the source runtime from release-relative metadata.

- [ ] **Step 6: Commit**

```powershell
git add .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/scripts/runtime-locator.mjs .agents/skills/shubi-shot-director/scripts/director.mjs tests/skill-runtime-locator.test.ts
git commit -m "feat: add deterministic skill runtime discovery"
```

### Task 5: Negotiate and enforce Skill compatibility

**Files:**

- Create: `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Create: `tests/helpers/skill-runtime-fixture.ts`
- Create: `tests/helpers/create-skill-forward-fixtures.ts`
- Create: `tests/skill-compatibility.test.ts`

- [ ] **Step 1: Write the failing compatibility matrix**

Create `tests/helpers/skill-runtime-fixture.ts`. The fake runtime writes only normalized command IDs; it never records arguments:

```ts
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SkillRuntimeFixtureOptions {
  doctorData: unknown;
  helpCommands?: string[];
  healthData?: unknown;
  healthError?: { code: string; message: string };
  actionErrors?: Record<string, { code: string; message: string }>;
}

export interface SkillRuntimeFixture {
  root: string;
  logFile: string;
  stateFile: string;
  readCommandIds: () => Promise<string[]>;
  readState: () => Promise<{
    sceneId: string;
    revision: number;
    mutationCount: number;
  }>;
  dispose: () => Promise<void>;
}

export const createSkillRuntimeFixture = async (
  options: SkillRuntimeFixtureOptions,
  requestedRoot?: string,
): Promise<SkillRuntimeFixture> => {
  const root = requestedRoot === undefined
    ? await mkdtemp(path.join(os.tmpdir(), "shot-skill-runtime-"))
    : path.resolve(requestedRoot);
  const scriptsDirectory = path.join(root, "scripts");
  const fixtureFile = path.join(root, "fixture.json");
  const logFile = path.join(root, "command-ids.log");
  const stateFile = path.join(root, "state.json");
  await mkdir(scriptsDirectory, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "shubi-shot-director",
      version: "1.0.0",
      type: "module",
    }),
  );
  await writeFile(fixtureFile, JSON.stringify(options));
  await writeFile(logFile, "");
  await writeFile(
    stateFile,
    JSON.stringify({
      sceneId: "scene_generic_test",
      revision: 0,
      mutationCount: 0,
    }),
  );
  await writeFile(
    path.join(scriptsDirectory, "director.mjs"),
    `
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8"));
const args = process.argv.slice(2);
const actionId = (() => {
  if (args.length === 0 || args[0] === "help") return "help";
  if (["doctor", "ensure", "status", "stop", "health", "snapshot", "undo", "redo"].includes(args[0])) return args[0];
  if (args[0] === "scene") return \`scene.\${args[1] ?? "unknown"}\`;
  if (args[0] === "patch" && args[1] === "apply") return "patch.apply";
  if (args[0] === "shot") return \`shot.\${args[1] ?? "unknown"}\`;
  if (args[0] === "composition" && args[1] === "inspect") return "composition.inspect";
  if (args[0] === "export" && args[1] === "png") return "export.png";
  if (args[0] === "profile" && args[1] === "resolve") return "profile.resolve";
  if (args[0] === "open" && args[1] === "--system") return "open.system";
  return "unknown";
})();

await appendFile(path.join(root, "command-ids.log"), \`\${actionId}\\n\`);

let envelope;
if (actionId === "doctor") {
  envelope = { ok: true, data: fixture.doctorData };
} else if (actionId === "help") {
  envelope = { ok: true, data: { commands: fixture.helpCommands ?? [] } };
} else if (actionId === "health") {
  envelope = fixture.healthError !== undefined
    ? { ok: false, error: fixture.healthError }
    : fixture.healthData === undefined
      ? { ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The local bridge is not running." } }
      : { ok: true, data: fixture.healthData };
} else if (fixture.actionErrors?.[actionId] !== undefined) {
  envelope = { ok: false, error: fixture.actionErrors[actionId] };
} else {
  const manifestCommands = Array.isArray(fixture.doctorData?.commands)
    ? fixture.doctorData.commands
    : [];
  const legacyUsageToAction = new Map([
    ["ensure", "ensure"],
    ["health", "health"],
    ["snapshot", "snapshot"],
    ["shot create --text <description> [--open]", "shot.create"],
    ["shot modify --text <description> [--open]", "shot.modify"],
    ["open --system", "open.system"],
  ]);
  const legacyActions = (fixture.helpCommands ?? [])
    .map((usage) => legacyUsageToAction.get(usage))
    .filter(Boolean);
  const declared = new Set([...manifestCommands, ...legacyActions]);
  if (!declared.has(actionId)) {
    envelope = {
      ok: false,
      error: {
        code: "CLI_UNKNOWN_COMMAND",
        message: "The synthetic runtime does not declare this command.",
      },
    };
  } else {
    const stateFile = path.join(root, "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (["shot.create", "scene.create"].includes(actionId)) {
      state.revision += 1;
      state.mutationCount += 1;
      await writeFile(stateFile, JSON.stringify(state));
    } else if (["shot.modify", "patch.apply"].includes(actionId)) {
      if (state.revision === 0) {
        envelope = {
          ok: false,
          error: { code: "SCENE_NOT_FOUND", message: "No synthetic scene exists." },
        };
      } else {
        state.revision += 1;
        state.mutationCount += 1;
        await writeFile(stateFile, JSON.stringify(state));
      }
    }
    if (envelope === undefined) {
      envelope = {
        ok: true,
        data: {
          action: actionId,
          sceneId: state.sceneId,
          revision: state.revision,
          ...(actionId === "ensure"
            ? { uiUrl: "http://127.0.0.1:9/" }
            : {}),
        },
      };
    }
  }
}

process.stdout.write(\`\${JSON.stringify(envelope)}\\n\`);
if (!envelope.ok) process.exitCode = 1;
`,
  );

  return {
    root,
    logFile,
    stateFile,
    readCommandIds: async () => {
      try {
        return (await readFile(logFile, "utf8"))
          .split(/\r?\n/)
          .filter(Boolean);
      } catch {
        return [];
      }
    },
    readState: async () => JSON.parse(await readFile(stateFile, "utf8")),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
};
```

Create `tests/helpers/create-skill-forward-fixtures.ts` so RED and GREEN runs use the identical isolated matrix:

```ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRuntimeCapabilityManifest } from "../../cli/runtime-capabilities";
import { createSkillRuntimeFixture } from "./skill-runtime-fixture";

export const forwardCaseIds = [
  "current",
  "no-export",
  "legacy",
  "future-compatible",
  "future-schema",
  "requires-key",
] as const;

export const createSkillForwardFixtures = async (
  root: string,
  tiers: readonly string[] = ["sol", "terra"],
) => {
  const current = getRuntimeCapabilityManifest();
  const withoutExport = {
    ...current,
    commands: current.commands.filter((id) => id !== "export.png"),
    features: current.features.filter(
      (id) => id !== "export.software-png",
    ),
  };
  const futureCompatible = { ...current, applicationVersion: "9.0.0" };
  const futureSchema = {
    ...current,
    applicationVersion: "9.1.0",
    sceneSchemaVersion: current.sceneSchemaVersion + 1,
    patchSchemaVersion: current.patchSchemaVersion + 1,
  };
  const requiresKey = { ...current, requiresApiKey: true };
  const legacyDoctor = {
    service: "shubi-shot-director",
    applicationVersion: "0.1.0",
    requiresApiKey: false,
    bridgeProtocolVersion: 1,
    sceneSchemaVersion: 1,
    patchSchemaVersion: 1,
  };
  const legacyHelp = [
    "ensure",
    "health",
    "snapshot",
    "shot create --text <description> [--open]",
    "shot modify --text <description> [--open]",
    "open --system",
  ];
  const cases = {
    current: { doctorData: current, healthData: current },
    "no-export": {
      doctorData: withoutExport,
      healthData: withoutExport,
    },
    legacy: {
      doctorData: legacyDoctor,
      healthData: legacyDoctor,
      helpCommands: legacyHelp,
    },
    "future-compatible": {
      doctorData: futureCompatible,
      healthData: futureCompatible,
    },
    "future-schema": {
      doctorData: futureSchema,
      healthData: futureSchema,
    },
    "requires-key": {
      doctorData: requiresKey,
      healthData: requiresKey,
    },
  };

  for (const tier of tiers) {
    for (const id of forwardCaseIds) {
      await createSkillRuntimeFixture(
        cases[id],
        path.join(root, tier, id),
      );
    }
  }

  return { tiers: [...tiers], cases: [...forwardCaseIds] };
};

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  if (root === undefined) {
    process.stderr.write("--root is required\n");
    process.exitCode = 1;
  } else {
    const result = await createSkillForwardFixtures(path.resolve(root));
    process.stdout.write(`${JSON.stringify({ ok: true, data: result })}\n`);
  }
}
```

Create `tests/skill-compatibility.test.ts` with this matrix:

```ts
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import {
  createSkillForwardFixtures,
  forwardCaseIds,
} from "./helpers/create-skill-forward-fixtures";
import { createSkillRuntimeFixture } from "./helpers/skill-runtime-fixture";

const execFileAsync = promisify(execFile);
const skillDirector = fileURLToPath(
  new URL(
    "../.agents/skills/shubi-shot-director/scripts/director.mjs",
    import.meta.url,
  ),
);

const plan = async (
  root: string,
  action: string,
  live = false,
) => {
  const result = await execFileAsync(
    process.execPath,
    [
      skillDirector,
      "compatibility",
      "plan",
      "--action",
      action,
      ...(live ? ["--live"] : []),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, SHUBI_SHOT_RUNTIME_ROOT: root },
    },
  );
  return JSON.parse(result.stdout) as {
    ok: boolean;
    data: Record<string, unknown>;
  };
};

describe("Skill compatibility plan", () => {
  it("creates and resets isolated forward-test fixtures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shot-forward-matrix-"));
    const result = await createSkillForwardFixtures(root, ["sol"]);
    const currentRoot = path.join(root, "sol", "current");

    expect(result).toEqual({
      tiers: ["sol"],
      cases: [...forwardCaseIds],
    });
    await execFileAsync(
      process.execPath,
      [path.join(currentRoot, "scripts", "director.mjs"),
        "shot", "create", "--text", "generic"],
      { encoding: "utf8" },
    );
    expect(
      JSON.parse(await readFile(path.join(currentRoot, "state.json"), "utf8")),
    ).toMatchObject({ revision: 1, mutationCount: 1 });

    await createSkillForwardFixtures(root, ["sol"]);
    expect(await readFile(path.join(currentRoot, "command-ids.log"), "utf8"))
      .toBe("");
    expect(
      JSON.parse(await readFile(path.join(currentRoot, "state.json"), "utf8")),
    ).toMatchObject({ revision: 0, mutationCount: 0 });
    await rm(root, { recursive: true, force: true });
  });

  it("does not branch on application or runtime-owned protocol versions", async () => {
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        ...getRuntimeCapabilityManifest(),
        applicationVersion: "9.0.0",
        bridgeProtocolVersion: 2,
      },
      healthData: {
        ...getRuntimeCapabilityManifest(),
        applicationVersion: "9.0.0",
        bridgeProtocolVersion: 2,
      },
    });
    const result = await plan(runtime.root, "shot.create", true);

    expect(result.data).toMatchObject({
      mode: "full",
      actionAllowed: true,
      liveVerified: true,
    });
    await runtime.dispose();
  });

  it("keeps high-level commands but disables incompatible schema authoring", async () => {
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        ...getRuntimeCapabilityManifest(),
        sceneSchemaVersion: 2,
        patchSchemaVersion: 2,
      },
    });

    expect((await plan(runtime.root, "shot.create")).data).toMatchObject({
      mode: "restricted",
      actionAllowed: true,
      sceneSchemaAuthoring: false,
      patchSchemaAuthoring: false,
    });
    expect((await plan(runtime.root, "scene.create")).data).toMatchObject({
      actionAllowed: false,
      blockingError: { code: "SCENE_SCHEMA_UNSUPPORTED" },
    });
    expect((await plan(runtime.root, "patch.apply")).data).toMatchObject({
      actionAllowed: false,
      blockingError: { code: "PATCH_SCHEMA_UNSUPPORTED" },
    });
    await runtime.dispose();
  });

  it("blocks undeclared export before forwarding it", async () => {
    const manifest = getRuntimeCapabilityManifest();
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        ...manifest,
        commands: manifest.commands.filter((id) => id !== "export.png"),
        features: manifest.features.filter(
          (id) => id !== "export.software-png",
        ),
      },
    });

    await expect(
      execFileAsync(
        process.execPath,
        [skillDirector, "export", "png", "--file", "out.png",
          "--width", "16", "--height", "9"],
        {
          encoding: "utf8",
          env: { ...process.env, SHUBI_SHOT_RUNTIME_ROOT: runtime.root },
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("CAPABILITY_NOT_AVAILABLE"),
    });
    expect(await runtime.readCommandIds()).toEqual(["doctor"]);
    await runtime.dispose();
  });

  it("rejects unknown commands without forwarding them", async () => {
    const runtime = await createSkillRuntimeFixture({
      doctorData: getRuntimeCapabilityManifest(),
    });

    await expect(
      execFileAsync(process.execPath, [skillDirector, "unknown-command"], {
        encoding: "utf8",
        env: { ...process.env, SHUBI_SHOT_RUNTIME_ROOT: runtime.root },
      }),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("CLI_UNKNOWN_COMMAND"),
    });
    expect(await runtime.readCommandIds()).toEqual([]);
    await runtime.dispose();
  });

  it("uses a conservative legacy allowlist from exact help usages", async () => {
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        productVersion: "0.1.0",
        bridgeProtocolVersion: 1,
        sceneSchemaVersion: 1,
        patchSchemaVersion: 1,
      },
      helpCommands: [
        "ensure",
        "health",
        "snapshot",
        "shot create --text <description> [--open]",
        "shot modify --text <description> [--open]",
        "open --system",
        "export png --file <output.png> --width <px> --height <px>",
      ],
    });

    expect((await plan(runtime.root, "shot.modify")).data).toMatchObject({
      mode: "legacy",
      actionAllowed: true,
      sceneSchemaAuthoring: false,
      patchSchemaAuthoring: false,
    });
    expect((await plan(runtime.root, "export.png")).data).toMatchObject({
      mode: "legacy",
      actionAllowed: false,
    });
    await runtime.dispose();
  });

  it.each([
    {
      name: "offline key requirement",
      doctorData: {
        productVersion: "0.1.0",
        bridgeProtocolVersion: 1,
        requiresApiKey: true,
      },
      healthData: undefined,
      code: "RUNTIME_REQUIRES_API_KEY",
      commandIds: ["doctor", "help"],
    },
    {
      name: "live key requirement",
      doctorData: {
        productVersion: "0.1.0",
        bridgeProtocolVersion: 1,
      },
      healthData: {
        bridgeProtocolVersion: 1,
        requiresApiKey: true,
      },
      code: "RUNTIME_REQUIRES_API_KEY",
      commandIds: ["doctor", "help", "health"],
    },
    {
      name: "live protocol mismatch",
      doctorData: {
        productVersion: "0.1.0",
        bridgeProtocolVersion: 1,
      },
      healthData: { bridgeProtocolVersion: 2 },
      code: "BRIDGE_PROTOCOL_UNSUPPORTED",
      commandIds: ["doctor", "help", "health"],
    },
  ])("blocks legacy $name before mutation", async ({
    doctorData,
    healthData,
    code,
    commandIds,
  }) => {
    const runtime = await createSkillRuntimeFixture({
      doctorData,
      ...(healthData === undefined ? {} : { healthData }),
      helpCommands: ["health", "snapshot"],
    });

    expect((await plan(runtime.root, "snapshot", true)).data).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      blockingError: { code },
    });
    expect(await runtime.readCommandIds()).toEqual(commandIds);
    expect(await runtime.readState()).toMatchObject({ mutationCount: 0 });
    await runtime.dispose();
  });

  it.each([
    {
      name: "unsupported contract",
      mutate: (manifest: ReturnType<typeof getRuntimeCapabilityManifest>) => ({
        ...manifest,
        capabilitiesContractVersion: 2,
      }),
      code: "CAPABILITIES_CONTRACT_UNSUPPORTED",
    },
    {
      name: "API key requirement",
      mutate: (manifest: ReturnType<typeof getRuntimeCapabilityManifest>) => ({
        ...manifest,
        requiresApiKey: true,
      }),
      code: "RUNTIME_REQUIRES_API_KEY",
    },
    {
      name: "duplicate command ids",
      mutate: (manifest: ReturnType<typeof getRuntimeCapabilityManifest>) => ({
        ...manifest,
        commands: [...manifest.commands, manifest.commands[0]],
      }),
      code: "CAPABILITIES_INVALID",
    },
  ])("returns an incompatible plan for $name", async ({ mutate, code }) => {
    const runtime = await createSkillRuntimeFixture({
      doctorData: mutate(getRuntimeCapabilityManifest()),
    });

    expect((await plan(runtime.root, "snapshot")).data).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      blockingError: { code },
    });
    await runtime.dispose();
  });

  it("fails closed when offline and live runtime contracts disagree", async () => {
    const manifest = getRuntimeCapabilityManifest();
    const runtime = await createSkillRuntimeFixture({
      doctorData: manifest,
      healthData: { ...manifest, bridgeProtocolVersion: 2 },
    });

    expect((await plan(runtime.root, "snapshot", true)).data).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      blockingError: { code: "BRIDGE_PROTOCOL_UNSUPPORTED" },
    });
    await runtime.dispose();
  });

  it("rejects offline and live command or feature drift", async () => {
    const manifest = getRuntimeCapabilityManifest();
    const runtime = await createSkillRuntimeFixture({
      doctorData: manifest,
      healthData: {
        ...manifest,
        commands: manifest.commands.filter((id) => id !== "scene.save"),
      },
    });

    expect((await plan(runtime.root, "snapshot", true)).data).toMatchObject({
      mode: "incompatible",
      actionAllowed: false,
      blockingError: { code: "CAPABILITIES_INVALID" },
    });
    await runtime.dispose();
  });

  it("does not call health when health is not advertised", async () => {
    const manifest = getRuntimeCapabilityManifest();
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        ...manifest,
        commands: manifest.commands.filter((id) => id !== "health"),
      },
      healthData: manifest,
    });

    expect((await plan(runtime.root, "snapshot", true)).data).toMatchObject({
      mode: "restricted",
      actionAllowed: false,
      blockingError: { code: "CAPABILITY_NOT_AVAILABLE" },
    });
    expect(await runtime.readCommandIds()).toEqual(["doctor"]);
    await runtime.dispose();
  });

  it("does not echo a runtime error message", async () => {
    const marker = "sensitive-runtime-marker";
    const runtime = await createSkillRuntimeFixture({
      doctorData: getRuntimeCapabilityManifest(),
      healthError: { code: "BRIDGE_UNAVAILABLE", message: marker },
    });

    await expect(plan(runtime.root, "snapshot", true)).rejects.toMatchObject({
      stdout: expect.not.stringContaining(marker),
    });
    await runtime.dispose();
  });

  it.each([
    ["scene.save", "scene.files"],
    ["scene.load", "scene.files"],
    ["composition.inspect", "composition.segmented-report"],
    ["stop", "bridge.safe-shutdown"],
  ])("requires %s feature support", async (action, feature) => {
    const manifest = getRuntimeCapabilityManifest();
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        ...manifest,
        features: manifest.features.filter((id) => id !== feature),
      },
    });

    expect((await plan(runtime.root, action)).data).toMatchObject({
      mode: "restricted",
      actionAllowed: false,
      blockingError: { code: "CAPABILITY_NOT_AVAILABLE" },
    });
    await runtime.dispose();
  });

  it("gates profile and partial flags independently", async () => {
    const manifest = getRuntimeCapabilityManifest();
    const runtime = await createSkillRuntimeFixture({
      doctorData: {
        ...manifest,
        futureField: "ignored",
        features: manifest.features.filter(
          (id) =>
            id !== "intent.allow-partial" &&
            id !== "profile.external-read-only",
        ),
      },
    });

    expect((await plan(runtime.root, "snapshot")).data).toMatchObject({
      mode: "restricted",
      actionAllowed: true,
    });

    await expect(
      execFileAsync(
        process.execPath,
        [skillDirector, "shot", "modify", "--text", "generic edit",
          "--allow-partial"],
        {
          encoding: "utf8",
          env: { ...process.env, SHUBI_SHOT_RUNTIME_ROOT: runtime.root },
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("CAPABILITY_NOT_AVAILABLE"),
    });
    await expect(
      execFileAsync(
        process.execPath,
        [skillDirector, "profile", "resolve", "--file", "generic.json",
          "--text", "generic actor"],
        {
          encoding: "utf8",
          env: { ...process.env, SHUBI_SHOT_RUNTIME_ROOT: runtime.root },
        },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("CAPABILITY_NOT_AVAILABLE"),
    });
    expect(await runtime.readCommandIds()).toEqual([
      "doctor",
      "doctor",
      "doctor",
    ]);
    await runtime.dispose();
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm exec vitest run tests/skill-compatibility.test.ts
```

Expected: FAIL because the planner command and pre-forward gate do not exist.

- [ ] **Step 3: Implement the pure compatibility planner**

Create `compatibility-plan.mjs`:

```js
export const PLAN_CONTRACT_VERSION = 1;

export const ACTION_POLICY = {
  doctor: { command: "doctor", features: [], requiresBridge: false, mayStartBridge: false },
  ensure: { command: "ensure", features: [], requiresBridge: false, mayStartBridge: true },
  status: { command: "status", features: [], requiresBridge: false, mayStartBridge: false },
  stop: { command: "stop", features: ["bridge.safe-shutdown"], requiresBridge: true, mayStartBridge: false },
  health: { command: "health", features: [], requiresBridge: true, mayStartBridge: false },
  snapshot: { command: "snapshot", features: [], requiresBridge: true, mayStartBridge: false },
  "shot.create": { command: "shot.create", features: ["intent.strict-report"], requiresBridge: true, mayStartBridge: true },
  "shot.modify": { command: "shot.modify", features: ["intent.strict-report"], requiresBridge: true, mayStartBridge: true },
  "scene.create": { command: "scene.create", features: ["schema.scene-authoring"], authoring: "scene", requiresBridge: true, mayStartBridge: false },
  "scene.save": { command: "scene.save", features: ["scene.files"], requiresBridge: true, mayStartBridge: false },
  "scene.load": { command: "scene.load", features: ["scene.files"], requiresBridge: true, mayStartBridge: false },
  "patch.apply": { command: "patch.apply", features: ["schema.patch-authoring"], authoring: "patch", requiresBridge: true, mayStartBridge: false },
  "composition.inspect": { command: "composition.inspect", features: ["composition.segmented-report"], requiresBridge: true, mayStartBridge: false },
  "export.png": { command: "export.png", features: ["export.software-png"], requiresBridge: true, mayStartBridge: false },
  "profile.resolve": { command: "profile.resolve", features: ["profile.external-read-only"], requiresBridge: false, mayStartBridge: false },
  undo: { command: "undo", features: [], requiresBridge: true, mayStartBridge: false },
  redo: { command: "redo", features: [], requiresBridge: true, mayStartBridge: false },
  "open.system": { command: "open.system", features: [], requiresBridge: true, mayStartBridge: true },
};

const KNOWN_FEATURES = [
  "intent.strict-report",
  "intent.allow-partial",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
  "profile.external-read-only",
  "schema.scene-authoring",
  "schema.patch-authoring",
];

const LEGACY_USAGE_TO_ACTION = new Map([
  ["ensure", "ensure"],
  ["health", "health"],
  ["snapshot", "snapshot"],
  ["shot create --text <description> [--open]", "shot.create"],
  ["shot create --text <description> [--profile <external-project-profile.json>] [--open]", "shot.create"],
  ["shot modify --text <description> [--open]", "shot.modify"],
  ["shot modify --text <description> [--profile <external-project-profile.json>] [--open]", "shot.modify"],
  ["open --system", "open.system"],
]);

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUniqueStrings = (value) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;

const sameIds = (left, right) =>
  left.length === right.length && left.every((id) => right.includes(id));

const fixedMessage = (code) => ({
  CAPABILITIES_INVALID: "The installed runtime returned an invalid capability manifest.",
  CAPABILITIES_CONTRACT_UNSUPPORTED: "The installed runtime uses an unsupported capability contract.",
  BRIDGE_IDENTITY_MISMATCH: "The running local service is not Shubi Shot Director.",
  BRIDGE_PROTOCOL_UNSUPPORTED: "The running bridge protocol does not match the installed runtime CLI.",
  SCENE_SCHEMA_UNSUPPORTED: "The installed runtime does not support this Skill's SceneSpec authoring schema.",
  PATCH_SCHEMA_UNSUPPORTED: "The installed runtime does not support this Skill's ScenePatch authoring schema.",
  RUNTIME_REQUIRES_API_KEY: "The installed runtime is outside the local no-key product contract.",
  CAPABILITY_NOT_AVAILABLE: "The requested action is not available in the installed runtime.",
}[code]);

const diagnostics = (data = {}) => ({
  applicationVersion:
    typeof data.applicationVersion === "string"
      ? data.applicationVersion
      : null,
  capabilitiesContractVersion:
    Number.isInteger(data.capabilitiesContractVersion)
      ? data.capabilitiesContractVersion
      : null,
  bridgeProtocolVersion:
    Number.isInteger(data.bridgeProtocolVersion)
      ? data.bridgeProtocolVersion
      : null,
  sceneSchemaVersion:
    Number.isInteger(data.sceneSchemaVersion)
      ? data.sceneSchemaVersion
      : null,
  patchSchemaVersion:
    Number.isInteger(data.patchSchemaVersion)
      ? data.patchSchemaVersion
      : null,
  requiresApiKey:
    typeof data.requiresApiKey === "boolean"
      ? data.requiresApiKey
      : null,
});

const errorPlan = ({
  code,
  requestedAction,
  data,
  mode = "incompatible",
  liveVerified = false,
}) => ({
  planContractVersion: PLAN_CONTRACT_VERSION,
  mode,
  requestedAction,
  actionAllowed: false,
  allowedActions: [],
  requiresBridge: ACTION_POLICY[requestedAction]?.requiresBridge ?? false,
  mayStartBridge: false,
  liveVerified,
  sceneSchemaAuthoring: false,
  patchSchemaAuthoring: false,
  diagnostics: diagnostics(data),
  warnings: [],
  blockingError: { code, message: fixedMessage(code) },
});

const validManifestShape = (data) =>
  isRecord(data) &&
  data.service === "shubi-shot-director" &&
  Number.isInteger(data.capabilitiesContractVersion) &&
  data.capabilitiesContractVersion > 0 &&
  typeof data.applicationVersion === "string" &&
  data.applicationVersion.length > 0 &&
  typeof data.requiresApiKey === "boolean" &&
  Number.isInteger(data.bridgeProtocolVersion) &&
  data.bridgeProtocolVersion > 0 &&
  Number.isInteger(data.sceneSchemaVersion) &&
  data.sceneSchemaVersion > 0 &&
  Number.isInteger(data.patchSchemaVersion) &&
  data.patchSchemaVersion > 0 &&
  isUniqueStrings(data.commands) &&
  isUniqueStrings(data.features);

export function buildCompatibilityPlan({
  doctorData,
  helpData,
  liveHealthData,
  requestedAction,
  requestedFeatures = [],
  skillSceneSchemaVersion,
  skillPatchSchemaVersion,
}) {
  if (!isRecord(doctorData)) {
    return errorPlan({
      code: "CAPABILITIES_INVALID",
      requestedAction,
      data: doctorData,
    });
  }

  if (!("capabilitiesContractVersion" in doctorData)) {
    if (doctorData.requiresApiKey === true) {
      return errorPlan({
        code: "RUNTIME_REQUIRES_API_KEY",
        requestedAction,
        data: doctorData,
      });
    }
    if (liveHealthData !== undefined) {
      if (!isRecord(liveHealthData)) {
        return errorPlan({
          code: "CAPABILITIES_INVALID",
          requestedAction,
          data: liveHealthData,
        });
      }
      if (
        liveHealthData.service !== undefined &&
        liveHealthData.service !== "shubi-shot-director"
      ) {
        return errorPlan({
          code: "BRIDGE_IDENTITY_MISMATCH",
          requestedAction,
          data: liveHealthData,
        });
      }
      if (liveHealthData.requiresApiKey === true) {
        return errorPlan({
          code: "RUNTIME_REQUIRES_API_KEY",
          requestedAction,
          data: liveHealthData,
        });
      }
      const offlineProtocol = Number.isInteger(
        doctorData.bridgeProtocolVersion,
      )
        ? doctorData.bridgeProtocolVersion
        : null;
      const liveProtocol = Number.isInteger(
        liveHealthData.bridgeProtocolVersion,
      )
        ? liveHealthData.bridgeProtocolVersion
        : Number.isInteger(liveHealthData.protocolVersion)
          ? liveHealthData.protocolVersion
          : null;
      if (offlineProtocol === null || liveProtocol === null) {
        return errorPlan({
          code: "CAPABILITIES_INVALID",
          requestedAction,
          data: liveHealthData,
        });
      }
      if (offlineProtocol !== liveProtocol) {
        return errorPlan({
          code: "BRIDGE_PROTOCOL_UNSUPPORTED",
          requestedAction,
          data: liveHealthData,
        });
      }
    }
    const helpCommands = isRecord(helpData) && isUniqueStrings(helpData.commands)
      ? helpData.commands
      : [];
    const allowedActions = [...new Set(
      helpCommands
        .map((usage) => LEGACY_USAGE_TO_ACTION.get(usage))
        .filter(Boolean),
    )];
    const policy = ACTION_POLICY[requestedAction];
    const actionAllowed =
      policy !== undefined &&
      allowedActions.includes(requestedAction) &&
      requestedFeatures.length === 0;
    return {
      planContractVersion: PLAN_CONTRACT_VERSION,
      mode: "legacy",
      requestedAction,
      actionAllowed,
      allowedActions,
      requiresBridge: policy?.requiresBridge ?? false,
      mayStartBridge:
        actionAllowed &&
        (policy?.mayStartBridge ?? false) &&
        allowedActions.includes("ensure"),
      liveVerified: liveHealthData !== undefined,
      sceneSchemaAuthoring: false,
      patchSchemaAuthoring: false,
      diagnostics: diagnostics(doctorData),
      warnings: ["LEGACY_CAPABILITIES"],
      blockingError: actionAllowed
        ? null
        : {
            code: "CAPABILITY_NOT_AVAILABLE",
            message: fixedMessage("CAPABILITY_NOT_AVAILABLE"),
          },
    };
  }

  if (doctorData.capabilitiesContractVersion !== 1) {
    return errorPlan({
      code: "CAPABILITIES_CONTRACT_UNSUPPORTED",
      requestedAction,
      data: doctorData,
    });
  }
  if (!validManifestShape(doctorData)) {
    const code = doctorData.service === "shubi-shot-director"
      ? "CAPABILITIES_INVALID"
      : "BRIDGE_IDENTITY_MISMATCH";
    return errorPlan({ code, requestedAction, data: doctorData });
  }
  if (doctorData.requiresApiKey) {
    return errorPlan({
      code: "RUNTIME_REQUIRES_API_KEY",
      requestedAction,
      data: doctorData,
    });
  }

  let commands = new Set(doctorData.commands);
  let features = new Set(doctorData.features);
  let liveVerified = false;
  if (liveHealthData !== undefined) {
    if (!validManifestShape(liveHealthData)) {
      const code = isRecord(liveHealthData) &&
        liveHealthData.service !== "shubi-shot-director"
        ? "BRIDGE_IDENTITY_MISMATCH"
        : "CAPABILITIES_INVALID";
      return errorPlan({ code, requestedAction, data: liveHealthData });
    }
    if (
      liveHealthData.capabilitiesContractVersion !==
      doctorData.capabilitiesContractVersion
    ) {
      return errorPlan({
        code: "CAPABILITIES_CONTRACT_UNSUPPORTED",
        requestedAction,
        data: liveHealthData,
      });
    }
    if (liveHealthData.requiresApiKey) {
      return errorPlan({
        code: "RUNTIME_REQUIRES_API_KEY",
        requestedAction,
        data: liveHealthData,
      });
    }
    if (
      liveHealthData.bridgeProtocolVersion !==
      doctorData.bridgeProtocolVersion
    ) {
      return errorPlan({
        code: "BRIDGE_PROTOCOL_UNSUPPORTED",
        requestedAction,
        data: liveHealthData,
      });
    }
    if (liveHealthData.sceneSchemaVersion !== doctorData.sceneSchemaVersion) {
      return errorPlan({
        code: "SCENE_SCHEMA_UNSUPPORTED",
        requestedAction,
        data: liveHealthData,
      });
    }
    if (liveHealthData.patchSchemaVersion !== doctorData.patchSchemaVersion) {
      return errorPlan({
        code: "PATCH_SCHEMA_UNSUPPORTED",
        requestedAction,
        data: liveHealthData,
      });
    }
    if (
      !sameIds(liveHealthData.commands, doctorData.commands) ||
      !sameIds(liveHealthData.features, doctorData.features)
    ) {
      return errorPlan({
        code: "CAPABILITIES_INVALID",
        requestedAction,
        data: liveHealthData,
      });
    }
    liveVerified = true;
  }

  const sceneSchemaAuthoring =
    doctorData.sceneSchemaVersion === skillSceneSchemaVersion &&
    features.has("schema.scene-authoring");
  const patchSchemaAuthoring =
    doctorData.patchSchemaVersion === skillPatchSchemaVersion &&
    features.has("schema.patch-authoring");

  const allowedActions = Object.entries(ACTION_POLICY)
    .filter(([, policy]) => {
      if (!commands.has(policy.command)) return false;
      if (!policy.features.every((feature) => features.has(feature))) return false;
      if (policy.authoring === "scene" && !sceneSchemaAuthoring) return false;
      if (policy.authoring === "patch" && !patchSchemaAuthoring) return false;
      return true;
    })
    .map(([action]) => action);

  const policy = ACTION_POLICY[requestedAction];
  const missingRequestedFeature = requestedFeatures.some(
    (feature) => !features.has(feature),
  );
  const actionAllowed =
    policy !== undefined &&
    allowedActions.includes(requestedAction) &&
    !missingRequestedFeature;
  let blockingCode = null;
  if (!actionAllowed) {
    blockingCode =
      policy?.authoring === "scene" && !sceneSchemaAuthoring
        ? "SCENE_SCHEMA_UNSUPPORTED"
        : policy?.authoring === "patch" && !patchSchemaAuthoring
          ? "PATCH_SCHEMA_UNSUPPORTED"
          : "CAPABILITY_NOT_AVAILABLE";
  }
  const mode =
    allowedActions.length === Object.keys(ACTION_POLICY).length &&
    KNOWN_FEATURES.every((feature) => features.has(feature)) &&
    sceneSchemaAuthoring &&
    patchSchemaAuthoring
      ? "full"
      : "restricted";

  return {
    planContractVersion: PLAN_CONTRACT_VERSION,
    mode,
    requestedAction,
    actionAllowed,
    allowedActions,
    requiresBridge: policy?.requiresBridge ?? false,
    mayStartBridge:
      actionAllowed &&
      (policy?.mayStartBridge ?? false) &&
      allowedActions.includes("ensure"),
    liveVerified,
    sceneSchemaAuthoring,
    patchSchemaAuthoring,
    diagnostics: diagnostics(doctorData),
    warnings: [],
    blockingError: blockingCode === null
      ? null
      : { code: blockingCode, message: fixedMessage(blockingCode) },
  };
}
```

- [ ] **Step 4: Add planner execution and pre-forward gating to the wrapper**

Replace the Skill `director.mjs` with the following orchestration shape while retaining the existing child exit/signal forwarding:

```js
#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ACTION_POLICY,
  buildCompatibilityPlan,
} from "./compatibility-plan.mjs";
import {
  SkillRuntimeError,
  resolveRuntimeEntrypoint,
} from "./runtime-locator.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, "..");

class SkillDirectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SkillDirectorError";
    this.code = code;
  }
}

const output = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const parseEnvelope = (stdout) => {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) {
    throw new SkillDirectorError(
      "RUNTIME_RESPONSE_INVALID",
      "The installed runtime returned an invalid response.",
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(lines[0]);
  } catch {
    throw new SkillDirectorError(
      "RUNTIME_RESPONSE_INVALID",
      "The installed runtime returned an invalid response.",
    );
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    typeof envelope.ok !== "boolean"
  ) {
    throw new SkillDirectorError(
      "RUNTIME_RESPONSE_INVALID",
      "The installed runtime returned an invalid response.",
    );
  }
  return envelope;
};

const invokeRuntimeJson = async (runtimeEntrypoint, runtimeRoot, args) => {
  try {
    const result = await execFileAsync(
      process.execPath,
      [runtimeEntrypoint, ...args],
      {
        cwd: runtimeRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return parseEnvelope(result.stdout);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string" &&
      error.stdout.trim() !== ""
    ) {
      return parseEnvelope(error.stdout);
    }
    throw new SkillDirectorError(
      "RUNTIME_UNAVAILABLE",
      "The installed Shubi Shot Director runtime could not be executed.",
    );
  }
};

const safeRuntimeMessage = (code) => ({
  BRIDGE_UNAVAILABLE: "The local Shubi Shot Director bridge is not running.",
  CAPABILITIES_INVALID: "The installed runtime returned invalid capabilities.",
  CAPABILITIES_CONTRACT_UNSUPPORTED: "The installed runtime capability contract is unsupported.",
  BRIDGE_IDENTITY_MISMATCH: "The running local service is not Shubi Shot Director.",
  BRIDGE_PROTOCOL_UNSUPPORTED: "The running bridge does not match the installed runtime CLI.",
  SCENE_SCHEMA_UNSUPPORTED: "The running bridge SceneSpec schema does not match the installed runtime CLI.",
  PATCH_SCHEMA_UNSUPPORTED: "The running bridge ScenePatch schema does not match the installed runtime CLI.",
  RUNTIME_REQUIRES_API_KEY: "The installed runtime is outside the local no-key product contract.",
}[code] ?? "The installed runtime rejected the command.");

const requireData = (envelope) => {
  if (!envelope.ok) {
    const code =
      typeof envelope.error?.code === "string"
        ? envelope.error.code
        : "RUNTIME_COMMAND_FAILED";
    throw new SkillDirectorError(
      code,
      safeRuntimeMessage(code),
    );
  }
  return envelope.data;
};

const readGeneratedSchemaVersion = async (name) => {
  const schema = JSON.parse(
    await readFile(
      path.join(skillDirectory, "references", "generated", name),
      "utf8",
    ),
  );
  const version = schema?.properties?.schemaVersion?.const;
  if (!Number.isInteger(version)) {
    throw new SkillDirectorError(
      "SKILL_SCHEMA_INVALID",
      "The bundled Skill schema is invalid.",
    );
  }
  return version;
};

const parsePlanArgs = (args) => {
  if (args[0] !== "compatibility" || args[1] !== "plan") return null;
  let action;
  let live = false;
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] === "--live") {
      live = true;
      continue;
    }
    if (args[index] === "--action" && args[index + 1] !== undefined) {
      action = args[index + 1];
      index += 1;
      continue;
    }
    throw new SkillDirectorError(
      "CLI_UNKNOWN_ARGUMENT",
      "The compatibility plan arguments are invalid.",
    );
  }
  if (action === undefined || ACTION_POLICY[action] === undefined) {
    throw new SkillDirectorError(
      "CLI_ARGUMENT_REQUIRED",
      "A known --action value is required.",
    );
  }
  return { action, live };
};

const actionFromArgs = (args) => {
  if (["ensure", "status", "stop", "health", "snapshot", "undo", "redo"].includes(args[0])) return args[0];
  if (args[0] === "scene" && ["create", "save", "load"].includes(args[1])) return `scene.${args[1]}`;
  if (args[0] === "patch" && args[1] === "apply") return "patch.apply";
  if (args[0] === "shot" && ["create", "modify"].includes(args[1])) return `shot.${args[1]}`;
  if (args[0] === "composition" && args[1] === "inspect") return "composition.inspect";
  if (args[0] === "export" && args[1] === "png") return "export.png";
  if (args[0] === "profile" && args[1] === "resolve") return "profile.resolve";
  if (args[0] === "open" && args[1] === "--system") return "open.system";
  return null;
};

const requestedFeaturesFromArgs = (args) => [
  ...(args.includes("--profile") ? ["profile.external-read-only"] : []),
  ...(args.includes("--allow-partial") ? ["intent.allow-partial"] : []),
];

const createPlan = async ({
  runtimeEntrypoint,
  runtimeRoot,
  action,
  live,
  requestedFeatures = [],
}) => {
  const doctorData = requireData(
    await invokeRuntimeJson(runtimeEntrypoint, runtimeRoot, ["doctor"]),
  );
  const legacy =
    typeof doctorData === "object" &&
    doctorData !== null &&
    !("capabilitiesContractVersion" in doctorData);
  const helpData = legacy
    ? requireData(
        await invokeRuntimeJson(runtimeEntrypoint, runtimeRoot, ["help"]),
      )
    : undefined;
  const skillSceneSchemaVersion = await readGeneratedSchemaVersion(
    "scene-spec.schema.json",
  );
  const skillPatchSchemaVersion = await readGeneratedSchemaVersion(
    "scene-patch.schema.json",
  );
  const sharedInput = {
    doctorData,
    helpData,
    skillSceneSchemaVersion,
    skillPatchSchemaVersion,
  };
  const offlinePlan = buildCompatibilityPlan({
    ...sharedInput,
    requestedAction: action,
    requestedFeatures,
  });
  if (!live) return offlinePlan;

  const healthPlan = buildCompatibilityPlan({
    ...sharedInput,
    requestedAction: "health",
  });
  if (!healthPlan.actionAllowed) {
    return {
      ...offlinePlan,
      actionAllowed: false,
      mayStartBridge: false,
      liveVerified: false,
      blockingError: healthPlan.blockingError,
    };
  }
  const liveHealthData = requireData(
    await invokeRuntimeJson(runtimeEntrypoint, runtimeRoot, ["health"]),
  );
  return buildCompatibilityPlan({
    ...sharedInput,
    liveHealthData,
    requestedAction: action,
    requestedFeatures,
  });
};

const forwardRuntime = (runtimeEntrypoint, runtimeRoot, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtimeEntrypoint, ...args], {
      cwd: runtimeRoot,
      env: process.env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exitCode = code ?? 1;
      resolve();
    });
  });

const main = async () => {
  const runtimeEntrypoint = await resolveRuntimeEntrypoint();
  const runtimeRoot = path.resolve(path.dirname(runtimeEntrypoint), "..");
  const args = process.argv.slice(2);
  const planRequest = parsePlanArgs(args);
  if (planRequest !== null) {
    output({
      ok: true,
      data: await createPlan({
        runtimeEntrypoint,
        runtimeRoot,
        action: planRequest.action,
        live: planRequest.live,
      }),
    });
    return;
  }
  if (args.length === 0 || args[0] === "help" || args[0] === "doctor") {
    await forwardRuntime(runtimeEntrypoint, runtimeRoot, args);
    return;
  }
  const action = actionFromArgs(args);
  if (action === null) {
    throw new SkillDirectorError(
      "CLI_UNKNOWN_COMMAND",
      "The Skill wrapper does not recognize this command.",
    );
  }
  const plan = await createPlan({
    runtimeEntrypoint,
    runtimeRoot,
    action,
    live: false,
    requestedFeatures: requestedFeaturesFromArgs(args),
  });
  if (!plan.actionAllowed) {
    output({ ok: false, error: plan.blockingError });
    process.exitCode = 1;
    return;
  }
  await forwardRuntime(runtimeEntrypoint, runtimeRoot, args);
};

void main().catch((error) => {
  const known = error instanceof SkillDirectorError ||
    error instanceof SkillRuntimeError;
  output({
    ok: false,
    error: {
      code: known ? error.code : "SKILL_RUNTIME_ERROR",
      message: known
        ? error.message
        : "The Skill runtime command could not be completed safely.",
    },
  });
  process.exitCode = 1;
});
```

An incompatible diagnosis remains `ok: true` because planning succeeded. Attempting a forbidden command returns `ok: false` with the same stable `blockingError.code` and exits `1` before target invocation.

- [ ] **Step 5: Run planner and wrapper tests**

```powershell
pnpm exec vitest run tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts tests/skill-scripts.test.ts
```

Expected: PASS and no fake-runtime log contains raw text, file paths, or profile values.

- [ ] **Step 6: Commit**

```powershell
git add .agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs .agents/skills/shubi-shot-director/scripts/director.mjs tests/helpers/skill-runtime-fixture.ts tests/helpers/create-skill-forward-fixtures.ts tests/skill-compatibility.test.ts
git commit -m "feat: negotiate skill runtime capabilities"
```

### Task 6: Rewrite the Skill around negotiated capabilities

**Files:**

- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/intent-routing.md`
- Modify: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Modify: `.agents/skills/shubi-shot-director/references/recovery-and-concurrency.md`
- Modify: `.agents/skills/shubi-shot-director/references/visual-qa.md`
- Modify: `.agents/skills/shubi-shot-director/agents/openai.yaml`
- Modify: `docs/verification.md`
- Test: `tests/skill-docs.test.ts`

- [ ] **Step 1: Capture the RED fresh-agent baseline before editing the Skill**

Create one isolated synthetic runtime per model tier and compatibility case. The Task 5 generator resets only its own ignored generic state and command log, rejects undeclared actions, and never records arguments:

```powershell
$verifyRoot = Join-Path (git rev-parse --show-toplevel) ".shubi-shot/verification/skill-compatibility"
New-Item -ItemType Directory -Force $verifyRoot | Out-Null
pnpm exec tsx tests/helpers/create-skill-forward-fixtures.ts --root $verifyRoot
```

Expected: one JSON envelope listing tiers `sol`, `terra` and the six generic case IDs, with no resolved path in the envelope.

Run two fresh agents with `fork_turns: "none"`: one with model `gpt-5.6-sol`, one with `gpt-5.6-terra`. Give both the following task, substituting only `<tier>` with `sol` or `terra`; do not supply expected modes or expected commands:

```text
Use $shubi-shot-director for each generic task below. Prefix every runtime command in a case, in that same PowerShell invocation, with `$env:SHUBI_SHOT_RUNTIME_ROOT = (Resolve-Path '.shubi-shot/verification/skill-compatibility/<tier>/<case-id>').Path`. This relative-path injection must be repeated for the next command because shell processes may not persist. Do not inspect or edit the Skill, runtime fixture, or repository source.

1. current: create a generic single-actor medium shot in a small room; snapshot it; request "camera a little lower"; snapshot again.
2. no-export: request a 16:9 PNG export of the current generic shot.
3. legacy: create the same generic shot, then request "camera a little lower".
4. future-compatible: create the same generic shot.
5. future-schema: create the same generic shot, then request "camera a little lower".
6. requires-key: try to create the same generic shot. Never ask for or handle a key.

For each case, report only: case ID, selected compatibility mode or null, normalized command IDs, stable error code or null, whether mutation occurred, sceneId before/after when available, and revision before/after when available. Do not include raw prompts, command arguments, profile data, or resolved paths. Save that normalized JSON as `.shubi-shot/verification/skill-compatibility/<tier>/evidence-red.json`.
```

After both agents finish, compare each `evidence-red.json` with that case's `command-ids.log` and `state.json`, then audit the normalized evidence:

```powershell
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file .shubi-shot/verification/skill-compatibility/sol/evidence-red.json
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file .shubi-shot/verification/skill-compatibility/terra/evidence-red.json
```

Preserve the baseline even when it is wrong. At least one run must show a real current-Skill failure such as no compatibility plan, an undeclared action attempt, missing incremental verification, or different routing between tiers before editing `SKILL.md`.

- [ ] **Step 2: Write failing Skill contract tests**

Create `tests/skill-docs.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillRoot = path.resolve(
  ".agents/skills/shubi-shot-director",
);

describe("Shubi Shot Director Skill contract", () => {
  it("routes through negotiated capabilities without semver branching", async () => {
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const description = skill.match(/^description:\s*(.+)$/m)?.[1] ?? "";

    expect(description).toMatch(/^Use when/);
    expect(skill).toContain("compatibility plan");
    expect(skill).toContain("sceneSchemaAuthoring");
    expect(skill).toContain("patchSchemaAuthoring");
    expect(skill).toContain("offline/live");
    expect(skill).toContain("generic actor slots in memory");
    expect(skill).toContain("runtime-native `shot.create`");
    expect(skill).toContain("same `sceneId`");
    expect(skill).toContain("revision exactly `+1`");
    expect(skill).not.toMatch(/\b0\.\d+(?:\.\d+)?\b/);
    expect(skill).not.toContain("straightforward");
    expect(skill).not.toContain("versions are diagnostic only");
  });

  it("keeps every directly required reference present", async () => {
    const required = [
      "cli-contract.md",
      "intent-routing.md",
      "scene-authoring.md",
      "patch-authoring.md",
      "external-profiles.md",
      "recovery-and-concurrency.md",
      "visual-qa.md",
    ];
    await expect(
      Promise.all(
        required.map((name) =>
          readFile(path.join(skillRoot, "references", name), "utf8"),
        ),
      ),
    ).resolves.toHaveLength(required.length);
  });

  it("does not force every invocation to create and open", async () => {
    const metadata = await readFile(
      path.join(skillRoot, "agents", "openai.yaml"),
      "utf8",
    );

    expect(metadata).toContain("$shubi-shot-director");
    expect(metadata).toContain("stage or revise");
    expect(metadata).not.toContain("stage this shot and open");
  });
});
```

- [ ] **Step 3: Verify RED**

```powershell
pnpm exec vitest run tests/skill-docs.test.ts
```

Expected: FAIL because the current description and routing remain fixed-command and subjective.

- [ ] **Step 4: Replace the main Skill with the invariant route**

Keep `SKILL.md` under 500 words and use this structure:

```markdown
---
name: shubi-shot-director
description: Use when a user wants to create, revise, inspect, save, load, or export an editable graybox camera-previs shot through Shubi Shot Director, including natural-language blocking, actor, prop, camera, focal-length, history, or explicitly supplied external-alias tasks.
---

# Shubi Shot Director

Use Codex for semantic interpretation and the local runtime for deterministic validation, revision control, persistence, and rendering. Never request or handle an API key.

## Negotiate first

Run `node scripts/director.mjs compatibility plan --action <action-id>` before an action. Obey `actionAllowed`. Never branch on an absolute application or bridge-protocol number, but treat any offline/live manifest or protocol mismatch reported by `--live` as blocking before mutation. Run `ensure` only when `mayStartBridge` is true, then repeat the same plan with `--live` before mutation.

Read `references/cli-contract.md` for action IDs and recovery. Report unavailable capability codes without guessing another command.

## Interpret once

If the user explicitly supplies an external profile path, read `references/external-profiles.md`, resolve aliases through the allowed profile action, and keep only generic actor slots in memory. Then read `references/intent-routing.md`, compile the fully resolved request once, and submit only when `IntentReport.canApplySafely` is true. On a strict failure, attempt at most one schema fallback:

- read `references/scene-authoring.md` only when `sceneSchemaAuthoring` is true;
- read `references/patch-authoring.md` only when `patchSchemaAuthoring` is true.

If the matching flag is false or the schema cannot express every constraint, stop and report the generic missing capability. Do not partially create a scene. A runtime-native `shot.create` or `shot.modify` remains usable across a newer schema when it is advertised; only Skill-authored JSON is disabled.

## Preserve authoritative state

For a new shot, create one complete SceneSpec only through an allowed route. For every follow-up, snapshot first and apply one incremental ScenePatch at the exact revision; never replace the scene. Snapshot again and require the same `sceneId` plus revision exactly `+1` before checking the final-camera result. Read `references/recovery-and-concurrency.md` for conflicts and history.

Keep aliases and profile paths transient. Load `references/visual-qa.md` after a mutation or export and inspect the final-camera view rather than claiming composition from coordinates alone. Keep all saved data, logs, fixtures, and screenshots generic.
```

- [ ] **Step 5: Align references and UI metadata**

Update `cli-contract.md` with the current full command list, stable action IDs, compatibility modes, feature gates, and errors. Remove “straightforward/complex” model judgment from `intent-routing.md`, `scene-authoring.md`, and `patch-authoring.md`; let strict `IntentReport` plus authoring flags choose the route. Update recovery and visual QA so optional commands are invoked only when advertised.

Regenerate `agents/openai.yaml`:

```powershell
$env:PYTHONPATH = (Resolve-Path '.tools\pyyaml').Path
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\generate_openai_yaml.py" `
  ".agents\skills\shubi-shot-director" `
  --interface "display_name=Shubi Shot Director" `
  --interface "short_description=Stage or revise editable graybox shots" `
  --interface 'default_prompt=Use $shubi-shot-director to stage or revise this graybox shot with capabilities supported by the installed local runtime.'
```

Update `docs/verification.md` with the capability-plan matrix and no-key assertion.

- [ ] **Step 6: Run Skill GREEN checks**

```powershell
pnpm exec vitest run tests/skill-docs.test.ts tests/skill-compatibility.test.ts tests/skill-scripts.test.ts
$env:PYTHONPATH = (Resolve-Path '.tools\pyyaml').Path
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" ".agents\skills\shubi-shot-director"
```

Expected: all tests PASS and `quick_validate.py` reports a valid Skill.

- [ ] **Step 7: Run the GREEN fresh-agent matrix after editing**

Reset all synthetic states and command logs, without deleting the preserved RED evidence files:

```powershell
$verifyRoot = Join-Path (git rev-parse --show-toplevel) ".shubi-shot/verification/skill-compatibility"
pnpm exec tsx tests/helpers/create-skill-forward-fixtures.ts --root $verifyRoot
```

Run new `fork_turns: "none"` agents at `gpt-5.6-sol` and `gpt-5.6-terra`. Substitute only `<tier>` and save to `evidence-green.json`:

```text
Use $shubi-shot-director for each generic task below. Prefix every runtime command in a case, in that same PowerShell invocation, with `$env:SHUBI_SHOT_RUNTIME_ROOT = (Resolve-Path '.shubi-shot/verification/skill-compatibility/<tier>/<case-id>').Path`. This relative-path injection must be repeated for the next command because shell processes may not persist. Do not inspect or edit the Skill, runtime fixture, or repository source.

1. current: create a generic single-actor medium shot in a small room; snapshot it; request "camera a little lower"; snapshot again.
2. no-export: request a 16:9 PNG export of the current generic shot.
3. legacy: create the same generic shot, then request "camera a little lower".
4. future-compatible: create the same generic shot.
5. future-schema: create the same generic shot, then request "camera a little lower".
6. requires-key: try to create the same generic shot. Never ask for or handle a key.

For each case, report only: case ID, selected compatibility mode or null, normalized command IDs, stable error code or null, whether mutation occurred, sceneId before/after when available, and revision before/after when available. Do not include raw prompts, command arguments, profile data, or resolved paths. Save that normalized JSON as `.shubi-shot/verification/skill-compatibility/<tier>/evidence-green.json`.
```

Compare both GREEN evidence files with every case's `command-ids.log` and `state.json`, then run:

```powershell
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file .shubi-shot/verification/skill-compatibility/sol/evidence-green.json
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file .shubi-shot/verification/skill-compatibility/terra/evidence-green.json
```

Require identical modes and safe routes across tiers: current `full`; no-export `restricted` without `export.png` or mutation; legacy `legacy` with only recognized core actions; future-compatible `full`; future-schema `restricted` with runtime-native `shot.create` and `shot.modify` but no `scene.create` or `patch.apply`; requires-key `incompatible` with zero mutation. In the current case, require the same `sceneId`, create revision `1`, modify revision `2`, and an exact `+1` transition. Neither run may request, read, or transmit an API key.

- [ ] **Step 8: Commit**

```powershell
git add .agents/skills/shubi-shot-director/SKILL.md .agents/skills/shubi-shot-director/references .agents/skills/shubi-shot-director/agents/openai.yaml docs/verification.md tests/skill-docs.test.ts
git commit -m "docs: route shot skill by negotiated capabilities"
```

### Task 7: Run the complete CLI, privacy, and browser acceptance flow

**Files:**

- Runtime evidence only: `.shubi-shot/verification/skill-compatibility/` (ignored)
- Modify only if validation exposes a defect: the smallest owning source and its regression test

- [ ] **Step 1: Run the complete automated suite**

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit `0`; test count is at least the existing 110 plus the new compatibility cases.

- [ ] **Step 2: Validate and audit the Skill**

```powershell
$env:PYTHONPATH = (Resolve-Path '.tools\pyyaml').Path
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" ".agents\skills\shubi-shot-director"
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file .agents/skills/shubi-shot-director/SKILL.md
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file docs/verification.md
```

Expected: valid Skill and zero privacy findings.

- [ ] **Step 3: Exercise the no-browser CLI closed loop**

Use only generic files under the ignored verification directory:

```powershell
$verifyRoot = ".shubi-shot/verification/skill-compatibility/cli"
New-Item -ItemType Directory -Force $verifyRoot | Out-Null
node .agents/skills/shubi-shot-director/scripts/director.mjs compatibility plan --action ensure
node .agents/skills/shubi-shot-director/scripts/director.mjs ensure
node .agents/skills/shubi-shot-director/scripts/director.mjs compatibility plan --action snapshot --live
node .agents/skills/shubi-shot-director/scripts/director.mjs shot create --text "A generic actor sits on a low platform in a small room, medium shot at eye level."
node .agents/skills/shubi-shot-director/scripts/director.mjs scene save --file "$verifyRoot/generic.scene.json" --force
node .agents/skills/shubi-shot-director/scripts/director.mjs scene load --file "$verifyRoot/generic.scene.json"
node .agents/skills/shubi-shot-director/scripts/director.mjs composition inspect --json
node .agents/skills/shubi-shot-director/scripts/director.mjs export png --file "$verifyRoot/perspective.png" --width 1920 --height 1080 --force
node .agents/skills/shubi-shot-director/scripts/director.mjs status
```

Verify the PNG signature and IHDR dimensions, scene ID/revision continuity, SHA-256, warning codes, and segmented composition report. Audit every captured JSON sidecar with `audit-generic-output.mjs`.

- [ ] **Step 4: Verify an actual incremental transition**

Capture a raw before scene, derive one generic camera Patch from its authoritative IDs, apply it, capture the after scene, and run the bundled transition verifier:

```powershell
$transitionRoot = ".shubi-shot/verification/skill-compatibility/transition"
New-Item -ItemType Directory -Force $transitionRoot | Out-Null
node .agents/skills/shubi-shot-director/scripts/director.mjs scene save --file "$transitionRoot/before.scene.json" --force
$env:SHUBI_TRANSITION_ROOT = (Resolve-Path $transitionRoot).Path
$patchScript = @'
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

void (async () => {
  const root = process.env.SHUBI_TRANSITION_ROOT;
  if (!root) throw new Error("SHUBI_TRANSITION_ROOT is required");
  const before = JSON.parse(
    await readFile(path.join(root, "before.scene.json"), "utf8"),
  );
  const patch = {
    schemaVersion: 1,
    patchId: "verify_camera_lower",
    sceneId: before.sceneId,
    baseRevision: before.revision,
    source: "natural-language",
    operations: [
      {
        op: "entity.transform.translate",
        entityId: before.activeCameraId,
        deltaM: [0, -0.15, 0],
        referenceSpace: "world",
      },
    ],
  };
  await writeFile(
    path.join(root, "camera-lower.patch.json"),
    JSON.stringify(patch, null, 2),
  );
})().catch(() => {
  process.stderr.write("Unable to create the generic transition Patch.\n");
  process.exitCode = 1;
});
'@
pnpm exec tsx -e $patchScript
Remove-Item Env:SHUBI_TRANSITION_ROOT
node .agents/skills/shubi-shot-director/scripts/director.mjs compatibility plan --action patch.apply --live
node .agents/skills/shubi-shot-director/scripts/director.mjs patch apply --file "$transitionRoot/camera-lower.patch.json"
node .agents/skills/shubi-shot-director/scripts/director.mjs scene save --file "$transitionRoot/after.scene.json" --force
node .agents/skills/shubi-shot-director/scripts/verify-transition.mjs --before "$transitionRoot/before.scene.json" --after "$transitionRoot/after.scene.json" --patch "$transitionRoot/camera-lower.patch.json"
```

Expected: `ok: true`, `sameSceneId: true`, `exactRevision: true`, `hasOperations: true`, and `diffIsMinimal: true`. Audit all three JSON files and keep the verifier output as generic ignored evidence.

- [ ] **Step 5: Verify a real browser interaction**

Use `browser:control-in-app-browser`. Open the `uiUrl` returned by `ensure`, then verify in the real page:

- the editable 3D viewport renders;
- the independent final-camera preview renders;
- the generic actor and platform are visible;
- selecting and moving an entity changes the authoritative revision;
- changing focal length updates both SceneSpec and preview;
- undo and redo restore the expected state;
- the composition panel exposes all six checks;
- export produces a 16:9 perspective reference.

If a browser defect appears, write a failing regression test before changing code.

- [ ] **Step 6: Re-run privacy and repository-boundary checks**

```powershell
rg -n --hidden -g '!node_modules/**' -g '!dist/**' -g '!.git/**' -g '!.shubi-shot/**' -g '!docs/superpowers/plans/**' "OPENAI_API_KEY|api[_-]?key\s*[:=]|[A-Z]:\\|/Users/|/home/" .
node .agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs --artifact --file docs/superpowers/plans/2026-07-24-skill-version-compatibility.md
git status --short
```

Expected: the repository scan has no credential or committed machine-path finding, the plan-specific audit has zero findings, and only intended source changes are present.

- [ ] **Step 7: Stop the bridge and create the final stable checkpoint**

```powershell
node .agents/skills/shubi-shot-director/scripts/director.mjs stop
git status --short
git diff --check
git add -- `
  src/domain/schema-versions.ts `
  src/domain/scene-schema.ts `
  src/domain/scene-patch.ts `
  cli/application-metadata.ts `
  cli/runtime-capabilities.ts `
  cli/bridge.ts `
  cli/director.ts `
  server/api.ts `
  .agents/skills/shubi-shot-director/runtime.json `
  .agents/skills/shubi-shot-director/scripts/runtime-locator.mjs `
  .agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs `
  .agents/skills/shubi-shot-director/scripts/director.mjs `
  .agents/skills/shubi-shot-director/SKILL.md `
  .agents/skills/shubi-shot-director/references `
  .agents/skills/shubi-shot-director/agents/openai.yaml `
  docs/verification.md `
  tests/runtime-capabilities.test.ts `
  tests/cli-doctor.test.ts `
  tests/server-api-health.test.ts `
  tests/bridge-health.test.ts `
  tests/bridge-compatibility-cli.test.ts `
  tests/skill-runtime-locator.test.ts `
  tests/helpers/skill-runtime-fixture.ts `
  tests/helpers/create-skill-forward-fixtures.ts `
  tests/skill-compatibility.test.ts `
  tests/skill-docs.test.ts
git diff --cached --check
git diff --cached --stat
git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
  git commit -m "checkpoint: harden cross-version skill compatibility"
} elseif ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect staged changes."
}
```

Before committing, inspect `git diff --cached`, confirm every staged hunk belongs to this compatibility scope, and ensure ignored verification artifacts and unrelated user changes are not staged. If the explicit list has no remaining changes because Tasks 1–6 already committed everything, retain the latest passing task commit as the final stable checkpoint instead of creating an empty commit.

## Plan self-review result

- Capability manifest, application-version neutrality, no-key behavior, legacy routing, schema-restricted routing, live CLI/bridge matching, runtime location, Skill brevity, reference discovery, two-model forward testing, privacy auditing, CLI closed loop, and real-browser verification each have an owning task.
- The plan contains no deferred stubs or unspecified implementation steps.
- Type and field names remain consistent with the approved design: `capabilitiesContractVersion`, `applicationVersion`, `bridgeProtocolVersion`, `sceneSchemaVersion`, `patchSchemaVersion`, `commands`, `features`, `requiresApiKey`, `sceneSchemaAuthoring`, and `patchSchemaAuthoring`.
