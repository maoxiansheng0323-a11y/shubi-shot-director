# Generic connected environments

Use this reference when a request contains multiple continuous regions,
structural boundaries, openings, or cross-region camera sightlines.

## Semantic authority stays in Host Codex

The Director has no room-type dictionary. Host Codex decides how many regions
the description requires, what each region means, how they are shaped, and
which labels are useful. Persist only generic IDs, labels, geometry, topology,
memberships, visibility, and camera state.

Never add runtime logic that maps words such as bedroom, corridor, stage, shop,
or cabin to fixed geometry. An explicitly supplied external profile may help
Host Codex interpret aliases, but its names and contents remain host-only.

## Choose one spatial mode

- Legacy single-room scene: set `spatialLayout` to `null` and keep the existing
  `environment` entity flow.
- Connected-region scene: set `spatialLayout` to a complete object and do not
  include any `environment` entity.

Both modes use the same actors, props, cameras, constraints, composition goals,
revision history, persistence, and export flow.

## Author a connected layout

`spatialLayout` contains:

- `floorY`: one shared floor elevation for the current MVP;
- `regions`: arbitrary simple XZ polygons with a height and persistent
  visibility;
- `boundaries`: one- or two-region structural segments with height, thickness,
  and visibility;
- `openings`: rectangular cuts measured from a boundary's start point;
- `connections`: explicit two-region topology associated with an opening;
- `memberships`: at most one region assignment per actor, prop, or camera.

IDs and labels describe identity only. Do not encode room semantics into
runtime-recognized enums or preset names.

Every boundary endpoint must lie on every referenced region footprint.
Shared-boundary and connection region IDs must be distinct. Openings must fit
inside their boundary and may not overlap. A connection's regions must exactly
match its opening boundary.

An opening removes rendered wall geometry whenever its own `visible` flag is
true. For deterministic safety checks, the opening clears camera collision only
when its enabled connection allows passage, and clears sightline occlusion only
when that connection allows sight. These flags record Host-authored intent;
they do not trigger language inference.

## Place objects and cameras

Use ordinary world-space entity transforms. Add memberships for every actor,
prop, and camera whose local-region preview behavior matters. Membership does
not parent or transform an entity.

Overview frames all visible region footprints. Local preview keeps the focused
region floor and members opaque, renders its boundaries translucent for
interior legibility, fades enabled adjacent regions to `0.34`, and fades more
distant regions to `0.12`. This is UI state only and must never be copied into
`SceneSpec`.

Shot Preview ignores local fading and uses only persistent visibility. Boundary
wall boxes are deterministically split around visible openings for WebGL,
software PNG, sightline checks, and camera collision checks.

## Current limits

The connected-layout MVP is one floor only. It does not provide stairs,
multi-level topology, navigation meshes, pathfinding, streaming, LOD, physics,
or a general level editor. Report those requirements as unsupported instead of
encoding them into labels or preset parameters.
