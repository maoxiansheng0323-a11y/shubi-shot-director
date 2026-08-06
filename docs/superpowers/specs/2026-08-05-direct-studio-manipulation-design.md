# Direct Studio Manipulation Design

**Status:** Approved in conversation on 2026-08-05.

**Scope:** Turn the editor viewport into a directly manageable graybox studio
where actors, props, and shot cameras can be selected, focused, moved, rotated,
and refined while a compact active-camera composition preview remains visible.

## Decision And Supersession

The primary product surface is one game-editor-like 3D studio, not a set of
mutually exclusive full-size preview modes and not a fixed two-column editing
desk.

This specification supersedes only the layout and mode-entry decisions in:

- `2026-07-28-shot-camera-navigation-design.md` that selected a full Shot
  Preview adjustment surface and rejected a small preview;
- `2026-07-28-shot-preview-always-on-camera-controls-design.md` that made the
  full Shot Preview the always-on owner of camera input.

It preserves their accepted draft, revision, undo, lock, conflict, and browser
export invariants. The approved
`2026-08-05-explicit-shot-orbit-target-design.md` remains authoritative for
expanded shot-camera refinement: right-drag rotates freely by default and
target orbit is enabled only by an explicit actor or prop choice.

## Goal

A director should be able to treat the scene as a physical graybox studio:

- freely inspect the complete set from an editor camera;
- select and move an actor, prop, or shot camera where it stands;
- double-click a distant entity to bring it to a standard editing scale;
- manipulate one actor limb according to the current editor viewpoint;
- see the active shot camera's composition in a compact 16:9 preview;
- double-click any shot camera to refine it and make it the current preview and
  export camera;
- keep editor navigation, shot-camera navigation, and scene mutation as
  distinct interaction systems.

## Product Boundary

This change includes:

- a full-size studio editor viewport;
- a compact active-shot-camera preview over the studio;
- click selection and double-click focus/edit state;
- blue ordinary selection, red entity-edit focus, and green actor-part focus;
- direct whole-entity movement plus existing transform gizmos;
- editor-view-relative keyboard movement;
- editor-camera framing and follow behavior for a focused entity;
- explicit active-camera switching for multi-camera scenes;
- direct view-relative single-joint actor manipulation;
- transient drafts, lock preservation, revision conflict handling, undo, and
  browser verification.

This change does not include:

- a production DCC viewport, multi-pane orthographic layout, or general 3D
  engine tooling;
- inverse kinematics for a whole arm or leg chain;
- animation, keyframes, motion paths, physics, or gameplay controls;
- click-to-create cameras, actors, or props;
- batch export of every camera in one command;
- saving editor-camera position, focused entity, selected body part, glow
  state, panel size, or live drafts in `SceneSpec`;
- arbitrary mesh, rig, or skeleton editing;
- changes to SceneSpec, ScenePatch, IntentReport, or Blueprint schema versions.

## Studio Layout

### Main editor viewport

The studio editor occupies the available workspace. Its perspective editor
camera remains UI state and can orbit, pan, and zoom without mutating the
scene. Existing Overview and Local spatial filtering remain available as
editor-view filters; Shot Preview is removed from that mutually exclusive mode
switcher.

The editor camera is never represented by a scene camera entity, never becomes
`activeCameraId`, and never enters save files, Patch submissions, events,
exports, or diagnostics.

### Compact shot-camera preview

A compact 16:9 panel sits over the lower-right portion of the studio without
shrinking the main editor viewport. It shows the browser-rendered composition
of `scene.activeCameraId`, including current actor, prop, camera, and pose
drafts.

The compact panel displays:

- the active camera label;
- a camera selector containing every scene camera in stable entity order;
- the output aspect/resolution label;
- an affordance that the panel can be opened for refinement.

A click on the preview image or its explicit expand affordance opens the
existing full Shot Preview refinement surface. Using the camera selector does
not expand the panel. Compact mode does not own camera pan,
orbit, wheel, or navigation-key gestures; those remain reserved for the studio
until the preview is expanded. Expanded mode uses the approved free rotation,
explicit target lock, focal-length, movement, protection, undo, and export
contracts. Closing expanded mode restores the studio without changing the
editor camera.

The connected compact or expanded preview remains the authoritative browser
renderer for PNG export. Expansion is not required for export, but no local
draft may be pending.

## Multiple Shot Cameras

Every shot camera remains an ordinary camera entity in `SceneSpec`. A scene may
contain multiple cameras, but exactly one `activeCameraId` drives the compact
preview, composition inspection, and one-at-a-time export.

Double-clicking a camera in the studio performs two related actions:

1. it focuses that camera proxy in the editor and enters red entity-edit state;
2. if it is not already active, it submits one existing
   `scene.active-camera.set` Patch and switches the compact preview after that
   revision is accepted.

Choosing a camera in the compact selector performs only the second action. It
does not move the editor camera or select the scene camera proxy. Selecting a
camera once in the studio performs only ordinary scene selection and does not
change `activeCameraId`.

Double-clicking or editing an actor or prop never changes the active shot
camera. The compact preview continues to show the last explicitly activated
shot angle.

Changing the active camera cancels any incompatible shot-camera draft. It does
not mutate the previous camera transform or lens. User protection on a camera
prevents transform and lens mutation but does not prevent using that camera as
the read-only active preview.

Batch camera export, camera ordering metadata, storyboard labels, and camera
creation UI are outside this milestone.

## Selection And Edit States

The editor distinguishes three transient states:

1. **Ordinary selection:** one click sets the existing `selectedEntityId` and
   uses the existing blue selection edge treatment.
2. **Entity edit focus:** double-clicking a supported actor, prop, or camera
   sets `focusedEntityId`, frames it with the editor camera, and replaces blue
   edges with a readable red halo/outline.
3. **Actor-part focus:** while an actor has red entity focus, one click on a
   supported body segment sets `focusedActorJointId`; that segment becomes
   green while the rest of the actor remains red.

Only one entity and one part can be focused. A part focus always belongs to the
currently focused actor and cannot survive an actor change.

The implementation uses deterministic click-count and pointer-movement
thresholds so a drag is never reinterpreted as a double-click. One click on an
unfocused actor selects the actor as a whole; individual body-part hit testing
is enabled only after actor edit focus begins.

A short right-button click on empty studio space or the focused entity clears
part focus, entity focus, and ordinary selection together. A right-button drag
continues to pan the editor camera and does not clear selection. `Escape`
performs the same clear action without affecting the authoritative scene.

Scene replacement, disappearance of the selected entity, or a kind mismatch
clears invalid focus. An external revision may retain focus only when the same
entity and supported actor part still exist; it always cancels an active draft.

## Editor Camera Focus And Follow

Double-clicking a supported entity invokes a deterministic frame-selected
operation on the UI-only editor camera.

The framing helper resolves a finite world-space center and radius:

- actors use their current resolved visible rig bounds;
- props use transformed geometry bounds;
- cameras use a fixed proxy bound transformed into world space.

The editor camera preserves its current viewing direction and moves along that
view ray until the bound fits within a target fraction of both viewport width
and height. The calculation uses the editor camera FOV, viewport aspect ratio,
a stable padding factor, and a minimum distance for very small camera proxies.
It then sets the OrbitControls target to the resolved center.

This produces the requested behavior: from a distant view, double-clicking a
small actor zooms the studio to a standard editing scale without forcing a
canonical front, side, or three-quarter angle. The director can then orbit the
editor camera around that actor and choose the viewpoint that gives the desired
limb-drag meaning.

While red entity focus remains active, accepted or draft whole-entity movement
updates the editor orbit target by the same world-space center delta. The
editor camera translates by that delta as well, preserving its distance and
direction so the focused entity stays framed. Pose-only changes update the
resolved target center but do not force a camera-distance jump.

Clearing focus stops follow behavior but leaves the editor camera at its
current location. Focus and follow never become a shot-camera constraint.

## Whole-Entity Manipulation

### Direct body drag

A focused actor's torso and pelvis are whole-entity handles. Dragging either
one moves the actor transform across the current ground plane while preserving
rotation, scale, resolved stature, pose, and active contact. Contact snapping
continues to own the accepted vertical correction.

A focused prop's rendered body is a whole-entity handle and uses the same
ground-plane drag by default. A focused camera proxy instead uses left-drag for
in-place rotation, while an unfocused camera proxy retains direct ground-plane
movement. Precise translation and rotation remain available through the
existing gizmos and Inspector fields.

The drag plane is derived from the current spatial floor when available and
otherwise uses the scene's default ground Y. Pointer rays intersect that
plane, and the entity maintains its captured pointer-to-origin offset so it
does not jump when the drag starts.

### Transform gizmos

The existing translate and rotate gizmos remain the precise path for actors,
props, and cameras. `W` selects translation, `E` selects rotation, and `Q`
returns to ordinary select mode. Translation uses world axes; rotation uses
entity-local axes. Existing snap behavior remains available.

Workflow-locked entities may use direct drag and gizmos with
`preserveLock: true`; the accepted entity remains workflow locked. A
user-protected entity may be selected and focused for inspection but all
mutation handles are disabled until the existing explicit unlock action is
completed.

### Keyboard movement

When the studio owns focus and a red entity-edit target is eligible:

- arrow keys move in the ground plane relative to the editor camera's projected
  forward and right directions;
- `PageUp` and `PageDown` move along world Y;
- normal, `Shift`, and `Alt` steps reuse the established 0.1 m, 0.5 m, and
  0.02 m distances, with `Alt` precision taking precedence.

Native behavior is preserved for inputs, textareas, selects, content-editable
elements, the compact preview, and expanded Shot Preview. Holding multiple
movement keys creates one local draft and releasing the last key commits one
revision and undo step.

Actors with active ground contact may preview vertical keyboard movement, but
the accepted transform remains subject to deterministic contact enforcement.

## Actor Part Selection

Actor body hits map to canonical puppet joints without adding a new skeleton:

- head, face, and neck geometry map to `neck`;
- shoulder and upper-arm geometry map to `upper_arm_l` or `upper_arm_r`;
- elbow and forearm geometry map to `forearm_l` or `forearm_r`;
- hand geometry maps to `hand_l` or `hand_r`;
- hip and upper-leg geometry map to `upper_leg_l` or `upper_leg_r`;
- knee and lower-leg geometry map to `lower_leg_l` or `lower_leg_r`;
- foot geometry maps to `foot_l` or `foot_r`.

Torso and pelvis remain whole-actor movement handles rather than part-edit
targets. Direct `pelvis` and `spine` rotation continues through the Inspector
in this milestone. An absent limb has no selectable geometry and cannot be
focused. Blueprint modules remain part of the actor entity but are not joint
handles.

The focused body segment uses a green halo/outline that overrides its red actor
outline. The rest of the actor stays red, making the entity/part hierarchy
visible without introducing persistent renderer state.

## View-Relative Limb Drag

Pressing and dragging a supported head or limb segment immediately enters green
part focus and changes exactly one canonical local joint quaternion in that
same gesture. The selected segment rotates around its parent joint origin, and
all descendants move through the existing forward-kinematic projection.

At pointer-down the controller captures:

- scene ID, base revision, and actor ID;
- canonical joint ID and original normalized local quaternion;
- parent joint world frame and selected segment direction;
- editor camera view basis;
- pointer ray and an image-parallel manipulation plane through the joint
  origin.

At pointer-move, the pointer ray intersects the captured plane. The world-space
direction from the joint origin to that point becomes the desired segment
direction. A shortest-arc swing from the captured segment direction to the
desired direction is converted through the captured parent frame and composed
with the original local joint quaternion. The result is normalized and
recomputed from the original capture on every event, so event frequency cannot
change the result.

This makes the gesture editor-view relative:

- from the actor's front, dragging an arm outward creates visible abduction;
- after orbiting the editor camera to the actor's side, dragging in the same
  screen direction moves the arm toward the actor's front or back;
- dragging a forearm rotates at the elbow and carries the hand with it;
- no automatic shoulder/elbow or hip/knee IK solution is introduced.

The view-relative gesture controls swing/bend and side movement. It preserves
the captured axial twist as far as the one-joint shortest-arc construction
allows; exact twist remains available through the existing Inspector Y-axis
control. The gesture does not infer semantic actions or author multiple joint
updates.

Pointer-up submits one existing `actor.pose.joints.set` operation containing
only the selected joint. The accepted pose becomes `pose.custom-v1` under the
existing patch contract. Pointer cancel, right click, Escape, focus change,
scene change, active external revision, missing part, or submission failure
discards the draft and restores the authoritative pose.

## Draft And Patch Model

`SceneSpec` remains the only persistent scene authority. Editor camera,
ordinary selection, entity focus, actor-part focus, pointer capture, key state,
and draft transforms or joints remain UI state.

Each gesture captures the exact scene ID and base revision and commits through
one allowlisted operation:

- entity body drag, transform gizmo, or entity keyboard movement uses
  `entity.transform.set`;
- camera activation uses `scene.active-camera.set`;
- actor-part drag uses `actor.pose.joints.set`;
- expanded shot-camera transform and lens refinement retain their existing
  `entity.transform.set` and `camera.lens.set` paths.

Every complete gesture creates at most one revision and one undo step. No-op
gestures submit nothing. Live entity and pose drafts project into both the
studio and compact shot preview. Export remains disabled while any draft is
active.

The controller never retries an absolute draft against a newer revision. A
stale or conflicting session cancels, displays the authoritative scene, and
uses the existing readable conflict reporting path.

## Component Boundaries

### Pure editor interaction math

Focused modules own deterministic, React-free functions for:

- entity bound center/radius resolution;
- frame-selected editor-camera position and orbit target;
- editor-view-relative ground movement and keyboard axes;
- pointer-ray ground-plane translation;
- actor primitive-to-joint mapping;
- one-joint view-plane direction and quaternion updates.

These functions consume plain scene and numeric values and return drafts. They
do not access the bridge, store, DOM events, or Three.js scene objects.

### Studio interaction controller

`ViewportWorkspace` delegates click timing, focus lifecycle, editor-camera
follow, body drag, keyboard movement, pointer capture, draft publication, and
gesture commit/cancel behavior to a focused controller or small set of focused
components. The controller reuses the existing transform-drag session and shot
gesture invariants where they match.

### Scene projection

`SceneWorld` exposes entity and actor-part hit metadata without becoming a
mutation layer. Actor procedural and refined render paths use the same
primitive IDs and selection colors. The refined built-in mannequin remains a
renderer projection; no asset, mesh node, or renderer option enters scene data.

### Patch authoring and store

The editor adds the minimum manual Patch helpers needed for active-camera
selection and one-joint draft commits. The store remains the only bridge
mutation path and preserves readable errors, lock semantics, history, and
authoritative scene replacement.

## Accessibility And Discoverability

- Ordinary, focused, and part-focused states are not color-only: the Outliner
  and Inspector expose text status for selected entity and selected joint.
- The compact preview is a labeled button-like region with an explicit expand
  name and a keyboard-operable camera selector.
- Double-click focus has an Outliner/Inspector `Focus in studio` alternative.
- Right-click clear has an `Escape` keyboard equivalent.
- Direct body and limb drag retain gizmo or Inspector alternatives for precise
  and keyboard-accessible editing.
- Studio keyboard handlers do not intercept form controls or expanded shot
  camera controls.

## Documentation

README, Skill guidance, and verification records must describe the separated
roles:

- the editor camera is UI-only studio navigation;
- scene camera entities are persistent shot cameras;
- the compact preview shows only the active shot camera;
- double-click frames actors, props, and cameras for editing;
- camera double-click also activates its shot preview;
- red indicates entity edit focus and green indicates a single actor part;
- limb drag follows the current editor viewpoint;
- expanded shot preview defaults to free rotation and uses only explicit target
  lock.

Existing text that says Shot Preview replaces the editor viewport or always
owns camera input must be revised. No public release is implied until the
implemented milestone passes the repository release gate and receives any
required human visual acceptance.

## Testing

Every new behavior begins with a failing test and follows red-green-refactor.

### Pure unit tests

- bounds and frame-selected math fit actor, prop, and camera proxy bounds while
  preserving editor view direction;
- min distance and invalid bounds are deterministic;
- focus follow preserves editor camera offset across entity drafts;
- view-relative arrow axes remain horizontal and normalized;
- pointer ground drag preserves the captured offset;
- every selectable actor primitive maps to the intended canonical joint;
- absent limbs and Blueprint modules are not joint targets;
- front-view and side-view limb drags produce distinct expected world
  directions;
- one-joint drag returns a normalized quaternion and changes no other joint;
- no-op movement and pose gestures are detected.

### Component and integration tests

- studio and compact shot preview render simultaneously from one SceneSpec;
- compact mode does not steal studio camera gestures;
- clicking the compact preview expands it and closing restores the unchanged
  editor camera;
- compact camera selection commits one active-camera revision without studio
  focus;
- camera double-click focuses and activates the camera exactly once;
- actor or prop focus never changes active camera;
- single click, double-click, red focus, green part focus, right-click clear,
  Escape, and right-drag pan follow the declared state machine;
- torso drag moves the actor, while a green limb drag authors only its joint;
- prop and camera direct drags author entity transforms;
- arrow/Page keys commit once and ignore editable HTML controls;
- workflow locks remain workflow, user locks create no drafts, and unlock uses
  the existing explicit path;
- drafts reach studio and compact preview, block export, and clear on success,
  cancel, conflict, or failure;
- undo and redo restore transforms, active camera, and joint pose exactly.

### Repository gates

Run focused tests during each TDD cycle, followed by:

- `pnpm test:parallel`;
- `pnpm test:workspace-e2e`;
- `pnpm verify`;
- `git diff --check`;
- the generic/public audit required by the current release gate.

No generated schema should change. All fixtures, labels, screenshots, logs, and
exports remain generic and contain no external profile content or
machine-specific absolute path.

### Real-browser acceptance

Use a generic scene containing at least two cameras, one actor, one prop, and
one workflow-locked editable entity.

1. start from a distant studio view and double-click the actor;
2. verify the editor camera frames and orbits the actor without changing either
   shot camera;
3. drag the torso and verify the actor, editor focus, and compact composition
   update together in one accepted revision;
4. select an upper arm, verify green part focus, and drag it from front and
   side editor viewpoints;
5. verify only the intended joint changes and descendants follow;
6. double-click the prop, drag it, and verify the active shot camera is
   unchanged;
7. double-click each camera, verify editor framing plus one explicit active
   preview switch, and adjust position and local rotation with gizmos;
8. select cameras from the compact control without changing studio focus;
9. expand the compact preview and verify free rotation, explicit target lock,
   lens control, movement, and return to studio;
10. exercise entity keyboard movement, modifiers, right-click clear, Escape,
    workflow locks, user locks, undo, redo, and external-revision cancel;
11. inspect the browser console and require no unexpected errors or warnings;
12. inspect composition and export a generic 1920 x 1080 PNG from the connected
    current active-camera preview, verifying scene ID, revision, dimensions,
    SHA-256, and warning codes.

## Delivery Sequence

Implementation proceeds as stable, independently verified milestones:

1. studio plus compact active-camera preview and expand/return behavior;
2. selection state, double-click framing, focus follow, red highlight, direct
   entity movement, keyboard movement, and lock-preserving transforms;
3. multi-camera activation and camera refinement integration;
4. actor-part hit mapping, green highlight, view-relative limb draft, and
   one-joint Patch commit;
5. documentation, full gates, real-browser acceptance, and stable milestone
   commits.

The application remains runnable after each milestone. Unrelated assets,
schemas, renderer scope, production image generation, animation, physics, and
project-specific data remain outside the work.

## Acceptance Criteria

The feature is accepted when:

- the main surface behaves as one directly manageable 3D studio;
- editor navigation never mutates or replaces shot cameras;
- a compact preview continuously shows the active persistent shot camera;
- distant actor, prop, and camera proxies can be double-clicked into a stable
  focused editing view;
- actors, props, and cameras support direct and precise transform adjustment;
- camera double-click explicitly switches the preview and export angle;
- red entity and green actor-part states are clear and reversible;
- view-relative limb drag matches front-versus-side editing expectations and
  mutates exactly one canonical joint;
- SceneSpec authority, lock provenance, one-gesture/one-revision history,
  conflict cancellation, undo/redo, composition inspection, and browser export
  remain intact;
- automated gates and real-browser acceptance pass using only generic content.
