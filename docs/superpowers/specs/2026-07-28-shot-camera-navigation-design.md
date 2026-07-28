# Shot Camera Navigation Design

**Status:** Approved in conversation on 2026-07-28.

**Scope:** Make the active final camera directly adjustable inside Shot
Preview with mouse and keyboard controls, live draft feedback, lock-preserving
atomic ScenePatch commits, deterministic conflict handling, and real-browser
acceptance.

## Goal

Let a director adjust the final shot while looking through the final camera.
The user must not have to leave Shot Preview, find a camera proxy in Overview,
select a transform gizmo, and repeatedly switch back to Shot Preview to judge
the result.

The first release supports direct camera navigation and focal-length changes:

- left-drag translates the camera in the image plane without changing its
  direction;
- right-drag orbits the camera through 360 degrees around a deterministic
  composition target while keeping that target in view;
- the mouse wheel changes focal length in millimeters without moving the
  camera;
- arrow keys move forward, backward, left, and right;
- `PageUp` and `PageDown` move vertically;
- each complete gesture becomes one revision and one undo step.

## Current problem

The editor currently exposes two disconnected adjustment paths:

1. Shot Preview shows the exact final camera but intentionally hides
   `TransformControls` and provides no direct camera navigation.
2. Overview can show a camera proxy and transform gizmo only after the active
   camera is selected, unlocked, and the translate or rotate tool is chosen.

The global keyboard handler supports `Q`, `W`, `E`, and undo/redo. It has no
handlers for arrow keys, `PageUp`, or `PageDown`. A workflow-locked camera also
disables the current manual transform and focal-length controls. The resulting
workflow requires repeated mode switching and gives no live final framing
while camera position or rotation changes.

## Product boundary

This change includes:

- one explicit Shot Preview camera-adjustment mode;
- active-camera mouse and keyboard navigation;
- live transform and focal-length drafts in the real final-camera renderer;
- deterministic orbit-target derivation from generic scene data;
- workflow-lock preservation without an unlock prompt;
- user-lock blocking without a protected draft;
- gesture-level ScenePatch commits and undo history;
- revision-conflict cancellation;
- keyboard focus and browser-default safeguards;
- unit, component, integration, real-browser, and export verification.

This change does not include:

- animation paths, keyframes, camera rigs, rails, cranes, or handheld motion;
- depth of field, aperture, exposure, focus distance, or render effects;
- saving an orbit target in SceneSpec;
- multiple simultaneous camera views or picture-in-picture layout;
- touch gestures, gamepad controls, or a general DCC navigation system;
- automatic composition, subject tracking, or model-authored camera motion;
- schema-version changes or new public ScenePatch operation types.

## Considered approaches

### Selected: direct Shot Preview camera-adjustment mode

The exact final-camera view becomes the adjustment surface. The user sees the
authoritative composition while moving, orbiting, or changing focal length.
This directly addresses the observed mode-switching problem and keeps the
existing single-canvas renderer.

### Rejected: Overview with a Shot Preview inset

A live inset would preserve spatial context, but it would reduce usable space
in both views, complicate compact layouts, and still split attention between
the edit surface and final framing.

### Rejected: Inspector-only nudge controls

Buttons and numeric inputs are precise but slow. They do not provide the
direct mouse interaction requested for camera placement and would leave the
main Shot Preview read-only.

## Interaction model

### Mode entry and focus

Shot Preview adds one camera-adjustment toggle with a familiar camera/move icon,
an accessible name, a pressed state, and a concise tooltip. It is part of the
existing preview controls rather than a new panel or card.

The toggle is enabled only when:

- the browser is connected to the current scene and revision;
- `activeCameraId` resolves to a camera;
- no load, mutation, save, or export operation blocks interaction; and
- the camera is not user protected.

Entering the mode selects the active camera, focuses the Shot Preview surface,
captures the current scene ID and base revision, and derives one orbit target.
The mode has a visible active state and a compact live focal-length readout.
It does not display instructional copy over the shot.

`Escape` cancels any uncommitted draft and exits the mode. Changing preview
mode, loading or replacing the scene, losing the active camera, or changing the
camera to `user` lock exits the mode. An accepted Patch submitted by this
controller keeps the mode active, advances its base revision, and retains the
current orbit target. An external authoritative revision cancels any active
draft; when the same active camera remains eligible, the mode stays active and
derives a fresh orbit target from the new revision.

### Mouse controls

#### Left drag: image-plane translation

Left-drag moves the camera along its current local right and up axes. Camera
rotation and focal length remain unchanged. Pointer displacement maps to camera
displacement in the same direction: dragging right moves the camera right;
dragging up moves it up.

Translation sensitivity is derived from viewport height, current vertical
field of view, and distance to the orbit target. This keeps apparent movement
usable across focal lengths and scene scales. A minimum positive reference
distance prevents a near-zero target distance from producing an unusable
control.

#### Right drag: target orbit

Right-drag rotates the camera position around the fixed orbit target derived
when adjustment mode starts. The camera continuously looks at that target.
Horizontal movement changes yaw without an artificial limit, allowing a full
360-degree orbit. Vertical movement changes pitch and clamps only close to the
two poles so the camera cannot flip unpredictably.

The orbit radius remains constant. Orbiting changes camera position and
rotation but not focal length. The context menu is suppressed only for a
right-drag that begins inside active camera-adjustment mode.

#### Wheel: focal length

The wheel changes `focalLengthMm` and never changes camera position or
rotation. Wheel-up increases focal length and narrows the field of view;
wheel-down decreases focal length and widens it. The existing schema range of
12 to 300 mm remains authoritative.

Wheel input is normalized across discrete mouse wheels and trackpads. A normal
wheel step changes focal length by 0.5 mm, `Shift` uses 2 mm, and `Alt` uses
0.1 mm. `Alt` precision takes precedence if both modifiers are held.

### Keyboard controls

When Shot Preview has focus and camera-adjustment mode is active:

- `ArrowUp` moves along camera local forward;
- `ArrowDown` moves along camera local backward;
- `ArrowLeft` moves along camera local left;
- `ArrowRight` moves along camera local right;
- `PageUp` moves along world `+Y`;
- `PageDown` moves along world `-Y`.

Keyboard movement preserves camera rotation and focal length. The normal step
is 0.1 m, `Shift` uses 0.5 m, and `Alt` uses 0.02 m. `Alt` precision takes
precedence if both modifiers are held. Native key repeat produces a continuous
local draft; releasing the final held navigation key commits the whole key
sequence once.

The application calls `preventDefault()` for these navigation keys only while
the mode owns focus. Inputs, textareas, selects, content-editable elements, and
the rest of the page retain their native keyboard behavior.

## Orbit target derivation

The orbit target is transient UI state. It is never written to SceneSpec,
ScenePatch, saved scenes, events, logs, or exports.

The target is derived once on mode entry in this order:

1. the anchor of the first valid enabled `keep-visible` constraint for the
   active camera whose subject is also the first matching framing target;
2. the anchor of the first valid enabled `keep-visible` constraint for the
   active camera in canonical constraint order;
3. the visible-bounds center of the first valid framing target;
4. a point on the current camera-forward ray at the positive projected distance
   of the visible scene-bounds center;
5. a point 5 m forward from the camera when no usable visible bounds exist.

For an actor `face` anchor, the target uses the same shared visible-rig anchor
projection used by composition checks. Other supported anchors use their
existing deterministic projection. Invalid, absent, or invisible targets are
skipped rather than guessed from labels.

Left-drag does not change the fixed world-space target. Starting a later
right-drag reuses that target and naturally brings the camera direction back
toward it. Leaving and re-entering adjustment mode derives a fresh target from
the current authoritative revision.

## Draft and commit model

SceneSpec remains the only persistent scene authority. Pointer state, held
keys, orbit target, and draft camera values remain UI state.

Every gesture captures:

- scene ID;
- base revision;
- active camera ID;
- original transform and lens;
- original lock mode;
- derived orbit target when required.

The Shot Preview renderer accepts both a draft camera transform and a draft
focal length. Draft changes update the real final-camera projection immediately
without mutating the authoritative store.

Commit boundaries are:

- pointer-up for one left- or right-drag;
- release of the final held navigation key for one keyboard sequence;
- 180 ms without another wheel event for one wheel burst.

A transform gesture submits one existing `entity.transform.set` operation. A
wheel gesture submits one existing `camera.lens.set` operation. Each Patch uses
the exact captured scene ID and base revision and sets `preserveLock: true`.
No combined gesture needs a new operation type.

One accepted gesture creates exactly one new revision and one undo step. A
no-op gesture submits nothing. Undo and redo restore the complete camera state
through the existing authoritative history.

## Lock behavior

`none` cameras remain `none` after adjustment.

`workflow` cameras can enter adjustment mode without a manual unlock or user
confirmation. Each commit uses `preserveLock: true`, and the accepted camera
remains `workflow`. The UI must not produce an intermediate unlock revision.

`user` cameras cannot enter adjustment mode. The toggle is disabled with a
user-protection tooltip, and mouse, wheel, and navigation-key handlers produce
no draft and no Patch. Explicit user-protection changes remain handled by the
existing lock UI and authorization rules.

## Concurrency and failure handling

The current transform-drag concurrency rules extend to all camera gestures.

If scene ID, active camera ID, or protected state changes while a draft is
active, the gesture is cancelled and the mode exits. If an external revision
changes while a draft is active, the gesture is cancelled but the mode may
remain active under the eligibility rules above. In both cases the draft is
discarded, the latest authoritative camera is rendered, and the existing
readable conflict notice is shown. The implementation does not update only
`baseRevision` and retry an old absolute draft.

The controller distinguishes its own accepted Patch response from an external
revision event. Its own response clears the committed draft, advances the
captured base revision, and keeps the mode active without showing a conflict.

If Patch validation or submission fails, the draft is discarded and the
authoritative transform or lens is restored. The user never remains on a
camera view that exists only in local UI state.

Pointer capture is released on pointer-up, pointer-cancel, mode exit, unmount,
and scene replacement. Lost keyboard focus resolves the current keyboard
gesture against the captured revision: it commits a valid non-no-op draft once
or cancels it if the authoritative scene changed.

Wheel debounce timers are cleared on mode exit, scene change, unmount, and
conflict. Export remains disabled while an uncommitted camera draft exists, so
PNG output cannot race a local-only view.

## Architecture

### Pure navigation math

A focused editor-domain module owns:

- camera local-axis derivation;
- image-plane pan projection;
- world-Y keyboard movement;
- target-orbit quaternion and position calculation;
- pitch clamping and radius preservation;
- focal-length wheel normalization and clamping;
- modifier-based movement steps.

These functions accept plain numeric scene values and return new draft values.
They do not depend on React, browser events, Three.js objects, the store, or the
bridge.

### Shot navigation controller

`ViewportWorkspace` owns or delegates to one controller hook/component that:

- enters and exits adjustment mode;
- owns viewport focus and pointer capture;
- translates mouse, wheel, and keyboard events into pure navigation inputs;
- manages one active gesture session;
- publishes transform and lens drafts;
- submits or cancels at gesture boundaries;
- reacts to authoritative scene and revision changes.

The controller reuses the existing transform-drag session concepts where their
invariants match. It does not make `SceneWorld` or the renderer responsible for
network mutation.

### Final camera projection

`ShotCamera` receives optional draft transform and lens overrides. The shared
Shot Preview and export renderer continue to project one camera. Export can
proceed only after drafts are committed, so exported pixels always correspond
to an authoritative revision.

### Patch authoring and store

Existing manual Patch helpers gain the minimum lock-preserving camera commit
surface needed by the controller. The editor store remains the only UI path to
the local bridge and remains responsible for readable mutation errors,
revision replacement, and undo/redo state.

No runtime language inference, credential, network route, schema migration, or
arbitrary JSON-path mutation is added.

## Accessibility and compact layouts

The adjustment toggle is a real button with `aria-pressed`, a stable accessible
name, disabled-state explanation, and visible focus treatment. Shot Preview is
focusable only as an interactive camera surface and exposes its active mode in
the accessibility tree.

Mouse actions have keyboard equivalents for position movement. Focal length
retains the existing numeric field and slider in addition to wheel input.
Orbit remains pointer-driven in this release; existing numeric rotation fields
remain available for precise keyboard entry.

The mode toggle and focal-length readout fit the existing preview control band
without adding a nested card or reducing the 16:9 shot frame. Controls must not
overlap the mode switcher at supported desktop and compact breakpoints.

## Testing

### Unit tests

Pure navigation tests require:

- left-drag changes position along local right/up and preserves rotation;
- keyboard forward/back and left/right use camera-local axes;
- `PageUp` and `PageDown` use world Y;
- target orbit preserves radius and continues to look at the target;
- yaw supports a complete revolution and pitch does not flip;
- wheel direction and modifier steps are correct;
- focal length clamps to 12 and 300 mm;
- target derivation follows the declared deterministic priority order.

### Component and integration tests

Editor tests require:

- the toggle appears in Shot Preview and owns focus only while active;
- inputs and normal page scrolling are not hijacked outside the mode;
- one drag, held-key sequence, or wheel burst commits once;
- a no-op gesture produces no Patch;
- live transform and lens drafts reach `ShotCamera`;
- workflow locks commit with `preserveLock: true` and remain workflow locked;
- user locks disable the mode and produce no draft;
- external revision, scene replacement, active-camera change, pointer cancel,
  and failed submission clear the draft;
- export cannot run while a camera draft is pending;
- undo and redo restore camera transform and lens exactly.

### Repository gates

Run schema generation, type checking, the full test suite, lint, production
build, public audit, and `git diff --check`. No generated schema should change
unless an unrelated defect is discovered and separately approved.

### Real-browser acceptance

Use a generic connected scene and a workflow-locked active camera. In the real
browser:

1. enter Shot Preview and enable camera adjustment without unlocking;
2. left-drag and confirm image-plane translation with unchanged direction;
3. right-drag around the generic primary subject and confirm target-facing
   360-degree orbit behavior;
4. wheel both directions and confirm focal-length changes with unchanged
   camera transform;
5. use all arrow and page keys, plus normal, `Shift`, and `Alt` steps;
6. confirm inputs do not receive global navigation and page defaults remain
   intact outside the mode;
7. verify every completed gesture advances exactly one revision and preserves
   the workflow lock;
8. undo and redo transform and lens gestures;
9. apply an external revision during a draft and confirm deterministic cancel;
10. user-protect the camera and confirm the mode is disabled;
11. inspect console warnings and errors;
12. commit the final generic camera state, inspect composition, and export a
    1920 x 1080 PNG from the connected current Shot Preview.

Verify the exported scene ID, revision, dimensions, SHA-256, warnings, PNG
signature, IHDR, and full-resolution visual match. Keep all transient scenes,
submissions, screenshots, and exports generic and ignored under `.shubi-shot`.

## Acceptance criteria

The feature is complete when:

- a user can adjust the final camera without leaving Shot Preview;
- the approved mouse and keyboard mappings work only in active adjustment mode;
- visual drafts are immediate but authoritative history is gesture-level;
- workflow locks require no unlock and remain workflow locked;
- user locks prevent all protected drafts and commits;
- orbit targeting is deterministic and transient;
- conflict or submission failure cannot leave a phantom camera view;
- undo, redo, composition inspection, and export use the accepted camera state;
- the real 1920 x 1080 export matches the connected final-camera preview;
- public audit finds no private profile, project-specific asset, credential,
  machine-specific path, or non-generic fixture.
