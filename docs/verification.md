# Verification and known boundaries

Shubi Shot Director is accepted feature-by-feature in the real local browser,
not only through schema or unit tests. This document is the repeatable Stage F
checklist for the first usable graybox workflow.

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
