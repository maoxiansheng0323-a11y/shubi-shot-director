# Shot Preview Context Menu and Wall Visibility Design

**Status:** Approved in conversation on 2026-07-28.

**Scope:** Prevent the embedded browser context menu from interrupting final
camera orbit gestures, and remove only the first solid wall segment that blocks
an outside final camera's center view in Shot Preview and PNG export.

## Goal

Keep direct final-camera adjustment usable at the room boundary. Right-drag
must remain an uninterrupted target-orbit gesture, and a camera placed outside
the visible room volumes must see into the scene without the nearest blocking
wall covering the shot.

The wall response is deliberately binary: the first blocking solid wall
segment disappears completely. No translucent outline remains in the final
shot.

## Product boundary

This change includes:

- context-menu suppression on the active Shot Preview camera surface;
- deterministic visible-room volume containment;
- center-ray intersection against rendered boundary wall segments;
- removal of exactly one first-hit wall segment while the camera is outside;
- live response to an uncommitted camera transform draft;
- identical Shot Preview and PNG export geometry;
- focused unit, UI-contract, browser, and export verification.

This change does not include:

- SceneSpec, ScenePatch, schema, persistence, or revision changes;
- saved wall visibility changes;
- automatic fading in Overview or Local preview;
- hiding props, actors, floors, ceilings, or more than one wall segment;
- collision response, camera clamping, portals, clipping planes, or a general
  occlusion system;
- topology or composition-safety rule changes.

## Considered approaches

### Selected: first solid wall hit by the final-camera center ray

Derive the same solid wall boxes already used for rendering after visible
openings have been subtracted. When the final camera is outside every visible
room volume, cast its center ray and omit the closest wall box with a positive
intersection distance.

This approach follows the shot direction, respects openings, hides only the
actual blocker, and is deterministic for preview and export.

### Rejected: hide the wall nearest to the camera

Distance alone can select a side or rear wall that is not in the shot. It also
behaves poorly near corners where two boundaries are almost equally close.

### Rejected: back-face rendering or broad wall transparency

Material-side rules and fading all exterior walls are inexpensive, but they
remove more scene structure than requested and can make interior walls or the
second room disappear unexpectedly.

## Context-menu behavior

The active camera-adjustment surface owns right-button interaction. Its
`contextmenu` handler always calls `preventDefault()` while adjustment mode is
active, independent of pointer capture and gesture references.

This fixes the event-order defect in which pointer-up clears the right-button
gesture before the embedded browser dispatches `contextmenu`. The surface has
no pointer events while adjustment mode is inactive, so normal browser context
menus outside the active surface remain unchanged.

Right-button pointer-down, movement, capture, pointer-up commit, pointer-cancel,
and revision handling keep their existing behavior. This change does not add a
global document-level context-menu listener.

## Outside-camera rule

A visible spatial region defines a closed room volume:

- horizontal extent is its `footprintXZ`, with points on the footprint edge
  counted as inside;
- vertical extent is from `layout.floorY` through
  `layout.floorY + region.heightM`, with both planes counted as inside.

The camera is outside only when its position is outside every visible region
volume. Hidden regions do not keep the camera in an interior state. If there
is no spatial layout or no visible region, automatic wall removal is disabled.

This full-volume rule covers both lateral exterior shots and cameras above the
room. A camera above the room only removes a wall when its actual center ray
intersects that wall.

## First-hit wall rule

The final-camera center ray starts at the active camera position and points
along camera-local negative Z after applying the active camera quaternion.

Eligible blockers are the wall boxes produced by `deriveBoundaryWallBoxes`
for visible boundaries. Because that function subtracts visible openings
before producing boxes, a center ray through a door or window opening does not
hit an absent wall section.

Ray intersection operates on each wall box's actual position, size, and Y-axis
rotation. Only finite intersections in front of the camera count. The eligible
box with the smallest positive entry distance is the first hit. Ties use stable
layout and box order so rendering cannot flicker at a corner.

The selected box is omitted completely from the shot projection. Other boxes
from the same boundary remain rendered, including wall portions around an
opening. Every later wall remains rendered. When no eligible box is hit, no
wall is removed.

## Architecture and data flow

### Pure visibility projection

A focused editor-domain module accepts:

- `SpatialLayout | null`;
- final camera position and rotation.

It returns a stable wall-box key for the first blocker or `null`. The module
owns point-in-polygon, visible-volume containment, camera-forward derivation,
and ray-versus-oriented-box intersection. It does not depend on React, browser
events, the scene store, the bridge, or mutable Three.js scene objects.

### Shot scene projection

`ShotScene` resolves the effective camera transform from the current
authoritative camera plus any matching live transform draft. It passes that
effective transform to both `ShotCamera` and `SceneWorld`.

`SceneWorld` computes the hidden wall-box key only for `view="shot"` and passes
it into the spatial layout projection. Overview and Local preview continue to
use the existing opacity maps without this rule.

The spatial wall renderer gives every derived box the same stable key used by
the pure projection and skips only the matching box. No SceneSpec value is
mutated.

### Export parity

`ShotExporter` renders the current Shot View's Three scene and default final
camera. Because the wall box is omitted in the shared Shot View scene graph,
the connected preview and PNG export use identical geometry without a separate
export-only branch.

Export remains disabled during an uncommitted camera draft under the existing
camera-navigation rules. The live preview can react to the draft, while an
export is produced only from an accepted authoritative revision.

## Failure and edge behavior

- Invalid or missing active camera data produces no automatic wall removal;
  existing scene validation remains authoritative.
- No layout, no visible region, or no visible boundary produces no removal.
- A camera on a region wall, floor, or ceiling boundary counts as inside to
  avoid rapid state changes at exact boundaries.
- A ray parallel to a wall axis is handled without division-by-zero or
  non-finite distances.
- A ray that starts inside a wall box uses its forward exit distance, but the
  existing composition collision report continues to flag the camera-wall
  collision.
- No state, warning, revision, save artifact, or public schema records which
  wall was omitted; it remains derived render state.

## Testing

### Unit tests

The pure visibility projection must prove:

- camera positions inside, on the edge of, laterally outside, above, and below
  visible room volumes;
- no removal for an inside camera;
- first solid box removal for an outside camera aimed through a wall;
- preservation of the second wall and other boxes on the first boundary;
- no removal when the center ray passes through a visible opening;
- rotated wall-box intersection;
- stable tie-breaking at a corner;
- no removal for missing layouts, hidden regions, hidden boundaries, rays
  pointing away, and non-intersecting exterior views.

### UI and integration tests

Tests must prove:

- active Shot Preview suppresses `contextmenu` even after pointer-up cleared the
  right-button gesture;
- inactive or unrelated UI surfaces keep normal context-menu behavior;
- the matching camera transform draft drives live wall removal;
- Shot View receives one effective camera transform for both camera and world
  projection;
- Overview and Local preview do not apply the hidden-wall key;
- ShotExporter remains mounted in the same Shot View scene.

### Repository and browser acceptance

Run schema generation, type checking, the full test suite, lint, production
build, public audit, and `git diff --check`.

In the real embedded browser, use a generic connected-room scene and verify:

1. right-click and right-drag inside active camera adjustment do not open the
   embedded browser menu;
2. right-drag still commits one target-orbit gesture;
3. an inside camera renders every wall;
4. moving the camera outside removes only the first center-ray wall segment;
5. a later wall remains visible and a door opening does not cause removal;
6. returning inside restores the omitted wall automatically;
7. the behavior updates during a live transform draft;
8. the connected 1920 x 1080 PNG matches Shot Preview with the same first wall
   absent;
9. scene ID, accepted revision, PNG dimensions, SHA-256, warnings, and browser
   console state are recorded.

## Acceptance criteria

The change is complete when:

- the embedded browser menu never interrupts active right-button camera
  gestures;
- an outside final camera removes exactly the first solid center-ray wall box;
- openings, remaining wall pieces, and later walls are preserved;
- inside cameras and non-intersecting exterior views render all walls;
- live drafts react immediately but persistence remains unchanged;
- Shot Preview and connected PNG export share the same wall geometry;
- Overview, Local preview, SceneSpec, history, save behavior, public schemas,
  composition analysis, and lock behavior are unchanged;
- public audit finds no private profile data, proprietary asset, credential,
  machine-specific path, or non-generic fixture.
