# Generic Connected Multi-Region Scenes Design

**Status:** Approved in conversation on 2026-07-26.

**Scope:** Add a minimum viable, generic connected-region layout to Shubi Shot
Director without turning it into a level editor. The Host Codex model remains
the only semantic authority. The Director runtime gains deterministic spatial
records, validation, rendering, revisioned patches, overview/local viewing, and
compatibility migration for existing single-room scenes.

## Goal

Allow one `SceneSpec` to contain a complete same-floor arrangement of multiple
connected spatial regions, wall boundaries, openings, entity placements, and
cameras. A user can inspect the whole arrangement, focus one region, continue
editing entities and cameras, save and reload the scene, inspect composition,
and export the active perspective camera.

The schema must not contain built-in residential or project-specific meanings.
Names such as living room, corridor, entry, apartment, kitchen, or any private
project term are authored only by Host Codex when interpreting a user request.
Runtime schemas, fixtures, examples, diagnostics, and UI behavior use generic
region identifiers and labels.

## Product boundary

This change includes:

- one horizontal floor plane per scene layout;
- arbitrary simple polygon region footprints;
- straight wall boundary segments with thickness and height;
- rectangular openings cut into wall boundaries;
- explicit region adjacency, passage, and sight relationships through openings;
- optional region membership for actors, props, and cameras;
- persistent visibility for regions and boundaries;
- overview, local-focus, and active-shot views;
- existing entity/camera editing, history, save/load, composition inspection,
  and browser-rendered PNG export;
- explicit migration and compatibility for SceneSpec v1 and ScenePatch v1.

This change does not include:

- hard-coded room or environment types;
- stacked floors, stairs, ramps, vertical portals, or voids;
- navigation meshes, pathfinding, gameplay collision, or AI movement;
- level streaming, LOD, culling systems, or remote collaboration;
- arbitrary curved walls, boolean solid modeling, or a general mesh editor;
- door animation, production assets, ShotSet, animation authoring, or final
  image generation;
- freehand wall dragging or a full floor-plan authoring UI.

Host Codex authors complete layouts and minimal layout patches from natural
language. The browser UI inspects, focuses, and renders the layout while
preserving the existing direct transform and camera controls.

## Authority and data flow

Host Codex is the sole semantic authority:

1. interpret the user's spatial description;
2. decide how many generic regions are required and what they mean;
3. author region footprints, boundaries, openings, connections, memberships,
   object transforms, persistent visibility, and cameras;
4. produce a strict `IntentReport` plus complete `SceneSpec` or minimal
   `ScenePatch`.

The Director runtime performs no language interpretation. It:

1. parses a structured submission;
2. migrates supported legacy structured versions;
3. validates geometry, references, topology, coverage, and revision;
4. mutates the authoritative `SceneSession` atomically;
5. projects the accepted scene into editor, overview, local, and shot views;
6. saves, loads, inspects, and exports the accepted revision.

Raw user wording, aliases, profile content, credentials, models, and endpoints
remain outside the Director contract.

## SceneSpec v2

`SCENE_SCHEMA_VERSION` becomes `2`. SceneSpec v2 retains the existing scene
metadata, entities, constraints, output, and composition goals, and adds:

```ts
interface SpatialLayout {
  floorY: number;
  regions: SpatialRegion[];
  boundaries: SpatialBoundary[];
  openings: SpatialOpening[];
  connections: SpatialConnection[];
  memberships: EntityRegionMembership[];
}

interface SpatialRegion {
  id: EntityId;
  label: string;
  footprintXZ: Array<[number, number]>;
  heightM: number;
  visible: boolean;
}

interface SpatialBoundary {
  id: EntityId;
  label: string;
  regionIds: [EntityId] | [EntityId, EntityId];
  startXZ: [number, number];
  endXZ: [number, number];
  heightM: number;
  thicknessM: number;
  visible: boolean;
}

interface SpatialOpening {
  id: EntityId;
  label: string;
  boundaryId: EntityId;
  offsetM: number;
  widthM: number;
  bottomM: number;
  heightM: number;
  visible: boolean;
}

interface SpatialConnection {
  id: EntityId;
  label: string;
  regionIds: [EntityId, EntityId];
  openingId: EntityId;
  allowsPassage: boolean;
  allowsSight: boolean;
  enabled: boolean;
}

interface EntityRegionMembership {
  entityId: EntityId;
  regionId: EntityId;
}
```

`SceneSpec.spatialLayout` is nullable:

- `null` is the canonical v2 compatibility form for an existing single-room
  environment scene. Existing environment entities, contacts, rendering, and
  controls keep their current behavior.
- a non-null layout is connected-region mode. It contains at least one region,
  uses the layout to render floors and walls, and forbids environment entities
  so two enclosure systems cannot overlap.

This is an explicit compatibility mode, not a room-type enum. New connected
layouts contain no `environment` entity. Existing generic actors, props, and
cameras remain ordinary scene entities and keep stable IDs and transforms.

Membership is organizational and controls local-focus presentation. It does not
rewrite an entity transform and does not claim geometric containment. Each
entity has at most one membership; unassigned entities remain visible context
in overview and local editor modes. Region and boundary visibility is
persistent. Local-focus fading is UI state only and never changes saved
visibility.

## Deterministic spatial validation

The runtime accepts only layouts that satisfy all of these rules:

- region IDs, boundary IDs, opening IDs, connection IDs, entity IDs, and
  constraint IDs are unique in their relevant namespaces;
- every footprint contains 3 to 32 finite XZ points, has non-zero area, has no
  self-intersection, and is consistently normalized;
- every boundary has distinct finite endpoints, positive height and thickness,
  and references one or two existing distinct regions;
- each boundary endpoint lies on every referenced region footprint edge within
  a documented numeric tolerance;
- every opening references an existing visible or hidden boundary, has positive
  dimensions, fits within that boundary's length and height, and does not
  overlap another opening on the same boundary;
- every connection references two distinct existing regions plus one existing
  opening whose boundary references the same two regions;
- each membership references one existing region and one actor, prop, or camera
  entity, and no entity has two memberships;
- connected-region mode contains no legacy environment entity;
- legacy single-room mode contains no spatial records;
- camera, constraint, composition-goal, and entity invariants continue to pass.

Validation is deterministic and reports stable generic error codes. The runtime
does not infer missing walls, close polygon gaps, guess adjacency, select a room
type, or repair semantic intent.

## ScenePatch v2

`PATCH_SCHEMA_VERSION` becomes `2`. Existing entity, camera, constraint, output,
composition, and title operations remain valid. Add only allowlisted spatial
operations:

- `spatial.region.upsert`
- `spatial.region.remove`
- `spatial.region.visibility.set`
- `spatial.boundary.upsert`
- `spatial.boundary.remove`
- `spatial.boundary.visibility.set`
- `spatial.opening.upsert`
- `spatial.opening.remove`
- `spatial.connection.upsert`
- `spatial.connection.remove`
- `spatial.membership.set`
- `spatial.membership.remove`

All operations apply to a cloned scene and the complete result is validated
once before commit. Removing a referenced record fails rather than cascading.
Host Codex must explicitly remove or update dependent records in the same
atomic patch. No arbitrary JSON-path operation and no whole-scene replacement
is introduced for follow-up edits.

## IntentReport v2

`INTENT_REPORT_SCHEMA_VERSION` becomes `2`. Add generic constraint kinds:

- `spatial-region`
- `spatial-boundary`
- `spatial-opening`
- `spatial-connection`
- `entity-region-membership`
- `region-visibility`

Coverage validation accepts spatial patch-operation evidence and allowlisted
SceneSpec spatial-property evidence. It checks only internal agreement between
the Host's report and structured payload. It does not determine whether a
generic region should semantically be a particular real-world room.

Natural-language creation continues to require `allowPartial: false`. Patch
submissions remain atomic and revision-bound.

## Compatibility and migration

The runtime stores only canonical SceneSpec v2 in `SceneSession`.

### SceneSpec v1

Every supported create, submit, load, and browser file-load route first parses a
v1 or v2 structured document:

- a valid v1 scene is migrated by setting `schemaVersion: 2` and
  `spatialLayout: null`;
- all scene IDs, entity IDs, transforms, constraints, active camera, output,
  composition goals, and revision values are preserved;
- the accepted session and later saved files use v2;
- no region semantics are fabricated for a legacy environment.

### ScenePatch v1

A v1 patch is accepted only for the operation subset already defined in v1. It
is migrated by setting `schemaVersion: 2`; its operations and revision target
are preserved. Spatial operations require v2.

### IntentReport v1

Legacy direct structured operations continue without semantic claims. A legacy
v1 submission may be migrated only when its payload contains no v2 spatial
claim. New connected-layout submissions require IntentReport v2.

The capability contract remains contract version 2 and publishes scene, patch,
and intent schema version 2. The semantic, credential, and loopback-only
boundary fields remain unchanged.

## Rendering and spatial analysis

A focused spatial module owns all reusable derived geometry:

- normalized region polygons and combined layout bounds;
- boundary direction, length, midpoint, and quaternion;
- wall boxes split above, below, and beside each opening;
- region adjacency and graph distance;
- point-in-region and membership lookup;
- boundary collision volumes and sightline segments excluding open spans.

The Three.js projection uses:

- triangulated `ShapeGeometry` floors for visible regions;
- primitive wall box segments around visible openings;
- a neutral gray palette with generic per-region editor accents;
- stable meshes derived from SceneSpec, never saved Three.js state.

Composition inspection reuses the derived boundary volumes:

- sightlines crossing a solid wall segment fail topology;
- sightlines passing through an opening with an enabled
  `allowsSight: true` connection remain clear;
- a camera inside a solid boundary fails camera collision;
- legacy room analysis remains unchanged when `spatialLayout` is null.

Approximation warnings remain honest where proxy volumes cannot prove a visual
result.

## Browser interaction design

The existing viewport workspace becomes one maximum-size display with view
tabs:

1. **Overview** shows the complete layout with an editor camera fitted to all
   visible region bounds.
2. **Local** shows an editor camera fitted to the selected region. The focused
   region is fully opaque, directly connected regions are faded, and more
   distant regions are further muted. This fading is editor-only.
3. **Shot Preview** shows the existing active perspective camera using exact
   persistent visibility and remains the source of PNG export.

The shot view remains mounted and revision-connected even while another tab is
visible, so CLI export never substitutes a software approximation. Switching
tabs is UI state and does not increment revision.

The outliner adds a generic Spatial section:

- regions are selectable focus targets;
- boundaries and their openings are inspectable under each region;
- actors, props, and cameras remain normal editable entities;
- selecting a region enters Local view without mutating SceneSpec;
- selecting an entity preserves current transform, pose, contact, and camera
  controls.

The inspector shows read-only spatial dimensions, connection flags, and
membership for MVP. Natural-language Host patches author topology changes.
Direct manipulation remains limited to existing entity and camera transforms;
the feature does not become a wall-drawing level editor.

Single-room compatibility scenes show Overview and Shot Preview and keep all
existing entity/camera controls, history, save/load, and export. Local is
disabled because no stored region was invented.

## Save, load, history, and export

- `SceneSession` remains the only persistent authority.
- Every accepted spatial patch increments the current revision exactly once.
- Undo and redo include the complete spatial layout with the same global
  monotonic revision rules.
- Save writes canonical SceneSpec v2.
- Load accepts valid v1 and v2, migrates before mutation, and preserves the
  last accepted scene on failure.
- Browser file load uses the same parser and migration as CLI/server routes.
- Export remains locked to the open browser Shot Preview at the exact scene ID
  and revision.
- Overview and Local are inspection/editing views and are never export
  substitutes.

## Skill and public documentation

Update the project-local Skill and references so Host Codex can author:

- complete generic connected-region SceneSpec v2 submissions;
- minimal spatial ScenePatch v2 submissions;
- generic IntentReport v2 coverage;
- abstract region names and IDs only;
- no raw prompt or project-profile content in runtime files.

Replace the current connected-environments "unsupported" guidance with exact
generic authoring rules. Keep explicit unsupported guidance for vertical
layouts, curved solids, navigation, and other non-MVP requests.

Add one committed generic structured example using abstract names such as
`region_alpha`, `region_beta`, and `region_gamma`. Do not use residential,
project-specific, or proprietary labels.

## Error handling

Schema and domain failures use stable generic codes and mutate nothing:

- invalid polygon or boundary geometry;
- boundary not aligned with its referenced region;
- opening outside a boundary or overlapping another opening;
- connection/region/opening reference mismatch;
- duplicate or invalid membership;
- environment/spatial mode conflict;
- stale revision;
- incomplete intent coverage;
- missing connected Shot Preview for export.

The UI maps these failures to concise Chinese messages without echoing raw
submissions. Failed browser loads leave the current scene and focus state
intact.

## Test strategy

### Unit and schema tests

- accept a complete three-region same-floor SceneSpec v2;
- reject self-intersecting regions, invalid boundaries, overlapping openings,
  mismatched connections, duplicate memberships, and environment/layout
  conflicts;
- migrate a representative SceneSpec v1 without changing its functional data;
- migrate supported ScenePatch v1 operations;
- accept and apply every spatial Patch operation;
- reject dependency-breaking removal atomically;
- preserve revision, undo, redo, save, and load invariants;
- verify wall splitting, graph adjacency, layout bounds, point-in-region,
  opening sightlines, wall collisions, and camera collisions.

### UI and rendering tests

- Overview, Local, and Shot tabs select the expected projection;
- local focus derives opacity by connection distance without changing
  SceneSpec;
- region selection updates UI focus without revision mutation;
- existing entity transform and camera controls work in a multi-region scene;
- legacy single-room scenes retain their entity/camera workflow;
- Shot Preview stays connected for export while another tab is visible.

### Boundary and security tests

- capability contract publishes schema versions 2 with the existing host-only,
  structured-only, credential-forbidden, and loopback-only guarantees;
- runtime and Skill do not contain room-type dictionaries or project labels;
- public audit rejects raw prompts, private terms, credentials, paths, and
  unsupported semantic runtime inputs;
- generated schemas and copied Skill runtime remain synchronized.

### Real black-box acceptance

Run a new abstract submission through the real public flow:

`doctor -> ensure -> scene submit -> snapshot -> browser Overview -> Local
focus -> entity transform edit -> Shot Preview -> composition inspect -> save
-> load -> export png -> stop`

The scene contains at least three abstract regions, shared boundaries, two
openings, explicit connections, generic props/actor/cameras, and no room-type
or private labels. Acceptance requires:

- the combined layout is visibly complete in Overview;
- Local focuses one region and retains faded connected context;
- entity editing increments revision once;
- save/load preserve the layout and active camera;
- composition inspection distinguishes a clear opening sightline from a solid
  wall crossing;
- browser export returns the exact accepted scene ID/revision, valid dimensions,
  SHA-256, and no blocking warning;
- final overview/local screenshots and the exported perspective image are
  shown to the user.

## Acceptance criteria

- One SceneSpec can represent and render multiple connected generic regions.
- No runtime or Skill dictionary hard-codes real-world room or apartment types.
- Host Codex remains the only semantic planner.
- Regions, wall boundaries, openings, connections, memberships, persistent
  visibility, entities, and cameras are structurally validated.
- Overview, Local, and Shot Preview work from one authoritative revision.
- Existing entity and camera editing remains available.
- Save, load, undo, redo, composition inspection, and browser export work for a
  connected layout.
- Existing single-room SceneSpec v1 scenes remain usable through explicit
  migration and compatibility behavior.
- The runtime remains structured-only, credential-forbidden, and
  loopback-only.
- No navigation, LOD, streaming, complex level editing, or unrelated engine
  scope is introduced.
- Full verification and the real abstract black-box flow pass, and the final
  visual result is shown.
