# Parallel Scene Workspaces Design

## Problem

Shubi Shot Director currently runs one authoritative `SceneSession` per bridge.
Every Codex conversation uses the same default loopback bridge at port 4317 and
the same `.shubi-shot/current.scene.json`. Separate scene files can be saved and
loaded sequentially, but two conversations cannot safely build different
scenes at the same time. A full scene submission from one conversation replaces
the other conversation's active scene, while incremental edits can fail with a
stale revision or target the wrong scene.

The goal is to let several Codex conversations build, inspect, revise, and
export different scenes concurrently without requiring the user to manage
ports, directories, or runtime processes.

## Decision

Add automatic thread-scoped scene workspaces at the Skill wrapper boundary.
Each Codex conversation resolves to one stable local workspace. Every workspace
owns:

- one authoritative `SceneSession`;
- one contained runtime directory;
- one loopback bridge on a unique port;
- one current scene and independent undo/redo history;
- one browser `uiUrl` and connected Shot Preview.

The runtime continues to hold exactly one `SceneSession`. Parallelism comes from
multiple isolated runtime instances rather than from changing `SceneSpec` into
a multi-scene container.

This preserves the existing authority model: `SceneSpec` remains the only
persistent state for one scene, and workspace routing metadata is operational
state only.

## Alternatives Considered

### Explicit workspace names

Require the host to supply a workspace name for every command. This is simple
to implement but makes the user and every Codex conversation responsible for
remembering setup details. Missing one option reconnects to the wrong scene.

### One bridge with many sessions

Store a map of `SceneSession` objects behind one port and add a workspace
selector to every API route, browser URL, export request, and persistence
operation. This avoids multiple ports but makes the server, UI, and protocol
substantially more complex. It also increases the chance that a missing
workspace selector mutates the wrong scene.

### Thread-scoped bridges

Use the host conversation identity only in the Skill wrapper to route commands
to an isolated bridge and runtime directory. This keeps each runtime simple,
matches the current process boundary, and makes accidental cross-scene mutation
structurally difficult. This is the selected approach.

## Workspace Identity

When `CODEX_THREAD_ID` is available, the wrapper derives a non-reversible
workspace ID from a versioned SHA-256 digest. The raw thread ID is never written
to disk, passed to the runtime, emitted in JSON, or included in logs.

Workspace IDs use a strict generic form:

```text
workspace_<32 lowercase hex characters>
```

The same thread resolves to the same workspace after restart. A different
thread resolves to a different workspace.

When the host does not expose a thread ID, the wrapper retains the legacy
single-workspace behavior. This keeps direct terminal use and non-Codex hosts
backward compatible.

## Local Routing State

Workspace data lives under the ignored repository runtime area:

```text
.shubi-shot/
  workspace-routing/
    bindings/
    workspaces/
      workspace_<digest>/
        bridge.json
        runtime/
          current.scene.json
```

Binding and bridge descriptor files contain only generic workspace IDs,
loopback ports, instance IDs, lifecycle status, and timestamps. They never
contain prompts, source wording, profile data, aliases, credentials, project
names, or scene contents.

All paths are constructed from validated workspace IDs and fixed contained
roots. The wrapper does not accept an arbitrary workspace directory.

## Port Allocation And Process Ownership

Workspace startup acquires one filesystem allocation lock under
`.shubi-shot/workspace-routing`. While holding the lock, it:

1. scans known workspace descriptors;
2. validates compatible live bridges by loopback health and instance ID;
3. prunes stale routing descriptors without deleting scene runtime data;
4. selects an unused port from a bounded loopback range beginning at 4317;
5. records a starting lease atomically;
6. starts the workspace bridge with the selected port and contained runtime
   directory;
7. validates its health before marking the descriptor ready.

If startup loses an external port race, it releases that lease and retries the
next candidate. A bounded retry returns `WORKSPACE_PORT_UNAVAILABLE` without
changing any scene.

`stop` targets only the current workspace and uses the existing safe shutdown
instance ID. It never kills a guessed PID or stops another conversation's
bridge.

## Legacy Scene Adoption

The existing `.shubi-shot/current.scene.json` and compatible port-4317 bridge
must not be moved or overwritten during installation.

After the feature is merged, the first thread-scoped invocation may atomically
claim the unclaimed legacy workspace. That binding continues using the legacy
runtime directory, preserving the active scene. Every later unbound thread gets
a new contained workspace.

Claiming is allowed only when the legacy workspace has no recorded owner.
There is no automatic copying between workspaces. Explicit scene save/load
remains the controlled way to transfer a scene.

## Skill Workflow

The normal user flow stays short:

1. Open a Codex conversation and request a scene.
2. The Skill runs `doctor`, resolves the conversation workspace, and runs
   `ensure`.
3. The returned `uiUrl` belongs only to that workspace.
4. Every later `snapshot`, submit, patch, save, undo, redo, inspect, and export
   command routes to the same workspace automatically.
5. Open another conversation and repeat; it receives another workspace without
   affecting the first.

Add read-only workspace inspection commands so the host can diagnose and resume
work safely:

```text
workspace current
workspace list
workspace attach --id <workspace-id>
```

`workspace attach` changes only the current thread's routing binding. It
requires a canonical existing workspace ID, validates the target bridge or
runtime state, and never copies or mutates a scene.

The Skill keeps the workspace ID in host context after `ensure`. If context is
compacted, the hashed thread binding restores the same route.

## Browser And Export Behavior

Each workspace returns a distinct loopback `uiUrl`, so several browser tabs can
show different scenes concurrently. Browser state remains a projection of that
workspace's exact scene ID and revision.

PNG export continues to require an open connected Shot Preview. The export
broker for workspace A cannot use a preview registered with workspace B because
the bridges, instance IDs, scene IDs, and ports are separate.

## Compatibility And Versioning

The feature is a minor release and advances the application and Skill version
to 0.5.0. SceneSpec, ScenePatch, and IntentReport remain schema version 4.

Capability contract v2 remains in place, but the runtime manifest adds a
canonical workspace-routing capability and version so the updated Skill rejects
an older runtime before attempting workspace mutations. Existing direct
structured scene and Patch commands remain supported.

The default port remains 4317 for legacy or first-workspace compatibility.
Network policy remains loopback-only, and the runtime still accepts no prompts,
profiles, credentials, model settings, or non-loopback routes.

## Failure And Concurrency Rules

- A missing or malformed host thread ID falls back to the documented legacy
  workspace; it never becomes a path or command argument.
- A corrupt binding or descriptor returns a stable routing error and leaves all
  scene files untouched.
- Two simultaneous first invocations serialize allocation through the routing
  lock and receive different workspaces and ports.
- A stale descriptor may be replaced only after health proves its bridge is no
  longer live.
- A scene revision conflict remains local to one workspace and follows the
  existing `STALE_REVISION` recovery rule.
- Workspace creation, attachment, and stopping never create SceneSpec revisions.
- No cleanup command deletes runtime directories or saved scene data.

## Testing

Unit and integration coverage must prove:

- stable hashing for one thread and different IDs for different threads;
- no raw thread ID in paths, descriptors, output, or logs;
- contained path construction and strict workspace ID validation;
- atomic allocation under simultaneous `ensure` calls;
- distinct ports and runtime directories for two thread IDs;
- same-thread restart and reattachment to the same scene;
- scene submission and Patch mutation in workspace A leave workspace B's scene,
  revision, locks, and history unchanged;
- stopping workspace A leaves workspace B healthy;
- legacy single-workspace fallback remains compatible;
- an existing legacy scene is adopted without copying or overwrite;
- browser previews and 1920 x 1080 exports return the matching workspace scene
  ID, revision, dimensions, hash, and warnings;
- public audit finds no private identifiers or machine-specific paths.

## Acceptance

With two independent Codex conversations active at the same time:

1. each conversation receives a different `uiUrl`, port, instance ID, runtime
   directory, scene ID, and revision history;
2. both can submit scenes and apply edits concurrently;
3. neither conversation observes or mutates the other scene;
4. both browser tabs render their own Overview, Local, and Shot Preview;
5. each workspace exports its own connected 1920 x 1080 PNG;
6. closing or stopping one workspace does not interrupt the other;
7. the main checkout and its currently running bridge remain untouched until
   the isolated branch is explicitly merged.
