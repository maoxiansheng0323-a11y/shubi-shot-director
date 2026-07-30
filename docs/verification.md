# Verification and known boundaries

Shubi Shot Director is accepted feature-by-feature in the real local browser,
not only through schema or unit tests. This document is the repeatable Stage F
checklist for the first usable graybox workflow.

## v0.6.0 Actor Blueprint gates

Run the focused reusable-blueprint contract before the full gate:

```powershell
pnpm exec vitest run tests/actor-blueprint.test.ts tests/actor-blueprint-import.test.ts tests/actor-blueprint-scene.test.ts tests/actor-blueprint-patch.test.ts tests/actor-projection.test.ts tests/actor-blueprint-consumers.test.ts tests/actor-blueprint-controls.test.ts tests/persistence.test.ts tests/privacy-boundary.test.ts
node .agents/skills/shubi-shot-director/scripts/director.mjs blueprint validate --file <external-actor-blueprint.json>
```

Require all of the following:

- the external path stops at the Host import boundary and no source path or raw file content appears in any scene, submission, history, diagnostics, log, screenshot metadata, or PNG;
- every embedded snapshot has `schemaVersion: 1` and a verified canonical `contentSha256`;
- one SceneSpec stores at most one snapshot per content hash and a unique `blueprintId`; same-hash registration reuses the snapshot and same-ID/different-hash registration fails atomically;
- two legal actor IDs with distinct actor slots can independently reference one snapshot while retaining independent transform, pose, color, lock, and selected variant;
- damaged and repaired variants resolve from the complete base rather than each other, and module visibility uses only the selected delta over `module.visible`;
- render, bounds, contact, composition, and software diagnostics consume one resolved actor projection;
- v0.1-v0.4 legacy scenes migrate to v5 and preserve primitive ID, type, and visibility exactly, with size and transform differences no greater than `1e-9`;
- save/load, source-file deletion, restart, undo, and redo preserve snapshots and actor structure; removing the last actor does not garbage-collect the snapshot;
- the Inspector exposes only a read-only blueprint summary and selection among variants already in the snapshot.

The black-box acceptance uses one generic 1.62 m slim feminine humanoid-machine blueprint. Its base anatomy is complete. In `damaged`, the right arm and both lower-leg/foot chains are absent, three right-shoulder terminals and two sealed knee interfaces are visible. In `repaired`, the right arm returns and its terminals hide, while both lower-leg/foot chains remain absent and both sealed knee interfaces remain visible.

After registering once, save two scenes, move or delete the external file, restart, and reload both scenes. Export this fixed sequence through the connected browser Shot Preview:

1. Scene A, damaged, front.
2. Scene A, damaged, three-quarter.
3. Scene A, damaged, side.
4. Scene B, repaired, supine.

For each independent PNG record the scene ID, revision, exact dimensions, byte-derived SHA-256, warning codes, and human picture check. Inspect Overview, affected Local previews, and Shot Preview before accepting each browser-rendered final camera export.

The 2026-07-30 real-process acceptance registered snapshot
`1bf75cbad12e92dc867ea7f45164ab0b4a8a63ee28e969b7b678632a652da30d`,
saved both scenes, deleted the external source, restarted the owned workspace,
and reloaded both saved scenes before export. The connected browser showed the
read-only v1 blueprint summary, five modules, two available variants, and the
selected variant. The four 1920 x 1080 software PNGs completed with no export
warnings:

- `front.png`: `scene_blueprint_acceptance_a`, revision 14,
  `ac4e708902c677f38d4bda1d84497f0d3fe03d5ed7f9f45d5b7b293ef67c088f`;
- `three-quarter.png`: `scene_blueprint_acceptance_a`, revision 15,
  `93a2a592f1167ab2099f5d4c3fe40f712a826ee09b153f7b260b8df9d1386c24`;
- `side.png`: `scene_blueprint_acceptance_a`, revision 16,
  `f2435a8bed5cdfed8436beaeaa65f216ed0e07930f06c50a349f336b376ea18f`;
- `supine.png`: `scene_blueprint_acceptance_b`, revision 17,
  `18261301ff8db6c4fbaca8df5aba3b760e2b8bbf87de8ee3d4f585ed90e9f3e9`.

Visual inspection confirmed the damaged anatomy, three exposed shoulder
terminals, and two sealed knee interfaces in Scene A. Scene B restored the
complete right arm, hid the terminals, retained both lower-leg/foot absences
and knee interfaces, and rendered the supine pose. Required composition
checks passed; overall remains `check` because framing and caption targets were
not configured and occlusion is explicitly approximate. The retained
acceptance report, saved scenes, and PNGs passed the generic-output audit with
zero findings; PNGs contain no text metadata chunks.

## Automated gates

Run from the repository root:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Validate the repository Skill:

```powershell
$env:PYTHONPATH = (Resolve-Path '.tools\pyyaml').Path
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" '.agents\skills\shubi-shot-director'
```

The local `.tools` directory is ignored and is not part of the repository.

Run the generic-output audit:

```powershell
node .agents\skills\shubi-shot-director\scripts\audit-generic-output.mjs
```

Generate and compare all five bundled schemas before the remaining gates:

```powershell
pnpm schemas:generate
```

## v0.2.1 host-authority gates

- Host Codex performs the semantic compile from user language and an optional
  explicitly supplied external profile into generic `IntentReport` plus
  `SceneSpec` or `ScenePatch`.
- The runtime's structured compile performs only deterministic validation,
  normalization, intent coverage, atomic mutation, revision control,
  persistence, composition inspection, and export; it performs no semantic
  interpretation.
- No runtime command accepts prompt text, a profile path or content, aliases,
  credentials, tokens, models, providers, or endpoints.
- A create report uses `allowPartial: false`, `canApplySafely: true`, empty
  unsupported/unresolved arrays, and valid evidence for every required
  recognized constraint.
- A mixed recognized/unsupported modification is rejected atomically by
  default. Partial modification is allowed only after explicit user consent;
  every unapplied item remains in a structured issue array.
- A compound actor-and-camera request keeps each clause's target. It must not
  redirect an actor move merely because a later clause mentions the camera.
- A scene submission validates `{ intentReport, scene }` before mutation.
- A successful compound patch submission validates `{ intentReport, patch }`,
  keeps `sceneId`, advances revision by exactly one, and changes only requested
  fields.
- A stale compound Patch changes neither scene state nor undo history.
- Host account or KEY mode remains isolated; Director children receive no host
  credential, model, endpoint, proxy, or `NODE_OPTIONS` values.

Use `scripts/verify-transition.mjs` with generic before/after/Patch captures to
verify the revision and minimal diff.

## v0.2.1 CLI closed loop

Run the lifecycle, structured submission, persistence, history, and
composition commands below. Before `export png`, open the returned loopback
`uiUrl` and wait for an open connected Shot Preview at the current revision.

```powershell
node .agents\skills\shubi-shot-director\scripts\director.mjs doctor
node .agents\skills\shubi-shot-director\scripts\director.mjs ensure
node .agents\skills\shubi-shot-director\scripts\director.mjs status
node .agents\skills\shubi-shot-director\scripts\director.mjs scene submit --file <scene-submission-file>
node .agents\skills\shubi-shot-director\scripts\director.mjs snapshot
node .agents\skills\shubi-shot-director\scripts\director.mjs patch submit --file <patch-submission-file>
node .agents\skills\shubi-shot-director\scripts\director.mjs snapshot
node .agents\skills\shubi-shot-director\scripts\director.mjs scene save --file <new-scene-file>
node .agents\skills\shubi-shot-director\scripts\director.mjs scene load --file <scene-file>
node .agents\skills\shubi-shot-director\scripts\director.mjs composition inspect --json
node .agents\skills\shubi-shot-director\scripts\director.mjs export png --file <new-png-file> --width 1920 --height 1080
node .agents\skills\shubi-shot-director\scripts\director.mjs stop
```

Verify:

- `doctor` is read-only and does not start an offline bridge;
- `ensure` is idempotent and accepts loopback targets only;
- `status` and `stop` report online/offline state without exposing paths;
- scene and Patch submissions expose only generic intent summaries;
- the Patch snapshot keeps the scene ID and advances revision exactly once;
- save and export refuse to overwrite an existing file;
- load validates before replacing the authoritative scene;
- export fails closed when no compatible Shot Preview is connected or the
  scene revision changes during the request;
- the PNG comes from the browser-rendered final camera at the exact accepted
  `sceneId` and revision;
- the PNG has a valid signature and 1920 × 1080 IHDR dimensions;
- export reports scene ID, revision, dimensions, SHA-256, and generic warning
  codes only.

Keep raw verification artifacts under the ignored runtime directory, for
example `.shubi-shot/verification/v0.2.1`. Audit each captured JSON or PNG
sidecar with `audit-generic-output.mjs --artifact --file <artifact>`.

## Offline real-process acceptance

Run the credential-free acceptance test independently of any existing editor
preview:

```powershell
pnpm exec vitest run tests/structured-runtime-e2e.test.ts
```

The test allocates a fresh runtime directory and unused numeric loopback port.
It launches the real TypeScript server and CLI with absolute Node and tsx
loader paths under a fail-closed socket guard. The guard allows local IPC plus
numeric `127/8` and `::1` HTTP, while blocking and recording hostname DNS,
TLS, HTTPS, UDP sockets, hostname sockets, and non-loopback numeric sockets.
Every permitted Node child is launched with the same guard; shell, fork,
synchronous, and other unguarded child-process entry points are denied. Vite's
Windows network-drive probe is answered with a generic blocked error without
launching its shell command. The guard never records attempted hostnames,
socket paths, credentials, proxy values, or command arguments.

The repeatable command order is:

```text
doctor -> ensure -> health -> scene submit -> snapshot
-> compound patch submit -> snapshot -> undo -> snapshot
-> redo -> snapshot -> scene save -> scene load -> snapshot
-> composition inspect --json -> export png 1920x1080
-> root launcher doctor -> root launcher snapshot -> stop
```

Verify all of the following:

- `doctor` and live `health` publish capability contract v2 with host
  semantic authority, structured-only input, no model integration, forbidden
  credentials, loopback-only networking, and no legacy key requirement;
- `ensure.started` is `false` because it reuses the already guarded bridge;
- the generic scene keeps one `sceneId`; scene submission moves revision
  `0 -> 1`, the two-operation Patch moves it exactly `1 -> 2`, one undo
  restores both fields at revision `3`, one redo restores both at revision
  `4`, and load produces schema-valid revision `5`;
- composition inspection returns separate anchor, framing, caption,
  occlusion, topology, and camera-collision sections;
- the exported file has the PNG signature, an `IHDR` of `1920 x 1080`, and
  a byte-derived SHA-256 equal to the CLI summary;
- root-launcher children omit ambient host credential, endpoint, proxy, raw
  prompt, profile, alias, and `NODE_OPTIONS` markers, and each Node child is
  re-preloaded with the guard, as observed read-only at
  `child_process.spawn`;
- command output, saved scenes, composition JSON, export summaries, PNG
  sidecars, guard logs, and observer logs contain none of those marker values
  or a repository absolute path;
- `stop` terminates the owned bridge process, and parallel development
  bridges attach Vite HMR to their own HTTP server instead of competing for a
  shared WebSocket port.

## v0.2.1 composition gates

Require independent results for anchor, framing, caption/UI, occlusion,
topology, and camera collision.

- A face may pass anchor safety while the body entering the caption region
  still makes the overall result `CHECK`.
- Requested medium/full-body framing checks pose-aware subject bounds, not
  only a face point.
- Critical props must be wholly in frame.
- A camera intersecting a room wall or prop cannot be `SAFE`.
- Proxy occlusion reports an approximate ratio and cannot be presented as a
  pixel-accurate result.
- `unchecked`, approximate, or low-confidence required checks keep the
  overall result out of `SAFE`.

## Browser shot matrix

Start or reuse the loopback editor with `pnpm dev`, keep one browser tab open at
`http://127.0.0.1:4317`, and submit each request through the Skill's
host-authored structured route. User wording must not appear in IntentReport,
SceneSpec, ScenePatch, saved data, or success output.

### 1. Single subject and face priority

Create one generic female actor seated in a compact room with a low,
medium-close 70 mm camera and face priority.

Verify:

- exactly one generic actor slot exists;
- the seated pose is explicit in SceneSpec;
- ground contact has zero visible gap;
- the final camera reports 70 mm;
- the face keep-visible check is `SAFE`;
- the editor and shot preview stay interactive.

### 2. Two-person face-to-face blocking

Create two generic actors face to face in a spacious room with a wide 28 mm
camera.

Verify:

- the two actors use generic slots and opposing rotations;
- both feet remain on the selected support surface;
- the wide shot contains both figures;
- a follow-up such as “both actors sit down” produces one incremental Patch
  with two pose operations;
- one undo restores both poses together.

### 3. Over/under blocking with lower-face priority

Create a generic upper actor and lower actor on a low platform in a compact
room, using a low medium-close camera focused on the lower actor's face.

Verify:

- upper and lower poses are explicit and visibly different;
- both actors contact the same platform;
- the lower face is in frame and not reported as approximately occluded;
- moving a blocker into the sightline changes the panel to `CHECK`;
- a natural-language “keep the lower face clear” follow-up uses a minimal
  camera correction and returns the panel to `SAFE`;
- `perspective.png` decodes to 1920 × 1080 and matches the shot preview.

## Interaction and stability checks

- Resize the page to 1280 × 720, 900 × 720, and 800 × 720. Scene selection,
  transform controls, focal length, pose/contact/relationship controls, load,
  camera lock, and export must remain reachable.
- Start a viewport drag, then apply an external CLI Patch. Releasing the old
  drag must not overwrite the newer authoritative scene.
- Delay a local mutation response while a newer SSE update arrives. The page
  revision must never move backwards.
- Apply several server updates concurrently, restart the server, and confirm
  the last accepted valid SceneSpec is still parseable and loaded.
- Create or load replacement scenes repeatedly. Revisions remain monotonic,
  replacement is undoable, and a Patch from an older scene instance is stale.
- Refresh twice, select entities, switch `Q`/`W`/`E`, and export. The browser
  console should contain no application errors or compatibility warnings.

## 2026-07-25 capability-v2 acceptance record

The final capability-v2 checkpoint was verified from a clean feature branch.
The complete automated matrix passed with 33 test files and 938 tests, followed
by type checking, linting, production build, schema generation, Skill quick
validation, `git diff --check`, and a 133-file generic-output audit with zero
findings. The production build retained only the known large-chunk advisory.

The real-process guard was also exercised through the callback and Promise DNS
resolver surfaces, the public UDP factory, constructor, and low-level handle,
shell-backed spawn options, and direct `ChildProcess` prototype spawning. Each
unapproved entry returned `SOCKET_GUARD_BLOCKED`; an approved Node child still
started with the same guard injected and could not open UDP.

A separate browser runtime used an ephemeral numeric loopback port while the
existing `4317` preview remained available. The browser sequence was:

```text
doctor -> ensure -> health -> snapshot
-> select actor -> edit position -> edit focal length
-> patch submit -> snapshot -> undo -> redo
-> lock camera -> save -> export
-> scene save -> composition inspect -> export png
-> scene load -> snapshot -> edit rotation -> undo -> stop
```

The accepted generic scene kept `scene_starter` throughout. Revisions changed
as follows:

```text
0 initial
1 actor X position edit
2 focal length edit to 55 mm
3 host-authored one-operation position Patch
4 undo of that Patch
5 redo of that Patch
6 camera lock
7 saved-scene load
8 actor Y rotation edit to 15 degrees
9 undo of the rotation edit
```

At revision 3, the submitted Patch kept the scene ID, advanced exactly once,
and changed only `actor_generic_1` by a world-space translation of
`[0, 0, -0.4]`. The live inspector immediately showed the new Z position. Undo
and redo each created one new authoritative revision and restored the expected
value.

At revision 6, deterministic composition inspection honestly returned overall
`unchecked`: anchor, framing, caption, occlusion, and topology had no configured
targets, while camera collision passed with confidence `0.96`. The CLI PNG
export returned `1920 x 1080`, no warnings, and SHA-256
`5a0b068bc1d35fa2818f3ebc060e64768fb9673b2da2d8cf383798c8d627e5b0`.
The browser also reported successful scene download and locked-camera PNG
export at 1920 x 1080.

The rendered page showed the editable 3D viewport and independent final-camera
preview. Selection, position, rotation, focal length, camera lock, save, load,
undo, redo, composition display, and export all responded. Final browser logs
contained no errors or warnings. Document resources used only the runtime's
numeric loopback origin. No screenshot or downloaded browser artifact was
committed. After stopping the temporary runtime, its port was closed and the
existing `4317` preview still returned HTTP 200.

### Fresh-agent Skill generalization

A fresh minimal-context agent received only a generic create request followed
by a generic two-part modification and the instruction to use the repository
Skill. It was not told which Director commands to choose. The agent
independently selected the host-authored structured route:

```text
doctor -> ensure -> health -> snapshot -> composition inspect
-> scene submit -> snapshot -> composition inspect
-> patch submit -> snapshot -> composition inspect -> stop -> status
```

The create submission contained `IntentReport v1` plus a complete
`SceneSpec v1`. It replaced the starter with `scene_generic_medium_1` at
revision 1, with 16 recognized constraints and no unsupported, unresolved, or
warning entries. The follow-up used `IntentReport v1` plus a two-operation
`ScenePatch v1`, kept the same scene ID, and advanced revision exactly
`1 -> 2`. The minimal diff contained only:

```text
entities.prop_block_1.transform.positionM.0: 0.6 -> 0.4
entities.camera_generic_1.lens.focalLengthMm: 50 -> 65
```

The agent's transition check reported the same scene ID, exact revision,
non-empty operations, and a minimal diff. Generic-output audits of the
submissions and captured scenes reported zero findings. Runtime commands and
artifacts contained no source wording, credentials, token, model/provider
configuration, endpoint, or profile path/content.

Post-Patch composition passed anchor, framing, topology, and camera-collision
checks. The conservative proxy reported `SUBJECT_OCCLUDED_APPROXIMATE` at
approximately `7.6%` for the block, while the rendered final-camera preview
still showed both the actor and block clearly. This remains an explicit visual
review note rather than being promoted to `SAFE`. The isolated runtime stopped,
its port closed, its transient submissions were removed, and the existing
`4317` preview remained available.

## Generic connected-region acceptance

Use the public abstract submission:

```powershell
node .agents/skills/shubi-shot-director/scripts/director.mjs scene submit --file examples/connected-regions.scene-submission.json
node .agents/skills/shubi-shot-director/scripts/director.mjs snapshot
node .agents/skills/shubi-shot-director/scripts/director.mjs composition inspect --json
```

Require:

- `SceneSpec`, `ScenePatch`, and `IntentReport` version `2`;
- region IDs exactly `region_alpha`, `region_beta`, and `region_gamma`;
- no `environment` entity when `spatialLayout` is non-null;
- two shared-boundary openings and two explicit connections;
- actor, prop, and camera memberships in different regions;
- topology safety passes through both aligned openings;
- the Overview shows every visible region and outer/shared walls;
- selecting Beta opens Local preview with Beta opaque, adjacent regions faded,
  and no SceneSession revision change;
- Shot Preview removes editor fading and remains export-ready;
- legacy v1 quick-start input migrates to canonical v2 with
  `spatialLayout: null`.

Focused automated coverage:

```powershell
pnpm vitest run tests/spatial-layout.test.ts tests/spatial-patch.test.ts tests/spatial-intent.test.ts tests/spatial-composition.test.ts tests/spatial-preview.test.ts tests/software-png-spatial.test.ts tests/public-example.test.ts tests/structured-submission-cli.test.ts
```

## Intentional first-version boundaries

- Contact supports world ground, room floors, and horizontal box or plane
  surfaces. Unsupported or tilted shapes are not offered in contact pickers.
- Pose and relationship presets are recipes that materialize explicit
  SceneSpec transforms and constraints. They are not live IK, animation,
  physics, or collision systems.
- Occlusion safety uses conservative actor/prop proxy volumes. It is clearly
  labeled approximate and still requires visual confirmation.
- Host Codex performs all language understanding and authors every
  IntentReport, SceneSpec, and ScenePatch. The local runtime is structured-only
  and never provides a lexical or model-backed fallback.
- The editor produces graybox perspective references only. It does not create
  final art, animation, project-specific assets, or image-generation prompts.

## 2026-07-26 final public snapshot record

This record describes the final publication-preparation commit that contains
this section. Its exact commit ID is recorded outside the publication source in
the ignored validation manifest at
`.shubi-shot/validation/public-release/<final-short-sha>/verification.json`.
This avoids embedding a stale or self-referential Git hash in tracked source.

A history-free `git archive` of that final commit was extracted into the
same ignored, commit-keyed validation directory. The public source snapshot
contained 147 committed files and no `.git` metadata.

The clean snapshot installed with `pnpm install --frozen-lockfile --offline`
using pnpm 11.9.0. All 269 packages were reused from the local package store;
the install downloaded nothing and required no credential or model setting.

Inside the no-Git snapshot, `pnpm verify` passed with:

- 39 test files and 956 tests;
- schema generation, TypeScript checking, ESLint, and production build;
- a 149-file source-tree audit after the two ignored TypeScript build-info
  files were generated;
- zero public-audit findings;
- production dependency licenses limited to Apache-2.0, BSD-3-Clause, ISC,
  and MIT;
- `pnpm audit --prod` reporting no known vulnerabilities.

The production build retained the known non-blocking Vite advisory for the
1.30 MB application chunk. No core runtime, editor, schema, or stack rewrite
was introduced during this final publication pass.

The release gate was run on Windows 11 Pro, 64-bit, build 26200. macOS and
Linux were not claimed as verified platforms for v0.2.1.

A fresh isolated runtime accepted the strict public quick-start envelope as
`scene_quickstart_1` at revision 1 with seven recognized constraints and no
unsupported, unresolved, or warning entries. Deterministic composition
inspection returned honest `overallStatus: unchecked`; the configured camera
collision check passed at confidence 0.96.

The real in-app browser rendered the four-entity outliner, editable graybox
viewport, independent 1920 × 1080 Shot Preview, focal-length control, and
composition panel without an application error or warning. Locking the final
camera through the browser advanced the authoritative revision exactly once,
from 1 to 2.

With that exact browser preview connected, CLI export produced:

- scene ID `scene_quickstart_1`, revision 2;
- 1920 × 1080 IHDR dimensions;
- 115,178 bytes and PNG signature `89504e470d0a1a0a`;
- SHA-256
  `6ee2bc0ee5284065266b7817f5f87baf9a30f1ffd0ca0ccf310db7d4fe2cccbc`;
- only `IHDR`, `IDAT`, and `IEND` chunks;
- no export warnings and no generic-output audit findings.

The same audited generic render is committed at
`docs/assets/quickstart-perspective.png` for README onboarding. It visibly
contains only the public quick-start actor, blocking cube, room floor and
walls, with the same final-camera framing shown in Shot Preview.

The final source pass found no machine-specific path, credential, external
profile, private asset, or unapproved project marker. The explicitly approved
origin title appears only in README's `Origin & Maintainer` section. The fixed
publication parameters are repository `shubi-shot-director`, public
visibility, default branch `main`, initial version `v0.2.1`, and MIT license;
`package.json` remains `private: true` and no npm publication is planned.

The internal repository has no configured remote. No remote, public
repository, push, release tag, package, or artifact publication was created as
part of this verification.

## 2026-07-27 v0.3.0 lock provenance acceptance

This checkpoint was run on branch `codex/lock-provenance` from feature commit
`b4da88f` before adding this record. The complete `pnpm verify` gate passed with
49 test files and 1,272 tests, followed by schema generation, type checking,
ESLint, the production build, and a 168-file public audit with zero findings.
The production build retained only the known non-blocking Vite advisory for
the approximately 1.33 MB application chunk.

The live Skill/runtime contract reported application version `0.3.0`,
capability contract v2, and SceneSpec, ScenePatch, and IntentReport v3. Its
canonical entity lock modes were exactly `none`, `workflow`, and `user`; the
Patch policy fields were exactly `preserveLock`; and the lock error codes were
`USER_LOCKED`, `WORKFLOW_LOCKED`, and `LOCK_PRESERVATION_CONFLICT`.

The generic browser acceptance scene was `scene_lock_acceptance`. Its revision
sequence was:

```text
1 generic connected-region scene submitted with editable entities
2 two generic props changed to workflow locks by an explicit Patch
3 preserveLock correction moved prop_generic_1 by +0.25 m on world X
4 prop_generic_2 changed to a user lock by an explicit Patch
5 explicit save checkpoint changed the remaining camera to a workflow lock
```

At revision 3, both workflow locks were preserved without an unlock operation
or authorization prompt. The correction changed only
`prop_generic_1.transform.positionM` from `[0, 0.6, -0.65]` to
`[0.25, 0.6, -0.65]`. At revision 4, a second `preserveLock: true` translation
against the user-protected prop failed with `USER_LOCKED` and a non-zero exit.
The scene remained at revision 4, the user lock remained `user`, and the prop
position remained `[4, 0.5, 0.65]`.

The real browser was inspected at 1280 x 720. Overview, Local Alpha, Local
Beta, and Shot Preview all rendered. Local previews retained an opaque focused
region with readable faded neighbors; Shot Preview removed editor fading and
showed both generic props through the connected regions. Workflow and user
lock labels were distinct, and transform controls were disabled for both lock
modes. The save checkpoint advanced exactly once from revision 4 to 5, kept
the user-protected prop unchanged, changed only the remaining `none` camera to
`workflow`, and reported `scene_lock_acceptance.scene.json`. A repeated save
of the fully locked revision did not advance the revision.

The browser automation backend did not expose a blob download event or a host
download path for the scene JSON, so the downloaded file itself was not
available for independent browser-artifact inspection. The authoritative
revision transition, post-save lock modes, repeated-save stability, and UI
success notice were verified directly.

Deterministic composition inspection at revision 5 passed framing, topology,
and camera-collision checks. Its conservative proxy kept occlusion at `CHECK`
with an approximate 35.1% overlap, so the rendered final camera was reviewed
instead of promoting the report to `SAFE`. Both generic props were visibly
distinct and inside frame, the connected openings remained readable, and no
prop crossed the output boundary.

With that exact browser Shot Preview connected at revision 5, CLI export
produced `.shubi-shot/exports/lock-preservation.png` with:

- 1920 x 1080 decoded dimensions;
- 55,153 bytes;
- SHA-256
  `1b1f89dffcbdf7403afd216086724e1bac179d592b7235909ba18dd3c65d96f9`;
- no export warnings.

The exported PNG was inspected at full resolution and matched the accepted
final-camera preview. All scene submissions and exports remained under the
ignored `.shubi-shot` directory; no transient artifact is part of the tracked
source.

## 2026-07-27 v0.4.0 actor limb presence acceptance

This checkpoint was run on branch `codex/lock-provenance` from feature commit
`324a8b1` before adding this record. The Skill validator passed. The complete
`pnpm verify` gate passed with 55 test files and 1,451 tests, followed by
schema generation, type checking, ESLint, the production build, and a
181-file public audit with zero findings. The production build retained only
the known non-blocking Vite advisory for the approximately 1.34 MB application
chunk.

The live Skill/runtime contract reported application version `0.4.0`,
capability contract v2, and SceneSpec, ScenePatch, and IntentReport v4. It
reported feature `actor.limb-presence`, the twelve canonical arm and leg part
IDs, presence modes `present` and `absent`, and error code
`LIMB_HIERARCHY_CONFLICT`. The lock contract remained the three canonical
modes `none`, `workflow`, and `user` with Patch field `preserveLock`. The
bridge remained structured-only and loopback-only with no model or credential
integration. An owned incompatible older bridge was stopped safely through
the wrapper before the compatible v0.4.0 bridge started; the regression is
covered by the 1,451-test verifier.

The generic acceptance scene was `scene_generic_limb_1`. Its revision sequence
was:

```text
6  connected scene submitted with all twelve limbs present
7  actor changed to workflow lock by an explicit Patch
8  preserveLock Patch removed the right arm and both lower legs and feet
9  actor changed to user lock by an explicit Patch
10 undo restored workflow lock
11 redo restored user lock
12 undo restored workflow lock
13 explicit save changed the remaining prop and camera to workflow locks
14 saved schema-v4 scene loaded after an owned bridge restart
15 preserveLock Patch restored the left lower leg for history testing
16 undo restored the saved missing-limb state
17 redo restored the left lower leg
18 final undo restored the target missing-limb state
```

The revision 7 to 8 workflow correction required no authorization prompt and
contained no explicit unlock operation. The actor remained `workflow`; the
minimal transition changed only the seven canonical limb fields implied by
the hierarchy plus deterministic actor Y contact. A contradictory request for
an absent right upper arm with a present right hand failed with
`LIMB_HIERARCHY_CONFLICT` and left revision 8 unchanged. After the explicit
user lock at revision 9, a `preserveLock: true` limb request failed with
`USER_LOCKED`; the before and after scene hashes were both
`61d56bee970ff6705bc42bf6ff6f0ce0f12e469c3ecae9ba474cb9eb262405c7`.

The saved scene used schema version 4 at revision 13. The actor, prop, and
camera were all `workflow` locked, and the canonical limb map retained the
complete left arm and both upper legs while the right arm, both lower legs,
and both feet were absent. Its SHA-256 was
`c72597d2c4f319d31bf5fa51ec3733bb079932be5c627c57869aa5b9f14a651f`.
Restart and load retained that exact map. The revision 15 restore changed the
left lower leg to present and adjusted actor Y from `0.4816` m to `0.8858` m;
undo and redo restored the exact anatomy, contact transform, and workflow lock
while advancing revisions monotonically.

The real in-app browser was inspected at 1280 x 720. Overview rendered both
connected regions, their shared opening, the actor, and the prop readably.
Local Beta showed no detached right hand, detached feet, or phantom support.
The actor Inspector exposed exactly twelve presence controls in four labeled
groups: left arm, right arm, left leg, and right leg. Every control matched the
current SceneSpec, was disabled while workflow locked, and displayed the text
`流程锁定，无法编辑`. Shot Preview at revision 18 showed the right arm and both
lower legs and feet absent, deterministic contact at the visible upper-leg
end, no bottom crop, and the connected opening and prop still readable. Save
and export controls remained reachable and the browser reported the revision
as synchronized.

Composition inspection at revision 18 passed anchor, full-actor framing,
occlusion, topology, and camera-collision checks. Caption safety was correctly
unchecked because no caption target was configured; approximate framing and
occlusion remained subject to the completed visual review. Export from that
connected Shot Preview produced `.shubi-shot/exports/actor-limb-presence.png`
with:

- scene ID `scene_generic_limb_1`, revision 18;
- 1920 x 1080 IHDR dimensions and PNG signature `89504e470d0a1a0a`;
- 70,944 bytes;
- SHA-256
  `bea62f49b3c3b8077a91fb233d37730395fcdbb0e036f80d0583c448e51f2982`;
- no export warnings.

The exported PNG was inspected at full resolution and matched the accepted
revision 18 Shot Preview. All submission, saved-scene, and export artifacts
remained generic and ignored under `.shubi-shot`; none is part of the tracked
source.

## 2026-07-28 actor-relative left/right correction

The humanoid projection now follows its declared facing direction consistently:
actors face local `+Z`, so anatomical left is local `+X` and anatomical right
is local `-X`. Shoulder and hip placement use that convention, and the paired
Z-rotation signs in every built-in pose were corrected with it so arms and legs
continue to bend away from the torso on their anatomical sides.

The generic browser acceptance reused `scene_generic_limb_1`. At revision 19,
a diagnostic rotation presented the actor front-on to the existing shot camera
without changing its limb map, camera, or workflow lock. The Inspector showed
all three left-arm parts as `present`, all three right-arm parts as `absent`,
both lower legs and feet as `absent`, and every control disabled by the
workflow lock. Shot Preview showed the only remaining arm on viewer right,
which is the actor's anatomical left in a front-facing view. No browser warning
or error was reported.

Export from that connected Shot Preview produced
`.shubi-shot/exports/actor-side-correction.png` with:

- scene ID `scene_generic_limb_1`, revision 19;
- 1920 x 1080 IHDR dimensions and PNG signature `89504e470d0a1a0a`;
- 75,111 bytes;
- SHA-256
  `06811337bfc7a815e20e3b68ed2b0db6ccc9b65755707533485f2631a5b0b774`;
- no export warnings.

The full-resolution export matched the accepted Shot Preview. A final undo
advanced the scene to revision 20 while restoring actor rotation to identity;
the workflow lock, limb presence map, and camera remained unchanged. The
diagnostic Patch and PNG stayed transient under the ignored `.shubi-shot`
directory and were removed after evidence collection.

## 2026-07-28 direct Shot Preview camera navigation acceptance

This checkpoint was completed on branch `codex/lock-provenance`. The direct
camera feature commits were `e6fc781`, `887d8b5`, `97d80a9`, `66e1f47`, and
`246bc61`. Real-browser acceptance exposed a passive React wheel-listener
error; commit `4c21655` replaced that path with an explicitly non-passive
native listener and added a regression contract.

The complete `pnpm verify` gate then passed with 59 test files and 1,490 tests,
followed by schema generation, type checking, ESLint, the production build,
and a 191-file public audit with zero findings. The build retained only the
known non-blocking Vite advisory for the approximately 1.35 MB application
chunk. Director doctor reported application v0.4.0, capability contract v2,
SceneSpec/ScenePatch/IntentReport v4, `structured-only`,
`credential-forbidden`, and `loopback-only`. The repository Skill contract
tests passed; the optional generic Python Skill validator was not run because
the available Python environment did not include PyYAML, and no dependency
was installed for this acceptance.

The in-app browser at 1440 x 900 verified the page identity, nonblank WebGL
canvas, synchronized scene state, empty application warning/error log, and
the active Shot Preview controls. Its direct interaction record included:

```text
30 -> 31  left drag; position changed, rotation/lens/lock exact
31 -> 32  normal wheel; focal length 26.0 -> 26.5 mm
32 -> 33  modifier-wheel probe; control layer delivered a normal step
33 -> 34  inverse probe; focal length returned to 26.5 mm
34 -> 35  ArrowUp
35 -> 36  ArrowDown
36 -> 37  ArrowLeft
37 -> 38  ArrowRight
38 -> 39  PageUp
39 -> 40  PageDown
40 -> 41  Shift+ArrowUp; 0.5 m
41 -> 42  Alt+ArrowDown; 0.02 m
42 -> 43  undo
43 -> 44  redo
```

The in-app control layer could not synthesize a right-button drag or pass
modifiers through a wheel event, so installed Playwright 1.56 Chromium was
used only to supplement those missing input capabilities. The post-fix
supplemental run used 1440 x 900 and 800 x 720 viewports and recorded:

```text
57         inactive ArrowUp and active Escape; no revision
57 -> 58  external Patch during left-drag; draft cancelled, camera unchanged
58 -> 59  right-drag orbit; radius 5.992162351775484 m before and after
59 -> 60  normal wheel; -0.5 mm
60 -> 61  Shift+wheel; +2.0 mm
61 -> 62  Alt+wheel; -0.1 mm
62 -> 63  explicit user protection
63         pointer, wheel, and keyboard attempts; no revision or camera change
63 -> 64  explicit workflow-lock restoration
64 -> 65  atomic final-camera transform/lens correction
```

Every accepted camera gesture created one revision and one undo step. The
workflow lock remained `workflow` without an unlock revision or authorization
prompt. The external revision cancelled the stale draft and kept the eligible
mode active. User protection exited and disabled the mode, and protected input
created neither a draft nor a Patch. At 800 x 720 the fixed-size camera control
and focal readout remained inside the viewport and did not overlap the preview
mode switcher. After the listener fix, the repeated wheel run produced no
passive-listener errors; headless Chromium reported only environment-level
software-WebGL and readback performance warnings.

The final generic scene was `scene_generic_limb_1` revision 65. The camera was
still workflow locked at 26.5 mm. Composition inspection reported every
required section passing: anchor, full-actor framing, approximate occlusion,
topology, and camera collision. Overall status remained `CHECK` only because
no optional caption target was configured. The connected Shot Preview and the
full-resolution export were inspected together and matched.

Export from that exact connected revision produced
`.shubi-shot/exports/shot-camera-navigation.png` with:

- scene ID `scene_generic_limb_1`, revision 65;
- 1920 x 1080 IHDR dimensions and PNG signature `89504e470d0a1a0a`;
- 67,219 bytes;
- SHA-256
  `f32b3aa157f70e034a6fff302dec67acd4693335d613700080fb6a73918abf08`;
- no export warnings.

All Playwright scripts, patches, screenshots, and exports used generic data in
the ignored `.shubi-shot` directory and were removed after evidence capture.

## 2026-07-28 always-on Shot Preview controls acceptance

This follow-up removed the hidden camera-control activation state and added a
six-button movement pad while retaining the existing pointer, wheel, keyboard,
lock-preservation, and undo paths. The complete `pnpm verify` gate passed with
60 test files and 1,503 tests, followed by schema generation, TypeScript,
ESLint, the production build, and a 197-file public audit with zero findings.
The production build retained only the known non-blocking Vite advisory for
the approximately 1.35 MB application chunk. `director doctor` again confirmed
application v0.4.0, capability contract v2, schema v4, `structured-only`,
`credential-forbidden`, and `loopback-only`.

The in-app browser verified the current generic scene at the default desktop
viewport and at 800 x 900. Shot Preview exposed all six enabled movement
buttons immediately after opening, with no activation toggle. The buttons,
83.5 mm readout, preview label, and mode switcher did not overlap at either
viewport, and the application warning/error log remained empty.

The focused interaction record was:

```text
116 -> 117  forward movement button; position changed
117 -> 118  ArrowRight while the button retained focus; position changed
118         right-click on the camera surface; no context menu
118 -> 119  wheel; focal length 83.5 -> 84.0 mm
119 -> 120  undo wheel
120 -> 121  undo keyboard movement
121 -> 122  undo movement-button click
```

The three undo operations restored the exact pre-acceptance camera transform
and 83.5 mm focal length. The restored position was
`[0.11528559961414596, 7.191705214524558, -0.0053269027436609745]`, rotation
remained exact, and `lockMode` remained `none`. The scene revision advanced to
122 because authoritative undo is revisioned; no scene file was saved or
overwritten during this acceptance.

## 2026-07-28 protected Shot Preview control recovery acceptance

Commit `d326d3d` clarifies why direct controls are unavailable on a
user-protected final camera and suppresses the right-button context menu before
the protection guard can short-circuit pointer handling. The protected Shot
Preview now keeps the six movement buttons visible, identifies the protection
state, and provides an explicit `解除保护并调整` action. The action uses the
existing user-lock transition path; it does not weaken the user-lock boundary
or silently mutate a protected camera.

The regression was developed test-first. The focused UI contract test failed
on the missing early right-button suppression and missing in-preview unlock
wiring, then passed after the implementation. The complete `pnpm verify` gate
passed with 60 test files and 1,506 tests, followed by schema generation,
TypeScript, ESLint, the production build, and a 198-file public audit with zero
findings. The build retained only the known non-blocking Vite advisory for the
approximately 1.36 MB application chunk.

The in-app browser verified the running source worktree at the default desktop
viewport and at 800 x 900. With the camera user protected, all six movement
buttons remained visible and disabled, the in-preview unlock action remained
enabled, and a right click on the camera surface produced no host context menu.
The compact control group measured 367 x 69 pixels inside a 776 x 436.5 pixel
Shot Preview with no horizontal page overflow. No application warning or error
was reported.

After the explicit in-preview unlock action, all six movement buttons became
enabled. A movement-button round trip advanced revisions 134 -> 135 -> 136,
and a keyboard round trip advanced revisions 136 -> 137 -> 138 while restoring
the starting camera state. A final compact protection/unlock check advanced
revisions 138 -> 139 -> 140 and left the camera unlocked for handoff. No scene
file was saved or overwritten during this acceptance.

## 2026-07-29 parallel scene workspace acceptance

This checkpoint was completed on the isolated
`codex/parallel-scene-workspaces` branch. The two-workspace real-process
checkpoint is commit `e7eb66c`, followed by the stale-list attribution fix in
`f4efbcd`; no merge, push, release, or primary-checkout change was performed.

The complete `pnpm verify` gate passed with 64 test files and 1,539 tests,
followed by schema generation, TypeScript, ESLint, the production build, and a
207-file public audit with zero findings. The build retained only the known
non-blocking Vite advisory for the approximately 1.36 MB application chunk.
The official generic Skill validator also passed. Director doctor reported
application v0.5.0, capability contract v2, bridge protocol v1, workspace
routing v1, and SceneSpec/ScenePatch/IntentReport v4. It also confirmed the
`bridge.thread-workspaces`, `structured-only`, `credential-forbidden`, and
`loopback-only` contracts.

Two generic conversation workspaces were allocated concurrently:

```text
workspace_98496f3ab8d6be40295d4fcca9423b3f  127.0.0.1:4319
workspace_3f4a2ed073484bd9ea85f5b8a7ac02df  127.0.0.1:4318
```

They started with distinct bridge instance IDs and independent runtime
directories. The first workspace received `scene_connected_regions_1`; the
second received `scene_quickstart_1`. Each structured scene submission
advanced only its target workspace to revision 1, and each one-operation
output Patch advanced only its target workspace to revision 2. The automated
real-process isolation test additionally submitted, snapshotted, patched, and
stopped two disposable workspaces while auditing stdout, stderr, descriptors,
runtime files, and inputs for raw conversation identifiers. No identifier leak
or path escape was found.

An independent forward review then identified a recovery-list edge case: a
stopped workspace could inherit live metadata if another workspace later
reused its old port. The fix prevents `starting` and `stopped` descriptors from
probing ports and accepts live `ready` health only when both the bridge instance
ID and exact loopback URL match the descriptor. Regression coverage includes
stopped port reuse, unavailable health, instance mismatch, URL mismatch, and
the exact-match positive case. The focused registry/wrapper/real-process gate
passed with 3 test files and 15 tests, and the final independent review passed.

The in-app browser inspected both loopback pages at 1280 x 720. Both Overview
and Shot Preview rendered, their visible scene IDs and revisions matched their
own snapshots, and browser warning/error logs were empty. On the connected
regions workspace:

```text
2 -> 3  forward movement button; X -5.40 -> -5.30 m
3 -> 4  ArrowRight; Z 0.00 -> 0.10 m
4 -> 5  wheel delivery probe
5 -> 6  focused wheel/right-button interaction; no host context menu
```

The accepted wheel probe changed focal length from 28.0 to 28.5 mm. Throughout
those interactions the quick-start workspace stayed at revision 2 with camera
position `[4.2, 2.2, 5.8]` and 45 mm focal length. This proved that browser
editing in one conversation did not refresh or mutate the other.

### Main integration and release gate

After the isolated branch was fast-forwarded into `main`, the complete gate
was rerun from the integrated checkout. An existing local scene exposed that
the real-process workspace test had shared the checkout's live routing
directory. The test now creates a disposable runtime root, and its cleanup is
contained there. It no longer claims, stops, or writes routing metadata beside
an existing user scene.

Full-suite process pressure also showed that the former one-second health
probe could report a running loopback bridge as unavailable. A delayed-health
regression now covers that condition, and health probes allow a five-second
response window while connection-refused failures still return immediately.
The direct server preflight test has a separate 15-second process-start budget.

The final integrated `pnpm verify` gate passed with 64 test files and 1,540
tests. TypeScript, ESLint, the production build, and the 207-file public audit
also passed with zero findings. The build retained only the known non-blocking
Vite large-chunk advisory.

Connected Shot Preview exports produced:

- `.shubi-shot/exports/workspace-a.png`: `scene_connected_regions_1`,
  revision 6, 1920 x 1080, 73,295 bytes, SHA-256
  `979945dedcd4969640c7281c897fbd8e3848a13b4ddeb965ee6d44d84b589500`;
- `.shubi-shot/exports/workspace-b.png`: `scene_quickstart_1`, revision 2,
  1920 x 1080, 115,316 bytes, SHA-256
  `1eb2444a18487c6e906a0a73b2ea61d0d7ccb5b31d16de56f7103859b0c9e567`.

Both PNG signatures, IHDR dimensions, returned hashes, and visible scene
content matched. The images were clearly distinct and not cross-routed. Each
export reported only `ACTIVE_CAMERA_UNLOCKED`, which was expected because the
generic acceptance cameras intentionally remained editable.

Stopping the connected-regions workspace returned `stopped: true`. The
quick-start workspace remained ready on the same port and instance at
revision 2. Restarting the stopped workspace reused its route, created a new
bridge instance, and restored `scene_connected_regions_1` revision 6 with the
same camera transform. A final browser reload showed both expected scene
IDs/revisions and empty warning/error logs.
