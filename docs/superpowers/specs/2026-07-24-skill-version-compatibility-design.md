# Skill and Runtime Compatibility Design

> [!WARNING]
> **Superseded on 2026-07-25.** Use
> [`2026-07-25-host-semantic-authority-design.md`](2026-07-25-host-semantic-authority-design.md)
> as the current approved design. The historical body below is preserved for
> decision and migration context only.

## Status

Approved direction: capability-first compatibility for both Codex model variants and Shubi Shot Director runtime versions.

## Problem

The current Skill starts with `doctor`, but it does not use the response to decide which commands or schemas are safe. Command names, preset IDs, operation lists, and generated schema version 1 are then treated as universally available. This creates four failure modes:

- a weaker or older Codex model can choose a different route from a stronger model;
- a Skill can invoke a command that the installed runtime does not support;
- a bundled schema can be submitted to an incompatible runtime;
- a newer CLI can connect to an older bridge and report a generic identity error instead of a compatibility diagnosis.

The runtime already has the beginning of a solution: `doctor` is offline and read-only, and it reports the application, bridge protocol, SceneSpec schema, ScenePatch schema, and three coarse capabilities. This design turns that response into a stable contract instead of adding a second overlapping discovery command.

## Goals

- Let one Skill route safely across compatible runtime releases without branching on application semver.
- Keep behavior consistent across Codex models that can load a Skill, run a local command, and consume JSON.
- Keep all API-key handling outside the product and declare that boundary mechanically.
- Preserve useful core behavior on legacy runtimes that lack the new capability contract.
- Fail closed before scene mutation when the live bridge does not match its local runtime CLI, and before submitting Skill-authored JSON when its schema is incompatible.
- Keep the Skill concise and move fragile compatibility decisions into deterministic code.

## Non-goals

- Supporting Codex hosts that cannot load Skills or execute local commands.
- Guessing the semantics of undocumented legacy commands.
- Adding cloud inference or an OpenAI API client to the runtime.
- Making application version numbers part of feature routing.
- Expanding the product beyond graybox previs.

## Considered approaches

### Branch on application versions

The Skill could contain rules for `0.2.1`, `0.3`, and later releases. This is easy to start but brittle: backports, optional features, and compatible future versions make semver an unreliable capability signal. Rejected.

### Ship a separately pinned Skill for every release

This keeps each release internally consistent, but users can install a mismatched Skill and runtime. It also does not solve consistent routing across Codex models. A matching Skill will still ship with every release, but pinning is not the compatibility mechanism.

### Negotiate stable capabilities

The Skill asks the runtime what it supports, validates the response, and uses only the advertised intersection. Application semver remains diagnostic. This is the selected approach.

## Architecture

### 1. One capability manifest

Add one source module, owned by the CLI layer, that defines the runtime manifest. `doctor`, bridge health, the Skill compatibility adapter, and automated tests consume the same stable IDs.

The offline `doctor` envelope returns data shaped like:

```json
{
  "service": "shubi-shot-director",
  "capabilitiesContractVersion": 1,
  "applicationVersion": "0.2.1",
  "requiresApiKey": false,
  "bridgeProtocolVersion": 1,
  "sceneSchemaVersion": 1,
  "patchSchemaVersion": 1,
  "commands": [
    "doctor",
    "ensure",
    "status",
    "stop",
    "health",
    "snapshot",
    "shot.create",
    "shot.modify",
    "scene.create",
    "scene.save",
    "scene.load",
    "patch.apply",
    "composition.inspect",
    "export.png",
    "profile.resolve",
    "undo",
    "redo",
    "open.system"
  ],
  "features": [
    "intent.strict-report",
    "intent.allow-partial",
    "scene.files",
    "export.software-png",
    "composition.segmented-report",
    "bridge.safe-shutdown",
    "profile.external-read-only",
    "schema.scene-authoring",
    "schema.patch-authoring"
  ]
}
```

Command and feature IDs are machine-facing identifiers, not copied help text. Unknown IDs are ignored. A missing ID means unsupported. IDs are additive within a capability-contract major version.

`applicationVersion` comes from the package metadata through one tested helper. It must not be duplicated as a source literal in the CLI.

### 2. Offline negotiation, then live verification

Every Skill session begins with offline `doctor`. This must not start the bridge or mutate scene state.

If the requested action is allowed, the Skill runs `ensure` and checks live `health`. Health includes the same service identity and compatibility fields needed to prove that the running bridge matches the CLI contract:

- capability contract version;
- application version;
- bridge protocol version;
- SceneSpec schema version;
- ScenePatch schema version;
- bridge command and feature IDs.

The CLI compares offline and live contracts before sending scene operations. A new CLI connected to an incompatible old bridge receives a specific compatibility error, not `BRIDGE_IDENTITY_MISMATCH`.

### 3. Deterministic compatibility plan

The bundled Skill adapter normalizes `doctor`, optional legacy `help`, and live health into a small compatibility plan:

```json
{
  "mode": "full",
  "allowedActions": ["shot.create", "shot.modify", "export.png"],
  "sceneSchemaAuthoring": true,
  "patchSchemaAuthoring": true,
  "warnings": []
}
```

The Skill follows this plan and does not independently infer support from version text. This keeps routing consistent across Codex models.

The adapter and launcher must not depend on a fixed four-level repository layout. Runtime lookup is deterministic and bounded:

1. use `SHUBI_SHOT_RUNTIME_ROOT` when the user or installer explicitly configures an external runtime root;
2. use release-relative runtime metadata when the Skill is bundled with the application;
3. use the nearest ancestor package whose declared name is `shubi-shot-director` for a source checkout;
4. otherwise return `RUNTIME_NOT_FOUND` without scanning unrelated directories.

Resolved machine paths remain transient and are never written to scenes, logs, fixtures, screenshots, or repository files.

## Compatibility modes

### Full

Use when the capability contract is supported, the local runtime CLI verifies its live bridge, and the required authoring schemas are supported. Enable only advertised commands and features. A different application or bridge-protocol version remains compatible when the runtime's own CLI and bridge agree.

### Restricted

Use when the capability contract is supported but optional commands or features are absent, or when the runtime schema is newer than the schemas bundled with the Skill. Continue with the advertised high-level subset and accurately report unavailable actions. A runtime-native `shot.create` or `shot.modify` may continue across a schema change because the matching runtime owns compilation and validation. Hand-authored SceneSpec or ScenePatch JSON remains disabled until the bundled schema is explicitly compatible. Do not synthesize missing support.

### Legacy

Use when `doctor` exists but has no recognized capability-contract version. Read `help` once and allow only explicitly recognized core command signatures. Legacy mode may create, modify, snapshot, and open a shot when those commands are present. It must not:

- hand-author SceneSpec or ScenePatch JSON;
- claim save, export, composition inspection, safe shutdown, or partial application support;
- infer a feature from application semver;
- silently retry with a guessed command.

This preserves useful old-version behavior without promising semantics that cannot be verified.

### Incompatible

Enter this mode for an unsupported capability-contract version, a live bridge protocol that does not match the local runtime CLI, malformed manifest, false service identity, or a runtime that requires an API key.

No scene write, bridge startup, file write, export, stop, undo, or redo is allowed. Read-only diagnostics may be returned.

An unsupported SceneSpec or ScenePatch schema is action-scoped rather than globally incompatible: it disables only Skill-authored JSON and any operation that requires that JSON. Explicitly advertised high-level runtime commands remain available.

## Error contract

Add specific stable errors:

- `CAPABILITIES_INVALID`
- `CAPABILITIES_CONTRACT_UNSUPPORTED`
- `BRIDGE_PROTOCOL_UNSUPPORTED`
- `SCENE_SCHEMA_UNSUPPORTED`
- `PATCH_SCHEMA_UNSUPPORTED`
- `RUNTIME_NOT_FOUND`
- `RUNTIME_REQUIRES_API_KEY`

Keep `BRIDGE_IDENTITY_MISMATCH` for a service that does not identify itself as Shubi Shot Director. Do not use it for a recognized but incompatible version.

Errors and diagnostics must not include raw prompts, external profile content, private aliases, credentials, or resolved machine paths.

## Skill structure and routing

Reduce the main `SKILL.md` to the invariant route:

1. negotiate capabilities;
2. resolve an explicitly supplied external profile only in memory;
3. compile natural language once;
4. inspect `IntentReport.canApplySafely` rather than judging whether language is “simple” or “complex”;
5. use schema authoring only when the compatibility plan explicitly permits the matching schema version;
6. apply follow-up edits as one incremental patch at the authoritative revision;
7. verify the resulting revision and final-camera view;
8. report unavailable capabilities honestly.

Detailed command syntax, authoring rules, recovery, profiles, and visual QA remain in directly linked references. The main Skill must state exactly when each reference is required so older or weaker models do not miss safety rules.

`agents/openai.yaml` must describe staging or revising a shot without forcing every invocation to create and open a scene.

## API-key boundary

Shubi Shot Director remains a local Skill, CLI, bridge, and browser editor. It never asks for, reads, accepts, stores, logs, or transmits an OpenAI API key.

`requiresApiKey: false` is part of the capability contract. A runtime returning true is outside the product contract and is treated as incompatible. Codex account mode and billing are host concerns.

## Testing strategy

### Contract tests

Add process-level tests for `doctor` that prove:

- it returns one valid JSON envelope;
- it is read-only and does not start the bridge;
- application version matches package metadata;
- command and feature IDs are unique and consistent;
- protocol and schema versions use shared constants;
- unknown arguments are rejected.

### Negotiation matrix

Use synthetic, generic manifests to cover:

| Runtime case | Expected result |
| --- | --- |
| Current complete contract | Full mode |
| Older compatible contract with fewer features | Restricted mode |
| No capability contract | Conservative legacy mode |
| New application semver with the same contracts | Full mode |
| Unknown additive fields | Ignore fields and continue |
| Unsupported contract version | Incompatible before mutation |
| Live bridge protocol differs from the offline runtime manifest | `BRIDGE_PROTOCOL_UNSUPPORTED` before mutation |
| New bridge protocol with a matching runtime CLI and health response | Continue according to advertised commands and schemas |
| Unsupported SceneSpec schema | Restricted mode; disable SceneSpec authoring, keep advertised runtime-native commands |
| Unsupported ScenePatch schema | Restricted mode; disable ScenePatch authoring, keep advertised runtime-native commands |
| Missing or contradictory fields | `CAPABILITIES_INVALID` |
| Runtime claims an API key is required | `RUNTIME_REQUIRES_API_KEY` |

### Bridge tests

Test live health independently from service identity. A compatible response with unknown fields succeeds; a recognized service whose protocol differs from the local offline manifest returns `BRIDGE_PROTOCOL_UNSUPPORTED`; a new protocol shared by the local CLI and bridge remains valid; an unsupported Skill authoring schema produces a restricted compatibility plan and the matching schema error only when authored JSON is requested; an unrelated service still returns `BRIDGE_IDENTITY_MISMATCH`.

### Skill forward tests

Run fresh agents at two available Codex capability tiers against the same generic tasks without giving them the expected route:

- create a supported shot and open the editor;
- modify the existing shot without replacing it;
- request export when export is absent;
- encounter a legacy runtime;
- encounter a future incompatible schema;
- confirm that no task asks for or handles an API key.

Both tiers must choose the same compatibility mode, invoke no undeclared commands, preserve incremental revision behavior, and report unavailable capabilities without fabrication.

### Existing verification

Retain type checking, unit tests, linting, build, Skill `quick_validate.py`, generic-output privacy audit, CLI closed-loop verification, transition-diff verification, and real-browser interaction checks.

## Rollout order

1. Add failing capability-manifest and negotiation tests.
2. Implement the shared manifest and formalize `doctor`.
3. Add failing live-health compatibility tests, then update bridge health validation.
4. Add failing Skill adapter and legacy-routing tests, then implement deterministic negotiation.
5. Rewrite the Skill and CLI reference against stable IDs.
6. Forward-test two Codex capability tiers.
7. Run the complete CLI and browser acceptance flow and commit a stable checkpoint.

## Acceptance criteria

- No Skill branch uses application semver to decide behavior.
- Compatible future application versions continue to work when contracts match.
- Missing features are never invoked or claimed.
- Legacy runtimes retain verified core operations without schema authoring or optional feature claims.
- A live bridge that does not match its local runtime CLI causes no scene or file mutation.
- An unsupported schema never receives Skill-authored JSON; advertised runtime-native high-level commands may continue.
- CLI and live bridge report a single consistent manifest.
- Different tested Codex capability tiers produce the same safe route.
- The repository and all captured artifacts remain generic and contain no API key or private project data.
