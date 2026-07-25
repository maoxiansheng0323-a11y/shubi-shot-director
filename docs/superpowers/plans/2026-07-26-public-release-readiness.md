# Public Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a verified, generic source snapshot that an unfamiliar developer can install, run, inspect, and use to export a graybox PNG without publishing the repository or package.

**Architecture:** Preserve the capability-v2 structured-only runtime and current React/Three.js editor. Stabilize the browser Shot Preview export bridge, add one deterministic public audit and one schema-valid generic example, then document and verify the exact public workflow. Existing internal Git history remains private; a later public repository must start from the verified snapshot rather than push the internal history.

**Tech Stack:** TypeScript, Node.js 22+, pnpm 11, React 19, Three.js, React Three Fiber, Express, Zod, Vitest, ESLint, Vite.

---

### Task 1: Stabilize the real Shot Preview export bridge

**Files:**
- Modify: `cli/bridge.ts`
- Modify: `cli/director-runtime.ts`
- Modify: `server/api.ts`
- Create: `server/preview-export-broker.ts`
- Modify: `src/App.tsx`
- Modify: `src/three/ShotExporter.tsx`
- Create: `src/three/preview-export-client.ts`
- Modify: `tests/runtime-boundary.test.ts`
- Modify: `tests/structured-runtime-e2e.test.ts`
- Create: `tests/preview-export-api.test.ts`
- Create: `tests/preview-export-broker.test.ts`
- Create: `tests/preview-export-client.test.ts`

- [ ] **Step 1: Run the targeted preview-export tests**

  Run:

  ```powershell
  pnpm vitest run tests/preview-export-broker.test.ts tests/preview-export-api.test.ts tests/preview-export-client.test.ts tests/structured-runtime-e2e.test.ts tests/runtime-boundary.test.ts
  ```

  Expected: every targeted file passes; CLI export gets its PNG from the connected Shot Preview, not the software fallback.

- [ ] **Step 2: Review the boundary invariants**

  Confirm the implementation:

  - binds only through the existing loopback server;
  - accepts only width and height from CLI export;
  - verifies PNG signature, size, `sceneId`, and revision;
  - rejects missing preview, timeout, invalid data, and revision mismatch;
  - never accepts prompts, profiles, credentials, providers, models, or endpoints.

- [ ] **Step 3: Run static and build gates**

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm build
  ```

  Expected: all commands exit zero. The Vite large-chunk advisory is non-blocking because this task does not add a deployment bundle requirement.

- [ ] **Step 4: Commit the stable export checkpoint**

  Stage only the files listed in this task and commit:

  ```text
  feat: export png through the shot preview
  ```

### Task 2: Add a deterministic public-release audit

**Files:**
- Create: `tests/public-release-audit.test.ts`
- Create: `scripts/audit-public-release.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing audit tests**

  Add tests that require these exported behaviors:

  ```js
  auditText("docs/file.md", "generic text", [])
  // => []

  auditText(
    "docs/file.md",
    ["C:", "Users", "person", "private.json"].join("\\"),
    [],
  )
  // => [{ code: "MACHINE_ABSOLUTE_PATH", file: "docs/file.md" }]

  auditText(
    "docs/file.md",
    ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    [],
  )
  // => [{ code: "PRIVATE_KEY", file: "docs/file.md" }]

  auditText("docs/file.md", "private-marker", ["private-marker"])
  // => [{ code: "DENY_TOKEN_PRESENT", file: "docs/file.md", tokenIndex: 1 }]
  ```

  Add path tests that reject tracked `.env`, `project-profile.json`, runtime state, logs, reports, archives, private keys, and local exports while allowing committed files under `examples/`.

- [ ] **Step 2: Run the new test and verify RED**

  Run:

  ```powershell
  pnpm vitest run tests/public-release-audit.test.ts
  ```

  Expected: FAIL because `scripts/audit-public-release.mjs` does not exist.

- [ ] **Step 3: Implement the minimal audit**

  The CLI must:

  - enumerate `git ls-files --cached --others --exclude-standard -z`;
  - inspect text files up to 2 MiB without printing contents;
  - report repository-relative paths only;
  - detect machine paths, file URIs, private-key blocks, common API-secret shapes, and caller-supplied `--deny-token` values;
  - reject unsafe tracked or unignored file paths;
  - verify `package.json` declares MIT, `private: true`, Node 22.12+, and pnpm 11;
  - summarize production dependency licenses and reject licenses outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC;
  - output one JSON line and return non-zero when findings exist.

  Keep project-specific deny tokens outside the repository and pass them only as CLI arguments during the private release check.

- [ ] **Step 4: Add package scripts**

  Add:

  ```json
  {
    "audit:public": "node scripts/audit-public-release.mjs",
    "verify": "pnpm schemas:generate && pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm audit:public"
  }
  ```

- [ ] **Step 5: Verify GREEN and commit**

  Run the targeted test and `pnpm audit:public`, then commit:

  ```text
  test: add public release audit
  ```

### Task 3: Add one complete generic quick-start submission

**Files:**
- Create: `tests/public-example.test.ts`
- Create: `examples/quickstart.scene-submission.json`

- [ ] **Step 1: Write a failing example test**

  The test must read `examples/quickstart.scene-submission.json`, call `parseSceneSubmission`, and assert:

  - create operation;
  - `allowPartial: false` and `canApplySafely: true`;
  - generic IDs and actor slots only;
  - 16:9 at 1920 x 1080;
  - one room, one generic actor, one generic prop, one perspective camera;
  - valid ground contact and evidence coverage;
  - no free-form source wording, aliases, paths, credentials, or model settings.

- [ ] **Step 2: Run the test and verify RED**

  Run:

  ```powershell
  pnpm vitest run tests/public-example.test.ts
  ```

  Expected: FAIL because the example file does not exist.

- [ ] **Step 3: Add the minimal envelope**

  Wrap the existing generic starter scene in a strict create `IntentReport`. Use only generic identifiers such as `scene_quickstart_1`, `environment_room_1`, `actor_generic_1`, `prop_block_1`, and `camera_shot_1`.

- [ ] **Step 4: Verify GREEN and commit**

  Run the targeted test, the existing structured-submission tests, and the generic-output audit. Commit:

  ```text
  docs: add runnable structured example
  ```

### Task 4: Make public onboarding complete and safe

**Files:**
- Modify: `README.md`
- Modify: `LICENSE`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `docs/public-release.md`
- Modify: `.agents/skills/shubi-shot-director/SKILL.md`
- Modify: `.agents/skills/shubi-shot-director/references/cli-contract.md`
- Modify: `.agents/skills/shubi-shot-director/references/visual-qa.md`

- [ ] **Step 1: Update public metadata**

  Keep `private: true`, add `license: "MIT"`, and do not add a fake repository URL. Confirm the MIT text has the generic contributor copyright.

- [ ] **Step 2: Harden ignore rules**

  Ignore local scene/output directories, PNG exports, runtime state, external profiles, environment files, logs, reports, traces, coverage, build products, and editor state. Add explicit exceptions for committed generic JSON examples.

- [ ] **Step 3: Rewrite README for an unfamiliar developer**

  Include these sections in this order:

  1. What it is and what it is not
  2. Architecture and privacy boundary
  3. Prerequisites
  4. Install and start
  5. Five-minute structured quick start
  6. Browser controls and PNG export requirement
  7. Host Codex Skill installation/use
  8. Save/load and revision behavior
  9. Verification commands
  10. External profiles and private-data rules
  11. Known limits
  12. License

  Commands must use repository-relative paths and loopback URLs only.

- [ ] **Step 4: Document the no-history public release procedure**

  `docs/public-release.md` must say:

  - current internal Git history is not the publication artifact;
  - run all verification and private deny-token audits;
  - create a clean snapshot with `git archive` or an orphan-rooted repository;
  - initialize the future public repository from that snapshot;
  - never push the existing internal branches or tags;
  - publication still requires the user's repository name/owner decision.

- [ ] **Step 5: Align Skill export instructions**

  State that CLI PNG export requires an open connected Shot Preview and uses the exact browser-rendered final camera. Keep the runtime structured-only and credential-forbidden boundary unchanged.

- [ ] **Step 6: Validate docs and commit**

  Run link/path scans, Skill quick validation, `pnpm audit:public`, and `git diff --check`. Commit:

  ```text
  docs: prepare public onboarding
  ```

### Task 5: Verify from a clean source snapshot

**Files:**
- Verify only; write temporary files under ignored `.shubi-shot/validation/public-release/`

- [ ] **Step 1: Create an isolated source snapshot**

  Use `git archive HEAD` into the ignored validation directory. Do not copy `.git`, `.env`, `.shubi-shot`, ignored files, or internal branches.

- [ ] **Step 2: Install from the lockfile without credentials**

  Run inside the snapshot:

  ```powershell
  pnpm install --frozen-lockfile --offline
  ```

  Expected: installation succeeds from the package store. If offline cache is incomplete, rerun with normal registry access; do not add credentials.

- [ ] **Step 3: Run public gates in the snapshot**

  Run:

  ```powershell
  pnpm verify
  ```

  Expected: schema generation, typecheck, tests, lint, build, and public audit pass.

- [ ] **Step 4: Start a fresh loopback runtime**

  Use an unused loopback port and an ignored runtime directory. Run `doctor`, `ensure`, `health`, submit the quick-start envelope, then inspect `snapshot` and composition results.

- [ ] **Step 5: Verify the real browser and export**

  Open the fresh loopback URL in the integrated browser. Confirm the page title, meaningful editor DOM, no framework overlay, no relevant console errors, and a visible Shot Preview. Then run:

  ```text
  node scripts/director.mjs export png --file <ignored-output-path> --width 1920 --height 1080
  ```

  Verify the returned scene ID, revision, dimensions, SHA-256, PNG signature, and non-empty rendered content.

### Task 6: Final audit and release-ready checkpoint

**Files:**
- Modify: `docs/verification.md`

- [ ] **Step 1: Record the public verification evidence**

  Add the clean-install result, example scene/revision, browser URL and viewport, PNG dimensions/hash, public-audit count, dependency license set, and any non-blocking limitation.

- [ ] **Step 2: Run final repository gates**

  Run:

  ```powershell
  pnpm verify
  python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" '.agents\skills\shubi-shot-director'
  git diff --check
  git status --short
  ```

  Also run the public audit with private deny tokens supplied only on the command line; never write them into repository files or logs.

- [ ] **Step 3: Review the final diff**

  Confirm no remote was created, no push or package publication occurred, no private data was copied from ignored files, and every file is necessary for a stranger to run or verify the core workflow.

- [ ] **Step 4: Commit the final checkpoint**

  Commit:

  ```text
  docs: record public release verification
  ```
