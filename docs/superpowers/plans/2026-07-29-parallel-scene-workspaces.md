# Parallel Scene Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let separate Codex conversations build and export independent Shubi Shot Director scenes concurrently through automatically isolated local workspaces.

**Architecture:** The Skill wrapper hashes the host thread ID into a generic workspace ID, resolves one contained runtime directory and one loopback port for that workspace, and forwards only the port and directory to the existing structured runtime. Each bridge continues to own exactly one `SceneSession`; concurrency comes from multiple isolated bridge processes rather than a multi-scene server.

**Tech Stack:** Node.js ESM, TypeScript 6, Express, Vitest, filesystem-atomic JSON state, loopback HTTP, React/Three.js browser acceptance.

---

## File Structure

Create focused workspace modules under the Skill because raw host thread identity
must never cross into the runtime:

- `.agents/skills/shubi-shot-director/scripts/workspace-identity.mjs`
  derives opaque IDs, validates IDs, and constructs contained paths.
- `.agents/skills/shubi-shot-director/scripts/workspace-registry.mjs`
  owns atomic bindings, legacy adoption, descriptors, allocation locks, and
  loopback port leases.
- `.agents/skills/shubi-shot-director/scripts/director.mjs`
  routes ordinary Skill commands and exposes safe workspace inspection.

Keep runtime changes limited to capability/version reporting. The existing
`SHUBI_SHOT_PORT` and `SHUBI_SHOT_RUNTIME_DIR` process boundary remains the only
bridge configuration surface.

## Task 1: Opaque workspace identity and contained paths

**Files:**

- Create: `.agents/skills/shubi-shot-director/scripts/workspace-identity.mjs`
- Create: `tests/skill-workspace-identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

Create `tests/skill-workspace-identity.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  deriveThreadWorkspaceId,
  isWorkspaceId,
  resolveWorkspacePaths,
} from "../.agents/skills/shubi-shot-director/scripts/workspace-identity.mjs";

describe("Skill workspace identity", () => {
  it("derives a stable opaque ID without retaining the thread ID", () => {
    const source = "019fa111-1111-7111-8111-111111111111";
    const first = deriveThreadWorkspaceId(source);
    const second = deriveThreadWorkspaceId(source);

    expect(first).toBe(second);
    expect(first).toMatch(/^workspace_[0-9a-f]{32}$/u);
    expect(first).not.toContain(source);
  });

  it("separates two thread identities", () => {
    expect(
      deriveThreadWorkspaceId(
        "019fa111-1111-7111-8111-111111111111",
      ),
    ).not.toBe(
      deriveThreadWorkspaceId(
        "019fa222-2222-7222-8222-222222222222",
      ),
    );
  });

  it("accepts only canonical workspace IDs", () => {
    expect(
      isWorkspaceId("workspace_0123456789abcdef0123456789abcdef"),
    ).toBe(true);
    expect(isWorkspaceId("../workspace_escape")).toBe(false);
    expect(isWorkspaceId("workspace_ABCDEF")).toBe(false);
  });

  it("constructs every path below the fixed routing root", () => {
    const routingRoot = path.resolve(".shubi-shot/workspace-routing");
    const workspaceId =
      "workspace_0123456789abcdef0123456789abcdef";
    const paths = resolveWorkspacePaths(routingRoot, workspaceId);

    for (const value of Object.values(paths)) {
      expect(path.relative(routingRoot, value)).not.toMatch(
        /^(?:\.\.(?:[\\/]|$)|[\\/])/u,
      );
    }
    expect(paths.runtimeDirectory).toBe(
      path.join(
        routingRoot,
        "workspaces",
        workspaceId,
        "runtime",
      ),
    );
  });
});
```

- [ ] **Step 2: Run the tests and verify the red state**

Run:

```powershell
pnpm test -- tests/skill-workspace-identity.test.ts
```

Expected: FAIL because `workspace-identity.mjs` does not exist.

- [ ] **Step 3: Implement identity and path containment**

Create `.agents/skills/shubi-shot-director/scripts/workspace-identity.mjs`:

```js
import { createHash } from "node:crypto";
import path from "node:path";

const WORKSPACE_ID_PATTERN = /^workspace_[0-9a-f]{32}$/u;
const THREAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isWorkspaceId = (value) =>
  typeof value === "string" && WORKSPACE_ID_PATTERN.test(value);

export const deriveThreadWorkspaceId = (threadId) => {
  if (
    typeof threadId !== "string" ||
    !THREAD_ID_PATTERN.test(threadId)
  ) {
    return undefined;
  }
  const digest = createHash("sha256")
    .update("shubi-shot-workspace-v1\0", "utf8")
    .update(threadId.toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `workspace_${digest}`;
};

const contained = (root, ...segments) => {
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(path.resolve(root), candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  return candidate;
};

export const resolveWorkspacePaths = (routingRoot, workspaceId) => {
  if (!isWorkspaceId(workspaceId)) {
    throw new Error("WORKSPACE_ID_INVALID");
  }
  const workspaceDirectory = contained(
    routingRoot,
    "workspaces",
    workspaceId,
  );
  return Object.freeze({
    workspaceDirectory,
    descriptorFile: contained(workspaceDirectory, "bridge.json"),
    runtimeDirectory: contained(workspaceDirectory, "runtime"),
  });
};
```

- [ ] **Step 4: Run identity tests and public audit**

Run:

```powershell
pnpm test -- tests/skill-workspace-identity.test.ts
pnpm audit:public
```

Expected: identity tests PASS and public audit reports zero findings.

- [ ] **Step 5: Commit the identity checkpoint**

```powershell
git add .agents/skills/shubi-shot-director/scripts/workspace-identity.mjs tests/skill-workspace-identity.test.ts
git commit -m "feat: derive isolated scene workspace identities"
```

## Task 2: Atomic registry, bindings, and port leases

**Files:**

- Create: `.agents/skills/shubi-shot-director/scripts/workspace-registry.mjs`
- Create: `tests/skill-workspace-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `tests/skill-workspace-registry.test.ts`. Use a temporary routing root and
inject deterministic health and port probes:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachWorkspace,
  ensureWorkspaceRoute,
  listWorkspaces,
  readThreadBinding,
} from "../.agents/skills/shubi-shot-director/scripts/workspace-registry.mjs";

const workspaceA =
  "workspace_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const workspaceB =
  "workspace_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("Skill workspace registry", () => {
  it("allocates distinct routes under concurrent ensure calls", async () => {
    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-workspaces-"),
    );
    const occupied = new Set<number>();
    const dependencies = {
      portStart: 51000,
      portEnd: 51010,
      probePort: async (port: number) => occupied.has(port),
      probeHealth: async () => null,
    };

    const [left, right] = await Promise.all([
      ensureWorkspaceRoute({
        routingRoot,
        workspaceId: workspaceA,
        dependencies,
      }),
      ensureWorkspaceRoute({
        routingRoot,
        workspaceId: workspaceB,
        dependencies,
      }),
    ]);

    expect(left.port).not.toBe(right.port);
    expect(left.runtimeDirectory).not.toBe(right.runtimeDirectory);
  });

  it("reattaches one hashed thread binding without copying scene data", async () => {
    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-bindings-"),
    );
    await ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies: {
        portStart: 51100,
        portEnd: 51110,
        probePort: async () => false,
        probeHealth: async () => null,
      },
    });

    await attachWorkspace({
      routingRoot,
      threadWorkspaceId: workspaceB,
      targetWorkspaceId: workspaceA,
    });

    expect(
      await readThreadBinding(routingRoot, workspaceB),
    ).toBe(workspaceA);
  });

  it("lists generic routing data without raw thread identifiers", async () => {
    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-list-"),
    );
    await ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies: {
        portStart: 51200,
        portEnd: 51210,
        probePort: async () => false,
        probeHealth: async () => null,
      },
    });
    const listed = await listWorkspaces({
      routingRoot,
      probeHealth: async () => null,
    });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("CODEX_THREAD_ID");
  });

  it("never rewrites an existing legacy scene during adoption", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "shubi-legacy-"),
    );
    const routingRoot = path.join(root, "workspace-routing");
    const legacyScene = path.join(root, "current.scene.json");
    await writeFile(legacyScene, "{\"sceneId\":\"legacy\"}\n", "utf8");

    await ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      legacyRuntimeDirectory: root,
      dependencies: {
        portStart: 51300,
        portEnd: 51310,
        probePort: async () => false,
        probeHealth: async () => null,
      },
    });

    expect(await readFile(legacyScene, "utf8")).toBe(
      "{\"sceneId\":\"legacy\"}\n",
    );
  });
});
```

- [ ] **Step 2: Run the registry tests and verify failure**

Run:

```powershell
pnpm test -- tests/skill-workspace-registry.test.ts
```

Expected: FAIL because the registry module does not exist.

- [ ] **Step 3: Implement strict descriptors and atomic JSON writes**

In `workspace-registry.mjs`, define canonical records:

```js
const descriptorVersion = 1;
const descriptorKeys = new Set([
  "version",
  "workspaceId",
  "port",
  "status",
  "instanceId",
  "updatedAt",
  "legacy",
]);

const descriptor = ({
  workspaceId,
  port,
  status,
  instanceId = null,
  legacy = false,
}) => Object.freeze({
  version: descriptorVersion,
  workspaceId,
  port,
  status,
  instanceId,
  updatedAt: new Date().toISOString(),
  legacy,
});
```

Write JSON through a unique temporary file opened with `wx`, then rename it
over the descriptor. Validate exact keys, canonical workspace IDs, port range,
status (`starting`, `ready`, or `stopped`), instance ID shape, and ISO timestamp
on every read.

- [ ] **Step 4: Implement the routing lock and allocator**

Implement an exclusive lock file with bounded retries:

```js
const withRoutingLock = async (routingRoot, operation) => {
  await mkdir(routingRoot, { recursive: true });
  const lockFile = path.join(routingRoot, ".allocation.lock");
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        return await operation();
      } finally {
        await handle.close();
        await unlink(lockFile).catch(() => undefined);
      }
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() >= deadline) {
        throw new WorkspaceRoutingError("WORKSPACE_LOCK_UNAVAILABLE");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
};
```

While holding the lock, scan validated descriptors, reuse the current
workspace's healthy port, otherwise select the first port whose descriptor and
socket probes are both free. Reserve it with a `starting` descriptor before
releasing the lock. Exhaustion returns `WORKSPACE_PORT_UNAVAILABLE`.

- [ ] **Step 5: Implement legacy ownership and thread bindings**

Use `legacy-owner.json` with an atomic `wx` first claim. The record contains
only:

```json
{
  "version": 1,
  "workspaceId": "workspace_0123456789abcdef0123456789abcdef"
}
```

If the current workspace owns that record, route it to the existing
`.shubi-shot` runtime directory. Otherwise use its contained
`workspaces/<id>/runtime` directory.

Binding files are named by the caller's already-hashed thread workspace ID and
contain only a canonical target workspace ID. `attachWorkspace` validates that
the target descriptor or legacy ownership exists before writing the binding.

- [ ] **Step 6: Run registry, identity, and concurrency-focused tests**

Run:

```powershell
pnpm test -- tests/skill-workspace-identity.test.ts tests/skill-workspace-registry.test.ts
pnpm typecheck
```

Expected: all selected tests PASS and TypeScript accepts the `.mjs` imports.

- [ ] **Step 7: Commit the registry checkpoint**

```powershell
git add .agents/skills/shubi-shot-director/scripts/workspace-registry.mjs tests/skill-workspace-registry.test.ts
git commit -m "feat: allocate scene workspace routes atomically"
```

## Task 3: Route Skill commands by the current Codex thread

**Files:**

- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Create: `tests/skill-workspace-wrapper.test.ts`
- Modify: `tests/skill-scripts.test.ts`

- [ ] **Step 1: Write failing wrapper routing tests**

Create `tests/skill-workspace-wrapper.test.ts` to spawn the Skill wrapper with
two generic UUID thread IDs and a copied runtime root. Assert:

```ts
expect(first.workspaceId).toMatch(/^workspace_[0-9a-f]{32}$/u);
expect(second.workspaceId).toMatch(/^workspace_[0-9a-f]{32}$/u);
expect(first.workspaceId).not.toBe(second.workspaceId);
expect(first.port).not.toBe(second.port);
expect(first.runtimeDirectory).not.toBe(second.runtimeDirectory);
expect(JSON.stringify(first)).not.toContain(threadA);
expect(JSON.stringify(second)).not.toContain(threadB);
```

Add command-shape tests:

```ts
expect(await runSkill(["workspace", "current"], envA)).toMatchObject({
  ok: true,
  data: {
    workspaceId: expect.stringMatching(/^workspace_[0-9a-f]{32}$/u),
    source: "thread",
  },
});

expect(await runSkill(["workspace", "attach", "--id", target], envA))
  .toMatchObject({
    ok: true,
    data: { workspaceId: target, attached: true },
  });
```

- [ ] **Step 2: Run wrapper tests and verify failure**

Run:

```powershell
pnpm test -- tests/skill-workspace-wrapper.test.ts tests/skill-scripts.test.ts
```

Expected: FAIL because workspace commands and automatic routing are absent.

- [ ] **Step 3: Resolve workspace routing before live commands**

In the Skill wrapper:

```js
const resolveInvocationWorkspace = async (runtime, invocation) => {
  if (invocation.kind === "doctor" || invocation.kind === "help") {
    return undefined;
  }
  const threadWorkspaceId = deriveThreadWorkspaceId(
    process.env.CODEX_THREAD_ID,
  );
  if (threadWorkspaceId === undefined) {
    return undefined;
  }
  const routingRoot = path.join(
    runtime.runtimeRoot,
    ".shubi-shot",
    "workspace-routing",
  );
  const bound =
    (await readThreadBinding(routingRoot, threadWorkspaceId)) ??
    threadWorkspaceId;
  return ensureWorkspaceRoute({
    routingRoot,
    workspaceId: bound,
    legacyRuntimeDirectory: path.join(
      runtime.runtimeRoot,
      ".shubi-shot",
    ),
  });
};
```

An undefined route preserves the current legacy environment behavior.

- [ ] **Step 4: Refactor child environment construction**

Change:

```js
const runtimeChildEnvironment = (environment = process.env) => {
```

to:

```js
const runtimeChildEnvironment = (
  environment = process.env,
  workspaceRoute,
) => {
  const child = createBaseChildEnvironment(environment);
  const routed = workspaceRoute === undefined
    ? {
        url: environment.SHUBI_SHOT_URL,
        port: environment.SHUBI_SHOT_PORT,
        runtimeDirectory: environment.SHUBI_SHOT_RUNTIME_DIR,
      }
    : {
        port: String(workspaceRoute.port),
        runtimeDirectory: workspaceRoute.runtimeDirectory,
      };
  setDefined(child, "SHUBI_SHOT_URL", routed.url);
  setDefined(child, "SHUBI_SHOT_PORT", routed.port);
  setDefined(
    child,
    "SHUBI_SHOT_RUNTIME_DIR",
    routed.runtimeDirectory,
  );
  return child;
};
```

Pass that explicit environment into every `runRuntime`, compatibility-plan, and
forwarding call. Never forward `CODEX_THREAD_ID` or workspace binding paths.

- [ ] **Step 5: Add wrapper-only inspection and attachment**

Extend the wrapper parser with exact commands:

```text
workspace current
workspace list
workspace attach --id workspace_<32 hex>
```

Handle them before runtime capability action lookup. `workspace current` and
`workspace list` are read-only. `workspace attach` changes only the hashed
thread binding and fails with `WORKSPACE_THREAD_ID_UNAVAILABLE` outside a host
thread.

Return stable errors:

```text
WORKSPACE_ID_INVALID
WORKSPACE_NOT_FOUND
WORKSPACE_STATE_INVALID
WORKSPACE_LOCK_UNAVAILABLE
WORKSPACE_PORT_UNAVAILABLE
WORKSPACE_THREAD_ID_UNAVAILABLE
```

- [ ] **Step 6: Mark a successful ensure route ready**

After forwarding `ensure`, validate its returned `uiUrl`, `instanceId`, and port
against the reserved route, then atomically replace `starting` with `ready`.
If startup fails, mark only that workspace descriptor stopped and leave its
runtime directory intact.

- [ ] **Step 7: Run wrapper and existing compatibility tests**

Run:

```powershell
pnpm test -- tests/skill-workspace-wrapper.test.ts tests/skill-scripts.test.ts tests/skill-compatibility.test.ts tests/process-boundary.test.ts
pnpm typecheck
```

Expected: all selected tests PASS; existing no-thread invocations remain
byte-compatible with the legacy command path.

- [ ] **Step 8: Commit the wrapper checkpoint**

```powershell
git add .agents/skills/shubi-shot-director/scripts/director.mjs tests/skill-workspace-wrapper.test.ts tests/skill-scripts.test.ts
git commit -m "feat: route Skill commands by scene workspace"
```

## Task 4: Advertise workspace compatibility and version 0.5.0

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `cli/runtime-capabilities.ts`
- Modify: `cli/bridge.ts`
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Modify: `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Modify: `tests/runtime-capabilities.test.ts`
- Modify: `tests/bridge-health.test.ts`
- Modify: `tests/bridge-compatibility-cli.test.ts`
- Modify: `tests/skill-compatibility.test.ts`
- Modify: `tests/skill-runtime-locator.test.ts`

- [ ] **Step 1: Write failing capability assertions**

Add:

```ts
expect(getRuntimeCapabilityManifest()).toMatchObject({
  applicationVersion: "0.5.0",
  workspaceRoutingVersion: 1,
  features: expect.arrayContaining(["bridge.thread-workspaces"]),
});
```

Require live/offline compatibility to reject a missing, non-integer, or
non-canonical `workspaceRoutingVersion`, and require the exact
`bridge.thread-workspaces` feature.

- [ ] **Step 2: Run capability tests and verify failure**

Run:

```powershell
pnpm test -- tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
```

Expected: FAIL because version 0.5.0 and workspace routing capability are not
declared.

- [ ] **Step 3: Extend the runtime manifest**

In `cli/runtime-capabilities.ts`:

```ts
export const WORKSPACE_ROUTING_VERSION = 1;

export interface RuntimeCapabilityManifest {
  service: string;
  capabilitiesContractVersion: number;
  applicationVersion: string;
  bridgeProtocolVersion: number;
  workspaceRoutingVersion: number;
  // existing fields remain unchanged
}
```

Add `workspaceRoutingVersion` to exact manifest keys and parsing, require the
integer `1`, return it from `getRuntimeCapabilityManifest()`, and add
`bridge.thread-workspaces` to the canonical feature list.

Update `cli/bridge.ts` so health compatibility compares the routing version
before any scene request.

- [ ] **Step 4: Align Skill release metadata and compatibility**

Add to `runtime.json`:

```json
"workspaceRoutingVersion": 1
```

Update `runtime-locator.mjs`, `compatibility-plan.mjs`, and the Skill wrapper's
bundled constants so offline and live checks require the same version and
feature. Keep capability contract v2, bridge protocol v1, and all schema
versions at 4.

- [ ] **Step 5: Bump package version**

Set `package.json` to:

```json
"version": "0.5.0"
```

Run:

```powershell
pnpm install --lockfile-only
```

Expected: the lockfile importer version aligns with 0.5.0 without dependency
changes.

- [ ] **Step 6: Run capability, type, and build checks**

Run:

```powershell
pnpm test -- tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
pnpm typecheck
pnpm build
```

Expected: selected tests PASS and production build succeeds.

- [ ] **Step 7: Commit the capability checkpoint**

```powershell
git add package.json pnpm-lock.yaml cli/runtime-capabilities.ts cli/bridge.ts .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/scripts tests
git commit -m "feat: advertise parallel workspace routing"
```

## Task 5: Update Skill workflow and public documentation

**Files:**

- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/recovery-and-concurrency.md`
- Modify: `README.md`
- Create: `docs/releases/v0.5.0.md`
- Modify: `tests/skill-scripts.test.ts`
- Modify: `tests/public-onboarding.test.ts`
- Modify: `tests/public-release-audit.test.ts`

- [ ] **Step 1: Write failing documentation assertions**

Add assertions that the Skill states:

```ts
expect(skill).toMatch(/separate Codex conversations.*separate workspaces/iu);
expect(skill).toContain("workspace current");
expect(skill).toContain("workspace list");
expect(skill).toContain("workspace attach --id");
expect(skill).toMatch(/raw thread ID.*never.*runtime/iu);
expect(skill).toMatch(/each workspace.*Shot Preview/iu);
expect(skill).toMatch(/stop.*current workspace/iu);
```

Public onboarding must identify v0.5.0, schema v4, capability contract v2, and
workspace routing version 1.

- [ ] **Step 2: Run Skill/public tests and verify failure**

Run:

```powershell
pnpm test -- tests/skill-scripts.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts
```

Expected: FAIL until Skill and public docs describe workspace routing.

- [ ] **Step 3: Update the Skill start and recovery workflow**

In `SKILL.md`, make the sequence explicit:

```text
1. Run doctor.
2. Run workspace current.
3. Run ensure; retain the returned workspace ID and uiUrl.
4. Every later command in this conversation uses the same automatic route.
5. A separate Codex conversation receives a separate workspace.
```

State that raw `CODEX_THREAD_ID` is hashed only in the wrapper and never passed
to runtime processes, scene files, logs, screenshots, or exports. `stop` stops
only the current workspace. Use `workspace attach --id` only after host-side
selection of an existing generic workspace ID.

- [ ] **Step 4: Update CLI and concurrency references**

Document command outputs, stable workspace errors, legacy fallback, exact
attachment behavior, workspace-specific revision recovery, and the rule that
workspace operations never create SceneSpec revisions.

- [ ] **Step 5: Update README and release notes**

Add a parallel workflow example:

```text
Conversation A -> workspace_11111111111111111111111111111111 -> 127.0.0.1:4317
Conversation B -> workspace_22222222222222222222222222222222 -> 127.0.0.1:4318
```

Explain that the user does not choose ports or directories. Keep remote
collaborative editing out of scope. Create generic v0.5.0 release notes but do
not publish or merge from this branch.

- [ ] **Step 6: Run docs, Skill, and public checks**

Run:

```powershell
pnpm test -- tests/skill-scripts.test.ts tests/public-onboarding.test.ts tests/public-release-audit.test.ts
pnpm audit:public
git diff --check
```

Expected: selected tests PASS, public audit reports zero findings, and no
whitespace errors remain.

- [ ] **Step 7: Commit the documentation checkpoint**

```powershell
git add .agents/skills/shubi-shot-director/SKILL.md .agents/skills/shubi-shot-director/references README.md docs/releases/v0.5.0.md tests
git commit -m "docs: publish parallel scene workspace workflow"
```

## Task 6: Two-workspace runtime isolation E2E

**Files:**

- Create: `tests/parallel-workspace-e2e.test.ts`
- Modify: `tests/process-boundary.test.ts`
- Modify: `tests/structured-runtime-e2e.test.ts`

- [ ] **Step 1: Write the two-workspace E2E**

Spawn the Skill wrapper twice with different generic thread IDs and the same
runtime root:

```ts
const [leftEnsure, rightEnsure] = await Promise.all([
  runSkill(["ensure"], { ...base, CODEX_THREAD_ID: threadA }),
  runSkill(["ensure"], { ...base, CODEX_THREAD_ID: threadB }),
]);

expect(leftEnsure.data.uiUrl).not.toBe(rightEnsure.data.uiUrl);
expect(leftEnsure.data.instanceId).not.toBe(
  rightEnsure.data.instanceId,
);
```

Submit `scene_parallel_a` to A and `scene_parallel_b` to B through generic
schema-valid v4 envelopes. Snapshot both, apply a one-operation Patch only to A,
then assert:

```ts
expect(afterA.scene.sceneId).toBe("scene_parallel_a");
expect(afterA.scene.revision).toBe(beforeA.scene.revision + 1);
expect(afterB).toEqual(beforeB);
```

Stop A and require B health to remain ready. Re-run ensure with thread B and
require the same workspace, scene ID, revision, runtime directory, and port.

- [ ] **Step 2: Verify the E2E fails before final fixes**

Run:

```powershell
pnpm test -- tests/parallel-workspace-e2e.test.ts
```

Expected: any incomplete allocation, descriptor, forwarding, or lifecycle path
fails with a precise assertion.

- [ ] **Step 3: Enforce the routed child-environment allowlist**

In the Skill wrapper, construct each child environment from the existing OS
allowlist and assign only the resolved route:

```js
const routedChildEnvironment = (source, route) => {
  const child = createBaseChildEnvironment(source);
  child.SHUBI_SHOT_PORT = String(route.port);
  child.SHUBI_SHOT_RUNTIME_DIR = route.runtimeDirectory;
  return child;
};
```

Do not spread `source` into `child`. Add process-boundary assertions that every
Skill-spawned child environment contains only the existing OS allowlist plus:

```text
SHUBI_SHOT_PORT
SHUBI_SHOT_RUNTIME_DIR
```

`CODEX_THREAD_ID`, binding paths, registry state, and workspace IDs must not
appear in runtime or browser child environments. Fail the test if any forbidden
key is present rather than deleting it after construction.

- [ ] **Step 4: Add leak and containment audits**

Search captured stdout, stderr, routing descriptors, runtime files, and exports
for both raw thread IDs. Require zero matches. Resolve every recorded path and
require it to remain inside the ignored test runtime root.

- [ ] **Step 5: Run focused E2E and process-boundary checks**

Run:

```powershell
pnpm test -- tests/parallel-workspace-e2e.test.ts tests/process-boundary.test.ts tests/structured-runtime-e2e.test.ts
pnpm typecheck
```

Expected: all selected tests PASS and no child environment leaks host thread
identity.

- [ ] **Step 6: Commit the E2E checkpoint**

```powershell
git add tests/parallel-workspace-e2e.test.ts tests/process-boundary.test.ts tests/structured-runtime-e2e.test.ts .agents/skills/shubi-shot-director/scripts
git commit -m "test: verify parallel scene workspace isolation"
```

## Task 7: Full verification and real-browser acceptance

**Files:**

- Modify: `docs/verification.md`
- Create only ignored transient runtime and export files under:
  `.shubi-shot/workspace-routing/` and `.shubi-shot/exports/`

- [ ] **Step 1: Run the complete repository verifier**

Run:

```powershell
pnpm verify
```

Expected:

- schemas remain v4 and regenerate without a diff;
- typecheck passes;
- every Vitest file passes;
- ESLint passes;
- Vite production build succeeds;
- public audit reports zero findings.

Record exact test counts and non-blocking build advisories.

- [ ] **Step 2: Run Skill doctor and two concurrent ensures**

From `.agents/skills/shubi-shot-director`, use two generic thread environments
and run:

```powershell
node scripts/director.mjs doctor
node scripts/director.mjs workspace current
node scripts/director.mjs ensure
node scripts/director.mjs health
```

Require version 0.5.0, capability contract v2, workspace routing v1, schemas v4,
distinct workspace IDs, distinct loopback URLs, and distinct instance IDs.

- [ ] **Step 3: Submit two generic scenes concurrently**

Use ignored generic v4 scene submissions. After both submissions, capture
snapshots and apply one generic transform Patch to each workspace. Require each
revision to advance exactly once and the other workspace to remain unchanged.

- [ ] **Step 4: Inspect two real browser tabs**

Open both returned `uiUrl` values in the integrated browser. For each workspace
verify:

- Overview and Shot Preview render;
- the visible scene ID/revision matches that workspace snapshot;
- camera buttons, keyboard, mouse wheel, and right-click suppression work;
- changing workspace A does not refresh or mutate workspace B.

- [ ] **Step 5: Export one PNG from each workspace**

With both Shot Previews connected, export:

```powershell
$env:CODEX_THREAD_ID='019fa111-1111-7111-8111-111111111111'
node scripts/director.mjs export png --file .shubi-shot/exports/workspace-a.png --width 1920 --height 1080
$env:CODEX_THREAD_ID='019fa222-2222-7222-8222-222222222222'
node scripts/director.mjs export png --file .shubi-shot/exports/workspace-b.png --width 1920 --height 1080
```

Verify each returned workspace route, scene ID, revision, dimensions, SHA-256,
and warnings. Visually inspect both images and prove they are not cross-routed.

- [ ] **Step 6: Stop only one workspace**

Stop workspace A, then run health and snapshot for workspace B. Require B to
remain ready at the same scene and revision. Restart A and require its persisted
scene to return unchanged.

- [ ] **Step 7: Record generic evidence and rerun cleanliness checks**

Update `docs/verification.md` with:

- branch and commit;
- repository verifier result and exact test count;
- v0.5.0 capability versions;
- opaque workspace IDs and loopback ports;
- distinct generic scene IDs and revisions;
- both PNG dimensions, hashes, and warnings;
- browser viewport and inspected previews;
- one-workspace stop/restart result;
- public audit result.

Then run:

```powershell
pnpm audit:public
git diff --check
git status --short --branch
git -C <main-checkout> status --short --branch
```

Expected: public audit has zero findings, only intended verification
documentation is uncommitted in the isolated worktree, and the main checkout is
unchanged.

- [ ] **Step 8: Commit verified isolated completion**

```powershell
git add docs/verification.md
git commit -m "test: verify parallel scene workspaces"
git status --short --branch
```

Expected: clean `codex/parallel-scene-workspaces` worktree.

## Final Completion Gate

Before reporting the isolated branch ready:

- inspect `git log --oneline` and confirm every checkpoint exists;
- rerun `pnpm verify` after the final documentation commit;
- confirm the main checkout still points to its pre-upgrade commit;
- confirm no raw thread ID appears in tracked files, transient descriptors,
  logs, screenshots, or exports;
- confirm each workspace has a distinct port, runtime directory, instance ID,
  scene ID, revision history, browser preview, and PNG export;
- confirm stopping or restarting one workspace never changes another;
- leave `codex/parallel-scene-workspaces` and its worktree intact;
- do not merge, push, tag, release, or modify the main checkout until the user
  says the other work has finished.
