# Lock Provenance and Atomic Preservation Design

**Status:** Approved in conversation on 2026-07-27.

**Scope:** Replace the ambiguous entity `locked` boolean with explicit lock
provenance, let ordinary Skill-authored corrections pass through workflow
locks without asking the user, preserve those locks atomically, and continue
to require user confirmation before changing an explicitly user-protected
entity.

## Goal

Make lock behavior match the user's intent instead of treating every lock as a
permanent prohibition.

An unfinished graybox remains editable. After visual acceptance or an explicit
user-facing save, the workflow may protect completed entities against
accidental manual editing. If a later inspection finds a problem, Host Codex
can submit one correction Patch that preserves those workflow locks without
asking the user to authorize a temporary unlock.

Only a lock created from an explicit user protection request blocks Host Codex
and requires a new confirmation.

The expected user-visible result is:

1. Host Codex inspects a generic connected scene and finds a framing problem.
2. The affected generic props are workflow-locked.
3. Host Codex authors one minimal Patch with `preserveLock: true`.
4. The runtime applies the correction and restores the exact workflow-lock
   state in one transaction.
5. The scene advances by one revision, one undo reverses the whole correction,
   and no user authorization is requested.

## Product boundary

This change includes:

- explicit `none`, `workflow`, and `user` entity lock modes;
- deterministic migration of existing scene and Patch versions;
- an explicit top-level `preserveLock` Patch policy;
- atomic workflow-lock bypass and preservation;
- distinct errors for workflow and user locks;
- Skill guidance for when to ask the user;
- workflow locking after successful visual acceptance or explicit save;
- UI labels that distinguish workflow protection from user protection;
- tests for direct edits, indirect constraint effects, history, persistence,
  migration, generated schemas, and black-box Skill behavior.

This change does not include:

- accounts, roles, access-control lists, authentication, or collaboration
  permissions;
- per-property locks;
- expiring locks, remote leases, or distributed concurrency;
- arbitrary lock-owner strings;
- semantic interpretation inside the runtime;
- hidden lock mutation during background persistence;
- final image generation, production assets, or project-specific scene data.

## Considered representations

### Selected: one lock-mode enum

Each entity has exactly one canonical mode:

```ts
type EntityLockMode = "none" | "workflow" | "user";
```

This representation cannot express contradictory states and makes migration,
validation, rendering, and error handling straightforward.

### Rejected: `userLock` and `workflowLock` booleans

Two booleans use the requested concepts directly, but they can both become
`true`. Every parser, migration, Patch, and UI path would need precedence and
repair rules for an invalid state.

### Rejected: `locked` plus `lockOwner`

This is superficially backward-compatible but duplicates state. Values such as
`locked: false` with `lockOwner: "user"` are ambiguous and require additional
normalization.

## Authority boundary

Host Codex remains the sole semantic authority.

Host Codex decides:

- whether the user explicitly requested protection;
- whether a lock is a user lock or workflow lock;
- when visual acceptance has completed;
- which entities are complete enough to receive workflow locks;
- whether a user has approved changing a user-locked entity;
- the complete `IntentReport` and minimal structured Patch.

The Director runtime decides no language meaning. It only:

- parses and migrates structured data;
- enforces lock-mode and Patch-policy invariants;
- applies operations to a working clone;
- permits workflow-lock bypass when explicitly requested by
  `preserveLock: true`;
- rejects unauthorized structured transitions involving user locks;
- validates the complete result;
- commits one revision and one history entry;
- persists and returns the accepted canonical state.

Raw prompts, project aliases, profile data, credentials, model configuration,
and private scene details remain outside the runtime and repository.

## SceneSpec v3

`SCENE_SCHEMA_VERSION` becomes `3`.

The shared entity shape replaces:

```ts
locked: boolean;
```

with:

```ts
lockMode: "none" | "workflow" | "user";
```

The field is required in canonical v3 SceneSpec data. There is no second
`locked`, `userLock`, `workflowLock`, owner, or override field.

Lock meanings are:

- `none`: the entity is unfinished or intentionally editable;
- `workflow`: the Skill or editor workflow protected a completed checkpoint,
  but a structured correction may temporarily bypass the guard;
- `user`: the user explicitly protected the entity, so Host Codex must ask
  before authoring a change that affects it.

Locks remain part of `SceneSpec`, because they affect deterministic editor and
Patch behavior. They are not UI-only state.

## Legacy SceneSpec migration

SceneSpec v1 and v2 remain loadable. Migration produces canonical v3 data:

| Legacy value | Canonical v3 value |
| --- | --- |
| `locked: false` | `lockMode: "none"` |
| `locked: true` | `lockMode: "workflow"` |

All legacy true locks become workflow locks. The old format recorded no
provenance, and treating every old lock as a user lock would preserve the
failure mode this release exists to fix. The migration keeps the entity
protected against ordinary manual editing while allowing a future
`preserveLock: true` structured correction to proceed and restore the lock.

The migration does not inspect labels, presets, project aliases, operation
wording, or history. It is deterministic and generic.

Loaded legacy scenes are held in memory and saved only as canonical v3.
Migration alone does not increment the scene revision or create a history
entry.

## ScenePatch v3

`PATCH_SCHEMA_VERSION` becomes `3`.

Every canonical Patch includes a required top-level field:

```ts
preserveLock: boolean;
```

ScenePatch v3 raises the operation limit from 128 to 256. SceneSpec already
allows 256 entities, and an explicit save must be able to convert every
unlocked entity to `workflow` in one Patch, one revision, and one undo step.

The semantics are explicit:

- `true`: preserve all pre-existing lock modes and allow mutations guarded
  only by `workflow` locks;
- `false`: retain strict lock enforcement and permit explicit lock-mode
  operations where valid.

Host Codex uses `preserveLock: true` for ordinary natural-language corrections
that do not intentionally change lock policy. Manual editor transform, lens,
pose, and relationship Patches use `false`; the UI continues to require a
manual unlock before those edits.

Legacy v1 and v2 Patches migrate with `preserveLock: false`, preserving their
previous strict behavior. The Skill authors new natural-language edits as
canonical v3 rather than relying on migration defaults.

## Lock-mode operation

The existing `entity.flags.set` operation becomes a partial, at-least-one-field
operation:

```ts
{
  op: "entity.flags.set";
  entityId: EntityId;
  visible?: boolean;
  lockMode?: "none" | "workflow" | "user";
}
```

This preserves a one-to-one migration for legacy `entity.flags.set`
operations:

```ts
{
  op: "entity.flags.set";
  entityId;
  visible;
  lockMode: locked ? "workflow" : "none";
}
```

Keeping the operation index stable also preserves `IntentReport`
`patch-operation` evidence indexes during migration. New authors may update
visibility without restating or changing the lock mode.

With `preserveLock: true`:

- `entity.flags.set` may update visibility;
- it may repeat the entity's existing `lockMode`;
- it may not change `lockMode`;
- it may not remove a pre-existing workflow- or user-locked entity;
- newly added entities must use `lockMode: "none"`.

An intentional lock-policy transition uses `preserveLock: false`.

## Atomic workflow-lock preservation

`preserveLock: true` is a transaction policy, not three public Patch
operations.

The runtime:

1. validates the Patch schema, scene ID, and exact base revision;
2. clones the current SceneSpec;
3. records the lock mode of every existing entity;
4. applies the Patch to the clone using a lock guard that permits workflow
   locks but still rejects user locks;
5. applies deterministic contact and relationship effects under the same
   guard;
6. verifies that every surviving pre-existing entity has its original lock
   mode and that no locked pre-existing entity was removed;
7. validates the complete SceneSpec;
8. sets revision to `baseRevision + 1`;
9. commits one history entry and emits one scene-change event.

The implementation need not write a temporary `none` value into the working
SceneSpec. It may model “unlock, modify, restore” as a scoped workflow-lock
bypass, provided the observable state and failure behavior match this
contract.

If any operation, indirect constraint adjustment, final validation, or
postcondition fails, the working clone is discarded. The authoritative scene,
revision, history, persistence file, and lock modes remain unchanged.

One undo restores the complete pre-Patch scene. One redo reapplies the complete
post-Patch scene. Temporary bypass state never appears in undo/redo history,
snapshots, events, logs, or saved files.

## User-lock behavior

A user lock is created only from an explicit user action or explicit Host Codex
interpretation of a protection request such as “protect this entity” or “do
not change this entity.”

When an ordinary Patch would directly or indirectly change a user-locked
entity:

1. the runtime rejects the Patch with `USER_LOCKED`;
2. the scene and revision remain unchanged;
3. Host Codex identifies the generic affected entity and asks the user for
   confirmation;
4. Host Codex does not retry by merely changing `preserveLock`.

After the user confirms, Host Codex may author one atomic
`preserveLock: false` Patch containing:

1. an explicit `entity.flags.set` transition away from `user`;
2. the approved modifications;
3. an explicit transition back to `user` when the protection should remain.

Because the runtime applies operations sequentially to a clone, no intermediate
unlock becomes authoritative. If the approved Patch fails, the original user
lock remains.

The runtime cannot inspect conversation history. The Skill is responsible for
asking before authoring the explicit user-lock transition. The structured
unlock operation is the runtime-visible proof that Host Codex intentionally
authored a lock-policy change; `preserveLock` alone can never bypass a user
lock.

## Workflow-lock lifecycle

### New and unfinished scenes

New graybox entities default to `lockMode: "none"`. Host Codex does not lock
actors, props, cameras, or environment entities merely because it created
them.

An explicit user protection request may still create `lockMode: "user"` at
scene creation.

### Visual acceptance

After the required overview, local, final-camera, and composition checks
succeed, Host Codex may submit a separate `preserveLock: false` Patch that sets
the accepted entities to `workflow`.

Visual acceptance is a Host Codex workflow decision. The runtime never infers
acceptance from render completion, composition status, or export success.

### Explicit save

An explicit user-facing save or finalize action follows this sequence:

1. snapshot the exact current scene and revision;
2. submit one workflow-lock Patch that changes every existing `none` entity to
   `workflow`, while leaving existing `workflow` and `user` modes unchanged;
3. verify the accepted revision and lock modes;
4. serialize or download that accepted SceneSpec.

The low-level serializer remains side-effect free. The `scene save` wrapper and
browser Save action orchestrate the explicit lock Patch before writing the
file; they do not mutate locks inside serialization.

### Background persistence

Automatic persistence after a committed scene change is not a user-facing
save or acceptance event. It writes the current canonical SceneSpec exactly as
it exists and never adds, removes, or changes locks.

This distinction prevents an unfinished graybox from becoming workflow-locked
immediately after its first edit.

## Manual editor behavior

The editor displays the three modes distinctly:

- no badge for `none`;
- a generic “Workflow locked” badge for `workflow`;
- a generic “User protected” badge for `user`.

Manual transform, lens, pose, and preset controls remain disabled for either
locked mode.

The existing manual lock control behaves as an explicit user action:

- locking an entity sets `user`;
- unlocking a workflow- or user-locked entity sets `none`;
- the operation uses `preserveLock: false`.

The UI does not silently convert a user lock to a workflow lock. Exact labels
and styling remain an implementation detail, but the two meanings must be
readable without color alone.

## IntentReport v3

`INTENT_REPORT_SCHEMA_VERSION` becomes `3`.

Add the generic recognized constraint kind:

```text
lock-protection
```

Replace the entity evidence path:

```text
entity.locked
```

with:

```text
entity.lockMode
```

Legacy IntentReport v1 and v2 input migrates deterministically. Existing
`entity.locked` evidence becomes `entity.lockMode`; existing patch-operation
indexes remain valid because Patch operation migration is one-to-one.

The maximum `patch-operation.operationIndex` becomes 255 so every operation in
a 256-operation ScenePatch can be referenced without splitting the
transaction.

A user-requested lock or unlock uses `lock-protection` evidence. Workflow-only
preservation is primarily Patch policy and does not claim that the user
requested a protection constraint.

## Error model

Add stable generic errors:

- `USER_LOCKED`: a direct or indirect mutation reached a user-protected entity;
- `WORKFLOW_LOCKED`: a Patch with `preserveLock: false` reached a
  workflow-locked entity without first changing its mode;
- `LOCK_PRESERVATION_CONFLICT`: a `preserveLock: true` Patch attempted to
  change a lock mode, remove a locked entity, add a pre-locked entity, or
  otherwise violated the preservation postcondition.

`ENTITY_LOCKED` remains accepted as a legacy external error mapping during the
compatibility window, but canonical v3 domain paths emit the more specific
codes.

Errors contain only generic entity IDs and stable messages. They do not include
raw prompts, labels from private profiles, project names, or credentials.

## Capability and compatibility contract

The bridge capability-contract shape remains v2 because semantic authority,
structured-only input, credential policy, and loopback-only networking do not
change.

Capabilities advertise SceneSpec v3, ScenePatch v3, IntentReport v3, the
`preserveLock` Patch property, the `entity.lockMode` values, and the specific
lock error codes.

`doctor` must reject a live runtime that lacks any of those required
capabilities before a v3 submission is forwarded. The Skill must not silently
fall back to explicit unlock operations for workflow locks when connected to
an older runtime.

Direct `scene create --file` and `patch apply --file` continue to accept
supported legacy structured versions through deterministic migration. New
natural-language work uses host-authored v3 submission envelopes.

## Persistence and export

Scene persistence stores canonical v3 only. A migration is written on the next
ordinary committed persistence event or explicit save; loading alone does not
overwrite a user file.

PNG export does not change lock state. Export still requires the open browser
Shot Preview at the exact current scene ID and revision. Lock preservation
does not weaken visual QA, composition inspection, revision verification,
dimension checks, SHA-256 verification, or generic warning reporting.

## Skill workflow changes

The Skill instructions and references must state:

- unfinished graybox entities default to `none`;
- successful visual acceptance may create workflow locks;
- explicit save locks through a separate structured Patch before
  serialization;
- every ordinary natural-language correction that should retain lock policy
  uses `preserveLock: true`;
- workflow locks never require user authorization;
- user locks always require authorization before Host Codex authors an
  explicit lock transition;
- a `USER_LOCKED` response is a stop-and-ask condition;
- a `WORKFLOW_LOCKED` response means the Patch policy was authored
  incorrectly and should be recomputed from a fresh snapshot;
- stale Patches are discarded and re-authored rather than having only their
  base revision changed.

All documentation and examples use generic actors, props, environments,
cameras, regions, and IDs. No motivating private scene wording or asset names
enter the public repository.

## Verification strategy

### Schema and migration tests

- canonical SceneSpec v3 accepts exactly the three lock modes;
- canonical SceneSpec v3 rejects missing or unknown lock modes;
- v1/v2 `locked: false` migrates to `none`;
- v1/v2 `locked: true` migrates to `workflow`;
- canonical Patch v3 requires `preserveLock`;
- canonical Patch v3 accepts up to 256 operations and rejects 257;
- v1/v2 Patches migrate with `preserveLock: false`;
- legacy `entity.flags.set` migrates one-to-one and keeps operation indexes;
- IntentReport evidence migrates from `entity.locked` to
  `entity.lockMode`;
- IntentReport accepts patch-operation indexes through 255;
- generated schemas match runtime schemas and capabilities.

### Atomic domain tests

- a transform Patch with `preserveLock: true` changes a workflow-locked entity
  and leaves it workflow-locked;
- pose, lens, preset, look-at, visibility, and relationship operations follow
  the same policy;
- deterministic contact enforcement may adjust a workflow-locked entity under
  the same transaction;
- a user-locked direct target returns `USER_LOCKED`;
- an indirect contact or relationship effect on a user-locked entity also
  returns `USER_LOCKED`;
- a strict Patch reaching a workflow lock returns `WORKFLOW_LOCKED`;
- preservation rejects lock-mode changes and locked-entity removal;
- failure after one successful operation commits no partial data;
- successful preservation increments revision exactly once;
- one undo and redo cover the whole accepted correction.

### Session and persistence tests

- failed preservation emits no change event and writes no new persistence
  state;
- successful preservation emits one change event and one persistence write;
- background persistence does not create locks;
- explicit save submits and verifies a workflow-lock Patch before writing the
  canonical v3 file;
- load, save, undo, redo, and process restart retain exact lock modes.

### UI tests

- workflow and user modes have distinct text labels;
- both modes disable ordinary manual manipulation;
- the manual lock action creates a user lock;
- explicit unlock creates `none`;
- save waits for the workflow-lock Patch before downloading;
- a failed lock Patch prevents download and shows a generic actionable error.

### Skill and black-box tests

Use a generic connected-region fixture with generic props and camera:

1. create an unfinished scene with all editable entities unlocked;
2. complete visual checks and apply workflow locks;
3. submit a generic composition correction with `preserveLock: true`;
4. verify that no explicit unlock operations were authored;
5. verify the same scene ID, revision exactly plus one, requested transform
   changes only, and unchanged workflow lock modes;
6. inspect the actual browser final-camera preview and composition report;
7. export and verify scene ID, revision, dimensions, hash, and warnings;
8. repeat against a user-locked target and require `USER_LOCKED` with no
   mutation;
9. run the public-output audit to prove that fixtures, logs, screenshots, and
   exports remain generic.

## Acceptance criteria

This feature is complete only when all of the following are true:

- the canonical scene can distinguish unlocked, workflow-locked, and
  user-locked entities without contradictory states;
- old true locks migrate to workflow locks;
- unfinished grayboxes do not receive automatic locks;
- background persistence never changes lock state;
- explicit save changes every existing unlocked entity to a workflow lock
  before serialization, while successful visual acceptance may lock only its
  accepted subset;
- an ordinary natural-language correction passes through workflow locks
  without asking the user;
- the correction preserves exact lock modes, commits one revision, and creates
  one undo step;
- any failure leaves scene, revision, history, persistence, and locks
  unchanged;
- user locks cannot be bypassed by `preserveLock`;
- Host Codex must obtain user confirmation before authoring an explicit
  user-lock transition;
- capability checks prevent the new Skill from using an incompatible runtime;
- generated schemas, tests, builds, browser interaction, final-camera visual
  QA, and public-output audit all pass.

## Release shape

This is a backward-readable but canonical-schema-breaking feature and should
ship as the next minor public release, provisionally `v0.3.0`.

Implementation should land in stable checkpoints:

1. schemas, migrations, generated references, and capability advertisement;
2. atomic domain enforcement and error mapping;
3. session, persistence, save orchestration, and history verification;
4. editor lock labels and manual/save behavior;
5. Skill instructions, generic fixtures, black-box visual acceptance, and
   release verification.
