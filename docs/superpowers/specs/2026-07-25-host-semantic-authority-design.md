# Host Semantic Authority and Structured Runtime v2 Design

**Status:** Approved in conversation on 2026-07-25.

**Scope:** Shubi Shot Director v0.2.1 architecture correction. This design
supersedes every earlier decision that allowed the local runtime to interpret
natural language, resolve aliases inside prompt text, or advertise API-key
requirements. It does not pull connected-space schema work, ShotSet work,
animation, IK, physics, or final image generation into v0.2.1.

## Goal

Keep all semantic interpretation in the current host Codex model while making
the local Director runtime a deterministic, structured-only graybox engine.
The host converts user language into a generic `IntentReport` plus either a
complete `SceneSpec` or one incremental `ScenePatch`. The local scripts and
loopback bridge validate those documents, verify declared constraint coverage,
apply changes atomically, manage revisions, inspect composition, persist scenes,
and export perspective references.

The Director runtime must never contain, launch, or call a language model. It
must never discover, read, accept, store, log, forward, or depend on an API key,
token, model provider, or model-service address, and it must never make an
outbound model request.

## Non-goals

- No local lexical, statistical, or model-backed prompt-to-schema compiler.
- No final image generation, prompt production, asset management, animation,
  IK, gameplay physics, or project-specific character system.
- No v0.3 connected-space schema or v0.4 ShotSet implementation in this change.
- No persistence of raw prompts, external profile paths, private aliases, or
  profile contents.

## Authority boundary

### Host Codex

The host Codex model owns all non-deterministic or semantic work:

- understand the user's natural-language request;
- load an explicitly supplied external profile read-only;
- resolve aliases to generic actor slots in memory;
- identify constraints, unsupported requirements, and unresolved relations;
- decide whether a request can be applied safely;
- generate `IntentReport`, `SceneSpec`, and `ScenePatch` documents;
- retry schema authoring at most once when the first structured route cannot
  represent the request;
- report missing capability rather than submit a partial scene accidentally.

The Skill must never send raw user text, profile paths, aliases, or profile
contents to the Director runtime.

### Director runtime

The local runtime owns only deterministic work:

- strict schema parsing and normalization;
- generic ID, reference, and constraint validation;
- structured intent-coverage validation;
- atomic scene replacement and patch application;
- stale-revision rejection and revision accounting;
- undo, redo, save, load, composition inspection, and PNG export;
- loopback-only bridge lifecycle and browser-editor state projection.

`SceneSpec` remains the only persistent scene authority. `IntentReport` is an
ephemeral submission document and must not be copied into scenes, logs, exports,
or screenshots.

## Structured submission contract

### IntentReport v1

The host produces a strict, generic report with no raw prose fields:

```json
{
  "schemaVersion": 1,
  "operation": "create",
  "allowPartial": false,
  "recognizedConstraints": [
    {
      "id": "constraint_1",
      "kind": "camera-height",
      "required": true,
      "targets": ["camera_main"],
      "evidence": [
        { "type": "entity-property", "entityId": "camera_main", "path": "camera.heightM" }
      ]
    }
  ],
  "unsupportedConstraints": [],
  "unresolvedRelations": [],
  "warnings": [],
  "canApplySafely": true
}
```

Allowed constraint kinds, issue codes, evidence types, and property paths are
versioned allowlists. Reports may contain generic IDs and normalized capability
codes but may not contain the original request, aliases, external paths, or
free-form project text.

For scene creation, partial application is forbidden. `allowPartial` must be
false, `canApplySafely` must be true, and unsupported or unresolved arrays must
be empty.

For modification, `allowPartial` defaults to false. When it is false, the same
strict rule applies. When the user explicitly authorizes partial application,
the host may set it to true, but every unapplied item must appear in a structured
issue array and every applied required constraint must still have valid evidence.

### Atomic submission envelopes

Add two structured actions:

- `scene.submit --file <scene-submission.json>`
- `patch.submit --file <patch-submission.json>`

The files contain `{ intentReport, scene }` or `{ intentReport, patch }`.
The bridge validates the report and payload together before mutation. A failed
schema, coverage, safety, scene ID, entity reference, or revision check produces
zero mutation.

`patch.submit` applies all operations as one transaction. Success must preserve
the same `sceneId` and increase revision by exactly one. A stale base revision
remains a hard rejection.

Existing structured actions remain supported:

- `scene.create --file <scene.json>`
- `patch.apply --file <patch.json>`

They preserve current structured automation and browser/manual workflows, but
they carry no semantic-completeness claim. The Shubi Shot Director Skill must use
the submission actions for natural-language requests.

## Constraint-coverage validation

The runtime does not judge whether the host understood the prose correctly. It
does verify that the host's own structured claims are internally complete:

1. the report and payload use supported schema versions;
2. `canApplySafely` and partial-application rules are consistent;
3. every required recognized constraint contains evidence;
4. evidence references an existing scene entity, scene constraint, camera
   property, or patch operation from an allowlist;
5. every patch target exists and matches the operation kind;
6. no unsupported or unresolved item is silently omitted when partial
   application is disabled;
7. no report field contains a filesystem path or forbidden raw-text field.

Failures use stable codes such as `UNSUPPORTED_DESCRIPTION`,
`INTENT_REPORT_INVALID`, `INTENT_COVERAGE_INCOMPLETE`, and `STALE_REVISION`.
Messages are fixed and generic.

## Capability contract v2

The runtime publishes a non-negotiable boundary contract through both offline
`doctor` and live health:

```json
{
  "service": "shubi-shot-director",
  "capabilitiesContractVersion": 2,
  "applicationVersion": "0.2.1",
  "bridgeProtocolVersion": 1,
  "sceneSchemaVersion": 1,
  "patchSchemaVersion": 1,
  "intentReportSchemaVersion": 1,
  "semanticAuthority": "host",
  "inputContract": "structured-only",
  "modelIntegration": "none",
  "credentialPolicy": "forbidden",
  "networkPolicy": "loopback-only",
  "commands": [],
  "features": []
}
```

`requiresApiKey` is removed. API keys are not an optional runtime capability.
The Skill planner requires every boundary field above and treats a mismatch as
incompatible before bridge startup or mutation. Application semver remains
diagnostic and is never used for routing. Matching arbitrary positive protocol
numbers remain valid; only offline/live disagreement is blocking.

Remove these runtime action IDs:

- `shot.create`
- `shot.modify`
- `profile.resolve`

Remove these runtime features:

- `intent.strict-report`
- `intent.allow-partial`
- `profile.external-read-only`
- `schema.scene-authoring`
- `schema.patch-authoring`

Add structured feature IDs for intent-report validation, scene submission, and
patch submission. A v2 runtime that advertises any removed semantic action or
feature, or publishes a credential/model configuration field such as
`requiresApiKey`, violates the boundary and is incompatible rather than merely
additive.

## Text-command migration

The public manifest and help output no longer advertise raw-text commands. For
one compatibility window, the CLI may recognize only the leading command tokens
of `shot create`, `shot modify`, and `profile resolve` and immediately return
`HOST_STRUCTURED_INPUT_REQUIRED`.

The compatibility stub must not parse or normalize following arguments, resolve
a runtime, read a profile, start a bridge, write a file, log arguments, or mutate
state. It is a rejection path, not a hidden legacy compiler. The local
natural-language compiler, semantic-coverage tokenizer, prompt option parser,
and text alias resolver are removed from production code.

## Credential and process isolation

Codex may itself run in account or KEY mode. Those host credentials are outside
the Director input contract.

Director processes must not enumerate the ambient environment. Every child
process receives an environment built by direct lookup of a fixed allowlist of
OS execution fields and approved Director fields. The allowlist excludes API
keys, tokens, authorization values, provider/model settings, model endpoints,
proxy variables, and `NODE_OPTIONS`.

Explicit Director arguments or Director-owned configuration fields named as a
credential, model, provider, base URL, or endpoint are rejected before runtime
resolution, bridge startup, file access, or child spawn. Error output contains
only a stable code and fixed message. Ambient host credential variables are not
treated as Director input: they are neither inspected nor inherited.

The root launcher, Skill launcher, bridge process launcher, and system-browser
launcher all use the same minimal-environment policy.

## Network boundary

- The server binds only to `127.0.0.1`.
- CLI bridge URLs must be uncredentialed HTTP origins using IP-literal loopback
  hosts (`127.0.0.0/8` or `::1`).
- The browser client uses same-origin relative API and event paths; arbitrary
  external `baseUrl` values are rejected or removed.
- No production module may import a language-model client or contact a model
  endpoint.
- Opening the editor may launch a system browser only with the validated local
  UI URL.

The current rendering dependencies do not contain a used language-model client.
An unused transitive computer-vision package is not treated as a language-model
integration, but production imports remain covered by static audits.

## Compatibility behavior

| Skill/runtime combination | Result |
| --- | --- |
| New Skill + valid v2 runtime | Capability-planned structured operation |
| New Skill + v1 or legacy runtime | Incompatible before startup or mutation |
| Old Skill + v2 runtime raw-text command | `HOST_STRUCTURED_INPUT_REQUIRED`, zero mutation |
| v2 offline/live boundary mismatch | Incompatible before mutation |
| v2 runtime advertises removed semantic actions | `SEMANTIC_BOUNDARY_VIOLATION` |
| Scene or Patch schema mismatch | Disable the corresponding host-authored submission |
| Future application semver with matching contracts | Continue according to advertised structured capabilities |

Saved `SceneSpec` files, scene IDs, revisions, atomic Patch behavior, browser
manual edits, persistence, composition inspection, and export remain compatible.

## Verification strategy

### Static boundary tests

- deny language-model client dependencies and production imports;
- deny removed raw-text actions and features in manifest/help/Skill routing;
- allow network entry points only in reviewed loopback/same-origin modules;
- deny environment enumeration and whole-environment forwarding in production;
- deny model/provider/credential/endpoint options in public commands;
- audit repository fixtures and output for private names, absolute paths, raw
  prompts, profile contents, and credential markers.

### Process tests

Run a real no-browser structured loop:

`doctor -> ensure -> scene.submit -> snapshot -> patch.submit -> snapshot ->
scene save -> scene load -> composition inspect -> export png -> stop`

Use a minimal environment with no credentials or proxy configuration. Require
scene ID continuity, exact `+1` Patch revision, successful save/load, a valid
1920x1080 PNG, file hash, segmented composition report, and zero raw-input echo.

Repeat with host credential and model-endpoint markers present in the parent
environment. The Director must not inspect or pass them, and the synthetic child
must observe none of them.

Run the same loop with a socket guard that rejects DNS, TLS, and non-loopback
connections while allowing loopback. Negative cases for remote IPs, domains,
HTTPS, and credentialed URLs must fail before any socket is opened.

### Migration and safety tests

- v1/legacy runtimes are incompatible for mutation and export;
- old raw-text commands reject before runtime resolution and produce zero
  mutation;
- invalid or incomplete IntentReports reject before mutation;
- compound Patch submission changes only requested fields, preserves `sceneId`,
  and increments revision exactly once;
- stale Patch submission leaves current state unchanged;
- existing direct structured create/apply/save/load/composition/export tests
  remain green;
- full `typecheck`, `test`, `lint`, `build`, Skill validation, privacy audit,
  fresh-agent forward tests, and real-browser interaction checks pass.

## Migration order

1. Add failing boundary, contract-v2, structured submission, and offline tests.
2. Publish capability contract v2 and update bridge health validation.
3. Add IntentReport schema and deterministic coverage validation.
4. Add atomic `scene.submit` and `patch.submit` CLI/bridge paths.
5. Remove production prompt-to-schema compiler, text option parser, and text
   alias resolver; add fail-closed compatibility stubs.
6. Replace all child environments with the fixed allowlist and close browser
   client network escape hatches.
7. Rewrite the Skill and references so Codex authors all structured documents.
8. Migrate fixtures and tests, then run the complete acceptance flow.

Each stable step is committed independently, stays runnable, and receives a
specification review followed by a code-quality review.

## Acceptance criteria

- No production runtime code accepts or interprets natural-language prompt text.
- No runtime command or feature claims semantic authority.
- No production code enumerates or forwards the ambient environment.
- No Director process receives host credentials, model settings, endpoints, or
  proxy values.
- No non-loopback production network request is possible through supported
  configuration.
- The Skill alone performs natural-language understanding and generic alias
  resolution, then submits structured documents.
- IntentReport coverage is validated deterministically before semantic
  submissions mutate state.
- Existing direct structured calls, scene/revision invariants, atomic Patch,
  persistence, composition inspection, and export do not regress.
- All examples, fixtures, logs, screenshots, and exports remain generic and
  suitable for a public repository.
