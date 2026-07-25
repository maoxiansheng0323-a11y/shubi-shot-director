# Host Semantic Authority Runtime v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local natural-language compiler with a capability-contract-v2, structured-only runtime while preserving direct SceneSpec/ScenePatch calls, scene/revision invariants, atomic patches, CLI lifecycle, persistence, composition inspection, and PNG export.

**Architecture:** Host Codex is the sole semantic authority and authors a generic `IntentReport` plus a complete `SceneSpec` or incremental `ScenePatch`. The runtime validates strict structured envelopes, verifies the host report's internal evidence coverage, then mutates one authoritative `SceneSession` atomically. All launchers use fixed child-environment allowlists, every supported URL is loopback/same-origin, and old raw-text commands are rejection stubs that run before runtime discovery or bridge access.

**Tech Stack:** TypeScript 6, Zod 4, Node.js 22, Express 5, Vitest 4, React 19, Three.js, ESM launcher scripts, Codex Skill Markdown/references.

---

## File map

The implementation must keep responsibilities separated as follows.

- `src/domain/intent-report.ts`: strict `IntentReport` v1 schemas, generic enums, and types only.
- `src/domain/intent-coverage.ts`: deterministic safety-policy and evidence validation; no text parsing.
- `src/domain/scene-submission.ts`: strict scene/patch envelope parsing and stable submission errors.
- `tests/helpers/structured-fixtures.ts`: reusable public, generic SceneSpec/Patch/IntentReport fixtures; replaces compiler-as-test-factory usage.
- `scripts/process-boundary.mjs` + `scripts/process-boundary.d.ts`: fixed Director configuration rejection and minimal child environments shared by root launcher, CLI, bridge, and server.
- `cli/runtime-capabilities.ts`: capability contract v2 manifest and boundary validation.
- `cli/director.ts`: structured CLI routing and immediate legacy-text rejection only.
- `server/scene-session.ts`: atomic submission methods that validate before history/state mutation.
- `server/api.ts`: structured submission endpoints and stable domain error mapping.
- `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`: v2-only action planning.
- `.agents/skills/shubi-shot-director/scripts/director.mjs`: portable Skill wrapper with pre-resolution rejection and fixed child environment.
- `.agents/skills/shubi-shot-director/SKILL.md` and direct references: host-authoring workflow, not runtime language parsing.
- `tests/structured-runtime-e2e.test.ts` + `tests/helpers/socket-guard.mjs`: credential-free, outbound-blocked real-process loop.

Do not add an LLM SDK, prompt parser, model/provider configuration, arbitrary JSON path, or test-only production hook.

### Task 1: Publish and enforce capability contract v2

**Files:**
- Modify: `tests/runtime-capabilities.test.ts`
- Modify: `tests/bridge-health.test.ts`
- Modify: `tests/bridge-compatibility-cli.test.ts`
- Modify: `cli/runtime-capabilities.ts`
- Modify: `cli/bridge.ts`

- [ ] **Step 1: Write the failing v2 manifest tests**

Replace the expected command and feature arrays with:

```ts
const EXPECTED_COMMAND_IDS = [
  "doctor", "ensure", "status", "stop", "health", "snapshot",
  "scene.create", "scene.submit", "scene.save", "scene.load",
  "patch.apply", "patch.submit", "composition.inspect", "export.png",
  "undo", "redo", "open.system",
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
```

Assert the manifest contains exactly these boundary fields and no `requiresApiKey`:

```ts
expect(manifest).toMatchObject({
  capabilitiesContractVersion: 2,
  intentReportSchemaVersion: 1,
  semanticAuthority: "host",
  inputContract: "structured-only",
  modelIntegration: "none",
  credentialPolicy: "forbidden",
  networkPolicy: "loopback-only",
});
expect(manifest).not.toHaveProperty("requiresApiKey");
```

Add table-driven rejection tests for `shot.create`, `shot.modify`, `profile.resolve`, the removed `intent.*`/`profile.*`/`schema.*.authoring` feature IDs, and a `requiresApiKey` field. Those cases must surface `SEMANTIC_BOUNDARY_VIOLATION`; malformed required fields remain `CAPABILITIES_INVALID`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
pnpm exec vitest run tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts
```

Expected: FAIL because the runtime still publishes contract v1, `requiresApiKey`, and semantic actions.

- [ ] **Step 3: Implement the v2 manifest and boundary parser**

In `cli/runtime-capabilities.ts`:

```ts
export const CAPABILITIES_CONTRACT_VERSION = 2 as const;
export const INTENT_REPORT_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_AUTHORITY = "host" as const;
export const INPUT_CONTRACT = "structured-only" as const;
export const MODEL_INTEGRATION = "none" as const;
export const CREDENTIAL_POLICY = "forbidden" as const;
export const NETWORK_POLICY = "loopback-only" as const;
```

Add the fields to `RuntimeCapabilityManifest`, remove `requiresApiKey`, publish the new arrays, and reject forbidden semantic IDs or forbidden manifest configuration fields with a typed `RuntimeCapabilityError` whose code is `SEMANTIC_BOUNDARY_VIOLATION`. Keep arbitrary additive diagnostic fields acceptable, but validate every required field and require unique string arrays.

In `cli/bridge.ts`, remove `RUNTIME_REQUIRES_API_KEY`, map the typed boundary error to `SEMANTIC_BOUNDARY_VIOLATION`, compare all six boundary/version fields between offline and live manifests, and continue to ignore application semver differences. Keep exact offline/live command and feature set comparison.

- [ ] **Step 4: Run focused and compatibility tests GREEN**

Run the command from Step 2. Expected: all selected tests pass with no raw semantic action advertised.

- [ ] **Step 5: Commit the checkpoint**

```powershell
git add cli/runtime-capabilities.ts cli/bridge.ts tests/runtime-capabilities.test.ts tests/bridge-health.test.ts tests/bridge-compatibility-cli.test.ts
git commit -m "feat: publish structured runtime capability v2"
```

### Task 2: Add strict IntentReport and deterministic coverage validation

**Files:**
- Create: `src/domain/intent-report.ts`
- Create: `src/domain/intent-coverage.ts`
- Create: `src/domain/scene-submission.ts`
- Create: `tests/intent-report.test.ts`
- Create: `tests/structured-submission.test.ts`
- Create: `tests/helpers/structured-fixtures.ts`
- Modify: `server/scene-session.ts`

- [ ] **Step 1: Write failing schema and policy tests**

Define fixture-facing APIs in tests before production code:

```ts
import {
  intentReportSchema,
  type IntentReport,
} from "../src/domain/intent-report";
import {
  IntentSubmissionError,
  parsePatchSubmission,
  parseSceneSubmission,
} from "../src/domain/scene-submission";
```

Cover at least:

- a strict generic create report parses;
- unknown keys such as `rawPrompt`, `profilePath`, `aliases`, or free-form `message` fail;
- create rejects `allowPartial: true`;
- `canApplySafely: false` rejects with `UNSUPPORTED_DESCRIPTION`;
- unsupported/unresolved items reject when `allowPartial` is false;
- an explicitly partial modify report may contain structured unapplied issue codes;
- every required recognized constraint needs valid evidence;
- entity/property/constraint/scene-property evidence must reference the submitted scene;
- patch-operation evidence must reference an existing operation index;
- invalid coverage throws `INTENT_COVERAGE_INCOMPLETE` without echoing marker values.

Use these exact top-level report fields:

```ts
{
  schemaVersion: 1,
  operation: "create" | "modify",
  allowPartial: boolean,
  recognizedConstraints: IntentConstraint[],
  unsupportedConstraints: IntentIssue[],
  unresolvedRelations: IntentIssue[],
  warnings: IntentWarning[],
  canApplySafely: boolean,
}
```

Evidence is a strict discriminated union of `entity`, `entity-property`, `scene-property`, `scene-constraint`, and `patch-operation`. Every string value must be an enum or generic ID; do not add prose fields.

- [ ] **Step 2: Run the tests and verify RED**

```powershell
pnpm exec vitest run tests/intent-report.test.ts tests/structured-submission.test.ts
```

Expected: module-not-found failures for the three new domain modules.

- [ ] **Step 3: Implement the strict schemas**

Use Zod `.strict()` throughout. Export `INTENT_REPORT_SCHEMA_VERSION = 1`, `intentReportSchema`, `sceneSubmissionSchema`, `patchSubmissionSchema`, and inferred types. Use versioned enum allowlists for constraint kinds, issue codes, warning codes, and evidence property paths.

The initial constraint-kind allowlist is:

```ts
[
  "environment", "entity-presence", "entity-removal", "actor-slot",
  "pose", "relationship", "contact", "position", "rotation", "scale",
  "visibility", "camera-height", "camera-angle", "camera-target",
  "focal-length", "framing", "output", "composition-safety",
]
```

The implementation must check policy before coverage, validate generic target IDs against the before/after scene, resolve only allowlisted evidence paths, and validate patch-operation indices without interpreting text.

Use stable fixed messages through:

```ts
export class IntentSubmissionError extends Error {
  constructor(
    readonly code:
      | "INTENT_REPORT_INVALID"
      | "UNSUPPORTED_DESCRIPTION"
      | "INTENT_COVERAGE_INCOMPLETE",
  ) { /* fixed message by code */ }
}
```

- [ ] **Step 4: Add atomic SceneSession submission methods**

Refactor patch commit into a private method so the candidate patch is applied once:

```ts
submitScene(input: unknown): SceneSpec {
  const { scene } = parseSceneSubmission(input);
  return this.replaceScene(scene);
}

submitPatch(input: unknown): SceneSpec {
  const submission = parsePatchSubmission(input);
  const applied = applyScenePatch(this.scene, submission.patch);
  validateIntentCoverage(submission.intentReport, {
    before: applied.previous,
    after: applied.next,
    patch: applied.patch,
  });
  return this.commitAppliedPatch(applied);
}
```

All validation must complete before `historyPast`, `historyFuture`, `scene`, or events change.

- [ ] **Step 5: Run focused tests GREEN and prove failure is atomic**

Run:

```powershell
pnpm exec vitest run tests/intent-report.test.ts tests/structured-submission.test.ts tests/scene-session.test.ts tests/atomic-patch.test.ts
```

Expected: all selected tests pass, including unchanged snapshot/history after invalid coverage and stale revisions.

- [ ] **Step 6: Commit the checkpoint**

```powershell
git add src/domain/intent-report.ts src/domain/intent-coverage.ts src/domain/scene-submission.ts server/scene-session.ts tests/intent-report.test.ts tests/structured-submission.test.ts tests/helpers/structured-fixtures.ts tests/scene-session.test.ts
git commit -m "feat: validate host-authored scene submissions"
```

### Task 3: Expose scene.submit and patch.submit through API and CLI

**Files:**
- Modify: `server/api.ts`
- Modify: `cli/director.ts`
- Create: `tests/structured-submission-cli.test.ts`
- Modify: `tests/server-api-health.test.ts`
- Modify: `tests/bridge-compatibility-cli.test.ts`

- [ ] **Step 1: Write failing API and CLI tests**

Add tests for:

```text
scene submit --file <scene-submission.json>
patch submit --file <patch-submission.json>
```

The API endpoints are:

```text
POST /api/v1/submissions/scene
POST /api/v1/submissions/patch
```

Require:

- valid scene submission mutates once and returns the accepted session revision;
- valid compound patch submission preserves `sceneId` and increments exactly once;
- invalid report, invalid evidence, and stale patch return stable codes with zero mutation;
- direct `scene create --file` and `patch apply --file` still work unchanged;
- output contains only generic intent counts/codes, never the complete report or source file path.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/structured-submission-cli.test.ts tests/server-api-health.test.ts tests/bridge-compatibility-cli.test.ts
```

Expected: FAIL with unknown commands/routes.

- [ ] **Step 3: Implement API routes and error mapping**

Call `session.submitScene(request.body)` and `session.submitPatch(request.body)` and map `IntentSubmissionError` to HTTP 400. Return `{ scene, history, intentSummary }`, where the summary contains counts and structured codes only.

- [ ] **Step 4: Implement CLI file routing**

Add strict file readers for the two envelopes. Route `scene submit` and `patch submit` to the new endpoints after bridge health validation. Keep direct create/apply routing untouched. Summaries must include `sceneId`, `revision`, operation count where applicable, and generic intent summary only.

- [ ] **Step 5: Run focused tests GREEN**

Run the command from Step 2 and then:

```powershell
pnpm typecheck
```

- [ ] **Step 6: Commit the checkpoint**

```powershell
git add server/api.ts cli/director.ts tests/structured-submission-cli.test.ts tests/server-api-health.test.ts tests/bridge-compatibility-cli.test.ts
git commit -m "feat: add structured scene and patch submission commands"
```

### Task 4: Remove runtime natural-language compilation and retain rejection stubs

**Files:**
- Delete: `cli/intent-io.ts`
- Delete: `src/natural-language/compiler.ts`
- Delete: `src/natural-language/semantic-coverage.ts`
- Delete: `src/natural-language/intent-report.ts`
- Delete: `src/domain/project-profile.ts`
- Delete: `tests/natural-language-compiler.test.ts`
- Delete: `tests/cli-intent-io.test.ts`
- Delete: `tests/project-profile.test.ts`
- Modify: `cli/director.ts`
- Modify: `scripts/director.mjs`
- Modify: `tests/scene-files.test.ts`
- Modify: `tests/scene-session.test.ts`
- Modify: `tests/shot-regressions.test.ts` (rename intent to structured shot regressions if practical)
- Create: `tests/legacy-text-rejection.test.ts`

- [ ] **Step 1: Write failing rejection and no-import tests**

For all public entry paths, assert that only the first two command tokens are inspected and these invocations immediately return:

```json
{
  "ok": false,
  "error": {
    "code": "HOST_STRUCTURED_INPUT_REQUIRED",
    "message": "Natural-language requests must be authored by the host as structured submissions."
  }
}
```

Cover `shot create`, `shot modify`, and `profile resolve` with trailing marker values, invalid runtime roots, unused profile paths, and stopped bridges. Require zero runtime discovery, zero bridge request, zero file write, and no marker echo.

Add a static import test requiring no production module to import `src/natural-language/*` or `project-profile`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/legacy-text-rejection.test.ts tests/scene-files.test.ts tests/scene-session.test.ts tests/shot-regressions.test.ts
```

Expected: legacy commands still compile text and compiler-backed fixtures still import removed-boundary modules.

- [ ] **Step 3: Add immediate stubs before any other resolution**

In both the root launcher and TypeScript CLI, detect only:

```ts
const isLegacyTextCommand = (args: readonly string[]): boolean =>
  (args[0] === "shot" && (args[1] === "create" || args[1] === "modify")) ||
  (args[0] === "profile" && args[1] === "resolve");
```

Return the fixed error before parsing trailing args, checking environment/configuration, reading files, resolving bridge configuration, or spawning TypeScript/runtime children. The Skill wrapper receives the same pre-resolution stub in Task 6.

- [ ] **Step 4: Replace compiler-backed test factories**

Use `tests/helpers/structured-fixtures.ts` and existing preset/domain operations to construct generic scenes and patches. Regression tests may continue checking contact, framing, serialization privacy, relationship materialization, same `sceneId`, exact `+1` revisions, and minimal diffs, but must not assert local English/Chinese parsing.

- [ ] **Step 5: Delete the compiler chain and run all affected tests GREEN**

Delete the authorized files above, remove imports and compiler error classes from `cli/director.ts`, and run:

```powershell
pnpm exec vitest run tests/legacy-text-rejection.test.ts tests/scene-files.test.ts tests/scene-session.test.ts tests/shot-regressions.test.ts tests/relationship-presets.test.ts tests/pose-presets.test.ts
pnpm typecheck
```

- [ ] **Step 6: Commit the checkpoint**

```powershell
git add -A cli src scripts tests
git commit -m "refactor: remove runtime natural language compilation"
```

### Task 5: Isolate credentials, child environments, and network configuration

**Files:**
- Create: `scripts/process-boundary.mjs`
- Create: `scripts/process-boundary.d.ts`
- Modify: `scripts/director.mjs`
- Modify: `cli/director.ts`
- Modify: `cli/bridge.ts`
- Modify: `server/index.ts`
- Modify: `src/editor/scene-client.ts`
- Create: `tests/process-boundary.test.ts`
- Create: `tests/runtime-boundary.test.ts`
- Modify: `tests/bridge-health.test.ts`

- [ ] **Step 1: Write failing process and URL boundary tests**

Test explicit arguments before any file/runtime/bridge work:

```text
--api-key --token --authorization --secret
--model --provider --base-url --endpoint
```

Use fixed codes `CREDENTIAL_ARGUMENT_FORBIDDEN` and `MODEL_CONFIGURATION_FORBIDDEN`. Test fixed Director-owned environment names such as `SHUBI_SHOT_API_KEY`, `SHUBI_SHOT_TOKEN`, `SHUBI_SHOT_MODEL`, `SHUBI_SHOT_PROVIDER`, `SHUBI_SHOT_BASE_URL`, and `SHUBI_SHOT_ENDPOINT` with fixed env error codes.

Separately prove ambient host variables such as `OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NODE_OPTIONS` are neither rejected as Director input nor present in spawned Director children.

Test URL acceptance for uncredentialed `http://127.0.0.0/8:<port>` and `http://[::1]:<port>` origins. Reject domains, `localhost`, HTTPS, remote IPs, credentials, paths, queries, and fragments before fetch/socket use.

Test `SceneClient` always uses relative `/api/v1/*` and remove public arbitrary `baseUrl` configuration.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/process-boundary.test.ts tests/runtime-boundary.test.ts tests/bridge-health.test.ts
```

Expected: FAIL because launchers forward/enumerate `process.env`, model options are not rejected, and browser clients accept arbitrary base URLs.

- [ ] **Step 3: Implement the shared fixed boundary module**

`scripts/process-boundary.mjs` must use direct property lookup only. It must not call `Object.keys`, `Object.entries`, spread, or otherwise enumerate the ambient environment. Export:

```ts
assertNoForbiddenDirectorArguments(args: readonly string[]): void;
assertNoForbiddenDirectorEnvironment(env?: NodeJS.ProcessEnv): void;
createRuntimeChildEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
createBridgeChildEnvironment(port: number, runtimeDir?: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
createBrowserChildEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
```

The OS allowlist may contain only execution necessities (`PATH`, Windows system/command fields, temp/locale fields). Approved Director fields are `SHUBI_SHOT_URL`, `SHUBI_SHOT_PORT`, and `SHUBI_SHOT_RUNTIME_DIR`. Exclude proxy variables, `NODE_OPTIONS`, credentials, tokens, authorization, model/provider settings, and endpoints.

Use this module in the root launcher, TypeScript CLI, bridge spawn, server startup, and system-browser spawn. Browser launch must keep its console hidden while the requested browser remains visible.

- [ ] **Step 4: Close network escape hatches**

Update bridge host validation to numeric loopback only and strengthen `uiUrl` validation to require an uncredentialed origin. Remove `SceneClientOptions.baseUrl` and concatenate only relative same-origin paths.

- [ ] **Step 5: Add static production audits and run GREEN**

`tests/runtime-boundary.test.ts` must deny:

- model/LLM client dependencies or production imports;
- ambient environment enumeration or whole-environment forwarding;
- raw-text semantic action IDs in production manifests/help/wrappers;
- production network client entry points outside reviewed `cli/bridge.ts` and same-origin `src/editor/scene-client.ts`;
- arbitrary model/provider/base-url/endpoint command options.

Run:

```powershell
pnpm exec vitest run tests/process-boundary.test.ts tests/runtime-boundary.test.ts tests/bridge-health.test.ts tests/cli-doctor.test.ts
pnpm typecheck
```

- [ ] **Step 6: Commit the checkpoint**

```powershell
git add scripts/process-boundary.mjs scripts/process-boundary.d.ts scripts/director.mjs cli/director.ts cli/bridge.ts server/index.ts src/editor/scene-client.ts tests/process-boundary.test.ts tests/runtime-boundary.test.ts tests/bridge-health.test.ts tests/cli-doctor.test.ts
git commit -m "security: isolate Director process and network boundaries"
```

### Task 6: Replace Skill compatibility negotiation with v2 structured-only planning

**Files:**
- Modify: `.agents/skills/shubi-shot-director/runtime.json`
- Rewrite: `.agents/skills/shubi-shot-director/scripts/compatibility-plan.mjs`
- Rewrite: `.agents/skills/shubi-shot-director/scripts/director.mjs`
- Modify: `.agents/skills/shubi-shot-director/scripts/runtime-locator.mjs`
- Rewrite: `tests/skill-compatibility.test.ts`
- Modify: `tests/helpers/skill-runtime-fixture.ts`
- Modify: `tests/helpers/create-skill-forward-fixtures.ts`
- Modify: `tests/skill-runtime-locator.test.ts`

- [ ] **Step 1: Write failing v2 compatibility tests**

Cover this matrix:

| Skill/runtime case | Required result |
| --- | --- |
| valid v2 manifest | structured action planned/forwarded |
| v1 or legacy manifest | `CAPABILITIES_CONTRACT_UNSUPPORTED`, no startup/mutation |
| v2 manifest with removed action/feature or `requiresApiKey` | `SEMANTIC_BOUNDARY_VIOLATION` |
| future app semver, matching contracts | allowed |
| scene/patch/intent schema mismatch | only dependent action disabled |
| offline/live boundary mismatch | incompatible before mutation |
| raw-text command | `HOST_STRUCTURED_INPUT_REQUIRED` before runtime resolution |
| forbidden credential/model argument | fixed rejection before runtime resolution |
| host key/proxy markers | operation succeeds, child observes none |

The stable action allowlist is the 17 v2 command IDs from Task 1. `scene.submit` requires scene schema 1, intent schema 1, `input.intent-report.validate`, and `input.scene-submission.atomic`; `patch.submit` requires patch schema 1, intent schema 1, and the patch equivalents.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm exec vitest run tests/skill-compatibility.test.ts tests/skill-runtime-locator.test.ts
```

Expected: FAIL because the planner accepts legacy/v1 semantic actions and the wrapper enumerates host environment variables.

- [ ] **Step 3: Implement a smaller v2-only planner**

Set `PLAN_CONTRACT_VERSION = 2`. Remove every legacy-help and runtime-native natural-language route. Validate the six boundary fields plus all three schema versions, reject semantic boundary violations, ignore application version for routing, and compute `allowedActions` strictly from command/feature/schema requirements.

Keep plan output deterministic and generic:

```js
{
  planContractVersion: 2,
  mode: "compatible" | "degraded" | "incompatible",
  requestedAction,
  actionAllowed,
  allowedActions,
  requiresBridge,
  mayStartBridge,
  liveVerified,
  diagnostics,
  warnings,
  blockingError,
}
```

- [ ] **Step 4: Implement the portable wrapper boundary**

Recognize new submit actions, remove requested lexical features, read all three bundled schema versions, reject legacy text and forbidden args before `resolveRuntime`, and build a child environment through fixed direct lookups. Do not inspect or inherit ambient credential/model/proxy variables.

Add the v2 boundary fields to `runtime.json` and validate them without weakening existing containment/symlink checks.

- [ ] **Step 5: Run Skill compatibility tests GREEN**

Run the command from Step 2. Then run:

```powershell
pnpm exec vitest run tests/skill-scripts.test.ts
```

- [ ] **Step 6: Commit the checkpoint**

```powershell
git add .agents/skills/shubi-shot-director/runtime.json .agents/skills/shubi-shot-director/scripts tests/skill-compatibility.test.ts tests/helpers/skill-runtime-fixture.ts tests/helpers/create-skill-forward-fixtures.ts tests/skill-runtime-locator.test.ts
git commit -m "feat: negotiate structured-only Skill runtime v2"
```

### Task 7: Rewrite the Skill, references, schemas, and public documentation

**Files:**
- Rewrite: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/agents/openai.yaml`
- Rewrite: `.agents/skills/shubi-shot-director/references/intent-routing.md`
- Rewrite: `.agents/skills/shubi-shot-director/references/scene-authoring.md`
- Rewrite: `.agents/skills/shubi-shot-director/references/patch-authoring.md`
- Rewrite: `.agents/skills/shubi-shot-director/references/external-profiles.md`
- Rewrite: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/recovery-and-concurrency.md`
- Create: `.agents/skills/shubi-shot-director/references/intent-report.md`
- Modify: `scripts/generate-schemas.ts`
- Create: `.agents/skills/shubi-shot-director/references/generated/intent-report.schema.json`
- Create: `.agents/skills/shubi-shot-director/references/generated/scene-submission.schema.json`
- Create: `.agents/skills/shubi-shot-director/references/generated/patch-submission.schema.json`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/verification.md`
- Modify: `docs/superpowers/specs/2026-07-24-skill-version-compatibility-design.md`
- Modify: `docs/superpowers/plans/2026-07-24-skill-version-compatibility.md`

- [ ] **Step 1: Record the pre-edit Skill baseline**

Use a fresh read-only agent on generic create, compound modify, and explicit external-profile scenarios. Preserve its exact command choices as RED evidence. The expected pre-edit failure is use of `shot ... --text` or `profile resolve`; do not tell the agent that diagnosis in advance.

Baseline captured before any Skill edit: the fresh agent independently chose `shot create --text`, `shot modify --text`, and `shot modify --text ... --profile <external path>`. It also proposed paraphrasing the user's wording into built-in lexical vocabulary. This is the concrete RED behavior the revised Skill must eliminate.

- [ ] **Step 2: Write Skill-script/document assertions that fail**

Assert:

- `SKILL.md` makes host semantic authority explicit;
- no instruction routes user text/profile paths into runtime commands;
- create uses `scene submit --file`; modify uses `patch submit --file`;
- direct `scene create`/`patch apply` remain documented for already-structured automation only;
- all four generated schemas exist and versions match the Skill wrapper;
- `agents/openai.yaml` still references `$shubi-shot-director` and describes graybox staging;
- old compatibility docs have a prominent superseded-by-v2 notice.

- [ ] **Step 3: Run assertions and verify RED**

```powershell
pnpm exec vitest run tests/skill-scripts.test.ts tests/runtime-boundary.test.ts
```

Expected: FAIL on lexical fallback text and missing generated submission schemas.

- [ ] **Step 4: Rewrite the Skill with progressive disclosure**

Keep `SKILL.md` concise and imperative. Its non-negotiable route is:

```text
User language/profile -> host Codex reasoning -> generic IntentReport + SceneSpec/ScenePatch
-> scene.submit/patch.submit -> deterministic validation/session -> browser inspection/export
```

State that the runtime never accepts prompts, profiles, credentials, tokens, providers, models, endpoints, or out-of-loopback model/network requests. The host may itself be in account or KEY mode; the Skill must never inspect or pass those credentials.

Move exact report/evidence codes and envelope examples to `intent-report.md`. External profile instructions must use host filesystem access against only the exact user-supplied path, resolve aliases in host memory, and never pass the path/content to runtime.

- [ ] **Step 5: Generate schemas and update docs**

Generate all five schemas (SceneSpec, ScenePatch, IntentReport, scene submission, patch submission):

```powershell
pnpm schemas:generate
```

Update public docs and mark the 2026-07-24 v1 design/plan as superseded rather than deleting historical checkpoints.

- [ ] **Step 6: Validate the Skill and run GREEN forward test**

Locate the bundled `skill-creator` Python runtime, then run:

```powershell
$env:PYTHONPATH = (Resolve-Path '.tools\pyyaml').Path
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" '.agents\skills\shubi-shot-director'
```

Use a fresh agent with only the revised Skill and the same generic scenarios. It must independently choose host-authored submission envelopes and must not route raw text/profile paths or credentials into runtime.

- [ ] **Step 7: Commit the checkpoint**

```powershell
git add .agents/skills/shubi-shot-director scripts/generate-schemas.ts AGENTS.md README.md docs/verification.md docs/superpowers/specs/2026-07-24-skill-version-compatibility-design.md docs/superpowers/plans/2026-07-24-skill-version-compatibility.md tests/skill-scripts.test.ts tests/runtime-boundary.test.ts
git commit -m "docs: make host Codex the sole semantic authority"
```

### Task 8: Prove offline structured operation and no regressions

**Files:**
- Create: `tests/helpers/socket-guard.mjs`
- Create: `tests/structured-runtime-e2e.test.ts`
- Modify: `docs/verification.md`
- Modify: any tests that still assume local natural-language compilation

- [ ] **Step 1: Write the failing real-process acceptance test**

Start a real loopback bridge under a preload/socket guard that rejects DNS, TLS, HTTPS, and any non-loopback connection while allowing numeric loopback HTTP. Use a minimal environment with a temporary `SHUBI_SHOT_RUNTIME_DIR` and no credentials/proxies.

Run this real sequence with absolute Node/tsx paths:

```text
doctor -> ensure -> scene submit -> snapshot -> patch submit -> snapshot
-> scene save -> scene load -> composition inspect -> export png 1920x1080 -> stop
```

Require:

- v2 boundary fields in doctor and health;
- `ensure.started === false` when reusing the guarded bridge;
- same patch `sceneId`, exact `revision + 1`, and one undoable compound patch;
- saved/loaded SceneSpec remains valid;
- segmented composition report is returned;
- PNG signature, IHDR width 1920, height 1080, and returned SHA-256 match;
- stdout/stderr/artifacts contain no raw prompt, profile path, alias, credential marker, or machine-specific repository path.

Repeat the launcher path with parent host key/model/proxy markers and prove the runtime child sees none while the structured operation still succeeds.

- [ ] **Step 2: Run the acceptance test and verify RED**

```powershell
pnpm exec vitest run tests/structured-runtime-e2e.test.ts
```

Expected: initial failure until every v2 command, environment, and schema path is integrated.

- [ ] **Step 3: Fix only integration gaps exposed by the RED test**

Do not add a test-only network bypass. Correct production routing, environment construction, stable summaries, or fixture revisions as required, then rerun until GREEN.

- [ ] **Step 4: Run complete fresh verification**

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm schemas:generate
$env:PYTHONPATH = (Resolve-Path '.tools\pyyaml').Path
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" '.agents\skills\shubi-shot-director'
git status --short
```

Also run the Skill's generic-output audit on representative submission, saved scene, composition JSON, and export summary artifacts.

- [ ] **Step 5: Perform real-browser verification**

Start/reuse the loopback bridge, open the integrated browser, and verify:

- the editable 3D view loads;
- the final-camera preview loads;
- a structured patch changes the same live scene/revision shown in the UI;
- save/load, focal length, undo/redo, composition panel, and PNG export remain usable;
- no browser request targets a non-loopback origin.

Record the exact commands, scene/revision transition, composition result, and exported dimensions/hash in `docs/verification.md` without recording local absolute paths or raw user wording.

- [ ] **Step 6: Run a final fresh-agent generalization check**

Give a fresh agent a generic shot-creation/follow-up task through `$shubi-shot-director` without expected diagnosis. Verify its emitted plan/artifacts use IntentReport plus `scene.submit`/`patch.submit`, keep aliases host-side, and preserve the incremental revision contract.

- [ ] **Step 7: Commit the final checkpoint**

```powershell
git add tests/helpers/socket-guard.mjs tests/structured-runtime-e2e.test.ts docs/verification.md
git commit -m "test: prove offline structured Director workflow"
```

## Self-review checklist

- Spec coverage: Tasks 1-8 cover v2 capability fields, host-only semantics, structured submissions, compiler deletion, fail-closed explicit configuration, ambient host-key isolation, loopback-only networking, migration compatibility, direct structured-call preservation, atomic revisions, CLI/persistence/composition/export, Skill validation, browser checks, and fresh-agent validation.
- Placeholder scan: the plan contains no `TBD`, `TODO`, “implement later”, or unspecified “write tests” step.
- Type consistency: the plan consistently uses `operation`, `allowPartial`, `scene.submit`, `patch.submit`, `INTENT_REPORT_SCHEMA_VERSION`, and the same three stable submission error codes.
- Scope: no connected-space schema, ShotSet, animation, IK, physics, final image generation, model integration, or private project data is introduced.
