# Actor Limb Presence Design

**Status:** Approved in conversation on 2026-07-27.

**Scope:** Add generic, persistent `present`/`absent` state for canonical
humanoid limb segments so a graybox actor can accurately omit asymmetric arms,
lower legs, hands, or feet without introducing project-specific character data
or production asset systems.

## Goal

Let Host Codex create and revise a generic graybox actor whose visible anatomy
matches an explicitly supplied body configuration.

The first release supports existence only. It does not model injuries,
prosthetics, replacement meshes, sockets, materials, scars, animation, or
project-specific character systems.

A representative generic result is an actor with the complete right arm chain
absent and both lower-leg chains absent. The SceneSpec, browser viewport,
contact solver, composition report, saved scene, and PNG export must all agree
on that same anatomy.

## Product boundary

This change includes:

- twelve canonical left/right limb segments;
- exactly two states, `present` and `absent`;
- deterministic parent/child hierarchy rules;
- canonical SceneSpec persistence and legacy migration;
- one allowlisted ScenePatch operation for minimal limb edits;
- lock-aware atomic mutation and history behavior;
- graybox rendering with no detached downstream parts;
- contact and composition bounds derived from visible anatomy;
- non-specialist editor controls;
- Host-authored IntentReport evidence and Skill guidance;
- generic black-box browser and export verification.

This change does not include:

- prostheses, replacement parts, mechanical limbs, sockets, or custom meshes;
- face, torso, pelvis, or head removal;
- arbitrary skeletons, rig import, skinning, IK, animation, or physics;
- per-limb materials, colors, dimensions, damage states, or attachment points;
- character names, private profile content, story data, or production assets;
- a general-purpose digital-human or modular-character system.

## Considered representations

### Selected: explicit canonical presence map

Each actor stores a complete map under `body.limbPresence`:

```ts
type ActorLimbPresenceMode = "present" | "absent";

type ActorLimbPresence = {
  upper_arm_l: ActorLimbPresenceMode;
  forearm_l: ActorLimbPresenceMode;
  hand_l: ActorLimbPresenceMode;
  upper_arm_r: ActorLimbPresenceMode;
  forearm_r: ActorLimbPresenceMode;
  hand_r: ActorLimbPresenceMode;
  upper_leg_l: ActorLimbPresenceMode;
  lower_leg_l: ActorLimbPresenceMode;
  foot_l: ActorLimbPresenceMode;
  upper_leg_r: ActorLimbPresenceMode;
  lower_leg_r: ActorLimbPresenceMode;
  foot_r: ActorLimbPresenceMode;
};
```

The full map is required in canonical data. This makes saved state explicit,
keeps generated schemas self-describing, and prevents omission from meaning
different things in creation, migration, rendering, and patching.

### Rejected: absent-parts list

An `absentParts` array is compact, but every consumer must infer that omitted
parts are present. It also makes partial updates and generated schema guidance
less explicit.

### Rejected: limb segments as child entities

Independent entities would make future mesh replacement flexible, but they
would expand selection, locks, transforms, history, contact, and composition
into a modular-character system. That is outside the graybox-previs boundary.

## Canonical limb hierarchy

The limb chains are:

```text
upper_arm_l -> forearm_l -> hand_l
upper_arm_r -> forearm_r -> hand_r
upper_leg_l -> lower_leg_l -> foot_l
upper_leg_r -> lower_leg_r -> foot_r
```

Canonical SceneSpec state must obey both rules:

1. an absent parent requires every downstream segment to be absent;
2. a present child requires every upstream segment to be present.

Therefore an entire right arm absence is represented as:

```json
{
  "upper_arm_r": "absent",
  "forearm_r": "absent",
  "hand_r": "absent"
}
```

Both lower legs absent means `lower_leg_l`, `foot_l`, `lower_leg_r`, and
`foot_r` are absent. Feet cannot remain detached from absent lower legs.

Unknown part IDs, missing canonical keys, additional keys, and contradictory
canonical maps are rejected.

## Authority and privacy boundary

Host Codex remains the sole semantic authority.

Host Codex may resolve a user-supplied external character profile in host
memory and translate it into the generic canonical limb map. It must not pass
the profile path, profile content, aliases, character names, source wording,
or private identifiers to the Director runtime.

The runtime only validates the structured map, applies deterministic hierarchy
rules, mutates a cloned SceneSpec, re-solves deterministic effects, validates
the result, and commits one revision.

Repository examples, tests, screenshots, logs, scenes, and exports use generic
actor slots and generic body configurations only.

## SceneSpec v4

`SCENE_SCHEMA_VERSION` becomes `4`.

The actor body becomes:

```ts
body: {
  heightM: number;
  shoulderWidthM: number;
  build: "slim" | "average" | "broad";
  limbPresence: ActorLimbPresence;
};
```

New actors default every canonical part to `present`. Host Codex then authors
explicit absences required by the request before submitting the complete
SceneSpec.

Limb state is persistent scene authority. It is not a pose parameter, preset
parameter, UI selection state, render-only flag, or external profile value.

## Legacy migration

SceneSpec v1, v2, and v3 remain loadable. Every migrated actor receives the
complete all-present canonical map. Migration preserves existing geometry and
does not inspect labels, aliases, profile data, poses, colors, or source text.

Migration alone does not increment revision, create history, or overwrite a
user scene file. The next accepted mutation or explicit save serializes
canonical v4.

ScenePatch v1, v2, and v3 migrate to v4 without adding limb operations.
IntentReport v1, v2, and v3 migrate to v4 without inventing limb constraints.
Existing lock migrations and Patch operation indexes remain stable.

## ScenePatch v4

`PATCH_SCHEMA_VERSION` becomes `4`.

Add one allowlisted operation:

```ts
{
  op: "actor.limb-presence.set";
  actorId: EntityId;
  updates: Partial<ActorLimbPresence>;
}
```

`updates` must contain one to twelve known part IDs and no unknown keys. The
target must be an actor.

The runtime applies all explicit updates together and then computes one
deterministic hierarchy closure:

- explicitly making a parent absent makes all descendants absent;
- explicitly making a child present makes all ancestors present;
- making a parent present does not automatically restore absent descendants;
- making a child absent does not alter its ancestors;
- explicitly requesting an absent parent and present descendant in the same
  operation returns `LIMB_HIERARCHY_CONFLICT`.

Examples:

```json
{
  "op": "actor.limb-presence.set",
  "actorId": "actor_generic_1",
  "updates": {
    "upper_arm_r": "absent",
    "lower_leg_l": "absent",
    "lower_leg_r": "absent"
  }
}
```

The accepted result also marks the right forearm, right hand, and both feet
absent through the documented deterministic closure.

The operation participates in normal atomic Patch behavior. One Patch creates
one revision and one undo entry. Any schema, hierarchy, lock, contact, final
validation, or persistence failure leaves scene, revision, history, and saved
state unchanged.

## Lock behavior

Limb presence belongs to the actor entity and uses the existing entity lock
policy:

- `none`: manual and Host-authored limb edits are allowed;
- `workflow`: an ordinary Host-authored correction uses `preserveLock: true`
  and retains the workflow lock without asking the user;
- `user`: the edit returns `USER_LOCKED` unless the user explicitly authorizes
  the existing atomic unlock, modify, and relock sequence.

The limb operation cannot bypass a user lock through hierarchy closure,
contact adjustment, or `preserveLock: true`.

## Shared anatomy model

Create one domain-owned anatomy module containing:

- canonical part IDs and modes;
- parent/child chains;
- the all-present default map;
- strict hierarchy validation and Patch closure;
- the body-relative dimensions currently duplicated in renderer calculations;
- helpers for determining whether a segment is visible.

Three.js rendering, contact bounds, composition bounds, UI labels, schemas,
and tests must import this shared contract rather than keeping separate limb
lists or dimension ratios.

## Rendering

The mannequin renderer conditionally renders each chain segment:

- an absent upper arm removes its shoulder proxy, upper arm, forearm, and hand;
- a present upper arm with absent forearm renders only the shoulder and upper
  arm;
- an absent upper leg removes its hip proxy, upper leg, lower leg, and foot;
- a present upper leg with absent lower leg renders the upper leg but no lower
  leg or foot;
- an absent hand or foot removes only that terminal primitive.

Rendered stumps use the existing rounded capsule end. This release does not add
special cap meshes, wound detail, sockets, or replacement geometry.

Selection highlighting, Overview, Local preview, Shot Preview, and PNG export
must all use the same conditional renderer.

## Contact and visible bounds

The current fixed full-humanoid assumptions are insufficient once lower limbs
can be absent. Add a pure visible-rig-bounds helper that evaluates the existing
pose hierarchy, canonical dimensions, actor scale, and limb presence.

The helper returns approximate visible bounds and support height for the
actually rendered mannequin. It includes torso, pelvis, head, and every
present limb segment and terminal.

Deterministic contact behavior becomes:

- all-present actors retain the existing accepted contact result;
- after a limb-presence Patch, any enabled actor ground or support contact is
  re-solved in the same transaction;
- if one complete leg remains, that visible leg determines standing support;
- if both lower legs are absent, visible upper-leg ends can contact the support;
- if both complete leg chains are absent, the lowest remaining visible body
  geometry determines contact;
- the runtime never creates phantom feet or uses absent parts as support.

If contact enforcement would directly or indirectly move a user-locked entity,
the entire Patch fails with `USER_LOCKED` and no mutation.

Composition safety uses the same visible bounds for full-body framing,
actor/prop proxy occlusion, and camera collision estimates. Face, head, chest,
pelvis, and root anchors remain available because this release does not remove
those body regions.

## Manual editor behavior

Add a focused actor-limb control section to the Inspector. It groups controls
as left arm, right arm, left leg, and right leg and labels each canonical
segment with text, not color alone.

Each control displays `Present` or `Absent` and submits one
`actor.limb-presence.set` Patch. Turning off a parent visibly updates all
downstream controls after the accepted scene revision arrives.

When an ancestor is absent, descendant controls remain visible but disabled
with a concise explanation. The user restores the upstream segment first, then
chooses which descendants to restore. Manual controls are disabled for both
workflow- and user-locked actors, matching transform and pose controls.

The UI never stores a separate draft anatomy map after a server response. The
accepted SceneSpec revision remains authoritative.

## IntentReport v4

`INTENT_REPORT_SCHEMA_VERSION` becomes `4`.

Add the recognized constraint kind:

```text
actor-limb-presence
```

Create evidence may point to canonical fields such as:

```text
entity.body.limbPresence.upper_arm_r
entity.body.limbPresence.lower_leg_l
```

Modify evidence may point to the exact `actor.limb-presence.set` operation and
affected actor target. Coverage checks require every requested generic absence
or restoration to have valid structured evidence.

A request for a prosthesis, replacement mesh, mechanical limb, or custom asset
is not silently reduced to `present` or `absent`. Host Codex reports the
unsupported requirement through the existing structured unsupported path.

## Capability and compatibility contract

The capability-contract shape remains v2 because semantic authority,
structured-only input, credential policy, and loopback-only networking do not
change.

Capabilities advertise:

- SceneSpec v4, ScenePatch v4, and IntentReport v4;
- feature `actor.limb-presence`;
- the exact twelve canonical part IDs;
- presence modes exactly `present` and `absent`;
- error code `LIMB_HIERARCHY_CONFLICT`.

`doctor` must reject a runtime that lacks these fields before the Skill sends a
v4 scene or Patch. It must not fall back to hidden props, zero scale, detached
child entities, or render-only flags.

## Persistence, history, and export

Persistence stores the canonical v4 limb map. Save, load, restart, undo, redo,
scene replacement, and history traversal retain exact part states.

Background persistence does not change anatomy. Explicit save keeps the
existing workflow-lock checkpoint behavior and then serializes the accepted v4
scene.

PNG export remains side-effect free and requires an open connected Shot
Preview at the exact scene ID and revision. The exported mannequin must match
the visible anatomy in Shot Preview.

## Skill workflow

The Skill and its focused references must tell Host Codex to:

1. resolve any explicitly supplied private profile in host memory only;
2. translate the required anatomy into canonical generic part states;
3. author complete v4 create state or one minimal v4 limb Patch;
4. use `preserveLock: true` for ordinary workflow-locked corrections;
5. stop and ask before changing a user-locked actor;
6. reject unsupported replacement-part requirements instead of degrading them;
7. inspect the real mannequin in Overview, affected Local previews, and Shot
   Preview before claiming visual success;
8. verify contact, framing, visible anatomy, revision, persistence, and export;
9. keep private names and source wording out of all runtime and repository
   artifacts.

## Error model

Add stable generic errors:

- `ACTOR_LIMB_TARGET_INVALID`: the target does not exist or is not an actor;
- `LIMB_HIERARCHY_CONFLICT`: one operation explicitly requests contradictory
  parent and descendant states.

Unknown keys and missing canonical create fields remain schema-validation
errors. Existing `USER_LOCKED`, `WORKFLOW_LOCKED`,
`LOCK_PRESERVATION_CONFLICT`, stale revision, intent coverage, and atomic
rollback behavior continue to apply.

Errors include generic actor IDs and canonical part IDs only. They never
include private aliases, profile data, or source wording.

## Verification strategy

### Schema and migration tests

- canonical v4 accepts exactly the twelve parts and two modes;
- canonical v4 rejects missing, extra, or unknown part keys;
- canonical v4 rejects detached present descendants;
- SceneSpec v1, v2, and v3 actors migrate to all-present v4;
- ScenePatch and IntentReport v1-v3 migrate without invented limb changes;
- generated schemas expose the exact map and Patch operation;
- capabilities expose the exact parts, modes, feature, and error code.

### Domain and history tests

- removing an upper arm cascades to forearm and hand;
- removing a lower leg cascades to its foot;
- restoring a child restores required ancestors;
- explicit absent-parent and present-child updates fail atomically;
- wrong-kind and missing targets fail without mutation;
- one accepted operation creates one revision and one undo entry;
- undo and redo restore exact anatomy and deterministic contact;
- workflow locks preserve anatomy changes under `preserveLock: true`;
- user locks reject direct and indirect limb effects without mutation.

### Geometry, contact, and composition tests

- all-present visible bounds match the existing accepted humanoid bounds;
- absent parts do not contribute to visible bounds or occlusion proxies;
- a single remaining full leg provides standing support;
- bilateral lower-leg absence places visible upper-leg ends on the support;
- bilateral full-leg absence uses the lowest remaining visible body geometry;
- a limb edit re-solves enabled contact in the same accepted revision;
- full-body framing uses actual visible anatomy rather than phantom limbs.

### UI tests

- all twelve controls render in four readable groups;
- parent absence updates and disables downstream controls;
- controls reflect authoritative revisions rather than stale drafts;
- workflow and user locks disable limb controls;
- errors are generic and actionable;
- existing transform, pose, save, and export controls remain reachable.

### Skill and black-box tests

Use only a generic actor fixture:

1. create an all-present actor and verify legacy visual parity;
2. submit one generic Patch that removes a complete right arm chain and both
   lower-leg chains;
3. require the same scene ID, revision exactly plus one, and only anatomy plus
   deterministic contact changes;
4. inspect Overview, affected Local preview, and final Shot Preview;
5. verify no detached hand or feet, no phantom support, and correct framing;
6. save, reload, undo, and redo the anatomy;
7. export 1920 x 1080 PNG and verify scene ID, revision, dimensions, SHA-256,
   warnings, and visual parity;
8. repeat against workflow- and user-locked actors;
9. require public-output audits with zero private or project-specific data.

The updated Skill also receives a fresh-agent application test: given only a
generic anatomy request, the agent must select the structured v4 route, author
canonical limb states, avoid hidden geometry workarounds, and report
replacement-part requests as unsupported.

## Acceptance criteria

This feature is complete only when:

- canonical scene state represents all twelve limb segments explicitly;
- old scenes retain their existing all-present appearance;
- no accepted scene can contain a detached present descendant;
- create, Patch, UI, persistence, history, composition, and export agree on the
  same anatomy;
- absent parts do not render or affect support and composition calculations;
- limb edits remain atomic and obey workflow/user lock provenance;
- unsupported replacement-part requirements are reported honestly;
- the editor remains usable by a non-specialist;
- generated schemas, focused tests, full verification, real-browser visual QA,
  PNG inspection, and public-output audit all pass;
- no private character or profile data enters tracked or runtime artifacts.

## Release shape

This is a canonical-schema addition and should ship as the next minor public
release, provisionally `v0.4.0`, while retaining capability-contract v2.

Implementation should land in stable checkpoints:

1. canonical limb types, schema v4, migrations, generated schemas, and
   capabilities;
2. atomic limb Patch behavior, intent coverage, errors, locks, and history;
3. shared anatomy dimensions, conditional rendering, visible bounds, contact,
   and composition;
4. editor controls and manual Patch construction;
5. Skill guidance, generic examples, browser/export acceptance, public audit,
   and release verification.
